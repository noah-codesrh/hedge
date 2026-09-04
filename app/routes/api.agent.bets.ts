import {
  agentJson,
  agentKeysConfigured,
  agentOptions,
  corsHeaders,
  identifyAgent,
} from "../lib/server/agent-auth";
import {
  agentNotionalToday,
  findIdempotentBet,
  insertAgentBet,
  listPublicAgentBets,
} from "../lib/server/agent-bets";
import { listedMarket, resolveAgentMarket } from "../lib/server/agent-catalog";
import {
  agentLimits,
  buildCloseTicket,
  buildOpenTicket,
  confirmAgentTx,
  parseAgentWallet,
} from "../lib/server/agent-executor";
import type { Hex } from "viem";

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

function agentLabel(from: string, named: { name: string } | null) {
  return named?.name ?? from.toLowerCase();
}

export async function action({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return agentOptions();
  if (request.method !== "POST") {
    return agentJson({ error: "Method not allowed." }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return agentJson({ error: "Invalid JSON." }, 400);
  }

  const from = parseAgentWallet(body.from ?? body.wallet);
  if (!from) {
    return agentJson(
      { error: "Set from to the agent wallet that will sign the ticket." },
      400,
    );
  }

  const named = identifyAgent(request);
  const label = agentLabel(from, named);
  const actionName = String(body.action ?? "open")
    .trim()
    .toLowerCase();
  const idempotencyKey =
    (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()) ||
    request.headers.get("idempotency-key")?.trim() ||
    null;

  if (idempotencyKey) {
    const prior = await findIdempotentBet(label, idempotencyKey);
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

  if (actionName === "submit") {
    const hash = String(body.hash ?? "").trim() as Hex;
    if (!hash.startsWith("0x") || hash.length < 66) {
      return agentJson({ error: "Missing tx hash." }, 400);
    }
    const result = await confirmAgentTx({ from, hash });
    if ("error" in result) return agentJson({ error: result.error }, result.status);
    const listed = listedMarket({
      marketSlug: typeof body.marketSlug === "string" ? body.marketSlug : undefined,
      marketId: typeof body.marketId === "string" ? body.marketId : undefined,
    });
    const kind = String(body.kind ?? "open") === "close" ? "close" : "open";
    const side = sideOf(body.side) ?? "yes";
    await insertAgentBet({
      agent: label,
      kind,
      marketSlug: listed?.marketSlug ?? "",
      title: listed?.title ?? null,
      side,
      margin: Number(body.margin) || 0,
      leverage: Number(body.leverage) || 1,
      positionId: result.positionId,
      txHash: result.hash,
      idempotencyKey,
    });
    return agentJson({
      ok: true,
      action: "submit",
      from,
      hash: result.hash,
      positionId: result.positionId,
    });
  }

  if (actionName === "close") {
    const positionId = String(body.positionId ?? body.id ?? "").trim();
    if (!positionId) return agentJson({ error: "Missing positionId." }, 400);
    const result = await buildCloseTicket({ from, positionId });
    if ("error" in result) return agentJson({ error: result.error }, result.status);
    return agentJson({
      ok: true,
      action: "close",
      from,
      chainId: result.chainId,
      calls: result.calls,
      positionId: result.positionId,
      marketSlug: result.marketSlug,
      title: result.title,
      side: result.side,
      next: "Sign and send calls from `from`, then POST action=submit with the hash.",
    });
  }

  if (actionName !== "open") {
    return agentJson({ error: "action must be open, close, or submit." }, 400);
  }

  const side = sideOf(body.side);
  const margin = Number(body.margin);
  const leverage = Number(body.leverage ?? 1);
  const target = await resolveAgentMarket({
    marketSlug: typeof body.marketSlug === "string" ? body.marketSlug : undefined,
    marketId: typeof body.marketId === "string" ? body.marketId : undefined,
  });
  if (!target) {
    return agentJson({ error: "No live market with that slug or id." }, 404);
  }
  if (target.desk !== "leverage" || !target.openable) {
    return agentJson(
      {
        error:
          "This market is 1x. Quote it here and fill in the app. Vault tickets are only on listed leverage names.",
        desk: target.desk,
        ticketUrl: target.ticketUrl,
      },
      409,
    );
  }
  if (!side) return agentJson({ error: "Set side to yes or no." }, 400);
  if (!(margin > 0)) return agentJson({ error: "Set a margin in USDG." }, 400);

  const limits = agentLimits();
  const used = await agentNotionalToday(label);
  const next = used + margin * leverage;
  if (next > limits.dailyNotional + 1e-6) {
    return agentJson(
      {
        error: `Daily notional cap is ${limits.dailyNotional} USDG. Already used ${used.toFixed(2)}.`,
      },
      429,
    );
  }

  const result = await buildOpenTicket({
    from,
    marketSlug: target.marketSlug,
    isLong: side === "yes",
    margin,
    leverage,
  });
  if ("error" in result) return agentJson({ error: result.error }, result.status);

  return agentJson({
    ok: true,
    action: "open",
    from,
    chainId: result.chainId,
    token: result.token,
    calls: result.calls,
    quote: result.quote,
    desk: target.desk,
    marketSlug: target.marketSlug,
    title: target.title,
    side,
    margin,
    leverage,
    keysOptional: !agentKeysConfigured(),
    next: "Sign and send each call from `from` (the agent wallet). Then POST action=submit with the open hash.",
  });
}
