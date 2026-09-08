/** USDG parimutuel desk. Odds from the live tape. Pools pay. 1x. No CLOB, no vault. */

import { robinhoodTokens, type NativeQuote } from "./native-tokens";

export const NATIVE_MAX_STAKE = 25;
export const NATIVE_MIN_STAKE = 1;
/** Combined user tickets across every open native market. */
export const NATIVE_USER_CAP = 1000;
/** House seed on each side. Zero so open float cannot owe more than the desk cap. */
export const NATIVE_SEED = 0;
/**
 * Desk cover. Not a prize. Open tickets stay inside NATIVE_USER_CAP.
 * Featured races do not add extra USDG to the winning pot.
 */
export const NATIVE_PROTOCOL_BOOST = 0;
/**
 * USDG depth that matches tape weight 1:1. Empty book follows the tape.
 * A filled book pulls displayed odds toward the pools.
 */
export const NATIVE_POOL_BLEND = 100;
/** Desk takes new tickets. Flip off to park /pool without undeploying. */
export const NATIVE_POOL_OPEN = true;
/** Shown next to Refund. Stake back before lock, not a sale at the mark. */
export const POOL_REFUND_COPY =
  "Refund is an undo, not a sale. You get the stake back before lock. After lock the ticket stays until expiry.";
/** Community "hits $1B first" races resolve on live mcap, not return from open. */
export const NATIVE_RACE_TARGET = 1_000_000_000;
/** Biggest Robinhood names ANSEM races against. */
export const TOP_RH_RIVALS = ["MEME", "CASHCAT", "AI", "PONS"] as const;
export const FEATURED_LONG_BASES = [
  "zcat-ansem",
  "zcat-meme",
  ...TOP_RH_RIVALS.map((symbol) => `ansem-${symbol.toLowerCase()}`),
];
export const COMMUNITY_WINDOWS: NativeTimeframe[] = ["4h", "6h", "12h", "24h"];
export const LONG_WINDOWS: NativeTimeframe[] = ["7d", "14d", "30d", "3mo", "6mo"];
export const COMMUNITY_BASES = new Set([
  "cashcat-meme",
  "ai-cashcat",
  ...FEATURED_LONG_BASES,
]);

export type NativeTimeframe =
  | "15m"
  | "1h"
  | "4h"
  | "6h"
  | "12h"
  | "24h"
  | "7d"
  | "14d"
  | "30d"
  | "3mo"
  | "6mo";

const TF_SLUG = "15m|1h|4h|6h|12h|24h|7d|14d|30d|3mo|6mo";
const TF_SLUG_RE = new RegExp(`-(${TF_SLUG})-\\d+$`);

/** Rolling windows. Lock is a slice of the window, not a flat hour. */
export const NATIVE_TIMEFRAMES: {
  id: NativeTimeframe;
  label: string;
  ms: number;
  lockMs: number;
}[] = [
  { id: "15m", label: "15m", ms: 15 * 60 * 1000, lockMs: 60 * 1000 },
  { id: "1h", label: "1h", ms: 60 * 60 * 1000, lockMs: 5 * 60 * 1000 },
  { id: "4h", label: "4h", ms: 4 * 60 * 60 * 1000, lockMs: 15 * 60 * 1000 },
  { id: "6h", label: "6h", ms: 6 * 60 * 60 * 1000, lockMs: 20 * 60 * 1000 },
  { id: "12h", label: "12h", ms: 12 * 60 * 60 * 1000, lockMs: 30 * 60 * 1000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60 * 1000, lockMs: 60 * 60 * 1000 },
  { id: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000, lockMs: 12 * 60 * 60 * 1000 },
  { id: "14d", label: "14d", ms: 14 * 24 * 60 * 60 * 1000, lockMs: 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000, lockMs: 48 * 60 * 60 * 1000 },
  { id: "3mo", label: "3mo", ms: 90 * 24 * 60 * 60 * 1000, lockMs: 7 * 24 * 60 * 60 * 1000 },
  { id: "6mo", label: "6mo", ms: 180 * 24 * 60 * 60 * 1000, lockMs: 14 * 24 * 60 * 60 * 1000 },
];

/** Chart windows on the pool trading panel. Not the ticket lock window. */
export const POOL_CHART_RANGES = [
  { id: "24h", label: "24h", seconds: 86_400 },
  { id: "7d", label: "7d", seconds: 7 * 86_400 },
  { id: "3mo", label: "3mo", seconds: 90 * 86_400 },
  { id: "6mo", label: "6mo", seconds: 180 * 86_400 },
] as const;

export type PoolChartRange = (typeof POOL_CHART_RANGES)[number]["id"];

export function poolChartCutoff(range: PoolChartRange, now = Date.now() / 1000) {
  const row = POOL_CHART_RANGES.find((item) => item.id === range);
  return now - (row?.seconds ?? 7 * 86_400);
}

export function parseNativeTimeframe(raw: unknown): NativeTimeframe {
  const id = String(raw ?? "").trim();
  return NATIVE_TIMEFRAMES.some((row) => row.id === id)
    ? (id as NativeTimeframe)
    : "1h";
}

export function timeframeFromSlug(slug: string): NativeTimeframe | null {
  const match = slug.match(TF_SLUG_RE);
  return match ? (match[1] as NativeTimeframe) : null;
}

export function parseLongTimeframe(raw: unknown): NativeTimeframe {
  const id = String(raw ?? "").trim();
  return LONG_WINDOWS.includes(id as NativeTimeframe)
    ? (id as NativeTimeframe)
    : "7d";
}

export function nativeWindowSlug(
  base: string,
  timeframe: NativeTimeframe,
  expiryMs: number,
) {
  return `${base}-${timeframe}-${Math.floor(expiryMs / 1000)}`;
}

export function nativeWindowsFor(
  timeframe: NativeTimeframe,
  now = Date.now(),
) {
  const spec = NATIVE_TIMEFRAMES.find((row) => row.id === timeframe);
  if (!spec) return [];
  const start = Math.floor(now / spec.ms) * spec.ms;
  const current = {
    openAt: start,
    expiryAt: start + spec.ms,
    lockAt: start + spec.ms - spec.lockMs,
  };
  if (now < current.lockAt) return [current];
  return [
    current,
    {
      openAt: start + spec.ms,
      expiryAt: start + 2 * spec.ms,
      lockAt: start + 2 * spec.ms - spec.lockMs,
    },
  ];
}

/** Open (or next) window slug for this matchup × timeframe. */
export function openNativeSlug(
  base: string,
  timeframe: NativeTimeframe,
  now = Date.now(),
) {
  const windows = nativeWindowsFor(timeframe, now);
  const open =
    windows.find((row) => now < row.lockAt) ?? windows[windows.length - 1];
  if (!open) return null;
  return nativeWindowSlug(base, timeframe, open.expiryAt);
}

export function stakeTimeframes(market: {
  slug: string;
  title?: string | null;
  kind: NativeKind;
}): NativeTimeframe[] {
  if (isLongRace(market.slug)) return [...LONG_WINDOWS];
  if (isCommunityMarket(market.slug, market.title)) return [...COMMUNITY_WINDOWS];
  return NATIVE_TIMEFRAMES.filter((row) => !LONG_WINDOWS.includes(row.id)).map(
    (row) => row.id,
  );
}

export type RollingNativeSpec = {
  spec: NativeMarketSpec;
  timeframe: NativeTimeframe;
  slug: string;
  openAt: Date;
  lockAt: Date;
  expiryAt: Date;
};

/** Current (and next, if this window is locking) card per name × timeframe. */
export function rollingNativeSpecs(now = Date.now()): RollingNativeSpec[] {
  const bases = nativeDefaultSpecs();
  const rows: RollingNativeSpec[] = [];
  for (const tf of NATIVE_TIMEFRAMES) {
    for (const window of nativeWindowsFor(tf.id, now)) {
      for (const spec of bases) {
        if (spec.timeframes && !spec.timeframes.includes(tf.id)) continue;
        rows.push({
          spec,
          timeframe: tf.id,
          slug: nativeWindowSlug(spec.slug, tf.id, window.expiryAt),
          openAt: new Date(window.openAt),
          lockAt: new Date(window.lockAt),
          expiryAt: new Date(window.expiryAt),
        });
      }
    }
  }
  return rows;
}

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
  prompt?: string;
  featured?: boolean;
  timeframes?: NativeTimeframe[];
};

export function nativeBaseSlug(slug: string) {
  return slug.replace(TF_SLUG_RE, "");
}

export function isLongRace(slug: string) {
  return FEATURED_LONG_BASES.includes(nativeBaseSlug(slug));
}

/** Overlay on the winning pot. Off: $1,000 is desk cover, not a prize. */
export function protocolBoost(slug: string) {
  return isLongRace(slug) ? NATIVE_PROTOCOL_BOOST : 0;
}

export function isDroppedNativeMarket(
  slug: string,
  tokenA?: string | null,
  tokenB?: string | null,
) {
  const base = nativeBaseSlug(slug);
  if (base === "ansemcat-meme") return true;
  if (base.startsWith("zcat-") && base !== "zcat-ansem" && base !== "zcat-meme") {
    return true;
  }
  if (/^(zcat|ansem)-mcap/.test(base)) return true;
  const a = (tokenA ?? "").toLowerCase();
  const b = (tokenB ?? "").toLowerCase();
  return a === "ansemcat" || b === "ansemcat";
}

export function isCommunityMarket(slug: string, title?: string | null) {
  if (isDroppedNativeMarket(slug)) return false;
  if (COMMUNITY_BASES.has(nativeBaseSlug(slug))) return true;
  return Boolean(title && /hits \$1\.00b first/i.test(title) && !/AnsemCat/i.test(title));
}

/** Stable room per matchup so chat survives rolling windows. */
export function poolChatId(slug: string) {
  return nativeBaseSlug(slug).slice(0, 64);
}

function isRaceMarket(market: { kind?: NativeKind; slug?: string; title?: string | null; token_a?: string; token_b?: string | null }) {
  if (market.kind && market.kind !== "pvp") return false;
  if (market.slug && isDroppedNativeMarket(market.slug, market.token_a, market.token_b)) {
    return false;
  }
  if (market.slug && COMMUNITY_BASES.has(nativeBaseSlug(market.slug))) return true;
  return Boolean(market.title && /hits \$1\.00b first/i.test(market.title) && !/AnsemCat/i.test(market.title));
}

/** Mcap strike per allowlist name, PvP cards, and community $1B races. */
export function nativeDefaultSpecs(): NativeMarketSpec[] {
  const strikes: NativeMarketSpec[] = robinhoodTokens().map((token) => ({
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
  const community: NativeMarketSpec[] = [
    {
      slug: "zcat-ansem",
      kind: "pvp",
      tokenA: "ZCAT",
      tokenB: "ANSEM",
      metric: null,
      featured: true,
      timeframes: LONG_WINDOWS,
      prompt: raceQuestion("ZCAT", "ANSEM"),
    },
    {
      slug: "zcat-meme",
      kind: "pvp",
      tokenA: "ZCAT",
      tokenB: "MEME",
      metric: null,
      featured: true,
      timeframes: LONG_WINDOWS,
      prompt: raceQuestion("ZCAT", "MEME"),
    },
    ...TOP_RH_RIVALS.map((symbol) => ({
      slug: `ansem-${symbol.toLowerCase()}`,
      kind: "pvp" as const,
      tokenA: "ANSEM",
      tokenB: symbol,
      metric: null,
      featured: true,
      timeframes: LONG_WINDOWS,
      prompt: raceQuestion("ANSEM", symbol),
    })),
    {
      slug: "cashcat-meme",
      kind: "pvp",
      tokenA: "CASHCAT",
      tokenB: "MEME",
      metric: null,
      featured: true,
      timeframes: COMMUNITY_WINDOWS,
      prompt: raceQuestion("CASHCAT", "MEME"),
    },
    {
      slug: "ai-cashcat",
      kind: "pvp",
      tokenA: "AI",
      tokenB: "CASHCAT",
      metric: null,
      featured: true,
      timeframes: COMMUNITY_WINDOWS,
      prompt: raceQuestion("AI", "CASHCAT"),
    },
  ];
  return [...community, ...strikes, ...pvps];
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
 * Strike: live vs strike. Race: live mcap toward $1B. PvP: print from open.
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
  slug?: string;
  title?: string | null;
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
  if (isRaceMarket(market)) {
    if (liveA != null && liveB != null && liveA + liveB > 0) {
      return liveA / (liveA + liveB);
    }
    return impliedP(market.poolA, market.poolB);
  }
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

/**
 * Displayed chance. Tape is the prior. The USDG book pulls it as tickets land.
 */
export function displayImpliedP(market: Parameters<typeof tapeImpliedP>[0]) {
  const tape = tapeImpliedP(market);
  const depth = Math.max(0, market.poolA) + Math.max(0, market.poolB);
  if (!(depth > 0)) return tape;
  const book = impliedP(market.poolA, market.poolB);
  const weight = depth / (depth + NATIVE_POOL_BLEND);
  return tape * (1 - weight) + book * weight;
}

export function poolImpliedP(poolA: number, poolB: number) {
  return impliedP(poolA, poolB);
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
  slug?: string;
  title?: string | null;
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
  if (isRaceMarket(market)) {
    return `${a} ${formatMcap(liveA)} · ${b} ${formatMcap(liveB)} · first to ${formatMcap(NATIVE_RACE_TARGET)}`;
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

export function payoutIfWin(
  stake: number,
  side: number,
  other: number,
  boost = 0,
) {
  if (!(stake > 0)) return 0;
  const extra = Math.max(0, boost);
  const pool = side + other + extra;
  if (!(side > 0)) return 0;
  return (stake * pool) / side;
}

export function multipleIfWin(side: number, other: number, boost = 0) {
  if (!(side > 0)) return 0;
  return (side + other + Math.max(0, boost)) / side;
}

/** Split a winning ticket into stake back, liquidated side, and Hedge overlay. */
export function winBreakdown(
  stake: number,
  side: number,
  other: number,
  boost = 0,
) {
  const extra = Math.max(0, boost);
  if (!(stake > 0) || !(side > 0)) {
    return { payout: 0, returned: 0, fromOthers: 0, fromHedge: 0 };
  }
  return {
    payout: (stake * (side + other + extra)) / side,
    returned: stake,
    fromOthers: (stake * other) / side,
    fromHedge: (stake * extra) / side,
  };
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
    slug?: string;
    title?: string | null;
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
  if (isRaceMarket(market)) {
    if (liveA === liveB) return "void";
    return liveA > liveB ? "a" : "b";
  }
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

export function remainingWindow(iso: string, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return "ended";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m left";
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    const restH = hours % 24;
    return restH ? `${days}d ${restH}h left` : `${days}d left`;
  }
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
}

export function strikeQuestion(symbol: string, strike: number, metric: NativeMetric) {
  const level = metric === "marketCap" ? formatMcap(strike) : `$${strike.toFixed(4)}`;
  const noun = metric === "marketCap" ? "market cap" : "price";
  return `Will ${symbol} ${noun} sit above ${level}?`;
}

export function pvpQuestion(a: string, b: string) {
  return `${a} vs ${b}. Which prints more from the open snapshot?`;
}

export function raceQuestion(a: string, b: string, target = NATIVE_RACE_TARGET) {
  return `Which memecoin hits ${formatMcap(target)} first: ${a} or ${b}?`;
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
  timeframe: NativeTimeframe | null;
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
  protocolBoost: number;
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
  wallet?: string | null;
  phase: NativePhase;
  resolved_side: NativeSide | "void" | null;
  expiry_at: string;
  /** Window this ticket was bought on, e.g. 24h / 7d / 3mo. */
  timeframe?: NativeTimeframe | null;
  /** Live chance of this ticket's side, 0–1. */
  implied: number;
  created_at?: string | null;
};

/** Sponsored gas Hedge covers on the mark so a fresh ticket is not red from fees. */
export const POOL_GAS_COVER = 0.05;
/** Extra opening print on top of gas. pnlTone needs more than $0.004 to go green. */
export const POOL_OPENING_EDGE = 0.012;

export type NativeTicketMark = {
  entryPrice: number;
  markPrice: number;
  currentValue: number;
  pnl: number;
  pctChange: number;
};

function clampChance(p: number) {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(0.99, Math.max(0.01, p));
}

/**
 * Mark a pool ticket the same way a spot ticket is marked: chance as share
 * price. PvP / community open even, so entry is 50¢. Now is the live token
 * chance. Empty books would MTM under cost; gas cover plus the chance move
 * vs 50¢ keep a fresh ticket green until the tape actually turns.
 */
export function markNativeTicket(ticket: NativeTicketView): NativeTicketMark {
  const stake = Math.max(0, ticket.amount);
  const gas = POOL_GAS_COVER;
  const implied = clampChance(ticket.implied);
  const payout = Math.max(0, ticket.payout);

  if (ticket.resolved_side === "void") {
    const currentValue = stake + (ticket.payoutTx ? gas : 0);
    const pnl = currentValue - stake;
    return {
      entryPrice: 0.5,
      markPrice: implied,
      currentValue,
      pnl,
      pctChange: stake > 0 ? pnl / stake : 0,
    };
  }

  if (ticket.resolved_side && ticket.side !== ticket.resolved_side) {
    return {
      entryPrice: 0.5,
      markPrice: 0.01,
      currentValue: 0,
      pnl: -stake,
      pctChange: stake > 0 ? -1 : 0,
    };
  }

  if (ticket.resolved_side === ticket.side || ticket.payoutTx) {
    const currentValue = payout + (ticket.payoutTx ? gas : 0);
    const pnl = currentValue - stake;
    return {
      entryPrice: clampChance(stake / Math.max(payout, stake)),
      markPrice: 0.99,
      currentValue,
      pnl,
      pctChange: stake > 0 ? pnl / stake : 0,
    };
  }

  const chanceMark =
    stake * (implied / 0.5) + gas + POOL_OPENING_EDGE * stake;
  const potMark = implied * payout + gas;
  const floor = stake + gas + POOL_OPENING_EDGE * stake;
  // Fresh tickets stay green unless the tape has clearly moved against you.
  const tapeHit = implied < 0.47;
  const currentValue = tapeHit
    ? Math.max(chanceMark, potMark)
    : Math.max(chanceMark, potMark, floor);
  const pnl = currentValue - stake;
  return {
    entryPrice: 0.5,
    markPrice: implied,
    currentValue,
    pnl,
    pctChange: stake > 0 ? pnl / stake : 0,
  };
}

export function nativeTicketFromMarket(
  market: NativeMarketView,
  stake: {
    id?: string;
    side: NativeSide;
    amount: number;
    payout: number;
    payoutTx?: string | null;
    txHash?: string | null;
    wallet?: string | null;
    created_at?: string | null;
  },
): NativeTicketView {
  const pA = displayImpliedP(market);
  return {
    id: stake.id ?? stake.txHash ?? `${market.slug}:${stake.side}`,
    slug: market.slug,
    title: market.title,
    kind: market.kind,
    token_a: market.token_a,
    token_b: market.token_b,
    side: stake.side,
    amount: stake.amount,
    payout: stake.payout,
    payoutTx: stake.payoutTx ?? null,
    txHash: stake.txHash ?? null,
    wallet: stake.wallet ?? null,
    phase: market.phase,
    resolved_side: market.resolved_side,
    expiry_at: market.expiry_at,
    timeframe: market.timeframe ?? timeframeFromSlug(market.slug),
    implied: stake.side === "a" ? pA : 1 - pA,
    created_at: stake.created_at ?? null,
  };
}

export function ticketCanRefund(
  ticket: Pick<NativeTicketView, "phase" | "payoutTx" | "resolved_side">,
) {
  return (
    ticket.phase === "open" &&
    !ticket.payoutTx &&
    ticket.resolved_side == null
  );
}
