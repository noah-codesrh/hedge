// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @notice Cheatcodes the deploy scripts use.
 * @dev Declared here rather than pulled from forge-std so the contracts folder
 * stays free of third-party Solidity. See test/Harness.sol for the same
 * approach on the test side.
 */
interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envBytes32(string calldata name, string calldata delim)
        external
        view
        returns (bytes32[] memory);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

abstract contract Script {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}
