import {
  NATIVE_CHAIN,
  NATIVE_TOKENS,
  nativeToken,
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
    pairUrl: null,
  };
}

function pickPair(pairs: Pair[], address: string) {
  const wanted = address.toLowerCase();
  const onChain = pairs.filter(
    (p) =>
      p.chainId === NATIVE_CHAIN &&
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
    pairUrl: pair.url ?? null,
  };
}

function needsGecko(quote: NativeQuote) {
  return quote.priceUsd == null || quote.marketCap == null;
}

const CACHE_MS = 30_000;
let dexCache: { at: number; pairs: Pair[] } | null = null;
let geckoCache: { at: number; byId: Map<string, GeckoMarket> } | null = null;

async function dexPairs() {
  if (dexCache && Date.now() - dexCache.at < CACHE_MS) return dexCache.pairs;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${NATIVE_TOKENS.map((t) => t.address).join(",")}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      console.error("[native] dexscreener", res.status);
      if (dexCache) dexCache = { ...dexCache, at: Date.now() };
      else dexCache = { at: Date.now(), pairs: [] };
      return dexCache.pairs;
    }
    const data = (await res.json()) as { pairs?: Pair[] };
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    dexCache = { at: Date.now(), pairs };
    return pairs;
  } catch (error) {
    console.error("[native] dexscreener", error);
    if (dexCache) dexCache = { ...dexCache, at: Date.now() };
    else dexCache = { at: Date.now(), pairs: [] };
    return dexCache.pairs;
  }
}

async function geckoMarkets() {
  if (geckoCache && Date.now() - geckoCache.at < CACHE_MS) {
    return geckoCache.byId;
  }
  const ids = NATIVE_TOKENS.map((t) => t.geckoId).filter(
    (id): id is string => Boolean(id),
  );
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
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?${params}`,
      { headers },
    );
    if (!res.ok) {
      console.error("[native] coingecko", res.status);
      if (geckoCache) geckoCache = { ...geckoCache, at: Date.now() };
      else geckoCache = { at: Date.now(), byId: new Map() };
      return geckoCache.byId;
    }
    const rows = (await res.json()) as GeckoMarket[];
    const byId = new Map(
      rows
        .filter((row) => typeof row.id === "string")
        .map((row) => [row.id as string, row]),
    );
    geckoCache = { at: Date.now(), byId };
    return byId;
  } catch (error) {
    console.error("[native] coingecko", error);
    if (geckoCache) geckoCache = { ...geckoCache, at: Date.now() };
    else geckoCache = { at: Date.now(), byId: new Map() };
    return geckoCache.byId;
  }
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
    const pair = pickPair(pairs, token.address);
    return pair ? quoteFromPair(token, pair) : emptyQuote(token.symbol);
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
