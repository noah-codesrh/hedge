import { keccak256, stringToBytes, type Hex } from "viem";

/**
 * HedgePool on Robinhood Chain. Holds USDG tickets. The app shows odds;
 * this address is the money.
 *
 * Blank until DeployPool is broadcast and this is set. `/pool` then keeps
 * the old escrow-wallet path so in-flight tickets still pay.
 */
export const POOL_ADDRESS = (
  import.meta.env.VITE_HEDGE_POOL_ADDRESS ?? ""
).trim();

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const poolIsLive = ADDRESS.test(POOL_ADDRESS);

/** Same join key the leverage engine uses: keccak256(slug). */
export function poolMarketId(slug: string): Hex {
  return keccak256(stringToBytes(slug.trim()));
}

export const POOL_SIDE_A = 1;
export const POOL_SIDE_B = 2;
export const POOL_OUTCOME_VOID = 3;

export const poolAbi = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "side", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "listMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "lockAt", type: "uint64" },
      { name: "expiryAt", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "outcome", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "previewPayout",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "lockAt", type: "uint64" },
      { name: "expiryAt", type: "uint64" },
      { name: "poolA", type: "uint128" },
      { name: "poolB", type: "uint128" },
      { name: "outcome", type: "uint8" },
      { name: "listed", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "tickets",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "side", type: "uint8" },
      { name: "amount", type: "uint128" },
      { name: "claimed", type: "bool" },
    ],
  },
  {
    type: "event",
    name: "Staked",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "side", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "paid", type: "uint256", indexed: false },
    ],
  },
] as const;
