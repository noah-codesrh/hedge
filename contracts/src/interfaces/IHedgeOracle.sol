// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IHedgeOracle {
    /// @notice Latest YES price for a market, scaled to 1e18 where 1e18 == $1.00.
    function price(bytes32 marketId) external view returns (uint256 value, uint256 updatedAt);

    /// @notice Reverts unless the market has a price newer than `maxPriceAge`.
    function requireFreshPrice(bytes32 marketId) external view returns (uint256 value);

    /// @notice True while the settlement price is still walking toward a gap,
    /// i.e. the oracle knows it is behind the real Polymarket price.
    function isConverging(bytes32 marketId) external view returns (bool);
}
