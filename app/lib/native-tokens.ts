/** Trending Robinhood memes plus Solana race names. */

export type NativeChain = "robinhood" | "solana";

export type NativeToken = {
  symbol: string;
  name: string;
  address: string;
  chain?: NativeChain;
  /** Preferred Dexscreener pair page when the mint is not on Robinhood. */
  pairUrl?: string;
  /** CoinGecko id. Used only when Dexscreener has no print. */
  geckoId: string | null;
};

export type NativeQuote = {
  symbol: string;
  name: string;
  address: string;
  priceUsd: number | null;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  change24h: number | null;
  image: string | null;
  pairUrl: string | null;
};

export const NATIVE_CHAIN = "robinhood";

export const NATIVE_TOKENS: NativeToken[] = [
  {
    symbol: "PONS",
    name: "Pons",
    address: "0x39dBED3a2bd333467115dE45665cC57F813C4571",
    geckoId: "pons",
  },
  {
    symbol: "AI",
    name: "Artificial Inu",
    address: "0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18",
    geckoId: "artificial-inu-3",
  },
  {
    symbol: "CASHCAT",
    name: "Cash Cat",
    address: "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
    geckoId: "cash-cat",
  },
  {
    symbol: "INDEX",
    name: "The Index",
    address: "0x56910D4409F3a0C78C64DD8D0545FF0705389870",
    geckoId: "the-index",
  },
  {
    symbol: "STONKBROKER",
    name: "Stonk Broker",
    address: "0xe934e36A439C94017B64a3FecE66AF12099aBF50",
    geckoId: "stonkbroker",
  },
  {
    symbol: "SHROOM",
    name: "Mushroom",
    address: "0xab093dEF657F15dF31b33922A95e047aDd645B29",
    geckoId: "mushroom-2",
  },
  {
    symbol: "OPTIMUS",
    name: "Optimus",
    address: "0x0fF9072a1EAD154d92C2d2Fef16AFba6028Ce2B2",
    geckoId: null,
  },
  {
    symbol: "MEME",
    name: "A Meme Coin",
    address: "0x385F4f8ae47651ce5F58F5265395a669f8281e18",
    geckoId: null,
  },
  {
    symbol: "ZCAT",
    name: "Anonymous Cat",
    address: "HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR",
    chain: "solana",
    pairUrl:
      "https://dexscreener.com/solana/btccxxtfi7a9xjte1exkn38jgie35s6gnerxd8dm61rc",
    geckoId: null,
  },
  {
    symbol: "ANSEM",
    name: "The Black Bull",
    address: "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump",
    chain: "solana",
    pairUrl:
      "https://dexscreener.com/solana/fnzky6x7entq1er3d225dqyt7ybfka4pskbmqhb8l3cc",
    geckoId: null,
  },
];

export function nativeChainOf(token: NativeToken): NativeChain {
  return token.chain ?? NATIVE_CHAIN;
}

export function robinhoodTokens() {
  return NATIVE_TOKENS.filter((token) => nativeChainOf(token) === "robinhood");
}

const BY_SYMBOL = new Map(
  NATIVE_TOKENS.map((token) => [token.symbol.toLowerCase(), token]),
);
const BY_ADDRESS = new Map(
  NATIVE_TOKENS.map((token) => [token.address.toLowerCase(), token]),
);

export function nativeToken(symbolOrAddress: string) {
  const key = symbolOrAddress.trim().toLowerCase();
  return BY_SYMBOL.get(key) ?? BY_ADDRESS.get(key) ?? null;
}

export function dexscreenerTokenUrl(address: string) {
  const token = nativeToken(address);
  if (token?.pairUrl) return token.pairUrl;
  const chain = token ? nativeChainOf(token) : NATIVE_CHAIN;
  const path =
    chain === "solana" ? token?.address ?? address : address.toLowerCase();
  return `https://dexscreener.com/${chain}/${path}`;
}

export function poolTokenPath(symbol: string, query?: Record<string, string>) {
  const path = `/pool/token/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) params.set(key, value);
  }
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}
