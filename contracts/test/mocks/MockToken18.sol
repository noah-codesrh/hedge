// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice An 18-decimal token, used only to prove the vault rejects one.
contract MockToken18 {
    uint8 public constant decimals = 18;

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}
