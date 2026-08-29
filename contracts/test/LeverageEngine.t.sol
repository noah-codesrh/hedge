// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Harness} from "./Harness.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";
import {MockToken18} from "./mocks/MockToken18.sol";
import {Admin} from "../src/lib/Admin.sol";
import {HedgeOracle} from "../src/HedgeOracle.sol";
import {HedgeVault} from "../src/HedgeVault.sol";
import {HedgeLeverageEngine} from "../src/HedgeLeverageEngine.sol";

contract LeverageEngineTest is Harness {
    uint256 constant ONE = 1e18;
    uint256 constant USD = 1e6;

    /**
     * @dev The timestamp `setUp` pins the chain to.
     *
     * Tests that warp more than once must build their targets off this, not
     * off `block.timestamp`: the optimizer treats TIMESTAMP as pure and will
     * happily re-read it after a `vm.warp`, so `block.timestamp + 10 hours`
     * evaluated twice does not mean what it looks like it means.
     */
    uint256 constant T0 = 1_700_000_000;

    address admin = address(0xA11CE);
    address relayer = address(0xB0B);
    address trader = address(0xCAFE);
    address lp = address(0xD00D);

    bytes32 constant MARKET = keccak256("will-team-x-win");

    MockUSDG usdg;
    HedgeOracle oracle;
    HedgeVault vault;
    HedgeLeverageEngine engine;

    function setUp() public {
        // Move off genesis so the oracle's staleness window has room underneath it.
        vm.warp(T0);

        usdg = new MockUSDG();
        oracle = new HedgeOracle(admin);
        vault = new HedgeVault(admin, address(usdg));
        engine = new HedgeLeverageEngine(admin, address(vault), address(oracle));

        vm.startPrank(admin);
        vault.setEngine(address(engine));
        oracle.setReporter(relayer, true);
        engine.listMarketWithDefaults(MARKET, 0);
        vm.stopPrank();

        _seedVault(100 * USD, 400 * USD);
        _pushPrice(0.50e18);

        usdg.mint(trader, 1_000 * USD);
        vm.prank(trader);
        usdg.approve(address(engine), type(uint256).max);
    }

    // --- spec assertions ---------------------------------------------------

    /// $5.00 is the hard deposit cap; $5.01 must not open.
    function test_DepositAboveCapReverts() public {
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.MarginTooLarge.selector);
        engine.openPosition(MARKET, true, 5 * USD + 10_000, 20_000);
    }

    function test_DepositAtCapSucceeds() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 5 * USD, 20_000);
        assertGt(id, 0, "position should open at the cap");
    }

    /// Only the $0.35-$0.65 band is tradeable.
    function test_PriceAboveBandReverts() public {
        _adminPrice(0.66e18);
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.PriceOutOfBand.selector);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);
    }

    function test_PriceBelowBandReverts() public {
        _adminPrice(0.34e18);
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.PriceOutOfBand.selector);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);
    }

    function test_PriceAtBandEdgesSucceeds() public {
        _adminPrice(0.35e18);
        vm.prank(trader);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);

        _adminPrice(0.65e18);
        vm.prank(trader);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);
    }

    function test_LeverageAboveCapReverts() public {
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.LeverageTooHigh.selector);
        engine.openPosition(MARKET, true, 2 * USD, 20_001);
    }

    // --- the canonical worked example --------------------------------------

    /**
     * Spec walkthrough: 2x long, $0.50 outcome, $2.50 deposit, $5.00 size.
     * Entry takes the 1% spread to $0.505 and the 1.5% fee is charged on the
     * full $5.00 size, leaving $2.425 of net margin.
     */
    function test_OpenMatchesWorkedExample() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        (,,,, uint128 entryPrice, uint128 size, uint128 margin, uint128 netMargin,,,,,) = engine.positions(id);

        assertEq(size, 5 * USD, "size is margin x leverage");
        assertEq(margin, 2_500_000, "gross margin");
        assertEq(entryPrice, 0.505e18, "1% spread against a long");
        // 1.5% of the $5.00 size, not of the $2.50 margin.
        assertEq(netMargin, 2_425_000, "net margin after the 1.5% size fee");
    }

    /**
     * The liquidation price follows directly from the 90%-of-net-margin rule:
     *
     *   shares    = 5.000000 / 0.505      = 9.900990
     *   max loss  = 2.425000 x 0.90       = 2.182500
     *   liq price = 0.505 x (5 - 2.1825)/5 = 0.284568
     *
     * Note this is a 43% fall from the $0.50 spot, not the ~$0.270 / "25-30%"
     * figures quoted in the brief - those two are not consistent with a 90%
     * threshold at 2x. The rule is implemented as written and stays tunable.
     */
    function test_LiquidationPriceMatchesFormula() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        (,,,,,,,,, uint128 liquidationPrice,,,) = engine.positions(id);
        assertApproxEq(liquidationPrice, 284_567_500_000_000_000, 1e12, "liquidation price");
    }

    function test_LiquidationTriggersAtThresholdAndNotBefore() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);
        (,,,,,,,,, uint128 liquidationPrice,,,) = engine.positions(id);

        // One tick above the trigger the position must survive.
        _adminPrice(uint256(liquidationPrice) + 1e15);
        assertTrue(!engine.isLiquidatable(id), "healthy above the trigger");
        vm.expectRevert(HedgeLeverageEngine.NotLiquidatable.selector);
        engine.liquidatePosition(id);

        _adminPrice(liquidationPrice);
        assertTrue(engine.isLiquidatable(id), "liquidatable at the trigger");

        uint256 vaultBefore = vault.totalAssets();
        engine.liquidatePosition(id);

        (,,, bool isOpen_,,,,,,,,,) = _flags(id);
        assertTrue(!isOpen_, "position closed by liquidation");
        // The whole $2.425 of net margin lands in the vault; the $0.075 entry
        // fee got there at open, so the vault keeps the full $2.50 deposit.
        assertEq(vault.totalAssets() - vaultBefore, 2_425_000, "margin absorbed");
        assertEq(vault.lockedAssets(), 0, "reservation released");
        assertEq(usdg.balanceOf(address(engine)), 0, "engine holds no residue");
    }

    /// A ~30% fall is survivable at 2x, but becomes a liquidation once the
    /// admin tightens the threshold - showing the rule is genuinely tunable.
    function test_ThresholdIsTunable() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        _adminPrice(0.35e18); // 30% below the $0.50 spot
        assertTrue(!engine.isLiquidatable(id), "30% fall survives a 90% threshold");

        vm.prank(admin);
        engine.setLiquidationThresholdBps(6_000);

        // Re-open from the original $0.50 spot, otherwise the new position's
        // entry is the depressed price and its trigger moves down with it.
        _adminPrice(0.50e18);
        vm.prank(trader);
        uint256 id2 = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        _adminPrice(0.35e18);
        assertTrue(engine.isLiquidatable(id2), "tighter threshold liquidates on a 30% fall");
    }

    // --- settlement ---------------------------------------------------------

    function test_CloseInProfitPaysTraderAndReturnsLiquidity() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        assertGt(vault.lockedAssets(), 0, "liquidity reserved while open");

        _adminPrice(0.55e18);
        uint256 balanceBefore = usdg.balanceOf(trader);

        vm.prank(trader);
        uint256 payout = engine.closePosition(id);

        assertGt(payout, 0, "profitable close pays out");
        assertEq(usdg.balanceOf(trader) - balanceBefore, payout, "trader received the payout");
        assertEq(vault.lockedAssets(), 0, "liquidity returned on close");
        assertEq(usdg.balanceOf(address(engine)), 0, "engine holds no residue");

        // shares 9.900990 x $0.55 = $5.445544, minus the $5.00 size = $0.445544
        // profit; plus $2.425 net margin, less the $0.075 exit fee.
        assertApproxEq(payout, 2_795_544, 5, "payout = net margin + pnl - exit fee");
    }

    function test_CloseInLossReturnsRemainder() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        _adminPrice(0.45e18);
        vm.prank(trader);
        uint256 payout = engine.closePosition(id);

        // Loss = 9.900990 x (0.505 - 0.45) = $0.544554.
        assertApproxEq(payout, 2_425_000 - 544_554 - 75_000, 5, "payout after loss and exit fee");
        assertEq(vault.lockedAssets(), 0, "liquidity returned");
        assertEq(usdg.balanceOf(address(engine)), 0, "engine holds no residue");
    }

    function test_ShortProfitsWhenPriceFalls() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, false, 2_500_000, 20_000);

        (,,,, uint128 entryPrice,,,,,,,,) = engine.positions(id);
        assertEq(entryPrice, 0.495e18, "1% spread against a short");

        _adminPrice(0.45e18);
        vm.prank(trader);
        uint256 payout = engine.closePosition(id);
        assertGt(payout, 2_425_000 - 75_000, "short gains as the price falls");
    }

    // --- capacity ------------------------------------------------------------

    /// Once 30% of TVL is reserved the pool is full and the UI shows the
    /// "more liquidity incoming" state rather than a generic failure.
    function test_PoolCapacityReachedIsDistinct() public {
        vm.prank(admin);
        engine.setRiskParams(5 * USD, 10 * USD, 20_000, 3_000);

        (,, uint256 available) = engine.capacity();
        assertGt(available, 0, "capacity available before filling");

        // Each 2x long at $0.505 reserves ~$4.90 of worst-case payout.
        uint256 opened;
        for (uint256 i; i < 64; ++i) {
            (,, uint256 room) = engine.capacity();
            if (room < 4_901_000) break;
            vm.prank(trader);
            engine.openPosition(MARKET, true, 2_500_000, 20_000);
            ++opened;
        }
        assertGt(opened, 0, "some positions fit");

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.PoolCapacityReached.selector);
        engine.openPosition(MARKET, true, 2_500_000, 20_000);

        assertTrue(engine.isPoolFull(4_901_000), "isPoolFull reports the same state");
    }

    function test_ReserveCoversWorstCasePayout() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);
        (,,,,,,,,,, uint128 reserved,,) = engine.positions(id);

        // shares 9.900990 less the $5.00 size: what a run to $1.00 would owe.
        assertApproxEq(reserved, 4_900_990, 5, "reserve equals max payout, not the borrowed slice");
        assertEq(vault.lockedAssets(), reserved, "vault locked the same amount");
    }

    // --- fee routing ----------------------------------------------------------

    function test_EntryFeeSplits70_30() public {
        uint256 seniorBefore = vault.seniorAssets();
        uint256 juniorBefore = vault.juniorAssets();

        vm.prank(trader);
        engine.openPosition(MARKET, true, 2_500_000, 20_000);

        // $0.075 fee -> $0.0525 senior / $0.0225 junior.
        assertEq(vault.seniorAssets() - seniorBefore, 52_500, "70% to senior LPs");
        assertEq(vault.juniorAssets() - juniorBefore, 22_500, "30% to the junior tranche");
    }

    function test_JuniorTrancheAbsorbsTraderProfitFirst() public {
        uint256 seniorBefore = vault.seniorAssets();

        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);
        _adminPrice(0.60e18);
        vm.prank(trader);
        engine.closePosition(id);

        // Junior is far larger than the profit, so senior only ever gains here.
        assertGt(vault.seniorAssets(), seniorBefore, "senior untouched by a trader win");
        assertGt(vault.juniorAssets(), 0, "junior still solvent");
    }

    // --- access control --------------------------------------------------------

    function test_OnlyAdminCanChangeRules() public {
        vm.prank(trader);
        vm.expectRevert(Admin.NotAdmin.selector);
        engine.setRiskParams(50 * USD, 100 * USD, 50_000, 5_000);

        vm.prank(trader);
        vm.expectRevert(Admin.NotAdmin.selector);
        engine.listMarketWithDefaults(keccak256("other"), 0);

        vm.prank(admin);
        engine.setRiskParams(10 * USD, 30 * USD, 30_000, 5_000);
        assertEq(engine.maxMargin(), 10 * USD, "admin raised the deposit cap");
        assertEq(engine.maxLeverageBps(), 30_000, "admin raised the leverage cap");
    }

    /// Raising the caps as liquidity arrives is the intended growth path.
    function test_AdminCanRaiseCapsAsLiquidityGrows() public {
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.MarginTooLarge.selector);
        engine.openPosition(MARKET, true, 10 * USD, 20_000);

        vm.prank(admin);
        engine.setRiskParams(10 * USD, 20 * USD, 20_000, 3_000);

        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 10 * USD, 20_000);
        assertGt(id, 0, "larger deposit allowed after the rule change");
    }

    function test_DisabledMarketBlocksOpening() public {
        vm.prank(admin);
        engine.setMarketEnabled(MARKET, false);

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.MarketNotEnabled.selector);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);
    }

    function test_UnlistedMarketBlocksOpening() public {
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.MarketNotEnabled.selector);
        engine.openPosition(keccak256("never-listed"), true, 2 * USD, 20_000);
    }

    // --- oracle ---------------------------------------------------------------

    function test_StalePriceBlocksOpening() public {
        vm.warp(block.timestamp + 10 minutes);
        vm.prank(trader);
        vm.expectRevert(HedgeOracle.StalePrice.selector);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);
    }

    function test_OnlyReporterCanPush() public {
        vm.prank(trader);
        vm.expectRevert(HedgeOracle.NotReporter.selector);
        oracle.pushPrice(MARKET, 0.5e18);
    }

    /// A gap is walked in at maxDeviationBps per tick rather than rejected, and
    /// the oracle admits it is behind while that walk is happening.
    function test_PriceGapIsClampedAndFlaggedAsConverging() public {
        _pushPrice(0.9e18);

        (uint256 value, uint256 target,) = oracle.priceDetail(MARKET);
        assertEq(value, 0.6e18, "settlement price moved 20%, not the full gap");
        assertEq(target, 0.9e18, "the reporter's true price is recorded");
        assertTrue(oracle.isConverging(MARKET), "oracle knows it is behind");

        // Keep reporting the truth and it catches up, then stops converging.
        for (uint256 i; i < 5; ++i) _pushPrice(0.9e18);
        (value, target,) = oracle.priceDetail(MARKET);
        assertEq(value, target, "settlement price caught up");
        assertTrue(!oracle.isConverging(MARKET), "converging clears once caught up");
    }

    /**
     * The lag between the clamped price and the real one is free money for
     * anyone watching Polymarket, so opening has to be shut while it exists.
     */
    function test_OpeningBlockedWhileOracleIsCatchingUp() public {
        _pushPrice(0.62e18); // a ~24% jump, past the 20% clamp

        assertTrue(oracle.isConverging(MARKET), "precondition: converging");
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.PriceConverging.selector);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);

        _pushPrice(0.62e18); // caught up
        assertTrue(!oracle.isConverging(MARKET), "precondition: caught up");
        vm.prank(trader);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);
    }

    /// Existing positions must still be able to exit while the oracle catches
    /// up — freezing their exits would be worse than settling a tick behind.
    function test_ConvergingDoesNotBlockClosingOrLiquidation() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        _pushPrice(0.2e18); // big fall, will be clamped and flagged
        assertTrue(oracle.isConverging(MARKET), "precondition: converging");

        vm.prank(trader);
        engine.closePosition(id);
        assertEq(vault.lockedAssets(), 0, "close still works mid-convergence");
    }

    // --- senior LP accounting ---------------------------------------------------

    function test_LockedLiquidityIsExcludedFromFreeAssets() public {
        vm.prank(trader);
        engine.openPosition(MARKET, true, 2_500_000, 20_000);

        assertEq(
            vault.freeAssets(),
            vault.totalAssets() - vault.lockedAssets(),
            "reserved capital is not counted as free"
        );

        // Plenty of headroom remains here, so a partial exit still settles.
        uint256 shares = vault.seniorSharesOf(lp);
        vm.prank(lp);
        vault.withdrawSenior(shares / 2);
        assertGt(usdg.balanceOf(lp), 0, "senior LP withdrew their share");
    }

    /// A withdrawal larger than the unreserved balance must be refused.
    function test_SeniorCannotWithdrawReservedLiquidity() public {
        // Shrink the free float so a single position's reserve actually bites.
        vm.prank(admin);
        engine.setRiskParams(5 * USD, 10 * USD, 20_000, 10_000);

        // Read before pranking; a view call would otherwise consume the prank.
        uint256 exit = (vault.seniorSharesOf(lp) * 99) / 100;
        vm.prank(lp);
        vault.withdrawSenior(exit);

        vm.prank(trader);
        engine.openPosition(MARKET, true, 2_500_000, 20_000);

        uint256 junior = vault.juniorAssets();
        assertGt(junior, vault.freeAssets(), "junior now exceeds the free float");

        vm.prank(admin);
        vm.expectRevert(HedgeVault.InsufficientFreeAssets.selector);
        vault.withdrawJunior(admin, junior);
    }

    /// Every cap is a 6-decimal literal, so a wrong-precision collateral must
    /// fail at deploy rather than silently rescaling all of them.
    function test_VaultRejectsNonSixDecimalCollateral() public {
        MockToken18 wrong = new MockToken18();
        vm.expectRevert(HedgeVault.UnexpectedDecimals.selector);
        new HedgeVault(admin, address(wrong));
    }

    // --- market resolution ----------------------------------------------------------

    /**
     * The scenario this whole path exists for. A market resolves YES, Polymarket
     * stops quoting it, and the oracle goes stale. Before settlement existed the
     * winning trader could only wait 24h and emergency-close at zero PnL, handing
     * the vault money that was theirs.
     */
    function test_WinningLongIsPaidOutWhenTheMarketResolvesYes() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        // The feed dies, as it does the moment a market resolves.
        vm.warp(block.timestamp + 7 days);

        vm.prank(admin);
        engine.resolveMarket(MARKET, 1e18);

        uint256 before = usdg.balanceOf(trader);
        engine.settlePosition(id);
        uint256 paid = usdg.balanceOf(trader) - before;

        // Entry $0.505 on $5.00 of size buys 9.9009 shares, worth $9.9009 at
        // resolution. Profit is $4.9009 on $2.425 of net margin, less the exit
        // fee, so the trader must come out well ahead of their $2.50 deposit.
        // Seven days of carry on the $2.50 borrowed at 1bp/hour takes $0.042.
        assertGt(paid, 2_500_000, "winner must be paid more than their deposit");
        assertApproxEq(paid, 7_208_990, 2, "net margin + profit - exit fee - carry");

        (,,, bool isOpen_,,,,,,,,,) = _flags(id);
        assertTrue(!isOpen_, "position settled");
        assertEq(vault.lockedAssets(), 0, "reserve released");
    }

    /// The mirror case: a long on a market that resolves NO loses everything,
    /// and the vault takes the margin rather than refunding it.
    function test_LosingLongForfeitsMarginWhenTheMarketResolvesNo() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        uint256 vaultBefore = vault.totalAssets();
        vm.prank(admin);
        engine.resolveMarket(MARKET, 0);

        uint256 before = usdg.balanceOf(trader);
        engine.settlePosition(id);

        assertEq(usdg.balanceOf(trader) - before, 0, "loser is paid nothing");
        assertEq(
            vault.totalAssets() - vaultBefore, 2_425_000, "vault absorbs the net margin"
        );
    }

    function test_ShortIsPaidWhenTheMarketResolvesNo() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, false, 2_500_000, 20_000);

        vm.prank(admin);
        engine.resolveMarket(MARKET, 0);

        uint256 before = usdg.balanceOf(trader);
        engine.settlePosition(id);
        assertGt(usdg.balanceOf(trader) - before, 2_500_000, "short wins on NO");
    }

    /// Settlement is arithmetic once the outcome is known, so anybody may push
    /// it — otherwise vault reserves sit behind positions nobody closes.
    function test_AnyoneCanSettleAResolvedPosition() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.prank(admin);
        engine.resolveMarket(MARKET, 1e18);

        uint256 before = usdg.balanceOf(trader);
        vm.prank(lp); // not the owner, not the admin
        engine.settlePosition(id);

        assertGt(usdg.balanceOf(trader) - before, 0, "payout still goes to the trader");
    }

    /// Closing must keep working after resolution even though the feed is dead.
    function test_CloseStillWorksOnAResolvedMarketWithAStaleFeed() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.warp(block.timestamp + 7 days);
        vm.prank(admin);
        engine.resolveMarket(MARKET, 1e18);

        uint256 before = usdg.balanceOf(trader);
        vm.prank(trader);
        engine.closePosition(id);
        assertGt(usdg.balanceOf(trader) - before, 2_500_000, "settled at the outcome");
    }

    /// emergencyClose pays zero PnL, so it must not be reachable once the real
    /// answer is known — a winner would be robbed by taking it.
    function test_EmergencyCloseIsBlockedOnceResolved() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.warp(block.timestamp + 2 days);
        vm.prank(admin);
        engine.resolveMarket(MARKET, 1e18);

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.MarketAlreadyResolved.selector);
        engine.emergencyClose(id);
    }

    function test_ResolvedMarketCannotBeTradedOrReopened() public {
        vm.prank(admin);
        engine.resolveMarket(MARKET, 1e18);

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.MarketNotEnabled.selector);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.MarketAlreadyResolved.selector);
        engine.setMarketEnabled(MARKET, true);

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.MarketAlreadyResolved.selector);
        engine.updateMarket(MARKET, true, 0.35e18, 0.65e18, 0);
    }

    function test_ResolutionIsAdminOnlyAndOneWay() public {
        vm.prank(relayer);
        vm.expectRevert(Admin.NotAdmin.selector);
        engine.resolveMarket(MARKET, 1e18);

        vm.prank(admin);
        engine.resolveMarket(MARKET, 1e18);

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.MarketAlreadyResolved.selector);
        engine.resolveMarket(MARKET, 0);
    }

    function test_ResolveRejectsBadInput() public {
        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.InvalidBand.selector);
        engine.resolveMarket(MARKET, 1e18 + 1);

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.MarketNotListed.selector);
        engine.resolveMarket(keccak256("never-listed"), 1e18);
    }

    function test_SettleRequiresResolution() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.expectRevert(HedgeLeverageEngine.MarketNotResolved.selector);
        engine.settlePosition(id);
    }

    /// The vault must always be able to cover a position that resolves fully in
    /// the trader's favour — that is exactly what the reserve was sized for.
    function test_VaultCoversTheMaximumResolutionPayout() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 5 * USD, 20_000);

        vm.prank(admin);
        engine.resolveMarket(MARKET, 1e18);

        // Must not revert for want of liquidity.
        engine.settlePosition(id);
        assertEq(vault.lockedAssets(), 0, "reserve fully released");
        assertEq(
            usdg.balanceOf(address(engine)), 0, "engine holds nothing after settling"
        );
    }

    // --- guardian ------------------------------------------------------------------

    function test_GuardianCanHaltOpeningButNothingElse() public {
        vm.prank(admin);
        engine.setGuardian(relayer);

        vm.prank(relayer);
        engine.guardianSetPaused(true);

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.OpeningIsPaused.selector);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);

        // The brake is all it gets — no access to the money or the rules.
        vm.prank(relayer);
        vm.expectRevert(Admin.NotAdmin.selector);
        engine.setRiskParams(50 * USD, 100 * USD, 50_000, 10_000);

        vm.prank(relayer);
        engine.guardianSetPaused(false);
        vm.prank(trader);
        engine.openPosition(MARKET, true, 2 * USD, 20_000);
    }

    /// A compromised keeper must not be able to undo an admin halt.
    function test_GuardianCannotLiftAnAdminPause() public {
        vm.prank(admin);
        engine.setGuardian(relayer);
        vm.prank(admin);
        engine.setOpeningPaused(true);

        vm.prank(relayer);
        vm.expectRevert(HedgeLeverageEngine.NotGuardianPause.selector);
        engine.guardianSetPaused(false);
    }

    function test_NonGuardianCannotPause() public {
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.NotGuardian.selector);
        engine.guardianSetPaused(true);
    }

    // --- leverage scales with liquidity ---------------------------------------------

    /**
     * Leverage is earned as the pool deepens. Nothing here is an admin action:
     * the ceiling moves purely because LPs deposited.
     */
    function test_LeverageRisesAsLiquidityGrows() public {
        // setUp seeds $500, which sits in the opening 2x tier.
        assertEq(engine.effectiveMaxLeverageBps(), 20_000, "2x while the vault is small");

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.LeverageTooHigh.selector);
        engine.openPosition(MARKET, true, 2 * USD, 30_000);

        _depositSenior(600 * USD); // TVL now ~$1,100
        assertEq(engine.effectiveMaxLeverageBps(), 30_000, "3x past $1,000");

        vm.prank(trader);
        engine.openPosition(MARKET, true, 2 * USD, 30_000);

        _depositSenior(4_000 * USD); // ~$5,100
        assertEq(engine.effectiveMaxLeverageBps(), 40_000, "4x past $5,000");

        _depositSenior(15_000 * USD); // ~$20,100
        assertEq(engine.effectiveMaxLeverageBps(), 50_000, "5x past $20,000");
    }

    // --- carry ---------------------------------------------------------------

    /// A 1x position borrows nothing from the vault, so it must never accrue.
    function test_UnleveredPositionsPayNoCarry() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 10_000);

        vm.warp(block.timestamp + 30 days);
        assertEq(engine.fundingOwed(id), 0, "nothing borrowed, nothing owed");
    }

    /// $2.50 borrowed at 1bp/hour is $0.00025 an hour, and it is linear.
    function test_CarryAccruesOnTheBorrowedSlice() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);
        assertEq(engine.fundingOwed(id), 0, "nothing owed at open");

        vm.warp(T0 + 10 hours);
        assertEq(engine.fundingOwed(id), 2_500, "10h on $2.50 borrowed");

        vm.warp(T0 + 20 hours);
        assertEq(engine.fundingOwed(id), 5_000, "accrues linearly");
    }

    /**
     * Two identical trades, closed at the same price, one held for 20 hours.
     * The only thing that can separate their payouts is the carry.
     */
    function test_TheHolderPaysCarryAndTheQuickTraderDoesNot() public {
        vm.prank(trader);
        uint256 quick = engine.openPosition(MARKET, true, 2_500_000, 20_000);
        vm.prank(trader);
        uint256 held = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        uint256 before = usdg.balanceOf(trader);
        vm.prank(trader);
        engine.closePosition(quick);
        uint256 paidQuick = usdg.balanceOf(trader) - before;

        vm.warp(T0 + 20 hours);
        _adminPrice(0.5e18); // same price, just not stale

        before = usdg.balanceOf(trader);
        vm.prank(trader);
        engine.closePosition(held);
        uint256 paidHeld = usdg.balanceOf(trader) - before;

        assertEq(paidQuick - paidHeld, 5_000, "20 hours of carry, and nothing else");
        assertEq(usdg.balanceOf(address(engine)), 0, "it all went to the vault");
    }

    /// Carry eats margin, so it must drag the liquidation price with it.
    function test_CarryPullsTheLiquidationPriceIn() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        (,,,,,,,,, uint128 atOpen,,,) = engine.positions(id);
        assertEq(engine.liquidationPriceNow(id), atOpen, "no carry, no drift");

        vm.warp(block.timestamp + 200 hours);

        uint256 now_ = engine.liquidationPriceNow(id);
        assertGt(now_, atOpen, "a long liquidates sooner once carry bites");
        // The stored figure is the open-time one and must not have moved.
        (,,,,,,,,, uint128 stored,,,) = engine.positions(id);
        assertEq(stored, atOpen, "stored price is a snapshot, not live");

        // A position that survives at its open-time trigger can still be
        // liquidatable once carry is counted.
        _adminPrice(now_);
        assertTrue(engine.isLiquidatable(id), "liquidatable at the live price");
    }

    /// Carry can never exceed the margin backing it.
    function test_CarryIsCappedAtTheNetMargin() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.warp(block.timestamp + 5_000 days);
        assertEq(engine.fundingOwed(id), 2_425_000, "capped at net margin");
    }

    function test_BorrowRateIsAdminOnlyAndBounded() public {
        uint256 overTheCap = engine.MAX_BORROW_RATE_BPS() + 1;

        vm.prank(trader);
        vm.expectRevert(Admin.NotAdmin.selector);
        engine.setBorrowRateBps(2);

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.InvalidParams.selector);
        engine.setBorrowRateBps(overTheCap);

        vm.prank(admin);
        engine.setBorrowRateBps(0);
        assertEq(engine.borrowRateBps(), 0, "carry can be switched off");
    }

    /// Changing the rate must not reprice positions that are already running.
    function test_OpenPositionsKeepTheRateTheyOpenedAt() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.prank(admin);
        engine.setBorrowRateBps(50);

        vm.warp(T0 + 10 hours);
        _adminPrice(0.5e18);
        assertEq(engine.fundingOwed(id), 2_500, "still charged at 1bp/hour");

        vm.prank(trader);
        uint256 fresh = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.warp(T0 + 20 hours);
        assertEq(engine.fundingOwed(fresh), 125_000, "the new one pays 50bp/hour");
    }

    // --- partial closes --------------------------------------------------------

    /**
     * Halving a position halves everything that describes it, and hands back
     * half the proceeds. Entry price and leverage are untouched, so the
     * liquidation price must not move.
     */
    function test_HalfCloseLeavesHalfTheSameTradeRunning() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 4 * USD, 20_000);

        (,,,, uint128 entry, uint128 size0,, uint128 net0,, uint128 liq0, uint128 res0,,) =
            engine.positions(id);
        uint256 lockedBefore = vault.lockedAssets();

        vm.prank(trader);
        engine.reducePosition(id, 5_000);

        (,,, bool isOpen_, uint128 entry1, uint128 size1,, uint128 net1,, uint128 liq1, uint128 res1,,)
        = engine.positions(id);

        assertTrue(isOpen_, "the other half is still running");
        assertEq(entry1, entry, "entry price is untouched");
        assertEq(size1, size0 / 2, "half the size");
        assertEq(net1, net0 / 2, "half the net margin");
        assertEq(res1, res0 / 2, "half the reservation");
        assertEq(liq1, liq0, "same trade, same liquidation price");
        assertEq(vault.lockedAssets(), lockedBefore - res0 / 2, "vault freed half");
    }

    /// The freed capital has to be usable by the next trader immediately.
    function test_PartialCloseReturnsCapacityToThePool() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 5 * USD, 20_000);

        (,, uint256 availableBefore) = engine.capacity();

        vm.prank(trader);
        engine.reducePosition(id, 5_000);

        (,, uint256 availableAfter) = engine.capacity();
        assertGt(availableAfter, availableBefore, "capacity came back");
    }

    /// Closing in pieces must not pay differently from closing in one go.
    function test_TwoHalfClosesPayTheSameAsOneFullClose() public {
        vm.prank(trader);
        uint256 a = engine.openPosition(MARKET, true, 4 * USD, 20_000);
        vm.prank(trader);
        uint256 b = engine.openPosition(MARKET, true, 4 * USD, 20_000);

        _adminPrice(0.55e18);

        uint256 before = usdg.balanceOf(trader);
        vm.prank(trader);
        engine.reducePosition(a, 5_000);
        vm.prank(trader);
        engine.reducePosition(a, 10_000);
        uint256 inPieces = usdg.balanceOf(trader) - before;

        before = usdg.balanceOf(trader);
        vm.prank(trader);
        engine.closePosition(b);
        uint256 inOne = usdg.balanceOf(trader) - before;

        assertApproxEq(inPieces, inOne, 2, "same money either way");
    }

    /// Dust positions stall the keeper, so the remainder has to clear minMargin.
    function test_PartialCloseCannotLeaveDustBehind() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2 * USD, 20_000);

        // Leaving $0.20 behind is below the $1 floor.
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.RemainderTooSmall.selector);
        engine.reducePosition(id, 9_000);

        // Closing the lot is always allowed.
        vm.prank(trader);
        engine.reducePosition(id, 10_000);
        (,,, bool isOpen_,,,,,,,,,) = _flags(id);
        assertTrue(!isOpen_, "full close via reducePosition");
    }

    function test_PartialCloseRejectsBadFractionsAndOtherPeople() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 4 * USD, 20_000);

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.InvalidFraction.selector);
        engine.reducePosition(id, 0);

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.InvalidFraction.selector);
        engine.reducePosition(id, 10_001);

        vm.prank(lp);
        vm.expectRevert(HedgeLeverageEngine.NotPositionOwner.selector);
        engine.reducePosition(id, 5_000);
    }

    /// Carry is charged pro-rata, and the rest keeps accruing on the smaller base.
    function test_PartialCloseSplitsCarryWithoutLosingAny() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 4 * USD, 20_000);

        vm.warp(block.timestamp + 100 hours);
        _adminPrice(0.5e18);
        // $4 borrowed at 1bp/hour for 100h.
        assertEq(engine.fundingOwed(id), 40_000, "carry before the partial");

        vm.prank(trader);
        engine.reducePosition(id, 5_000);

        // Half was settled with the closed slice; the rest is still owed.
        assertEq(engine.fundingOwed(id), 20_000, "remainder keeps its share");
    }

    /**
     * Every advertised tier has to be usable by someone posting the maximum
     * deposit. `maxPositionSize` used to sit at $10, which quietly pinned a $5
     * margin to 2x no matter what tier the vault had reached.
     */
    function test_EveryTierIsReachableAtTheFullDeposit() public {
        uint256 margin = engine.maxMargin();

        vm.prank(trader);
        engine.openPosition(MARKET, true, margin, 20_000);

        _depositSenior(600 * USD); // ~$1,100 -> 3x
        vm.prank(trader);
        engine.openPosition(MARKET, true, margin, 30_000);

        _depositSenior(4_000 * USD); // ~$5,100 -> 4x
        vm.prank(trader);
        engine.openPosition(MARKET, true, margin, 40_000);

        _depositSenior(15_000 * USD); // ~$20,100 -> 5x
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, margin, 50_000);

        (,,,,, uint128 size,,,,,,,) = _flags(id);
        assertEq(size, 25 * USD, "$5 at 5x is a $25 position");
    }

    /// Withdrawals shrink it back down again, so the pool is never over-levered.
    function test_LeverageFallsBackWhenLiquidityLeaves() public {
        _depositSenior(600 * USD);
        assertEq(engine.effectiveMaxLeverageBps(), 30_000, "3x while funded");

        uint256 shares = vault.convertToShares(600 * USD);
        vm.prank(lp);
        vault.withdrawSenior(shares);

        assertEq(engine.effectiveMaxLeverageBps(), 20_000, "back to 2x once it leaves");
    }

    /// The ceiling is an instant brake regardless of what the tiers say.
    function test_CeilingOverridesTheTierSchedule() public {
        _depositSenior(600 * USD);
        assertEq(engine.effectiveMaxLeverageBps(), 30_000, "tier says 3x");

        vm.prank(admin);
        engine.setRiskParams(5 * USD, 10 * USD, 15_000, 3_000);
        assertEq(engine.effectiveMaxLeverageBps(), 15_000, "ceiling wins");
    }

    function test_NextTierTellsTheUiWhatUnlocksLeverage() public view {
        (uint256 atTvl, uint256 leverageBps) = engine.nextLeverageTier();
        assertEq(atTvl, 1_000e6, "next step is at $1,000 of TVL");
        assertEq(leverageBps, 30_000, "and it unlocks 3x");
    }

    function test_TiersMustBeAscendingAndStartAtZero() public {
        HedgeLeverageEngine.LeverageTier[] memory bad =
            new HedgeLeverageEngine.LeverageTier[](1);
        bad[0] = HedgeLeverageEngine.LeverageTier(100e6, 20_000); // no zero floor

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.InvalidTiers.selector);
        engine.setLeverageTiers(bad);

        HedgeLeverageEngine.LeverageTier[] memory descending =
            new HedgeLeverageEngine.LeverageTier[](2);
        descending[0] = HedgeLeverageEngine.LeverageTier(0, 20_000);
        descending[1] = HedgeLeverageEngine.LeverageTier(0, 30_000);

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.InvalidTiers.selector);
        engine.setLeverageTiers(descending);

        HedgeLeverageEngine.LeverageTier[] memory tooHigh =
            new HedgeLeverageEngine.LeverageTier[](1);
        tooHigh[0] = HedgeLeverageEngine.LeverageTier(0, 90_000); // above the ceiling

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.InvalidTiers.selector);
        engine.setLeverageTiers(tooHigh);
    }

    // --- dust griefing -------------------------------------------------------------

    /**
     * A 1-unit margin rounds its fee to zero, so without a floor it would open a
     * real position for the price of gas. Every open position is scanned by the
     * keeper each tick, so cheap dust is a way to stall liquidations protocol-wide.
     */
    function test_DustMarginReverts() public {
        // Read before pranking; a view call would otherwise consume the prank.
        uint256 floor = engine.minMargin();

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.MarginTooSmall.selector);
        engine.openPosition(MARKET, true, 1, 20_000);

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.MarginTooSmall.selector);
        engine.openPosition(MARKET, true, floor - 1, 20_000);
    }

    function test_MarginAtFloorSucceeds() public {
        uint256 floor = engine.minMargin();
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, floor, 20_000);
        assertGt(id, 0, "the floor itself is tradeable");
    }

    function test_FloorCannotCrossTheCeiling() public {
        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.InvalidParams.selector);
        engine.setMinMargin(6 * USD); // above the $5 maxMargin

        vm.prank(admin);
        vm.expectRevert(HedgeLeverageEngine.InvalidParams.selector);
        engine.setRiskParams(USD / 2, 10 * USD, 20_000, 3_000); // below the $1 minMargin
    }

    // --- keeper outage --------------------------------------------------------------

    /// While prices still flow, the break-glass exit must stay shut.
    function test_EmergencyCloseBlockedWhilePricesFlow() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.NotStaleEnough.selector);
        engine.emergencyClose(id);

        // Stale enough to block a normal close, but not to unlock this one.
        vm.warp(block.timestamp + 10 minutes);
        vm.prank(trader);
        vm.expectRevert(HedgeLeverageEngine.NotStaleEnough.selector);
        engine.emergencyClose(id);
    }

    /**
     * A dead keeper freezes prices, and closePosition needs a fresh one — so
     * without this path a trader's margin would be stuck indefinitely.
     */
    function test_EmergencyCloseFreesMarginWhenKeeperDies() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);

        vm.warp(block.timestamp + 25 hours);

        // The normal exit is shut, which is the problem this solves.
        vm.prank(trader);
        vm.expectRevert(HedgeOracle.StalePrice.selector);
        engine.closePosition(id);

        uint256 before = usdg.balanceOf(trader);
        vm.prank(trader);
        uint256 refund = engine.emergencyClose(id);

        // Settled at zero PnL: net margin back, no payout against a frozen price.
        assertEq(refund, 2_425_000, "net margin refunded in full");
        assertEq(usdg.balanceOf(trader) - before, refund, "trader received it");
        assertEq(vault.lockedAssets(), 0, "reservation released");
        assertEq(usdg.balanceOf(address(engine)), 0, "engine holds no residue");
    }

    function test_EmergencyCloseIsOwnerOnly() public {
        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);
        vm.warp(block.timestamp + 25 hours);

        vm.prank(lp);
        vm.expectRevert(HedgeLeverageEngine.NotPositionOwner.selector);
        engine.emergencyClose(id);
    }

    /// The vault keeps the entry fee it already earned; only margin comes back.
    function test_EmergencyCloseLeavesEarnedFeesWithTheVault() public {
        uint256 before = vault.totalAssets();

        vm.prank(trader);
        uint256 id = engine.openPosition(MARKET, true, 2_500_000, 20_000);
        vm.warp(block.timestamp + 25 hours);
        vm.prank(trader);
        engine.emergencyClose(id);

        assertEq(vault.totalAssets() - before, 75_000, "vault retains the $0.075 entry fee");
    }

    // --- helpers -----------------------------------------------------------------

    function _seedVault(uint256 junior, uint256 senior) private {
        usdg.mint(admin, junior);
        vm.startPrank(admin);
        usdg.approve(address(vault), type(uint256).max);
        vault.depositJunior(junior);
        vm.stopPrank();

        usdg.mint(lp, senior);
        vm.startPrank(lp);
        usdg.approve(address(vault), type(uint256).max);
        vault.depositSenior(senior);
        vm.stopPrank();
    }

    function _depositSenior(uint256 assets) private {
        usdg.mint(lp, assets);
        vm.startPrank(lp);
        usdg.approve(address(vault), type(uint256).max);
        vault.depositSenior(assets);
        vm.stopPrank();
    }

    function _pushPrice(uint256 value) private {
        vm.prank(relayer);
        oracle.pushPrice(MARKET, value);
    }

    /// @dev Large moves need the admin path, which bypasses the deviation guard.
    function _adminPrice(uint256 value) private {
        vm.prank(admin);
        oracle.adminSetPrice(MARKET, value);
    }

    function _flags(uint256 id)
        private
        view
        returns (
            address,
            bytes32,
            bool,
            bool,
            uint128,
            uint128,
            uint128,
            uint128,
            uint128,
            uint128,
            uint128,
            uint64,
            uint64
        )
    {
        return engine.positions(id);
    }
}
