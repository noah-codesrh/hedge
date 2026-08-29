/**
 * Chains a trader can send from. Privy issues a deposit address on the origin
 * chain, then bridges and swaps into USDG on Robinhood Chain.
 *
 * Amounts are in the origin stablecoin (USDC), not native gas. Solana uses
 * Privy's CAIP-2 id, not Relay's numeric chain id, so the deposit address is
 * a Solana account rather than the user's Robinhood EVM wallet.
 */

import { RH_CHAIN_ID, USDG } from "./robinhood";

export type DepositChain = {
  id: string;
  name: string;
  /** CAIP-2 id for Privy (`eip155:1`, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`). */
  caip2: string;
  logo: string;
  /** Featured row in the deposit sheet. The rest sit behind +. */
  featured: boolean;
  token: {
    symbol: string;
    address: string;
    decimals: number;
  };
  explorerAddress: (address: string) => string;
};

export const DEPOSIT_DEST_CHAIN = `eip155:${RH_CHAIN_ID}`;
export const DEPOSIT_DEST_TOKEN = USDG;

export const SOLANA_MAINNET_CAIP2 =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export const DEPOSIT_CHAINS: DepositChain[] = [
  {
    id: "ethereum",
    name: "Ethereum",
    caip2: "eip155:1",
    logo: "/chains/ethereum.svg",
    featured: true,
    token: {
      symbol: "USDC",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      decimals: 6,
    },
    explorerAddress: (a) => `https://etherscan.io/address/${a}`,
  },
  {
    id: "solana",
    name: "Solana",
    caip2: SOLANA_MAINNET_CAIP2,
    logo: "/chains/solana.svg",
    featured: true,
    token: {
      symbol: "USDC",
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      decimals: 6,
    },
    explorerAddress: (a) => `https://solscan.io/account/${a}`,
  },
  {
    id: "bsc",
    name: "BNB Chain",
    caip2: "eip155:56",
    logo: "/chains/bsc.svg",
    featured: true,
    token: {
      symbol: "USDC",
      address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      decimals: 18,
    },
    explorerAddress: (a) => `https://bscscan.com/address/${a}`,
  },
  {
    id: "base",
    name: "Base",
    caip2: "eip155:8453",
    logo: "/chains/base.svg",
    featured: true,
    token: {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    },
    explorerAddress: (a) => `https://basescan.org/address/${a}`,
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    caip2: "eip155:42161",
    logo: "/chains/arbitrum.svg",
    featured: false,
    token: {
      symbol: "USDC",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: 6,
    },
    explorerAddress: (a) => `https://arbiscan.io/address/${a}`,
  },
  {
    id: "polygon",
    name: "Polygon",
    caip2: "eip155:137",
    logo: "/chains/polygon.svg",
    featured: false,
    token: {
      symbol: "USDC",
      address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      decimals: 6,
    },
    explorerAddress: (a) => `https://polygonscan.com/address/${a}`,
  },
  {
    id: "optimism",
    name: "Optimism",
    caip2: "eip155:10",
    logo: "/chains/optimism.svg",
    featured: false,
    token: {
      symbol: "USDC",
      address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      decimals: 6,
    },
    explorerAddress: (a) => `https://optimistic.etherscan.io/address/${a}`,
  },
];

export const FEATURED_DEPOSIT_CHAINS = DEPOSIT_CHAINS.filter((c) => c.featured);
export const MORE_DEPOSIT_CHAINS = DEPOSIT_CHAINS.filter((c) => !c.featured);

export function depositChainById(id: string) {
  return DEPOSIT_CHAINS.find((c) => c.id === id) ?? null;
}

export const DEPOSIT_MIN_USD = 5;
export const DEPOSIT_PRESETS = [25, 50, 100, 250];
