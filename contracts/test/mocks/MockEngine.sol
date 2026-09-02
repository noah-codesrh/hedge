// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "../../src/interfaces/IERC20.sol";

/// @notice Stands in for HedgeLeverageEngine in stock-desk tests.
contract MockEngine {
    IERC20 public assetToken;
    uint256 public nextId = 1;
    mapping(uint256 => uint256) public posted;
    /// @dev 1e6 = return posted. 1.1e6 = 10% profit. 0.9e6 = 10% loss.
    uint256 public payoutFactor = 1e6;

    constructor(address usdg_) {
        assetToken = IERC20(usdg_);
    }

    function setPayoutFactor(uint256 factor) external {
        payoutFactor = factor;
    }

    function openPosition(bytes32, bool, uint256 margin, uint256) external returns (uint256 id) {
        require(assetToken.transferFrom(msg.sender, address(this), margin), "pull");
        id = nextId++;
        posted[id] = margin;
    }

    function closePosition(uint256 id) external returns (uint256 payout) {
        uint256 margin = posted[id];
        posted[id] = 0;
        payout = (margin * payoutFactor) / 1e6;
        uint256 have = assetToken.balanceOf(address(this));
        if (payout > have) payout = have;
        require(assetToken.transfer(msg.sender, payout), "pay");
    }

    function positions(uint256 id)
        external
        view
        returns (
            address trader,
            bytes32 marketId,
            bool,
            bool isOpen,
            uint128,
            uint128,
            uint128,
            uint128,
            uint128,
            uint128,
            uint128,
            uint64,
            uint64
        )
    {
        trader = address(0);
        marketId = bytes32(0);
        isOpen = posted[id] > 0;
    }
}
