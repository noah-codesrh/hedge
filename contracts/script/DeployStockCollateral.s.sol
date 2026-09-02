// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "./Common.sol";
import {HedgeStockCollateral} from "../src/HedgeStockCollateral.sol";

/**
 * @notice Deploys the stock desk, lists the top five, and points it at the
 * live USDG engine. Sets the keeper as marks reporter. Admin still has
 * to fundDesk(); marks arrive from Blockscout via the keeper.
 *
 *   forge script script/DeployStockCollateral.s.sol:DeployStockCollateral \
 *     --rpc-url $RPC --account hedge-admin --sender $ADMIN --broadcast
 */
contract DeployStockCollateral is Script {
    address internal constant RH_USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    function run() external returns (address collateral) {
        address admin = vm.envAddress("ADMIN");
        address engine = vm.envAddress("ENGINE");
        address keeper = vm.envOr("KEEPER", address(0));

        vm.startBroadcast();
        HedgeStockCollateral box = new HedgeStockCollateral(admin);
        box.setUsdgEngine(RH_USDG, engine);
        box.setListed(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, true); // NVDA
        box.setListed(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, true); // SPCX
        box.setListed(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, true); // AAPL
        box.setListed(0x1b0E319c6A659F002271B69dB8A7df2F911c153E, true); // GME
        box.setListed(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, true); // TSLA
        if (keeper != address(0)) box.setMarksReporter(keeper);
        vm.stopBroadcast();

        return address(box);
    }
}
