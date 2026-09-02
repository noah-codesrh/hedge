// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Harness} from "./Harness.sol";
import {HedgeStockCollateral} from "../src/HedgeStockCollateral.sol";
import {MockStock} from "./mocks/MockStock.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";
import {MockEngine} from "./mocks/MockEngine.sol";

contract StockCollateralTest is Harness {
    HedgeStockCollateral internal box;
    MockStock internal aapl;
    MockUSDG internal usdg;
    MockEngine internal engine;
    address internal admin = address(0xA11);
    address internal alice = address(0xA1);

    uint256 internal constant ONE = 1e18;
    bytes32 internal constant MARKET = bytes32(uint256(1));

    function setUp() public {
        box = new HedgeStockCollateral(admin);
        aapl = new MockStock("Apple", "AAPL");
        usdg = new MockUSDG();
        engine = new MockEngine(address(usdg));
        aapl.mint(alice, 10 * ONE);
        usdg.mint(admin, 10_000e6);

        vm.startPrank(admin);
        box.setListed(address(aapl), true);
        box.setMark(address(aapl), 200e6);
        box.setUsdgEngine(address(usdg), address(engine));
        usdg.approve(address(box), type(uint256).max);
        box.fundDesk(5_000e6);
        vm.stopPrank();
    }

    function testDepositAndWithdrawSameToken() public {
        vm.startPrank(alice);
        aapl.approve(address(box), 3 * ONE);
        box.deposit(address(aapl), 3 * ONE);
        box.withdraw(address(aapl), 3 * ONE);
        vm.stopPrank();
        assertEq(aapl.balanceOf(alice), 10 * ONE, "stock returned");
    }

    function testUnlistedReverts() public {
        MockStock tsla = new MockStock("Tesla", "TSLA");
        tsla.mint(alice, ONE);
        vm.startPrank(alice);
        tsla.approve(address(box), ONE);
        vm.expectRevert(HedgeStockCollateral.TokenNotListed.selector);
        box.deposit(address(tsla), ONE);
        vm.stopPrank();
    }

    function testQuoteMarginAppliesHaircut() public {
        // 1 AAPL at $200, 30% haircut -> $140
        uint256 margin = box.quoteMargin(address(aapl), ONE);
        assertEq(margin, 140e6, "haircut");
    }

    function testOpenAndCloseReturnsStockOnFlat() public {
        vm.startPrank(alice);
        aapl.approve(address(box), ONE);
        uint256 id = box.openWithStock(address(aapl), ONE, MARKET, true, 20_000);
        vm.stopPrank();

        assertEq(aapl.balanceOf(alice), 9 * ONE, "stock locked");

        vm.prank(alice);
        box.closeTicket(id);

        assertEq(aapl.balanceOf(alice), 10 * ONE, "stock back");
    }

    function testOpenUsesDepositedStock() public {
        vm.startPrank(alice);
        aapl.approve(address(box), 2 * ONE);
        box.deposit(address(aapl), 2 * ONE);
        box.openWithStock(address(aapl), ONE, MARKET, true, 20_000);
        vm.stopPrank();
        assertEq(box.freeOf(alice, address(aapl)), ONE, "one share still free");
    }

    function testLossSeizesStock() public {
        engine.setPayoutFactor(500_000);
        usdg.mint(address(engine), 1);

        vm.startPrank(alice);
        aapl.approve(address(box), ONE);
        uint256 id = box.openWithStock(address(aapl), ONE, MARKET, true, 20_000);
        box.closeTicket(id);
        vm.stopPrank();

        // $70 loss on $200 mark -> 0.35 share seized, 0.65 back
        assertEq(aapl.balanceOf(alice), 9 * ONE + (65 * ONE) / 100, "partial return");
    }

    function testWinPaysUsdgAndReturnsStock() public {
        engine.setPayoutFactor(1_100_000);
        usdg.mint(address(engine), 1_000e6);

        uint256 before = usdg.balanceOf(alice);
        vm.startPrank(alice);
        aapl.approve(address(box), ONE);
        uint256 id = box.openWithStock(address(aapl), ONE, MARKET, true, 20_000);
        box.closeTicket(id);
        vm.stopPrank();

        assertEq(aapl.balanceOf(alice), 10 * ONE, "stock back");
        assertGt(usdg.balanceOf(alice), before, "profit paid");
    }

    function testReporterCanPushMarks() public {
        address keeper = address(0xB0B);
        vm.prank(admin);
        box.setMarksReporter(keeper);

        address[] memory tokens = new address[](1);
        tokens[0] = address(aapl);
        uint256[] memory marks = new uint256[](1);
        marks[0] = 210e6;

        vm.prank(keeper);
        box.pushMarks(tokens, marks);
        assertEq(box.markUsd6(address(aapl)), 210e6, "reporter write");
    }

    function testStrangerCannotSetMark() public {
        vm.prank(alice);
        vm.expectRevert(HedgeStockCollateral.NotMarksWriter.selector);
        box.setMark(address(aapl), 1);
    }
}
