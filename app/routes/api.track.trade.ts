import type { Route } from "./+types/api.track.trade";
import { CHALLENGE_LEAGUE, isEplTrade } from "../lib/challenge";
import { requirePrivyUser, userHasWallet } from "../lib/server/privy-auth";
import { supabaseAdmin } from "../lib/server/supabase";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
/** Postgres unique_violation: the same order was already reported. */
const UNIQUE_VIOLATION = "23505";

function text(value: unknown, max = 200) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

function amount(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const db = supabaseAdmin();
  // Tracking is optional; report success so the client never retries in a loop.
  if (!db) return Response.json({ ok: true, recorded: false });

  const { userId, user } = await requirePrivyUser(request);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const wallet = text(body.wallet, 42) ?? "";
  const direction = text(body.direction, 8);
  const outcome = text(body.outcome, 8)?.toLowerCase();
  const usdg = amount(body.usdg);

  if (!ADDR.test(wallet)) {
    return Response.json({ error: "Invalid wallet." }, { status: 400 });
  }
  if (direction !== "buy" && direction !== "sell") {
    return Response.json({ error: "Invalid direction." }, { status: 400 });
  }
  if (outcome !== "yes" && outcome !== "no") {
    return Response.json({ error: "Invalid outcome." }, { status: 400 });
  }
  if (usdg == null) {
    return Response.json({ error: "Invalid amount." }, { status: 400 });
  }
  // Volume is only meaningful for wallets this user actually owns.
  if (!userHasWallet(user, wallet)) {
    return Response.json(
      { error: "That wallet is not linked to this account." },
      { status: 403 },
    );
  }

  const proxyWallet = text(body.proxyWallet, 42);
  const price = amount(body.price);

  const eventSlug = text(body.eventSlug, 200);
  const marketSlug = text(body.marketSlug, 200);
  const title = text(body.title, 300);
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const league = isEplTrade({
    tags: tags as Array<{ slug?: string | null } | string>,
    eventSlug,
    marketSlug,
    title,
  })
    ? CHALLENGE_LEAGUE
    : null;

  const row: Record<string, unknown> = {
    privy_user_id: userId,
    wallet: wallet.toLowerCase(),
    proxy_wallet: proxyWallet && ADDR.test(proxyWallet)
      ? proxyWallet.toLowerCase()
      : null,
    direction,
    outcome,
    outcome_label: text(body.outcomeLabel, 120),
    event_slug: eventSlug,
    market_slug: marketSlug,
    token_id: text(body.tokenId, 120),
    title,
    usdg,
    pusd: amount(body.pusd),
    shares: amount(body.shares),
    price: price != null && price <= 1 ? price : null,
    order_id: text(body.orderId, 120),
    conversion_id: text(body.conversionId, 120),
    league,
  };

  let { error } = await db.from("trades").insert(row);
  if (error?.message?.includes("league")) {
    delete row.league;
    ({ error } = await db.from("trades").insert(row));
  }

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return Response.json({ ok: true, recorded: false, duplicate: true });
    }
    console.error("[track-trade]", error);
    return Response.json({ error: "Could not record the trade." }, { status: 502 });
  }

  return Response.json({ ok: true, recorded: true });
}
