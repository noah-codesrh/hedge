/** USDG parimutuel desk. Odds from the live tape. Pools pay. 1x. No CLOB, no vault. */

import { NATIVE_TOKENS, type NativeQuote } from "./native-tokens";

export const NATIVE_MAX_STAKE = 25;
export const NATIVE_MIN_STAKE = 1;
/** Combined user tickets across every open native market. */
export const NATIVE_USER_CAP = 200;
/** House seed. Zero so a $200 float cannot owe more than the desk cap. */
export const NATIVE_SEED = 0;
export const NATIVE_LOCK_MS = 60 * 60 * 1000;

export type NativeKind = "strike" | "pvp";
export type NativeSide = "a" | "b";
export type NativePhase = "open" | "locked" | "resolved" | "void";
export type NativeMetric = "marketCap" | "price";

export type NativeMarketSpec = {
  slug: string;
  kind: NativeKind;
  tokenA: string;
  tokenB: string | null;
  metric: NativeMetric | null;
};

/** Mcap strike per allowlist name, plus a few PvP cards so leftover names still fight. */
export function nativeDefaultSpecs(): NativeMarketSpec[] {
  const strikes: NativeMarketSpec[] = NATIVE_TOKENS.map((token) => ({
    slug: `${token.symbol.toLowerCase()}-mcap`,
    kind: "strike",
    tokenA: token.symbol,
    tokenB: null,
    metric: "marketCap",
  }));
  const pvps: NativeMarketSpec[] = [
    { slug: "pons-cashcat", kind: "pvp", tokenA: "PONS", tokenB: "CASHCAT", metric: null },
    { slug: "ai-index", kind: "pvp", tokenA: "AI", tokenB: "INDEX", metric: null },
    {
      slug: "stonkbroker-shroom",
      kind: "pvp",
      tokenA: "STONKBROKER",
      tokenB: "SHROOM",
      metric: null,
    },
  ];
  return [...strikes, ...pvps];
}

export function impliedP(side: number, other: number) {
  const total = side + other;
  if (!(total > 0)) return 0.5;
  return side / total;
}

function liveLevel(
  quote: NativeQuote | null | undefined,
  metric: NativeMetric | null,
) {
  if (metric === "price") return quote?.priceUsd ?? null;
  return quote?.marketCap ?? null;
}

/**
 * Odds from the Dexscreener/CoinGecko tape, not from empty pools.
 * Strike: live vs strike. PvP: print from the open snapshot.
 */
export function tapeImpliedP(market: {
  kind: NativeKind;
  metric: NativeMetric | null;
  strike: number | null;
  open_mcap_a: number | null;
  open_mcap_b: number | null;
  poolA: number;
  poolB: number;
  quoteA: NativeQuote | null;
  quoteB: NativeQuote | null;
}) {
  if (market.kind === "strike") {
    const live = liveLevel(market.quoteA, market.metric);
    const strike = market.strike;
    if (!(live != null && live > 0) || !(strike != null && strike > 0)) {
      return impliedP(market.poolA, market.poolB);
    }
    const live2 = live * live;
    const strike2 = strike * strike;
    return live2 / (live2 + strike2);
  }
  const liveA = market.quoteA?.marketCap;
  const liveB = market.quoteB?.marketCap;
  const openA = market.open_mcap_a;
  const openB = market.open_mcap_b;
  if (
    liveA != null &&
    liveB != null &&
    liveA > 0 &&
    liveB > 0 &&
    openA &&
    openA > 0 &&
    openB &&
    openB > 0
  ) {
    const scoreA = liveA / openA;
    const scoreB = liveB / openB;
    if (scoreA + scoreB > 0) return scoreA / (scoreA + scoreB);
  }
  if (liveA != null && liveB != null && liveA + liveB > 0) {
    return liveA / (liveA + liveB);
  }
  return impliedP(market.poolA, market.poolB);
}

export function tapeLine(market: {
  kind: NativeKind;
  metric: NativeMetric | null;
  strike: number | null;
  open_mcap_a: number | null;
  open_mcap_b: number | null;
  token_a: string;
  token_b: string | null;
  quoteA: NativeQuote | null;
  quoteB: NativeQuote | null;
}) {
  if (market.kind === "strike") {
    const live = liveLevel(market.quoteA, market.metric);
    if (!(live != null && live > 0) || !(market.strike != null && market.strike > 0)) {
      return "Waiting on the tape";
    }
    const liveText =
      market.metric === "price" ? `$${live.toPrecision(4)}` : formatMcap(live);
    const strikeText =
      market.metric === "price"
        ? `$${market.strike.toPrecision(4)}`
        : formatMcap(market.strike);
    return `Live ${liveText} · strike ${strikeText}`;
  }
  const liveA = market.quoteA?.marketCap;
  const liveB = market.quoteB?.marketCap;
  const a = market.token_a;
  const b = market.token_b ?? "B";
  if (!(liveA != null && liveA > 0) || !(liveB != null && liveB > 0)) {
    return "Waiting on the tape";
  }
  const openA = market.open_mcap_a;
  const openB = market.open_mcap_b;
  if (openA && openA > 0 && openB && openB > 0) {
    const retA = (liveA - openA) / openA;
    const retB = (liveB - openB) / openB;
    const fmt = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
    return `${a} ${fmt(retA)} · ${b} ${fmt(retB)} from open`;
  }
  return `${a} ${formatMcap(liveA)} · ${b} ${formatMcap(liveB)}`;
}

export function payoutIfWin(stake: number, side: number, other: number) {
  if (!(stake > 0)) return 0;
  const pool = side + other;
  if (!(side > 0)) return 0;
  return (stake * pool) / side;
}

export function multipleIfWin(side: number, other: number) {
  if (!(side > 0)) return 0;
  return (side + other) / side;
}

export function nativePhase(input: {
  now?: number;
  lockAt?: string;
  expiryAt?: string;
  resolvedSide?: NativeSide | "void" | null;
  lock_at?: string;
  expiry_at?: string;
  resolved_side?: NativeSide | "void" | null;
  status?: string | null;
}): NativePhase {
  const resolved = input.resolvedSide ?? input.resolved_side ?? null;
  if (resolved === "void" || input.status === "void") return "void";
  if (input.status === "resolved" || resolved) return "resolved";
  const now = input.now ?? Date.now();
  const lockAt = input.lockAt ?? input.lock_at;
  const expiryAt = input.expiryAt ?? input.expiry_at;
  if (expiryAt && now >= Date.parse(expiryAt)) return "locked";
  if (lockAt && now >= Date.parse(lockAt)) return "locked";
  return "open";
}

/** Live Dexscreener/CoinGecko tape vs the stored strike or open snapshot. */
export function resolveNativeOutcome(
  market: {
    kind: NativeKind;
    metric: NativeMetric | null;
    strike: number | null;
    open_mcap_a: number | null;
    open_mcap_b: number | null;
  },
  quoteA: NativeQuote | null,
  quoteB: NativeQuote | null,
): NativeSide | "void" | null {
  if (market.kind === "strike") {
    const live =
      market.metric === "price" ? quoteA?.priceUsd : quoteA?.marketCap;
    if (live == null || market.strike == null) return null;
    return live >= market.strike ? "a" : "b";
  }
  const liveA = quoteA?.marketCap;
  const liveB = quoteB?.marketCap;
  if (liveA == null || liveB == null) return null;
  const openA = market.open_mcap_a;
  const openB = market.open_mcap_b;
  if (openA && openA > 0 && openB && openB > 0) {
    const retA = (liveA - openA) / openA;
    const retB = (liveB - openB) / openB;
    if (retA === retB) return "void";
    return retA > retB ? "a" : "b";
  }
  if (liveA === liveB) return "void";
  return liveA > liveB ? "a" : "b";
}

export function parseStake(raw: unknown) {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const amount = Math.round(n * 100) / 100;
  if (amount < NATIVE_MIN_STAKE || amount > NATIVE_MAX_STAKE) return null;
  return amount;
}

export function parseSide(raw: unknown): NativeSide | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "a" || s === "yes") return "a";
  if (s === "b" || s === "no") return "b";
  return null;
}

/** Slightly OTM round number from a live mcap or price. */
export function niceStrike(n: number) {
  if (!(n > 0)) return 0;
  const mag = 10 ** Math.floor(Math.log10(n));
  const step = mag >= 1e8 ? mag / 2 : mag / 5;
  return Math.ceil((n * 1.02) / step) * step;
}

export function nextSundayUtc(from = new Date()) {
  const add = (7 - from.getUTCDay()) % 7;
  const candidate = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + add,
      18,
      0,
      0,
    ),
  );
  if (candidate.getTime() - from.getTime() < 18 * 60 * 60 * 1000) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }
  return candidate;
}

export function formatMcap(n: number) {
  if (!(n > 0)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}b`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(2)}`;
}

export function strikeQuestion(symbol: string, strike: number, metric: NativeMetric) {
  const level = metric === "marketCap" ? formatMcap(strike) : `$${strike.toFixed(4)}`;
  const noun = metric === "marketCap" ? "market cap" : "price";
  return `Will ${symbol} ${noun} sit above ${level}?`;
}

export function pvpQuestion(a: string, b: string) {
  return `${a} vs ${b}. Which prints more from the open snapshot?`;
}

export function sideLabel(
  kind: NativeKind,
  side: NativeSide,
  a: string,
  b?: string | null,
) {
  if (kind === "strike") return side === "a" ? "Yes" : "No";
  return side === "a" ? a : (b ?? "B");
}

export type NativeMarketView = {
  id: string;
  slug: string;
  kind: NativeKind;
  title: string;
  token_a: string;
  token_b: string | null;
  metric: NativeMetric | null;
  strike: number | null;
  open_at: string;
  lock_at: string;
  expiry_at: string;
  seed_a: number;
  seed_b: number;
  open_mcap_a: number | null;
  open_mcap_b: number | null;
  open_price_a: number | null;
  open_price_b: number | null;
  resolved_side: NativeSide | "void" | null;
  resolved_at: string | null;
  phase: NativePhase;
  poolA: number;
  poolB: number;
  tickets: number;
  quoteA: NativeQuote | null;
  quoteB: NativeQuote | null;
};

export type NativeTicketView = {
  id: string;
  slug: string;
  title: string;
  kind: NativeKind;
  token_a: string;
  token_b: string | null;
  side: NativeSide;
  amount: number;
  payout: number;
  payoutTx: string | null;
  txHash: string | null;
  phase: NativePhase;
  resolved_side: NativeSide | "void" | null;
  expiry_at: string;
};
