import { useEffect, useState } from "react";

const CLOB = "https://clob.polymarket.com";

/**
 * A book is an optimisation, never a reason to stall. Every caller sits in front
 * of something the user is waiting on, so a slow CLOB has to degrade to "no
 * book" rather than hold the response open.
 */
const BOOK_TIMEOUT_MS = 2_500;

export type Level = { price: number; size: number };
export type OrderBook = { bids: Level[]; asks: Level[] };

export const EMPTY_BOOK: OrderBook = { bids: [], asks: [] };

function levels(raw: unknown, side: "bid" | "ask"): Level[] {
  if (!Array.isArray(raw)) return [];
  const out: Level[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const price = Number((row as { price?: unknown }).price);
    const size = Number((row as { size?: unknown }).size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    if (price <= 0 || price >= 1 || size <= 0) continue;
    out.push({ price, size });
  }
  // The CLOB does not promise an order, and walking a mis-sorted book would
  // quote a fill nobody can get.
  out.sort((a, b) => (side === "ask" ? a.price - b.price : b.price - a.price));
  return out;
}

export async function getOrderBook(
  tokenId: string,
  signal?: AbortSignal,
): Promise<OrderBook> {
  const res = await fetch(
    `${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`,
    {
      headers: { Accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(BOOK_TIMEOUT_MS),
    },
  );
  if (!res.ok) return EMPTY_BOOK;
  const data = (await res.json().catch(() => null)) as {
    bids?: unknown;
    asks?: unknown;
  } | null;
  return {
    bids: levels(data?.bids, "bid"),
    asks: levels(data?.asks, "ask"),
  };
}

export async function getOrderBooks(
  tokenIds: string[],
  timeoutMs = BOOK_TIMEOUT_MS,
) {
  // One shared deadline, so N books cost the same wall clock as one.
  const signal = AbortSignal.timeout(timeoutMs);
  const rows = await Promise.all(
    tokenIds.map(async (id) => {
      try {
        return [id, await getOrderBook(id, signal)] as const;
      } catch {
        return [id, EMPTY_BOOK] as const;
      }
    }),
  );
  return Object.fromEntries(rows) as Record<string, OrderBook>;
}

export function bestAsk(book: OrderBook | undefined) {
  return book?.asks[0]?.price ?? null;
}

export function bestBid(book: OrderBook | undefined) {
  return book?.bids[0]?.price ?? null;
}

export type BuyFill = {
  shares: number;
  spent: number;
  /** Average price actually paid across the levels consumed. */
  avgPrice: number;
  /** Dollars the book could not absorb. */
  unfilled: number;
};

/**
 * What spending `usd` on this book really returns.
 *
 * A market buy lifts the asks in order, so the price paid is the walked average
 * rather than the market's quoted price — on a thin book those are not close.
 */
export function fillBuy(asks: Level[], usd: number): BuyFill {
  let left = usd;
  let shares = 0;
  let spent = 0;
  for (const level of asks) {
    if (left <= 1e-9) break;
    const take = Math.min(level.price * level.size, left);
    shares += take / level.price;
    spent += take;
    left -= take;
  }
  return {
    shares,
    spent,
    avgPrice: shares > 0 ? spent / shares : 0,
    unfilled: Math.max(0, left),
  };
}

export type SellFill = {
  proceeds: number;
  sold: number;
  avgPrice: number;
  /** Shares the book could not absorb. */
  unfilled: number;
};

/** What selling `shares` into this book really returns. */
export function fillSell(bids: Level[], shares: number): SellFill {
  let left = shares;
  let proceeds = 0;
  let sold = 0;
  for (const level of bids) {
    if (left <= 1e-9) break;
    const take = Math.min(level.size, left);
    proceeds += take * level.price;
    sold += take;
    left -= take;
  }
  return {
    proceeds,
    sold,
    avgPrice: sold > 0 ? proceeds / sold : 0,
    unfilled: Math.max(0, left),
  };
}

/**
 * Books for the outcomes of one market, refreshed while the panel is open.
 *
 * Public market data, so this works for signed-out visitors too — the quote has
 * to be honest before anyone connects a wallet.
 */
export function useOrderBooks(tokenIds: (string | null | undefined)[]) {
  const key = tokenIds.filter((id): id is string => Boolean(id)).join(",");
  const [books, setBooks] = useState<Record<string, OrderBook>>({});

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/pm/book?tokenIds=${encodeURIComponent(key)}`,
          { signal: AbortSignal.timeout(BOOK_TIMEOUT_MS) },
        );
        const data = (await res.json()) as { books?: Record<string, OrderBook> };
        if (!cancelled && data.books) setBooks(data.books);
      } catch {
        /* keep the last book rather than blanking the quote */
      }
    };
    void load();
    const timer = window.setInterval(load, 6_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);

  return books;
}
