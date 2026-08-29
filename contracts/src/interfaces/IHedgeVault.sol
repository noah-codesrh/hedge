// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IHedgeVault {
    function asset() external view returns (address);

    /// @notice Senior + junior capital, excluding trader margin held by the engine.
    function totalAssets() external view returns (uint256);

    /// @notice Capital not already reserved against open interest.
    function freeAssets() external view returns (uint256);

    function lockedAssets() external view returns (uint256);

    /// @notice Reserve capital to back a position's worst-case payout.
    function lock(uint256 amount) external;

    /// @notice Release a reservation once the position is settled.
    function unlock(uint256 amount) external;

    /// @notice Credit fees already transferred in, split senior/junior.
    function collectFee(uint256 amount) external;

    /// @notice Credit a liquidated trader's margin, already transferred in.
    function absorbMargin(uint256 amount) external;

    /// @notice Pay a winning trader. Junior tranche absorbs the loss first.
    function payProfit(address to, uint256 amount) external;
}
