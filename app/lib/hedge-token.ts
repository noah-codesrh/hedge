import { RH_EXPLORER } from "./robinhood";

export const HEDGE_CA = "0x48DCA2206189013Fa50b9b2C38233B9363d72bD9";
export const HEDGE_PAIR =
  "0xbe67ce8260d03681734e39bc062145bc47984b7e052b35a2b285a3841a836777";
export const HEDGE_DEXSCREENER = `https://dexscreener.com/robinhood/${HEDGE_PAIR}`;
export const HEDGE_EXPLORER = `${RH_EXPLORER}/token/${HEDGE_CA}`;
export const HEDGE_SITE = "https://hedgeapp.trade";
const HEDGE_DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO = "0x0000000000000000000000000000000000000000";

/** On-chain $HEDGE retired. 20m to dEaD, then buyback burns. */
const KNOWN_BURNS: Array<{ hash: string; amount: number }> = [
  {
    hash: "0x810e6a82ebb12cebb7d0b21c1a57dd51fbab67383954e874d3a5dcd434514724",
    amount: 20_000_000,
  },
  {
    hash: "0xc1d9924f33af390c469d45b55343cdaa7cdd81f546e055e833f9904009dd85be",
    amount: 10_000_000,
  },
  {
    hash: "0x3afe553b727402cdc2778df3ec7d7cc515a9996cc7b1d90b928019e2e8b03c2b",
    amount: 2_158_158.767422545,
  },
];

export type HedgePair = {
  priceUsd: number | null;
};

export type HedgeBurns = {
  total: number;
  latestHash: string | null;
  latestHref: string | null;
};

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function explorerTx(hash: string) {
  return `${RH_EXPLORER}/tx/${hash}`;
}

function hedgeAmount(value: string | undefined, decimals: number) {
  const raw = BigInt(value ?? "0");
  const base = 10n ** BigInt(decimals);
  return Number(raw) / Number(base);
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

export async function fetchHedgeBurns(): Promise<HedgeBurns> {
  const seen = new Set<string>();
  let total = 0;
  let latestHash = KNOWN_BURNS[KNOWN_BURNS.length - 1]?.hash ?? null;

  const add = (hash: string, amount: number) => {
    const key = hash.toLowerCase();
    if (seen.has(key) || !(amount > 0)) return false;
    seen.add(key);
    total += amount;
    return true;
  };

  for (const row of KNOWN_BURNS) add(row.hash, row.amount);

  try {
    const res = await fetch(
      `${RH_EXPLORER}/api/v2/tokens/${HEDGE_CA}/transfers?limit=50`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (res.ok) {
      const raw = (await res.json()) as {
        items?: Array<{
          total?: { value?: string; decimals?: string };
          to?: { hash?: string };
          type?: string;
          method?: string;
          transaction_hash?: string;
        }>;
      };
      let newestFromExplorer = false;
      for (const row of raw.items ?? []) {
        const to = (row.to?.hash ?? "").toLowerCase();
        const kind = `${row.type ?? ""} ${row.method ?? ""}`.toLowerCase();
        const isBurn =
          kind.includes("burn") ||
          to === HEDGE_DEAD.toLowerCase() ||
          to === ZERO;
        if (!isBurn) continue;
        const hash = row.transaction_hash ?? "";
        if (!hash) continue;
        const decimals = Number(row.total?.decimals ?? 18);
        const amount = hedgeAmount(
          row.total?.value,
          Number.isFinite(decimals) ? decimals : 18,
        );
        if (!add(hash, amount)) continue;
        if (!newestFromExplorer) {
          latestHash = hash;
          newestFromExplorer = true;
        }
      }
    }
  } catch {
    /* known burns still stand */
  }

  return {
    total,
    latestHash,
    latestHref: latestHash ? explorerTx(latestHash) : null,
  };
}

export function formatHedgeAmount(n: number | null) {
  if (n == null || !Number.isFinite(n) || n <= 0) return "...";
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString("en-US", {
      maximumFractionDigits: 2,
    })}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toLocaleString("en-US", {
      maximumFractionDigits: 1,
    })}k`;
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
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
