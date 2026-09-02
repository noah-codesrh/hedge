// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IHedgeLeverageEngine {
    function openPosition(bytes32 marketId, bool isLong, uint256 margin, uint256 leverageBps)
        external
        returns (uint256 id);

    function closePosition(uint256 id) external returns (uint256 payout);
    function assetToken() external view returns (address);

    function positions(uint256 id)
        external
        view
        returns (
            address trader,
            bytes32 marketId,
            bool isLong,
            bool isOpen,
            uint128 entryPrice,
            uint128 size,
            uint128 margin,
            uint128 netMargin,
            uint128 shares,
            uint128 liquidationPrice,
            uint128 reserved,
            uint64 openedAt,
            uint64 borrowRateBps
        );
}
