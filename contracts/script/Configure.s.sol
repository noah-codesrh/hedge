// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "./Common.sol";
import {HedgeOracle} from "../src/HedgeOracle.sol";
import {HedgeLeverageEngine} from "../src/HedgeLeverageEngine.sol";

/**
 * @notice Post-deploy admin setup: register the keeper and list markets.
 *
 * Safe to re-run as markets are added — listing one that already exists would
 * revert the whole run, so already-listed ids are skipped.
 *
 * Required env: ORACLE, ENGINE, KEEPER, MARKET_IDS (comma-separated bytes32)
 * Optional env: MARKET_MAX_RESERVE (per-market reserve ceiling, 0 = global only)
 *
 * The grep is not optional: pnpm writes its own progress lines to stdout, and
 * without it the first two ids come through as "Already" and "Done".
 *
 *   MARKET_IDS=$(cd relayer && pnpm -s ids | grep '^0x' | awk '{print $1}' | paste -sd, -) \
 *   forge script script/Configure.s.sol:Configure --rpc-url $RPC --account hedge-admin --broadcast
 */
contract Configure is Script {
    function run() external {
        HedgeOracle oracle = HedgeOracle(vm.envAddress("ORACLE"));
        HedgeLeverageEngine engine = HedgeLeverageEngine(vm.envAddress("ENGINE"));
        address keeper = vm.envAddress("KEEPER");
        bytes32[] memory marketIds = vm.envBytes32("MARKET_IDS", ",");
        uint128 maxReserve = uint128(vm.envOr("MARKET_MAX_RESERVE", uint256(0)));

        vm.startBroadcast();

        if (!oracle.isReporter(keeper)) {
            oracle.setReporter(keeper, true);
        }

        // The keeper is the only actor that notices trouble within seconds, so
        // it gets the brake. It cannot do anything else with the role, and it
        // cannot lift a pause the admin set.
        if (engine.guardian() != keeper) {
            engine.setGuardian(keeper);
        }

        for (uint256 i; i < marketIds.length; ++i) {
            (bool enabled,, uint128 minPrice,,,,) = engine.markets(marketIds[i]);
            if (enabled || minPrice != 0) continue;
            engine.listMarketWithDefaults(marketIds[i], maxReserve);
        }

        vm.stopBroadcast();
    }
}
