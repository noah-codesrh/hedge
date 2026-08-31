import { parseAbi } from "viem";

/** Only the surface the keeper touches, so the ABI stays readable. */
export const oracleAbi = parseAbi([
  "function price(bytes32 marketId) view returns (uint256 value, uint256 updatedAt)",
  "function priceDetail(bytes32 marketId) view returns (uint256 value, uint256 target, uint256 updatedAt)",
  "function isConverging(bytes32 marketId) view returns (bool)",
  "function maxDeviationBps() view returns (uint256)",
  "function maxPriceAge() view returns (uint256)",
  "function isReporter(address) view returns (bool)",
  "function pushPrice(bytes32 marketId, uint256 target)",
  "function pushPrices(bytes32[] marketIds, uint256[] targets)",
]);

export const engineAbi = parseAbi([
  "function openPositionCount() view returns (uint256)",
  "function openPositionIds(uint256 offset, uint256 limit) view returns (uint256[])",
  "function isLiquidatable(uint256 id) view returns (bool)",
  "function liquidatePosition(uint256 id)",
  "function positions(uint256) view returns (address trader, bytes32 marketId, bool isLong, bool isOpen, uint128 entryPrice, uint128 size, uint128 margin, uint128 netMargin, uint128 shares, uint128 liquidationPrice, uint128 reserved, uint64 openedAt)",
  "function markets(bytes32) view returns (bool enabled, bool resolved, uint128 minPrice, uint128 maxPrice, uint128 maxReserve, uint128 reserved, uint128 finalPrice)",
  "function isSettleable(uint256 id) view returns (bool)",
  "function settlePosition(uint256 id)",
  "function guardian() view returns (address)",
  "function openingPaused() view returns (bool)",
  "function pausedByGuardian() view returns (bool)",
  "function guardianSetPaused(bool paused)",
  "function effectiveMaxLeverageBps() view returns (uint256)",
  "function nextLeverageTier() view returns (uint256 atTvl, uint256 leverageBps)",
]);

export const stockCollateralAbi = parseAbi([
  "function marksReporter() view returns (address)",
  "function markUsd6(address token) view returns (uint256)",
  "function pushMarks(address[] tokens, uint256[] marks)",
]);
