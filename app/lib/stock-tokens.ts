/** Robinhood Chain tokenized equities Hedge will accept as collateral. */

export type StockToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoUrl: string;
};

export const CASH_LOGO =
  "https://assets.coingecko.com/coins/images/51281/small/GDN_USDG_Token_200x200.png";

function rhLogo(address: string) {
  return `https://cdn.robinhood.com/ncw_assets/logos/${address.toLowerCase()}.png`;
}

/** Highest-volume stock tokens on Robinhood Chain. Expand later. */
export const STOCK_TOKENS: StockToken[] = [
  {
    symbol: "NVDA",
    name: "NVIDIA",
    address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    decimals: 18,
    logoUrl: rhLogo("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"),
  },
  {
    symbol: "SPCX",
    name: "SpaceX",
    address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
    decimals: 18,
    logoUrl: rhLogo("0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa"),
  },
  {
    symbol: "AAPL",
    name: "Apple",
    address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    decimals: 18,
    logoUrl: rhLogo("0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"),
  },
  {
    symbol: "GME",
    name: "GameStop",
    address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E",
    decimals: 18,
    logoUrl: rhLogo("0x1b0E319c6A659F002271B69dB8A7df2F911c153E"),
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    decimals: 18,
    logoUrl: rhLogo("0x322F0929c4625eD5bAd873c95208D54E1c003b2d"),
  },
];

const BY_ADDRESS = new Map(
  STOCK_TOKENS.map((t) => [t.address.toLowerCase(), t]),
);

export function stockByAddress(address: string | null | undefined) {
  if (!address) return null;
  return BY_ADDRESS.get(address.toLowerCase()) ?? null;
}

export const STOCK_COLLATERAL_ADDRESS = (
  import.meta.env.VITE_HEDGE_STOCK_COLLATERAL ?? ""
).trim();

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const stockCollateralIsLive = ADDRESS.test(STOCK_COLLATERAL_ADDRESS);
