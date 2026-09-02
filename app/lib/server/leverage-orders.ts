import { LEVERAGE_MARKETS } from "../leverage";
import { PRICE_BAND } from "../leverage";
import type { LeverageOrder } from "../leverage-chain";
import { supabaseAdmin } from "./supabase";

const GAMMA = "https://gamma-api.polymarket.com";

type Row = {
  id: string;
  market_slug: string;
  is_long: boolean;
  trigger_above: boolean;
  margin: number | string;
  leverage: number | string;
  limit_price: number | string;
  position_id: string | null;
  kind: "open" | "close";
  status: string;
};

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function orderFillable(
  kind: "open" | "close",
  isLong: boolean,
  triggerAbove: boolean,
  mark: number,
  limitPrice: number,
) {
  if (!(mark > 0)) return false;
  if (kind === "open") {
    if (mark < PRICE_BAND.min || mark > PRICE_BAND.max) return false;
    return isLong ? mark <= limitPrice : mark >= limitPrice;
  }
  return triggerAbove ? mark >= limitPrice : mark <= limitPrice;
}

export async function yesMark(slug: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${GAMMA}/markets?slug=${encodeURIComponent(slug)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { outcomePrices?: string }[];
    const prices = JSON.parse(rows[0]?.outcomePrices ?? "[]") as string[];
    const yes = Number(prices[0]);
    return Number.isFinite(yes) ? yes : null;
  } catch {
    return null;
  }
}

function toOrder(row: Row, mark: number | null): LeverageOrder {
  const known = LEVERAGE_MARKETS.find((m) => m.marketSlug === row.market_slug);
  const kind = row.kind;
  const limitPrice = num(row.limit_price);
  return {
    id: row.id,
    marketId: row.market_slug,
    marketSlug: row.market_slug,
    label: known?.title ?? row.market_slug,
    isLong: row.is_long,
    isClose: kind === "close",
    triggerAbove: row.trigger_above,
    margin: num(row.margin),
    leverage: num(row.leverage),
    limitPrice,
    positionId: row.position_id,
    fillable:
      mark != null &&
      orderFillable(kind, row.is_long, row.trigger_above, mark, limitPrice),
  };
}

export async function listUserOrders(userId: string): Promise<LeverageOrder[]> {
  const db = supabaseAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from("leverage_orders")
    .select(
      "id, market_slug, is_long, trigger_above, margin, leverage, limit_price, position_id, kind, status",
    )
    .eq("privy_user_id", userId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[leverage-orders] list", error);
    return [];
  }
  const rows = (data ?? []) as Row[];
  const slugs = [...new Set(rows.map((r) => r.market_slug))];
  const marks = new Map<string, number | null>();
  await Promise.all(
    slugs.map(async (slug) => {
      marks.set(slug, await yesMark(slug));
    }),
  );
  return rows.map((row) => toOrder(row, marks.get(row.market_slug) ?? null));
}

export async function insertUserOrder(input: {
  userId: string;
  wallet: string;
  kind: "open" | "close";
  marketSlug: string;
  isLong: boolean;
  triggerAbove: boolean;
  margin: number;
  leverage: number;
  limitPrice: number;
  positionId: string | null;
}) {
  const db = supabaseAdmin();
  if (!db) {
    return { error: "Limits are not connected yet.", status: 503 as const };
  }
  if (!(input.limitPrice > 0 && input.limitPrice < 1)) {
    return { error: "Set a limit between 1¢ and 99¢.", status: 400 as const };
  }
  const { error } = await db.from("leverage_orders").insert({
    privy_user_id: input.userId,
    wallet: input.wallet,
    kind: input.kind,
    market_slug: input.marketSlug,
    is_long: input.isLong,
    trigger_above: input.triggerAbove,
    margin: input.margin,
    leverage: input.leverage,
    limit_price: input.limitPrice,
    position_id: input.positionId,
    status: "open",
  });
  if (error) {
    console.error("[leverage-orders] insert", error);
    return { error: "Could not rest that limit.", status: 500 as const };
  }
  return { ok: true as const };
}

export async function cancelUserOrder(userId: string, id: string) {
  const db = supabaseAdmin();
  if (!db) return { error: "Limits are not connected yet.", status: 503 as const };
  const { error } = await db
    .from("leverage_orders")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("privy_user_id", userId)
    .eq("status", "open");
  if (error) {
    console.error("[leverage-orders] cancel", error);
    return { error: "Could not cancel that limit.", status: 500 as const };
  }
  return { ok: true as const };
}

export async function fillUserOrder(userId: string, id: string) {
  const db = supabaseAdmin();
  if (!db) return { error: "Limits are not connected yet.", status: 503 as const };
  const { error } = await db
    .from("leverage_orders")
    .update({ status: "filled" })
    .eq("id", id)
    .eq("privy_user_id", userId)
    .eq("status", "open");
  if (error) {
    console.error("[leverage-orders] fill", error);
    return { error: "Could not close that limit.", status: 500 as const };
  }
  return { ok: true as const };
}
