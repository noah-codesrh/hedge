// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "./Common.sol";
import {HedgeOracle} from "../src/HedgeOracle.sol";
import {HedgeVault} from "../src/HedgeVault.sol";
import {HedgeLeverageEngine} from "../src/HedgeLeverageEngine.sol";

/**
 * @notice Deploys the three contracts and wires the vault to the engine.
 *
 * Wiring happens here because `setEngine` is one-time and irreversible; doing
 * it in the same run removes the window where a deployed vault sits unclaimed.
 *
 * Required env: ADMIN. USDG defaults to the real token on Robinhood Chain and
 * only has to be set when deploying somewhere else, such as a local anvil.
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url $RPC --private-key $PK --broadcast
 *
 * The broadcasting key must be ADMIN, since it calls setEngine.
 */
contract Deploy is Script {
    /// @notice The Global Dollar (USDG) on Robinhood Chain.
    address internal constant RH_USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    uint256 internal constant RH_CHAIN_ID = 4663;

    error SetUsdgForThisChain();
    error UnexpectedUsdgOnMainnet();

    function run() external returns (address oracle, address vault, address engine) {
        address admin = vm.envAddress("ADMIN");
        address usdg = _resolveUsdg();

        vm.startBroadcast();

        HedgeOracle oracle_ = new HedgeOracle(admin);
        HedgeVault vault_ = new HedgeVault(admin, usdg);
        HedgeLeverageEngine engine_ =
            new HedgeLeverageEngine(admin, address(vault_), address(oracle_));

        vault_.setEngine(address(engine_));

        vm.stopBroadcast();

        return (address(oracle_), address(vault_), address(engine_));
    }

    /**
     * @dev On Robinhood Chain the collateral is known, so it is the default and
     * anything else is treated as a mistake — that is the one place a stray
     * USDG env var left over from a local run would do real damage. Other
     * chains have no default and must be told explicitly.
     */
    function _resolveUsdg() internal view returns (address) {
        address configured = vm.envOr("USDG", address(0));

        if (block.chainid == RH_CHAIN_ID) {
            if (configured != address(0) && configured != RH_USDG) {
                revert UnexpectedUsdgOnMainnet();
            }
            return RH_USDG;
        }

        if (configured == address(0)) revert SetUsdgForThisChain();
        return configured;
    }
}
