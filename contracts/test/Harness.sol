// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @notice Minimal test base.
 * @dev Declares only the cheatcodes these tests use rather than depending on
 * forge-std, so the contracts folder pulls no third-party code into the app
 * repo. Foundry finds tests by the `test` prefix, and a revert is a failure,
 * so assertion helpers just revert with a readable reason.
 */
interface Vm {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 revertData) external;
    function label(address account, string calldata newLabel) external;
}

abstract contract Harness {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition, string memory reason) internal pure {
        if (!condition) revert(reason);
    }

    function assertEq(uint256 a, uint256 b, string memory reason) internal pure {
        if (a != b) revert(string.concat(reason, ": ", _u(a), " != ", _u(b)));
    }

    function assertEq(int256 a, int256 b, string memory reason) internal pure {
        if (a != b) revert(string.concat(reason, ": ", _i(a), " != ", _i(b)));
    }

    /// @dev Fixed-point comparison for values that carry rounding dust.
    function assertApproxEq(uint256 a, uint256 b, uint256 tolerance, string memory reason)
        internal
        pure
    {
        uint256 diff = a > b ? a - b : b - a;
        if (diff > tolerance) {
            revert(string.concat(reason, ": ", _u(a), " vs ", _u(b), " (delta ", _u(diff), ")"));
        }
    }

    function assertGt(uint256 a, uint256 b, string memory reason) internal pure {
        if (a <= b) revert(string.concat(reason, ": ", _u(a), " !> ", _u(b)));
    }

    function assertLt(uint256 a, uint256 b, string memory reason) internal pure {
        if (a >= b) revert(string.concat(reason, ": ", _u(a), " !< ", _u(b)));
    }

    function _u(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 v = value; v != 0; v /= 10) ++digits;
        bytes memory buffer = new bytes(digits);
        for (uint256 i = digits; i != 0; --i) {
            buffer[i - 1] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _i(int256 value) private pure returns (string memory) {
        return value < 0 ? string.concat("-", _u(uint256(-value))) : _u(uint256(value));
    }
}
