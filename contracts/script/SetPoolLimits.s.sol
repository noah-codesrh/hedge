// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "./Common.sol";
import {HedgePool} from "../src/HedgePool.sol";

/**
 * @notice Raises HedgePool ticket and desk caps to match the funded escrow.
 *
 *   MIN_STAKE=1000000 MAX_STAKE=50000000 DESK_CAP=1000000000 \
 *   forge script script/SetPoolLimits.s.sol:SetPoolLimits \
 *     --rpc-url $RPC --account hedge-admin --sender $ADMIN --broadcast
 */
contract SetPoolLimits is Script {
    function run() external {
        address pool = vm.envAddress("HEDGE_POOL_ADDRESS");
        uint256 minStake = vm.envOr("MIN_STAKE", uint256(1e6));
        uint256 maxStake = vm.envOr("MAX_STAKE", uint256(25e6));
        uint256 deskCap = vm.envOr("DESK_CAP", uint256(1000e6));

        vm.startBroadcast();
        HedgePool(pool).setLimits(minStake, maxStake, deskCap);
        vm.stopBroadcast();
    }
}
