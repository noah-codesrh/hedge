import { defineChain } from "viem";
import { base, polygon } from "viem/chains";
import { RH_EXPLORER, RH_RPC } from "./robinhood";

export { base, polygon };

export const RH_CHAIN_ID = 4663;
export const RH_CHAIN_HEX = "0x1237" as const;

export const POLYGON_CHAIN_ID = 137;
export const POLYGON_CHAIN_HEX = "0x89" as const;
export const POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";
export const POLYGON_EXPLORER = "https://polygonscan.com";

/** Polymarket collateral on Polygon (6 decimals). */
export const PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
export const PUSD_DECIMALS = 6;

export const robinhoodChain = defineChain({
  id: RH_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RH_RPC] },
  },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: RH_EXPLORER },
  },
});

export type AddableChain = {
  chainId: number;
  hex: `0x${string}`;
  name: string;
  rpcUrl: string;
  explorer: string;
  native: { name: string; symbol: string; decimals: number };
};

export const ROBINHOOD_ADD_CHAIN: AddableChain = {
  chainId: RH_CHAIN_ID,
  hex: RH_CHAIN_HEX,
  name: "Robinhood Chain",
  rpcUrl: RH_RPC,
  explorer: RH_EXPLORER,
  native: { name: "ETH", symbol: "ETH", decimals: 18 },
};

export const POLYGON_ADD_CHAIN: AddableChain = {
  chainId: POLYGON_CHAIN_ID,
  hex: POLYGON_CHAIN_HEX,
  name: "Polygon",
  rpcUrl: POLYGON_RPC,
  explorer: POLYGON_EXPLORER,
  native: { name: "POL", symbol: "POL", decimals: 18 },
};
