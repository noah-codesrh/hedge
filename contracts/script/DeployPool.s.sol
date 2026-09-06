// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "./Common.sol";
import {HedgePool} from "../src/HedgePool.sol";

/**
 * @notice Deploys HedgePool and sets the reporter that lists and resolves.
 *
 * Required env: ADMIN. REPORTER defaults to ADMIN. USDG defaults to the real
 * token on Robinhood Chain.
 *
 * Listing the weekly cards is a separate call (`listMarket`) from the reporter
 * key the app already holds as NATIVE_ESCROW_KEY, so a deploy does not have to
 * know next Sunday.
 *
 *   forge script script/DeployPool.s.sol:DeployPool \
 *     --rpc-url $RPC --account hedge-admin --sender $ADMIN --broadcast
 */
contract DeployPool is Script {
    address internal constant RH_USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    uint256 internal constant RH_CHAIN_ID = 4663;

    error SetUsdgForThisChain();
    error UnexpectedUsdgOnMainnet();

    function run() external returns (address pool) {
        address admin = vm.envAddress("ADMIN");
        address reporter = vm.envOr("REPORTER", admin);
        address usdg = _resolveUsdg();

        vm.startBroadcast();
        HedgePool pool_ = new HedgePool(admin, usdg);
        if (reporter != address(0)) pool_.setReporter(reporter);
        vm.stopBroadcast();

        return address(pool_);
    }

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
