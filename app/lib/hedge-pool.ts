import { keccak256, stringToBytes, type Hex } from "viem";

/**
 * HedgePool on Robinhood Chain. Holds USDG tickets. The app shows odds;
 * this address is the money.
 *
 * Current live pool is VITE_HEDGE_POOL_ADDRESS (refund before lock).
 * First live pool is POOL_LEGACY_ADDRESS: no refund, claim after expiry.
 */
export const POOL_ADDRESS = (
  import.meta.env.VITE_HEDGE_POOL_ADDRESS ?? ""
).trim();

/**
 * First live HedgePool. No refund. Tickets here wait until expiry, then claim.
 * Kept so Redeem still hits this address after a new deploy.
 */
export const POOL_LEGACY_ADDRESS =
  "0xf0D392e67904acE892A6024E0501AbfAD67A1c8c";

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
    name: "refund",
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
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "minStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "deskCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "setLimits",
    stateMutability: "nonpayable",
    inputs: [
      { name: "minStake_", type: "uint256" },
      { name: "maxStake_", type: "uint256" },
      { name: "deskCap_", type: "uint256" },
    ],
    outputs: [],
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
    name: "Refunded",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
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
  { type: "error", name: "MarketNotListed", inputs: [] },
  { type: "error", name: "AlreadyTicketed", inputs: [] },
  { type: "error", name: "WindowLocked", inputs: [] },
  { type: "error", name: "DeskCapReached", inputs: [] },
  { type: "error", name: "StakeOutOfRange", inputs: [] },
  { type: "error", name: "StakingIsPaused", inputs: [] },
  { type: "error", name: "MarketResolved", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  { type: "error", name: "NoTicket", inputs: [] },
  { type: "error", name: "MarketListedAlready", inputs: [] },
  { type: "error", name: "NotLister", inputs: [] },
] as const;
