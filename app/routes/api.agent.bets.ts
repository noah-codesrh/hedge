import {
  agentJson,
  agentOptions,
  corsHeaders,
  requireAgent,
} from "../lib/server/agent-auth";
import {
  agentNotionalToday,
  agentOwnsPosition,
  findIdempotentBet,
  insertAgentBet,
  listPublicAgentBets,
} from "../lib/server/agent-bets";
import { listedMarket } from "../lib/server/agent-catalog";
import {
  agentLimits,
  closeAgentPosition,
  openAgentPosition,
} from "../lib/server/agent-executor";

export function headers() {
  return corsHeaders();
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return agentOptions();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "40");
  const bets = await listPublicAgentBets(Number.isFinite(limit) ? limit : 40);
  return agentJson({
    bets: bets.map((b) => ({
      id: b.id,
      at: b.created_at,
      agent: b.agent,
      kind: b.kind,
      marketSlug: b.market_slug,
      title: b.title,
      side: b.side,
      margin: Number(b.margin),
      leverage: Number(b.leverage),
      notional: Number(b.margin) * Number(b.leverage),
      positionId: b.position_id,
      tx: b.tx_hash,
    })),
  });
}

function sideOf(value: unknown): "yes" | "no" | null {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (s === "yes" || s === "long" || s === "true") return "yes";
  if (s === "no" || s === "short") return "no";
  return null;
}

export async function action({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return agentOptions();
  if (request.method !== "POST") {
    return agentJson({ error: "Method not allowed." }, 405);
  }

  const agent = requireAgent(request);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return agentJson({ error: "Invalid JSON." }, 400);
  }

  const actionName = String(body.action ?? "open")
    .trim()
    .toLowerCase();
  const idempotencyKey =
    (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()) ||
    request.headers.get("idempotency-key")?.trim() ||
    null;

  if (idempotencyKey) {
    const prior = await findIdempotentBet(agent.name, idempotencyKey);
    if (prior) {
      return agentJson({
        ok: true,
        replayed: true,
        id: prior.id,
        hash: prior.tx_hash,
        positionId: prior.position_id,
      });
    }
  }

  if (actionName === "close") {
    const positionId = String(body.positionId ?? body.id ?? "").trim();
    if (!positionId) return agentJson({ error: "Missing positionId." }, 400);
    const owns = await agentOwnsPosition(agent.name, positionId);
    if (!owns) {
      return agentJson(
        { error: "That position was not opened by this agent." },
        403,
      );
    }
    const result = await closeAgentPosition(positionId);
    if ("error" in result) return agentJson({ error: result.error }, result.status);
    await insertAgentBet({
      agent: agent.name,
      kind: "close",
      marketSlug: result.marketSlug,
      title: result.title,
      side: result.side,
      margin: 0,
      leverage: 1,
      positionId,
      txHash: result.hash,
      idempotencyKey,
    });
    return agentJson({
      ok: true,
      action: "close",
      hash: result.hash,
      positionId,
    });
  }

  if (actionName !== "open") {
    return agentJson({ error: "action must be open or close." }, 400);
  }

  const side = sideOf(body.side);
  const margin = Number(body.margin);
  const leverage = Number(body.leverage ?? 1);
  const listed = listedMarket({
    marketSlug: typeof body.marketSlug === "string" ? body.marketSlug : undefined,
    marketId: typeof body.marketId === "string" ? body.marketId : undefined,
  });
  if (!listed) return agentJson({ error: "That market is not on the agent wall." }, 404);
  if (!side) return agentJson({ error: "Set side to yes or no." }, 400);
  if (!(margin > 0)) return agentJson({ error: "Set a margin in USDG." }, 400);

  const limits = agentLimits();
  const used = await agentNotionalToday(agent.name);
  const next = used + margin * leverage;
  if (next > limits.dailyNotional + 1e-6) {
    return agentJson(
      {
        error: `Daily notional cap is ${limits.dailyNotional} USDG. Already used ${used.toFixed(2)}.`,
      },
      429,
    );
  }

  const result = await openAgentPosition({
    marketSlug: listed.marketSlug,
    isLong: side === "yes",
    margin,
    leverage,
  });
  if ("error" in result) return agentJson({ error: result.error }, result.status);

  const logged = await insertAgentBet({
    agent: agent.name,
    kind: "open",
    marketSlug: listed.marketSlug,
    title: listed.title,
    side,
    margin,
    leverage,
    positionId: result.positionId,
    txHash: result.hash,
    idempotencyKey,
  });

  return agentJson({
    ok: true,
    action: "open",
    id: logged.id,
    hash: result.hash,
    positionId: result.positionId,
    wallet: result.wallet,
    quote: result.quote,
    marketSlug: listed.marketSlug,
    title: listed.title,
    side,
    margin,
    leverage,
  });
}
