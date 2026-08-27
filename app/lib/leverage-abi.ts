/**
 * Minimal ABIs for the Hedge contracts on Robinhood Chain.
 *
 * Hand-written rather than generated from the Foundry artifacts: only a
 * fraction of each contract is reachable from the app, and a trimmed ABI keeps
 * the client bundle small and makes it obvious what the UI is allowed to do.
 *
 * These must track `contracts/src/HedgeLeverageEngine.sol` and
 * `contracts/src/HedgeVault.sol`. Signatures are checked at runtime by viem,
 * so a drift shows up as a decode failure rather than silently wrong data.
 */
export const engineAbi = [
  {
    type: "function",
    name: "quoteOpen",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "isLong", type: "bool" },
      { name: "margin", type: "uint256" },
      { name: "leverageBps", type: "uint256" },
    ],
    outputs: [
      {
        name: "q",
        type: "tuple",
        components: [
          { name: "size", type: "uint256" },
          { name: "entryPrice", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "netMargin", type: "uint256" },
          { name: "shares", type: "uint256" },
          { name: "liquidationPrice", type: "uint256" },
          { name: "reserve", type: "uint256" },
          { name: "hasCapacity", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "openPosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "isLong", type: "bool" },
      { name: "margin", type: "uint256" },
      { name: "leverageBps", type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "closePosition",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "payout", type: "uint256" }],
  },
  {
    type: "function",
    name: "reducePosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "fractionBps", type: "uint256" },
    ],
    outputs: [{ name: "payout", type: "uint256" }],
  },
  {
    type: "function",
    name: "emergencyClose",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "refund", type: "uint256" }],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "trader", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "isLong", type: "bool" },
      { name: "isOpen", type: "bool" },
      { name: "entryPrice", type: "uint128" },
      { name: "size", type: "uint128" },
      { name: "margin", type: "uint128" },
      { name: "netMargin", type: "uint128" },
      { name: "shares", type: "uint128" },
      { name: "liquidationPrice", type: "uint128" },
      { name: "reserved", type: "uint128" },
      { name: "openedAt", type: "uint64" },
      { name: "borrowRateBps", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "openPositionIds",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ name: "ids", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "openPositionCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pnlOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "int256" }],
  },
  {
    type: "function",
    name: "fundingOwed",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "liquidationPriceNow",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isLiquidatable",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "effectiveMaxLeverageBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "nextLeverageTier",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "atTvl", type: "uint256" },
      { name: "leverageBps", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "leverageTiers",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "minTvl", type: "uint128" },
          { name: "maxLeverageBps", type: "uint128" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "capacity",
    stateMutability: "view",
    inputs: [],
    // Order matters and is easy to get backwards: the engine returns what is
    // already reserved first, then the ceiling, then the headroom between them.
    outputs: [
      { name: "used", type: "uint256" },
      { name: "ceiling", type: "uint256" },
      { name: "available", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      { name: "enabled", type: "bool" },
      { name: "resolved", type: "bool" },
      { name: "minPrice", type: "uint128" },
      { name: "maxPrice", type: "uint128" },
      { name: "maxReserve", type: "uint128" },
      { name: "reserved", type: "uint128" },
      { name: "finalPrice", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "minMargin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxMargin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "openingPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "borrowRateBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const vaultAbi = [
  {
    type: "function",
    name: "depositSenior",
    stateMutability: "nonpayable",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawSenior",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "freeAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "seniorAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "juniorAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lockedAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "seniorSharesOf",
    stateMutability: "view",
    inputs: [{ name: "lp", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "seniorAssetsOf",
    stateMutability: "view",
    inputs: [{ name: "lp", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToShares",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "depositsPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "seniorCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "FeeCollected",
    inputs: [
      { name: "amount", type: "uint256", indexed: false },
      { name: "toSenior", type: "uint256", indexed: false },
      { name: "toJunior", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MarginAbsorbed",
    inputs: [
      { name: "amount", type: "uint256", indexed: false },
      { name: "toSenior", type: "uint256", indexed: false },
      { name: "toJunior", type: "uint256", indexed: false },
    ],
  },
] as const;
