import {
  NATIVE_CHAIN,
  NATIVE_TOKENS,
  nativeChainOf,
  nativeToken,
  type NativeChain,
  type NativeQuote,
  type NativeToken,
} from "../native-tokens";

export type { NativeQuote };

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

type Pair = {
  chainId?: string;
  url?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string | number;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  info?: { imageUrl?: string };
};

type GeckoMarket = {
  id?: string;
  image?: string;
  current_price?: number;
  market_cap?: number;
  total_volume?: number;
  price_change_percentage_24h?: number | null;
};

function emptyQuote(symbol: string): NativeQuote {
  const token = nativeToken(symbol);
  return {
    symbol: token?.symbol ?? symbol,
    name: token?.name ?? symbol,
    address: token?.address ?? "",
    priceUsd: null,
    marketCap: null,
    liquidity: null,
    volume24h: null,
    change24h: null,
    image: null,
    pairUrl: token?.pairUrl ?? null,
  };
}

function pickPair(pairs: Pair[], token: NativeToken) {
  const wanted = token.address.toLowerCase();
  const chain = nativeChainOf(token);
  const onChain = pairs.filter(
    (p) =>
      p.chainId === chain &&
      p.baseToken?.address?.toLowerCase() === wanted,
  );
  const pool =
    onChain.length > 0
      ? onChain
      : pairs.filter((p) => p.baseToken?.address?.toLowerCase() === wanted);
  return pool.reduce<Pair | null>((best, pair) => {
    const liq = num(pair.liquidity?.usd) ?? 0;
    const bestLiq = num(best?.liquidity?.usd) ?? 0;
    return liq >= bestLiq ? pair : best;
  }, null);
}

function quoteFromPair(token: NativeToken, pair: Pair): NativeQuote {
  return {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    priceUsd: num(pair.priceUsd),
    marketCap: num(pair.marketCap) ?? num(pair.fdv),
    liquidity: num(pair.liquidity?.usd),
    volume24h: num(pair.volume?.h24),
    change24h: num(pair.priceChange?.h24),
    image: pair.info?.imageUrl ?? null,
    pairUrl: pair.url ?? token.pairUrl ?? null,
  };
}

function needsGecko(quote: NativeQuote) {
  return quote.priceUsd == null || quote.marketCap == null;
}

const FRESH_MS = 15_000;
const STALE_MS = 5 * 60_000;
const DEX_TIMEOUT_MS = 2_500;
const GECKO_TIMEOUT_MS = 2_500;
let dexCache: { at: number; pairs: Pair[] } | null = null;
let geckoCache: { at: number; byId: Map<string, GeckoMarket> } | null = null;
let dexInflight: Promise<Pair[]> | null = null;
let geckoInflight: Promise<Map<string, GeckoMarket>> | null = null;

async function fetchDexTokenPairs(addresses: string[]) {
  if (addresses.length === 0) return [] as Pair[];
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${addresses.join(",")}`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DEX_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    console.error("[native] dexscreener", res.status);
    return [] as Pair[];
  }
  const data = (await res.json()) as { pairs?: Pair[] };
  return Array.isArray(data.pairs) ? data.pairs : [];
}

async function refreshDexPairs() {
  if (dexInflight) return dexInflight;
  dexInflight = (async () => {
    const rh = NATIVE_TOKENS.filter((t) => nativeChainOf(t) === "robinhood");
    const sol = NATIVE_TOKENS.filter((t) => nativeChainOf(t) === "solana");
    const [rhPairs, solPairs] = await Promise.all([
      fetchDexTokenPairs(rh.map((t) => t.address)),
      fetchDexTokenPairs(sol.map((t) => t.address)),
    ]);
    const pairs = [...rhPairs, ...solPairs];
    if (pairs.length > 0 || !dexCache) dexCache = { at: Date.now(), pairs };
    return dexCache?.pairs ?? pairs;
  })()
    .catch((error) => {
      console.error("[native] dexscreener", error);
      return dexCache?.pairs ?? [];
    })
    .finally(() => {
      dexInflight = null;
    });
  return dexInflight;
}

async function dexPairs() {
  const age = dexCache ? Date.now() - dexCache.at : Infinity;
  if (age < FRESH_MS) return dexCache!.pairs;
  if (dexCache && age < STALE_MS) {
    void refreshDexPairs();
    return dexCache.pairs;
  }
  return refreshDexPairs();
}

async function refreshGeckoMarkets() {
  if (geckoInflight) return geckoInflight;
  const ids = NATIVE_TOKENS.map((t) => t.geckoId).filter(
    (id): id is string => Boolean(id),
  );
  if (ids.length === 0) return geckoCache?.byId ?? new Map<string, GeckoMarket>();
  geckoInflight = (async () => {
    const params = new URLSearchParams({
      vs_currency: "usd",
      ids: ids.join(","),
      order: "market_cap_desc",
      per_page: "50",
      page: "1",
      sparkline: "false",
      price_change_percentage: "24h",
    });
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.COINGECKO_API_KEY?.trim();
    if (key) headers["x-cg-demo-api-key"] = key;
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?${params}`,
      { headers, signal: AbortSignal.timeout(GECKO_TIMEOUT_MS) },
    );
    if (!res.ok) {
      console.error("[native] coingecko", res.status);
      return geckoCache?.byId ?? new Map<string, GeckoMarket>();
    }
    const rows = (await res.json()) as GeckoMarket[];
    const byId = new Map(
      rows
        .filter((row) => typeof row.id === "string")
        .map((row) => [row.id as string, row]),
    );
    geckoCache = { at: Date.now(), byId };
    return byId;
  })()
    .catch((error) => {
      console.error("[native] coingecko", error);
      return geckoCache?.byId ?? new Map<string, GeckoMarket>();
    })
    .finally(() => {
      geckoInflight = null;
    });
  return geckoInflight;
}

async function geckoMarkets() {
  const age = geckoCache ? Date.now() - geckoCache.at : Infinity;
  if (age < FRESH_MS) return geckoCache!.byId;
  if (geckoCache && age < STALE_MS) {
    void refreshGeckoMarkets();
    return geckoCache.byId;
  }
  return refreshGeckoMarkets();
}

function fillFromGecko(quote: NativeQuote, row: GeckoMarket | undefined) {
  if (!row) return quote;
  return {
    ...quote,
    priceUsd: quote.priceUsd ?? num(row.current_price),
    marketCap: quote.marketCap ?? num(row.market_cap),
    volume24h: quote.volume24h ?? num(row.total_volume),
    change24h: quote.change24h ?? num(row.price_change_percentage_24h),
    image: quote.image ?? (typeof row.image === "string" ? row.image : null),
  } satisfies NativeQuote;
}

export type NativeCandle = {
  time: number;
  price: number;
};

export function oddsPointsFromCandles(
  candlesA: NativeCandle[],
  candlesB: NativeCandle[],
  supplyA: number,
  supplyB: number,
) {
  if (!(supplyA > 0) || !(supplyB > 0)) return [] as { time: number; value: number }[];
  const byB = new Map(candlesB.map((row) => [row.time, row.price]));
  const points: { time: number; value: number }[] = [];
  for (const row of candlesA) {
    const priceB = byB.get(row.time);
    if (!(row.price > 0) || !(priceB && priceB > 0)) continue;
    const mcapA = row.price * supplyA;
    const mcapB = priceB * supplyB;
    if (!(mcapA + mcapB > 0)) continue;
    points.push({ time: row.time, value: mcapA / (mcapA + mcapB) });
  }
  return points;
}

export function mcapPointsFromCandles(
  candles: NativeCandle[],
  supply: number,
  live?: { time: number; value: number } | null,
) {
  if (!(supply > 0)) return [] as { time: number; value: number }[];
  const points: { time: number; value: number }[] = [];
  for (const row of candles) {
    if (!(row.price > 0)) continue;
    points.push({ time: row.time, value: row.price * supply });
  }
  points.sort((a, b) => a.time - b.time);
  if (live && live.value > 0 && live.time > 0) {
    const last = points[points.length - 1];
    if (!last || live.time - last.time > 60) points.push(live);
    else last.value = live.value;
  }
  if (points.length === 1) {
    points.unshift({ time: points[0]!.time - 3600, value: points[0]!.value });
  }
  return points;
}

const CANDLE_FRESH_MS = 60_000;
const CANDLE_STALE_MS = 10 * 60_000;
const CANDLE_TIMEOUT_MS = 4_000;
const candleCache = new Map<string, { at: number; points: NativeCandle[] }>();
const candleInflight = new Map<string, Promise<NativeCandle[]>>();
const poolAddrCache = new Map<string, { at: number; address: string | null }>();

function geckoNum(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function geckoJson(url: string) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(CANDLE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
  return res.json();
}

function tokenIsBase(row: {
  relationships?: { base_token?: { data?: { id?: string } } };
}, token: string) {
  const id = row.relationships?.base_token?.data?.id ?? "";
  const addr = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  return addr.toLowerCase() === token.toLowerCase();
}

async function geckoPoolAddress(token: string, chain: NativeChain) {
  const key = `v2:${chain}:${token.toLowerCase()}`;
  const hit = poolAddrCache.get(key);
  if (hit && Date.now() - hit.at < CANDLE_STALE_MS) return hit.address;
  try {
    const data = (await geckoJson(
      `https://api.geckoterminal.com/api/v2/networks/${chain}/tokens/${token}/pools`,
    )) as {
      data?: Array<{
        attributes?: { address?: string; reserve_in_usd?: string };
        relationships?: { base_token?: { data?: { id?: string } } };
      }>;
    };
    const rows = Array.isArray(data.data) ? data.data : [];
    const scored = rows.flatMap((row) => {
      const address = row.attributes?.address?.trim() ?? "";
      if (!address) return [];
      if (chain === "robinhood" && !/^0x[a-fA-F0-9]{40}$/.test(address)) return [];
      return [
        {
          address,
          reserve: geckoNum(row.attributes?.reserve_in_usd) ?? 0,
          tokenIsBase: tokenIsBase(row, token),
        },
      ];
    });
    const base = scored.filter((row) => row.tokenIsBase);
    const pool = (base.length > 0 ? base : scored).reduce<
      (typeof scored)[number] | null
    >((acc, row) => (!acc || row.reserve > acc.reserve ? row : acc), null);
    const address = pool?.address ?? null;
    poolAddrCache.set(key, { at: Date.now(), address });
    return address;
  } catch (error) {
    console.error("[native] gecko pool", error);
    return hit?.address ?? null;
  }
}

function pairFromDexUrl(url: string | null | undefined) {
  if (!url) return null;
  const match = url.match(/dexscreener\.com\/[a-z0-9-]+\/([a-zA-Z0-9]+)/i);
  return match?.[1] ?? null;
}

function parseOhlcv(rows: unknown): NativeCandle[] {
  if (!Array.isArray(rows)) return [];
  const points: NativeCandle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const time = geckoNum(row[0]);
    const close = geckoNum(row[4]);
    if (time == null || close == null || !(close > 0)) continue;
    points.push({ time, price: close });
  }
  points.sort((a, b) => a.time - b.time);
  return points;
}

async function geckoOhlcvAt(
  net: NativeChain,
  pool: string,
  timeframe: "hour" | "day",
  limit: number,
) {
  try {
    const data = (await geckoJson(
      `https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pool}/ohlcv/${timeframe}?aggregate=1&limit=${limit}`,
    )) as { data?: { attributes?: { ohlcv_list?: unknown[] } } };
    return parseOhlcv(data.data?.attributes?.ohlcv_list);
  } catch (error) {
    console.error("[native] ohlcv", net, pool, timeframe, error);
    return [] as NativeCandle[];
  }
}

async function geckoOhlcv(net: NativeChain, pool: string) {
  const [hourly, daily] = await Promise.all([
    geckoOhlcvAt(net, pool, "hour", 168),
    geckoOhlcvAt(net, pool, "day", 180),
  ]);
  const byTime = new Map<number, NativeCandle>();
  for (const row of daily) byTime.set(row.time, row);
  for (const row of hourly) byTime.set(row.time, row);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Hourly USD closes from GeckoTerminal. Used as the strike-page prediction chart.
 * Solana pool ids are case-sensitive; Dexscreener URLs lowercase them, so we
 * resolve a pool where this token is the base instead of trusting the pair URL.
 */
async function loadNativeCandles(
  address: string,
  chain: NativeChain,
): Promise<NativeCandle[]> {
  const token = nativeToken(address);
  const net = token ? nativeChainOf(token) : chain;
  const mint = token?.address ?? address;
  const pool = await geckoPoolAddress(
    net === "solana" ? mint : mint.toLowerCase(),
    net,
  );
  if (pool) {
    const points = await geckoOhlcv(net, pool);
    if (points.length > 0) return points;
  }
  const hinted = pairFromDexUrl(token?.pairUrl);
  if (hinted && net !== "solana") {
    return geckoOhlcv(net, hinted);
  }
  return [];
}

export async function fetchNativeCandles(
  address: string,
  chain: NativeChain = NATIVE_CHAIN,
): Promise<NativeCandle[]> {
  const token = nativeToken(address);
  const net = token ? nativeChainOf(token) : chain;
  const key = `v3:${net}:${address.toLowerCase()}`;
  const hit = candleCache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (age < CANDLE_FRESH_MS) return hit!.points;
  const pending = candleInflight.get(key);
  if (hit && age < CANDLE_STALE_MS) {
    if (!pending) {
      const next = loadNativeCandles(address, chain)
        .then((points) => {
          if (points.length > 0) candleCache.set(key, { at: Date.now(), points });
          return points;
        })
        .catch((error) => {
          console.error("[native] candles", error);
          return hit.points;
        })
        .finally(() => {
          candleInflight.delete(key);
        });
      candleInflight.set(key, next);
    }
    return hit.points;
  }
  if (pending) return pending;
  const next = loadNativeCandles(address, chain)
    .then((points) => {
      if (points.length > 0) candleCache.set(key, { at: Date.now(), points });
      return points;
    })
    .catch((error) => {
      console.error("[native] candles", error);
      return hit?.points ?? [];
    })
    .finally(() => {
      candleInflight.delete(key);
    });
  candleInflight.set(key, next);
  return next;
}

/**
 * Dexscreener first. CoinGecko fills missing price or mcap.
 */
export async function fetchNativeQuotes(symbols?: string[]) {
  const wanted =
    symbols && symbols.length > 0
      ? NATIVE_TOKENS.filter((t) =>
          symbols.some((s) => s.toLowerCase() === t.symbol.toLowerCase()),
        )
      : NATIVE_TOKENS;
  if (wanted.length === 0) return [] as NativeQuote[];

  const pairs = await dexPairs();
  const quotes = wanted.map((token) => {
    const pair = pickPair(pairs, token);
    const quote = pair ? quoteFromPair(token, pair) : emptyQuote(token.symbol);
    if (!quote.pairUrl && token.pairUrl) quote.pairUrl = token.pairUrl;
    return quote;
  });

  const missing = wanted.filter(
    (token, i) => token.geckoId && needsGecko(quotes[i]!),
  );
  if (missing.length === 0) return quotes;

  const byId = await geckoMarkets();
  return wanted.map((token, i) => {
    const quote = quotes[i]!;
    if (!token.geckoId || !needsGecko(quote)) return quote;
    return fillFromGecko(quote, byId.get(token.geckoId));
  });
}
