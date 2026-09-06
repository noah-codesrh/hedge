/** Trending Robinhood Chain memes. Hand allowlist, not a live screener. */

export type NativeToken = {
  symbol: string;
  name: string;
  address: `0x${string}`;
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
];

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
  return `https://dexscreener.com/${NATIVE_CHAIN}/${address.toLowerCase()}`;
}
