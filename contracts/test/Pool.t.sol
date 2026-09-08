// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Harness} from "./Harness.sol";
import {HedgePool} from "../src/HedgePool.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract PoolTest is Harness {
    HedgePool internal pool;
    MockUSDG internal usdg;
    address internal admin = address(0xA11);
    address internal reporter = address(0x2e);
    address internal alice = address(0xA1);
    address internal bob = address(0xB0);
    bytes32 internal constant ID = keccak256("pons-cashcat");

    function setUp() public {
        usdg = new MockUSDG();
        pool = new HedgePool(admin, address(usdg));
        vm.prank(admin);
        pool.setReporter(reporter);
        usdg.mint(alice, 1_000e6);
        usdg.mint(bob, 1_000e6);
        vm.prank(alice);
        usdg.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        usdg.approve(address(pool), type(uint256).max);
        vm.prank(reporter);
        pool.listMarket(ID, uint64(block.timestamp + 1 hours), uint64(block.timestamp + 2 hours));
    }

    uint8 internal constant A = 1;
    uint8 internal constant B = 2;
    uint8 internal constant VOID = 3;

    function testStakeTwentyFive() public {
        vm.prank(alice);
        pool.stake(ID, A, 25e6);
        (,, uint128 poolA,,,) = pool.markets(ID);
        assertEq(poolA, 25e6, "pool A");
        assertEq(pool.deskOpen(), 25e6, "desk");
        assertEq(usdg.balanceOf(address(pool)), 25e6, "escrowed");
    }

    function testHundredReverts() public {
        vm.prank(alice);
        vm.expectRevert(HedgePool.StakeOutOfRange.selector);
        pool.stake(ID, A, 100e6);
        assertEq(usdg.balanceOf(alice), 1_000e6, "no pull");
    }

    function testSubDollarReverts() public {
        vm.prank(alice);
        vm.expectRevert(HedgePool.StakeOutOfRange.selector);
        pool.stake(ID, A, 0.5e6);
    }

    function testSecondTicketReverts() public {
        vm.startPrank(alice);
        pool.stake(ID, A, 10e6);
        vm.expectRevert(HedgePool.AlreadyTicketed.selector);
        pool.stake(ID, B, 10e6);
        vm.stopPrank();
    }

    function testLockStopsStake() public {
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        vm.expectRevert(HedgePool.WindowLocked.selector);
        pool.stake(ID, A, 10e6);
    }

    function testDeskCap() public {
        vm.prank(admin);
        pool.setLimits(1e6, 25e6, 50e6);
        vm.prank(alice);
        pool.stake(ID, A, 25e6);
        vm.prank(bob);
        pool.stake(ID, B, 25e6);
        address carol = address(0xC0);
        usdg.mint(carol, 25e6);
        vm.startPrank(carol);
        usdg.approve(address(pool), 25e6);
        vm.expectRevert(HedgePool.DeskCapReached.selector);
        pool.stake(ID, A, 25e6);
        vm.stopPrank();
    }

    function testResolveBeforeExpiryReverts() public {
        vm.prank(alice);
        pool.stake(ID, A, 10e6);
        vm.prank(reporter);
        vm.expectRevert(HedgePool.TooEarly.selector);
        pool.resolve(ID, A);
    }

    function testWinnerTakesPot() public {
        vm.prank(alice);
        pool.stake(ID, A, 25e6);
        vm.prank(bob);
        pool.stake(ID, B, 25e6);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(reporter);
        pool.resolve(ID, A);

        assertEq(pool.previewPayout(ID, alice), 50e6, "alice pot");
        assertEq(pool.previewPayout(ID, bob), 0, "bob lost");
        assertEq(pool.deskOpen(), 0, "desk released");

        vm.prank(alice);
        pool.claim(ID);
        assertEq(usdg.balanceOf(alice), 1_025e6, "alice +25");

        vm.prank(bob);
        vm.expectRevert(HedgePool.NothingToClaim.selector);
        pool.claim(ID);
        assertEq(usdg.balanceOf(bob), 975e6, "bob -25");
    }

    function testVoidRefunds() public {
        vm.prank(alice);
        pool.stake(ID, A, 10e6);
        vm.prank(bob);
        pool.stake(ID, B, 20e6);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(reporter);
        pool.resolve(ID, VOID);

        vm.prank(alice);
        pool.claim(ID);
        vm.prank(bob);
        pool.claim(ID);
        assertEq(usdg.balanceOf(alice), 1_000e6, "alice whole");
        assertEq(usdg.balanceOf(bob), 1_000e6, "bob whole");
    }

    function testEmptyWinRevertsUseVoid() public {
        vm.prank(alice);
        pool.stake(ID, A, 10e6);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(reporter);
        vm.expectRevert(HedgePool.EmptyWinningSide.selector);
        pool.resolve(ID, B);
    }

    function testRefundReturnsStake() public {
        vm.prank(alice);
        pool.stake(ID, A, 15e6);
        vm.prank(alice);
        pool.refund(ID);

        (,, uint128 poolA,,,) = pool.markets(ID);
        assertEq(poolA, 0, "pool A");
        assertEq(pool.deskOpen(), 0, "desk");
        assertEq(usdg.balanceOf(alice), 1_000e6, "alice whole");
        (uint8 side, uint128 amount, bool claimed) = pool.tickets(ID, alice);
        assertEq(side, 0, "cleared side");
        assertEq(amount, 0, "cleared amount");
        assertTrue(!claimed, "cleared claim");
    }

    function testRefundThenRestake() public {
        vm.startPrank(alice);
        pool.stake(ID, A, 10e6);
        pool.refund(ID);
        pool.stake(ID, B, 10e6);
        vm.stopPrank();
        (, uint128 amount,) = pool.tickets(ID, alice);
        assertEq(amount, 10e6, "new ticket");
        (,,, uint128 poolB,,) = pool.markets(ID);
        assertEq(poolB, 10e6, "pool B");
    }

    function testRefundAfterLockReverts() public {
        vm.prank(alice);
        pool.stake(ID, A, 10e6);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        vm.expectRevert(HedgePool.WindowLocked.selector);
        pool.refund(ID);
        assertEq(usdg.balanceOf(alice), 990e6, "still in");
    }

    function testRefundReleasesDeskCap() public {
        vm.prank(admin);
        pool.setLimits(1e6, 25e6, 25e6);
        vm.prank(alice);
        pool.stake(ID, A, 25e6);
        vm.prank(bob);
        vm.expectRevert(HedgePool.DeskCapReached.selector);
        pool.stake(ID, B, 25e6);
        vm.prank(alice);
        pool.refund(ID);
        vm.prank(bob);
        pool.stake(ID, B, 25e6);
        assertEq(pool.deskOpen(), 25e6, "bob in");
    }

    function testStrangerCannotRefund() public {
        vm.prank(alice);
        pool.stake(ID, A, 10e6);
        vm.prank(bob);
        vm.expectRevert(HedgePool.NoTicket.selector);
        pool.refund(ID);
    }

    function testStrangerCannotList() public {
        vm.prank(alice);
        vm.expectRevert(HedgePool.NotLister.selector);
        pool.listMarket(keccak256("other"), uint64(block.timestamp + 1), uint64(block.timestamp + 2));
    }
}
