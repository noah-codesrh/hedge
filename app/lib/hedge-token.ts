import { RH_EXPLORER } from "./robinhood";

export const HEDGE_CA = "0x48DCA2206189013Fa50b9b2C38233B9363d72bD9";
export const HEDGE_PAIR =
  "0xbe67ce8260d03681734e39bc062145bc47984b7e052b35a2b285a3841a836777";
export const HEDGE_DEXSCREENER = `https://dexscreener.com/robinhood/${HEDGE_PAIR}`;
export const HEDGE_EXPLORER = `${RH_EXPLORER}/token/${HEDGE_CA}`;

export type HedgePair = {
  priceUsd: number | null;
};

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickPair(pairs: unknown): Record<string, unknown> | null {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const wanted = HEDGE_PAIR.toLowerCase();
  const match = pairs.find(
    (p) =>
      typeof p === "object" &&
      p != null &&
      String((p as { pairAddress?: unknown }).pairAddress).toLowerCase() ===
        wanted,
  );
  const chosen = match ?? pairs[0];
  return typeof chosen === "object" && chosen != null
    ? (chosen as Record<string, unknown>)
    : null;
}

export async function fetchHedgePair(): Promise<HedgePair | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/robinhood/${HEDGE_PAIR}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok) {
      const data: unknown = await res.json();
      const pair = pickPair((data as { pairs?: unknown }).pairs);
      if (pair) return { priceUsd: num(pair.priceUsd) };
    }
  } catch {
    /* fall through to the token lookup */
  }

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${HEDGE_CA}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const pair = pickPair((data as { pairs?: unknown }).pairs);
    return pair ? { priceUsd: num(pair.priceUsd) } : null;
  } catch {
    return null;
  }
}

export function formatTokenUsd(n: number | null) {
  if (n == null || !Number.isFinite(n) || n <= 0) return "...";
  if (n >= 1) {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 4,
    });
  }
  const digits = n >= 0.01 ? 4 : n >= 0.0001 ? 6 : 8;
  return `$${n.toFixed(digits)}`;
}
