// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Admin} from "./lib/Admin.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IHedgeOracle} from "./interfaces/IHedgeOracle.sol";
import {IHedgeVault} from "./interfaces/IHedgeVault.sol";

/**
 * @notice Synthetic micro-leverage on Polymarket binary outcomes.
 *
 * A trader posts USDG margin and picks a direction and a leverage multiple. The
 * engine escrows the margin, reserves the vault's worst-case payout, and marks
 * the position against relayed Polymarket prices. Nothing is minted or held on
 * Polygon — the exposure is entirely synthetic and settled in USDG here.
 *
 * Every threshold below is admin-settable so the risk envelope can be widened
 * as the vault grows, and markets are opt-in one at a time.
 *
 * Units: USDG amounts use the token's own decimals (6). Prices use 1e18, where
 * 1e18 is $1.00, and binary outcomes are strictly inside (0, 1).
 */
contract HedgeLeverageEngine is Admin, ReentrancyGuard {
    using SafeTransfer for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant ONE = 1e18;

    IERC20 public immutable assetToken;
    IHedgeVault public immutable vault;
    IHedgeOracle public oracle;

    struct Market {
        bool enabled;
        /**
         * @dev Set once the underlying outcome is known.
         *
         * Polymarket stops quoting a resolved market, so the oracle stops
         * getting prices and every price-dependent path would otherwise seize
         * up. `finalPrice` is what positions settle against instead.
         */
        bool resolved;
        /// @dev Tradeable band. Outside it, a position is nearly settled and
        /// carries almost no liquidation risk, so it just parks vault capital.
        uint128 minPrice;
        uint128 maxPrice;
        /// @dev Per-market reserve ceiling. Zero means only the global cap applies.
        uint128 maxReserve;
        uint128 reserved;
        /// @dev The outcome, 0 or 1e18. Only meaningful once `resolved`.
        uint128 finalPrice;
    }

    struct Position {
        address trader;
        bytes32 marketId;
        bool isLong;
        bool isOpen;
        uint128 entryPrice;
        uint128 size;
        uint128 margin;
        uint128 netMargin;
        uint128 shares;
        uint128 liquidationPrice;
        uint128 reserved;
        uint64 openedAt;
        /**
         * @dev Pinned at open so a trader's carry cost cannot be changed under
         * them by an admin call halfway through a position.
         */
        uint64 borrowRateBps;
    }

    mapping(bytes32 marketId => Market) public markets;
    bytes32[] public marketList;

    mapping(uint256 id => Position) public positions;
    uint256 public nextPositionId = 1;

    uint256[] private _openIds;
    mapping(uint256 id => uint256 index) private _openIdIndex;

    // --- risk parameters, all admin-settable -------------------------------

    /// @notice Largest margin one position may post. $5 at 6 decimals.
    uint256 public maxMargin = 5e6;

    /**
     * @notice Smallest margin a position may post. $1 at 6 decimals.
     * @dev Not a UX nicety. Without a floor, a 1-unit margin rounds its fee to
     * zero and opens a position for the price of gas, and every open position
     * is scanned by the keeper on every tick. Dust would let anyone stall
     * liquidations for the whole protocol.
     */
    uint256 public minMargin = 1e6;

    /**
     * @notice Absolute ceiling on total position size. $25 at 6 decimals.
     * @dev Set to `maxMargin` times the leverage ceiling so it acts as a
     * backstop rather than a binding limit. Setting it below that product
     * silently caps leverage: at $10 a $5 margin can never exceed 2x, so the
     * upper tiers would still be advertised and still revert.
     */
    uint256 public maxPositionSize = 25e6;

    /**
     * @notice Absolute leverage ceiling, 20_000 == 2.00x.
     * @dev A hard cap that no tier can exceed, and an instant brake: lowering
     * it takes effect on the next open regardless of what the tiers say.
     */
    uint256 public maxLeverageBps = 50_000;

    /**
     * @notice Leverage available at a given vault size.
     * @dev Thin vaults cannot absorb a losing streak, so leverage is earned as
     * the pool deepens rather than granted up front. Read against live TVL on
     * every open, so it rises on its own as LPs deposit — no admin call needed.
     */
    struct LeverageTier {
        /// @dev Vault TVL at which this tier starts applying.
        uint128 minTvl;
        uint128 maxLeverageBps;
    }

    LeverageTier[] private _leverageTiers;

    uint256 public openFeeBps = 150;
    uint256 public closeFeeBps = 150;

    /// @notice Charged against the trader on entry, retained by the vault.
    uint256 public spreadBps = 100;

    /**
     * @notice Hourly carry on the vault's share of a position, in bps.
     *
     * @dev Charged on borrowed capital (`size - margin`), so an unlevered
     * position pays nothing. Without it a winning trade could sit on vault
     * liquidity indefinitely for free, which is exactly the capital the tier
     * schedule is trying to recycle. Accrues by the second and is settled out
     * of the trader's margin on exit.
     *
     * 1 bp/hour is ~0.24% a day on the borrowed slice — small next to the 3%
     * round-trip fee, which is intentional: this is a carry cost, not a
     * revenue line.
     */
    uint256 public borrowRateBps = 1;

    /// @dev Ceiling on what any admin call can set the hourly carry to. A
    /// runaway rate would drain open positions, so the bound is in the code
    /// rather than in an operator's judgement.
    uint256 public constant MAX_BORROW_RATE_BPS = 50;

    /// @notice Share of vault TVL that may be reserved against open interest.
    uint256 public maxPoolExposureBps = 3_000;

    /// @notice Fraction of net margin that must be lost before liquidation.
    uint256 public liquidationThresholdBps = 9_000;

    uint128 public defaultMinPrice = 0.35e18;
    uint128 public defaultMaxPrice = 0.65e18;

    /**
     * @notice How long prices must be frozen before positions can be unwound
     * without one.
     * @dev Closing normally needs a fresh price, which means a dead keeper
     * would otherwise trap every trader's margin indefinitely. This is the
     * break-glass window: long enough that it never fires during a brief
     * hiccup, short enough that nobody's money is stuck for days.
     */
    uint256 public staleCloseDelay = 24 hours;

    bool public openingPaused;

    /**
     * @notice May halt new positions, and nothing else.
     * @dev Held by the keeper. It is the one actor that notices trouble in
     * seconds, but it lives on a hot server, so it gets a brake and no other
     * power. It cannot lift a pause the admin put in place.
     */
    address public guardian;
    bool public pausedByGuardian;

    event MarketListed(bytes32 indexed marketId, uint128 minPrice, uint128 maxPrice);
    event MarketUpdated(
        bytes32 indexed marketId, bool enabled, uint128 minPrice, uint128 maxPrice, uint128 maxReserve
    );
    event PositionOpened(
        uint256 indexed id,
        address indexed trader,
        bytes32 indexed marketId,
        bool isLong,
        uint256 margin,
        uint256 size,
        uint256 entryPrice,
        uint256 liquidationPrice,
        uint256 fee
    );
    event PositionClosed(
        uint256 indexed id, address indexed trader, uint256 exitPrice, int256 pnl, uint256 payout, uint256 fee
    );
    event PositionLiquidated(
        uint256 indexed id, address indexed trader, address indexed keeper, uint256 price, uint256 absorbed
    );
    event PositionReduced(
        uint256 indexed id,
        address indexed trader,
        uint256 fractionBps,
        uint256 exitPrice,
        int256 pnl,
        uint256 payout,
        uint256 fee
    );
    event PositionEmergencyClosed(uint256 indexed id, address indexed trader, uint256 refund);
    event BorrowRateSet(uint256 bpsPerHour);
    event MinMarginSet(uint256 minMargin);
    event StaleCloseDelaySet(uint256 seconds_);
    event OracleSet(address indexed oracle);
    event RiskParamsSet(
        uint256 maxMargin, uint256 maxPositionSize, uint256 maxLeverageBps, uint256 maxPoolExposureBps
    );
    event FeeParamsSet(uint256 openFeeBps, uint256 closeFeeBps, uint256 spreadBps);
    event LiquidationThresholdSet(uint256 bps);
    event DefaultBandSet(uint128 minPrice, uint128 maxPrice);
    event OpeningPausedSet(bool paused, address indexed by);
    event GuardianSet(address indexed guardian);
    event MarketResolved(bytes32 indexed marketId, uint256 finalPrice);
    event LeverageTiersSet(uint256 count);

    error MarketNotEnabled();
    error PriceOutOfBand();
    error MarginTooLarge();
    error PositionTooLarge();
    error LeverageTooHigh();
    error LeverageTooLow();
    error MarginTooSmall();
    /// @dev Surfaced to the UI as "pool is filled up, more liquidity incoming".
    error PoolCapacityReached();
    error MarketCapacityReached();
    error OpeningIsPaused();
    error NotPositionOwner();
    error PositionNotOpen();
    error NotLiquidatable();
    error NotStaleEnough();
    /// @dev The oracle is knowingly behind the real price; opening is unsafe.
    error PriceConverging();
    error NotGuardian();
    error NotGuardianPause();
    error InvalidTiers();
    error MarketNotListed();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error InvalidBand();
    error InvalidParams();
    error AlreadyListed();
    error InvalidFraction();
    /// @dev The slice left behind would be too small to be worth scanning.
    error RemainderTooSmall();

    constructor(address initialAdmin, address vault_, address oracle_) Admin(initialAdmin) {
        if (vault_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        vault = IHedgeVault(vault_);
        oracle = IHedgeOracle(oracle_);
        assetToken = IERC20(IHedgeVault(vault_).asset());

        // Starts at the 2x the protocol launches with and widens on its own as
        // LPs deposit. Thresholds are USDG TVL at 6 decimals.
        _leverageTiers.push(LeverageTier(0, 20_000)); // any size      -> 2.0x
        _leverageTiers.push(LeverageTier(1_000e6, 30_000)); // $1,000  -> 3.0x
        _leverageTiers.push(LeverageTier(5_000e6, 40_000)); // $5,000  -> 4.0x
        _leverageTiers.push(LeverageTier(20_000e6, 50_000)); // $20,000 -> 5.0x
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    // --- capacity ----------------------------------------------------------

    /// @notice How much more the vault may reserve before the exposure cap bites.
    function capacity()
        public
        view
        returns (uint256 used, uint256 ceiling, uint256 available)
    {
        used = vault.lockedAssets();
        uint256 byExposure = (vault.totalAssets() * maxPoolExposureBps) / BPS;
        uint256 byLiquidity = used + vault.freeAssets();
        ceiling = byExposure < byLiquidity ? byExposure : byLiquidity;
        available = ceiling > used ? ceiling - used : 0;
    }

    /// @notice True when a fresh position of `reserve` size cannot be backed.
    function isPoolFull(uint256 reserve) external view returns (bool) {
        (,, uint256 available) = capacity();
        return reserve > available;
    }

    // --- leverage tiers ------------------------------------------------------

    /**
     * @notice Leverage currently allowed, from live vault TVL.
     * @dev Rises by itself as the pool grows. `maxLeverageBps` still caps the
     * result, so lowering the ceiling brakes everything immediately without
     * having to rewrite the schedule.
     */
    function effectiveMaxLeverageBps() public view returns (uint256) {
        uint256 tvl = vault.totalAssets();
        uint256 allowed = BPS;

        // Ascending by minTvl, so the last tier we clear is the right one.
        for (uint256 i; i < _leverageTiers.length; ++i) {
            if (tvl < _leverageTiers[i].minTvl) break;
            allowed = _leverageTiers[i].maxLeverageBps;
        }
        return allowed < maxLeverageBps ? allowed : maxLeverageBps;
    }

    /// @notice TVL at which leverage next steps up, and to what. Zeroes when
    /// the top tier is already in force, so the UI can hide the hint.
    function nextLeverageTier() external view returns (uint256 atTvl, uint256 leverageBps) {
        uint256 tvl = vault.totalAssets();
        for (uint256 i; i < _leverageTiers.length; ++i) {
            if (tvl < _leverageTiers[i].minTvl) {
                return (_leverageTiers[i].minTvl, _leverageTiers[i].maxLeverageBps);
            }
        }
        return (0, 0);
    }

    function leverageTiers() external view returns (LeverageTier[] memory) {
        return _leverageTiers;
    }

    // --- quoting -----------------------------------------------------------

    struct Quote {
        uint256 size;
        uint256 entryPrice;
        uint256 fee;
        uint256 netMargin;
        uint256 shares;
        uint256 liquidationPrice;
        uint256 reserve;
        bool hasCapacity;
    }

    /// @notice Preview a position without opening it. Used by the trade panel.
    function quoteOpen(bytes32 marketId, bool isLong, uint256 margin, uint256 leverageBps)
        public
        view
        returns (Quote memory q)
    {
        uint256 spot = oracle.requireFreshPrice(marketId);
        q.size = (margin * leverageBps) / BPS;
        q.entryPrice = _entryPrice(spot, isLong);
        q.fee = (q.size * openFeeBps) / BPS;
        q.netMargin = margin > q.fee ? margin - q.fee : 0;
        q.shares = (q.size * ONE) / q.entryPrice;
        q.liquidationPrice = _liquidationPrice(isLong, q.entryPrice, q.size, q.netMargin);
        q.reserve = _maxPayout(isLong, q.size, q.shares);
        (,, uint256 available) = capacity();
        q.hasCapacity = q.reserve <= available;
    }

    // --- trading -----------------------------------------------------------

    function openPosition(bytes32 marketId, bool isLong, uint256 margin, uint256 leverageBps)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (openingPaused) revert OpeningIsPaused();

        Market storage m = markets[marketId];
        if (!m.enabled) revert MarketNotEnabled();

        if (margin < minMargin) revert MarginTooSmall();
        if (margin > maxMargin) revert MarginTooLarge();
        if (leverageBps < BPS) revert LeverageTooLow();
        if (leverageBps > effectiveMaxLeverageBps()) revert LeverageTooHigh();

        uint256 size = (margin * leverageBps) / BPS;
        if (size > maxPositionSize) revert PositionTooLarge();

        uint256 spot = oracle.requireFreshPrice(marketId);
        if (spot < m.minPrice || spot > m.maxPrice) revert PriceOutOfBand();
        // The oracle is mid-way through walking in a gap, so it already knows
        // this price is behind Polymarket. Opening into that lag is free money
        // for anyone watching the real book, paid for by the vault.
        if (oracle.isConverging(marketId)) revert PriceConverging();

        uint256 entryPrice = _entryPrice(spot, isLong);
        uint256 fee = (size * openFeeBps) / BPS;
        if (margin <= fee) revert MarginTooSmall();
        uint256 netMargin = margin - fee;

        uint256 shares = (size * ONE) / entryPrice;
        uint256 reserve = _maxPayout(isLong, size, shares);

        // Capacity is checked before any transfer so a full pool costs the
        // trader nothing but gas, and the UI gets a distinguishable error.
        (,, uint256 available) = capacity();
        if (reserve > available) revert PoolCapacityReached();
        if (m.maxReserve != 0 && uint256(m.reserved) + reserve > m.maxReserve) {
            revert MarketCapacityReached();
        }

        assetToken.safeTransferFrom(msg.sender, address(this), margin);
        vault.lock(reserve);
        m.reserved += uint128(reserve);

        assetToken.safeTransfer(address(vault), fee);
        vault.collectFee(fee);

        id = nextPositionId++;
        positions[id] = Position({
            trader: msg.sender,
            marketId: marketId,
            isLong: isLong,
            isOpen: true,
            entryPrice: uint128(entryPrice),
            size: uint128(size),
            margin: uint128(margin),
            netMargin: uint128(netMargin),
            shares: uint128(shares),
            liquidationPrice: uint128(_liquidationPrice(isLong, entryPrice, size, netMargin)),
            reserved: uint128(reserve),
            openedAt: uint64(block.timestamp),
            borrowRateBps: uint64(borrowRateBps)
        });

        _openIdIndex[id] = _openIds.length;
        _openIds.push(id);

        emit PositionOpened(
            id,
            msg.sender,
            marketId,
            isLong,
            margin,
            size,
            entryPrice,
            positions[id].liquidationPrice,
            fee
        );
    }

    function closePosition(uint256 id) external nonReentrant returns (uint256 payout) {
        Position storage p = positions[id];
        if (!p.isOpen) revert PositionNotOpen();
        if (p.trader != msg.sender) revert NotPositionOwner();

        Market storage m = markets[p.marketId];
        // A resolved market has no live price and never will again, so settle
        // against the outcome instead of reverting on a stale feed.
        uint256 price = m.resolved ? m.finalPrice : oracle.requireFreshPrice(p.marketId);

        return _settleAt(id, p, price);
    }

    /**
     * @notice Close a position on a market that has resolved.
     *
     * @dev Permissionless, like liquidation. Once the outcome is known there is
     * no discretion left in the payout — it is arithmetic — so anyone may push
     * the button, and the keeper sweeps these automatically. Leaving it to the
     * trader alone would park vault reserves behind positions nobody bothered
     * to close.
     */
    function settlePosition(uint256 id) external nonReentrant returns (uint256 payout) {
        Position storage p = positions[id];
        if (!p.isOpen) revert PositionNotOpen();

        Market storage m = markets[p.marketId];
        if (!m.resolved) revert MarketNotResolved();

        return _settleAt(id, p, m.finalPrice);
    }

    /// @dev Shared settlement. `price` is a live oracle quote for a normal
    /// close and the resolved outcome for a settlement; the maths is identical.
    function _settleAt(uint256 id, Position storage p, uint256 price)
        internal
        returns (uint256 payout)
    {
        int256 pnl;
        uint256 fee;
        (payout, pnl, fee) = _settleFraction(id, p, price, BPS);
        emit PositionClosed(id, p.trader, price, pnl, payout, fee);
    }

    /**
     * @dev Settles `fractionBps` of a position at `price`.
     *
     * Everything that describes the position scales together — size, shares,
     * margin, net margin and the vault reservation — so the slice left behind
     * is the same trade in miniature. Entry price and leverage are unchanged
     * by construction, which is why the liquidation price does not move on a
     * partial close.
     */
    function _settleFraction(uint256 id, Position storage p, uint256 price, uint256 fractionBps)
        internal
        returns (uint256 payout, int256 pnl, uint256 fee)
    {
        bool whole = fractionBps == BPS;

        uint256 closedSize = whole ? p.size : (uint256(p.size) * fractionBps) / BPS;
        uint256 closedShares = whole ? p.shares : (uint256(p.shares) * fractionBps) / BPS;
        uint256 closedMargin = whole ? p.margin : (uint256(p.margin) * fractionBps) / BPS;
        uint256 closedNet = whole ? p.netMargin : (uint256(p.netMargin) * fractionBps) / BPS;
        uint256 closedReserve = whole ? p.reserved : (uint256(p.reserved) * fractionBps) / BPS;
        uint256 funding = whole
            ? _accruedFunding(p)
            : (_accruedFunding(p) * fractionBps) / BPS;

        // Value the slice before the position shrinks underneath us.
        uint256 value = (closedShares * price) / ONE;
        pnl = p.isLong
            ? int256(value) - int256(closedSize)
            : int256(closedSize) - int256(value);

        if (whole) {
            p.isOpen = false;
            _releaseReserve(id, p);
        } else {
            p.size -= uint128(closedSize);
            p.shares -= uint128(closedShares);
            p.margin -= uint128(closedMargin);
            p.netMargin -= uint128(closedNet);
            p.reserved -= uint128(closedReserve);
            _releasePartialReserve(p.marketId, closedReserve);
        }

        uint256 remaining = closedNet;
        if (pnl > 0) {
            // Profit is the vault's loss; junior tranche eats it first.
            vault.payProfit(address(this), uint256(pnl));
            remaining += uint256(pnl);
        } else if (pnl < 0) {
            uint256 loss = uint256(-pnl);
            if (loss > remaining) loss = remaining;
            remaining -= loss;
            assetToken.safeTransfer(address(vault), loss);
            vault.absorbMargin(loss);
        }

        // Carry is a vault fee, so it splits like every other fee.
        if (funding > remaining) funding = remaining;
        if (funding > 0) {
            remaining -= funding;
            assetToken.safeTransfer(address(vault), funding);
            vault.collectFee(funding);
        }

        // A wiped-out position cannot pay a full exit fee, so take what is left.
        fee = (closedSize * closeFeeBps) / BPS;
        if (fee > remaining) fee = remaining;
        if (fee > 0) {
            remaining -= fee;
            assetToken.safeTransfer(address(vault), fee);
            vault.collectFee(fee);
        }

        payout = remaining;
        if (payout > 0) assetToken.safeTransfer(p.trader, payout);
    }

    /**
     * @notice Close part of a position and keep the rest running.
     *
     * @param fractionBps Share to close, 5_000 being half. `BPS` closes it all.
     *
     * @dev The remainder must still clear `minMargin`, for the same reason a
     * position cannot be opened below it: every open position is scanned by
     * the keeper on every tick, and dust would let someone stall the queue for
     * everyone. Traders who want out entirely should pass `BPS`.
     */
    function reducePosition(uint256 id, uint256 fractionBps)
        external
        nonReentrant
        returns (uint256 payout)
    {
        if (fractionBps == 0 || fractionBps > BPS) revert InvalidFraction();

        Position storage p = positions[id];
        if (!p.isOpen) revert PositionNotOpen();
        if (p.trader != msg.sender) revert NotPositionOwner();

        Market storage m = markets[p.marketId];
        uint256 price = m.resolved ? m.finalPrice : oracle.requireFreshPrice(p.marketId);

        if (fractionBps != BPS) {
            uint256 leftover = uint256(p.margin) - (uint256(p.margin) * fractionBps) / BPS;
            if (leftover < minMargin) revert RemainderTooSmall();
        }

        int256 pnl;
        uint256 fee;
        (payout, pnl, fee) = _settleFraction(id, p, price, fractionBps);

        if (fractionBps == BPS) {
            emit PositionClosed(id, p.trader, price, pnl, payout, fee);
        } else {
            emit PositionReduced(id, p.trader, fractionBps, price, pnl, payout, fee);
        }
    }

    /**
     * @notice Force-close a position whose losses have eaten its margin.
     * @dev Permissionless on purpose. The relayer is the expected caller, but
     * anybody may step in if it stalls — the condition is verified on-chain
     * against the oracle, so a caller cannot liquidate a healthy position.
     */
    function liquidatePosition(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        if (!p.isOpen) revert PositionNotOpen();

        uint256 spot = oracle.requireFreshPrice(p.marketId);
        if (!_isLiquidatable(p, spot)) revert NotLiquidatable();

        p.isOpen = false;
        _releaseReserve(id, p);

        uint256 absorbed = p.netMargin;
        if (absorbed > 0) {
            assetToken.safeTransfer(address(vault), absorbed);
            vault.absorbMargin(absorbed);
        }

        emit PositionLiquidated(id, p.trader, msg.sender, spot, absorbed);
    }

    /**
     * @notice Break-glass exit when the keeper has stopped and prices are frozen.
     *
     * Settles at zero PnL rather than at the last known price. A frozen price
     * is wrong by definition, so paying against it would just hand the vault's
     * money to whoever the outage happened to favour, and let losing positions
     * cash out above their true value. The trader gets their net margin back,
     * the vault keeps the fees it already earned and releases the reservation.
     *
     * No exit fee: this path only opens because the protocol stopped working.
     */
    function emergencyClose(uint256 id) external nonReentrant returns (uint256 refund) {
        Position storage p = positions[id];
        if (!p.isOpen) revert PositionNotOpen();
        if (p.trader != msg.sender) revert NotPositionOwner();

        // Once the outcome is known, settling at zero PnL would rob whoever
        // called it right. settlePosition pays the real result instead.
        if (markets[p.marketId].resolved) revert MarketAlreadyResolved();

        (, uint256 updatedAt) = oracle.price(p.marketId);
        // A missing price is the most broken state there is, so treat a market
        // the oracle has never heard of as fully stale rather than trapping it.
        if (updatedAt != 0 && block.timestamp - updatedAt < staleCloseDelay) {
            revert NotStaleEnough();
        }

        p.isOpen = false;
        _releaseReserve(id, p);

        refund = p.netMargin;
        if (refund > 0) assetToken.safeTransfer(p.trader, refund);

        emit PositionEmergencyClosed(id, p.trader, refund);
    }

    // --- position views ----------------------------------------------------

    function isLiquidatable(uint256 id) external view returns (bool) {
        Position storage p = positions[id];
        if (!p.isOpen) return false;
        (uint256 spot, uint256 updatedAt) = oracle.price(p.marketId);
        if (updatedAt == 0) return false;
        return _isLiquidatable(p, spot);
    }

    /// @notice True when a position is open on a market that has resolved, so
    /// `settlePosition` will succeed. The keeper sweeps on this.
    function isSettleable(uint256 id) external view returns (bool) {
        Position storage p = positions[id];
        return p.isOpen && markets[p.marketId].resolved;
    }

    /// @notice Carry accrued on an open position so far, in USDG.
    function fundingOwed(uint256 id) external view returns (uint256) {
        Position storage p = positions[id];
        if (!p.isOpen) return 0;
        return _accruedFunding(p);
    }

    /**
     * @notice Live liquidation price, including carry accrued since open.
     * @dev Drifts toward the entry price the longer a levered position is
     * held. `positions(id).liquidationPrice` is the open-time figure and does
     * not move; this is the one to show a trader.
     */
    function liquidationPriceNow(uint256 id) external view returns (uint256) {
        Position storage p = positions[id];
        if (!p.isOpen) return 0;
        return _liquidationPriceNow(p);
    }

    function pnlOf(uint256 id) external view returns (int256) {
        Position storage p = positions[id];
        if (!p.isOpen) return 0;
        uint256 spot = oracle.requireFreshPrice(p.marketId);
        return _pnl(p, spot);
    }

    function openPositionCount() external view returns (uint256) {
        return _openIds.length;
    }

    /// @notice Page through open positions so the keeper can scan without logs.
    function openPositionIds(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids)
    {
        uint256 total = _openIds.length;
        if (offset >= total) return new uint256[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        ids = new uint256[](end - offset);
        for (uint256 i; i < ids.length; ++i) {
            ids[i] = _openIds[offset + i];
        }
    }

    function marketCount() external view returns (uint256) {
        return marketList.length;
    }

    // --- internals ---------------------------------------------------------

    function _entryPrice(uint256 spot, bool isLong) internal view returns (uint256 p) {
        // The spread always moves against the trader, and is kept by the vault.
        p = isLong ? (spot * (BPS + spreadBps)) / BPS : (spot * (BPS - spreadBps)) / BPS;
        if (p == 0) p = 1;
        if (p >= ONE) p = ONE - 1;
    }

    /**
     * @dev Worst case the vault can owe on this position.
     *
     * Deliberately not the "borrowed" amount. A binary outcome can run to $1.00
     * or collapse to $0.00, so a winning trade can pay out far more than the
     * leverage top-up: a short's upside is the entire position size. Reserving
     * only the borrowed slice would let a handful of winners leave the vault
     * unable to pay, so the reservation covers the full potential profit.
     */
    function _maxPayout(bool isLong, uint256 size, uint256 shares)
        internal
        pure
        returns (uint256)
    {
        // Long: price -> $1.00, position worth `shares`. Short: price -> $0.00.
        return isLong ? (shares > size ? shares - size : 0) : size;
    }

    function _liquidationPrice(bool isLong, uint256 entryPrice, uint256 size, uint256 netMargin)
        internal
        view
        returns (uint256)
    {
        return _liqPriceFromMaxLoss(
            isLong, entryPrice, size, (netMargin * liquidationThresholdBps) / BPS
        );
    }

    function _liqPriceFromMaxLoss(bool isLong, uint256 entryPrice, uint256 size, uint256 maxLoss)
        internal
        pure
        returns (uint256)
    {
        if (size == 0) return 0;

        if (isLong) {
            // loss = size * (1 - P/entry)  ->  P = entry * (size - maxLoss) / size
            if (maxLoss >= size) return 0;
            return (entryPrice * (size - maxLoss)) / size;
        }
        // loss = size * (P/entry - 1)  ->  P = entry * (size + maxLoss) / size
        uint256 p = (entryPrice * (size + maxLoss)) / size;
        return p >= ONE ? ONE - 1 : p;
    }

    /**
     * @dev Carry owed on the vault's slice since the position opened.
     *
     * Charged on `size - margin` rather than on size, so a 1x position accrues
     * nothing. A partial close takes its pro-rata share and shrinks both size
     * and margin, which leaves the remainder accruing from the original
     * timestamp on a smaller base — the two pieces sum to what the whole
     * position would have owed, with no double charge and nothing forgiven.
     */
    function _accruedFunding(Position storage p) internal view returns (uint256) {
        uint256 borrowed = uint256(p.size) > uint256(p.margin) ? p.size - p.margin : 0;
        if (borrowed == 0 || p.borrowRateBps == 0) return 0;

        uint256 elapsed = block.timestamp - p.openedAt;
        uint256 owed = (borrowed * p.borrowRateBps * elapsed) / (BPS * 1 hours);

        // Carry can never take more than the margin already at risk; past that
        // the position is liquidatable and the vault takes the whole thing.
        return owed > p.netMargin ? p.netMargin : owed;
    }

    function _pnl(Position storage p, uint256 spot) internal view returns (int256) {
        uint256 value = (uint256(p.shares) * spot) / ONE;
        return p.isLong
            ? int256(value) - int256(uint256(p.size))
            : int256(uint256(p.size)) - int256(value);
    }

    /**
     * @dev Liquidatable once price losses plus accrued carry have eaten
     * `liquidationThresholdBps` of the net margin.
     *
     * Not a plain comparison against the stored `liquidationPrice`: that price
     * was computed at open, when no carry had accrued. Ignoring carry here
     * would let a position that has already spent its margin on funding sit
     * open indefinitely at the vault's expense.
     */
    function _isLiquidatable(Position storage p, uint256 spot) internal view returns (bool) {
        int256 pnl = _pnl(p, spot);
        uint256 loss = pnl < 0 ? uint256(-pnl) : 0;
        uint256 charged = loss + _accruedFunding(p);
        return charged >= (uint256(p.netMargin) * liquidationThresholdBps) / BPS;
    }

    /// @dev The stored liquidation price, less whatever carry has since eaten
    /// into the margin backing it. This is the number the UI should show.
    function _liquidationPriceNow(Position storage p) internal view returns (uint256) {
        uint256 budget = (uint256(p.netMargin) * liquidationThresholdBps) / BPS;
        uint256 funding = _accruedFunding(p);
        uint256 maxLoss = budget > funding ? budget - funding : 0;
        return _liqPriceFromMaxLoss(p.isLong, p.entryPrice, p.size, maxLoss);
    }

    /// @dev Frees part of a reservation while the position stays open.
    function _releasePartialReserve(bytes32 marketId, uint256 amount) internal {
        if (amount == 0) return;
        vault.unlock(amount);
        Market storage m = markets[marketId];
        m.reserved = m.reserved > amount ? m.reserved - uint128(amount) : 0;
    }

    /// @dev Unwinds every reservation a settled position held.
    function _releaseReserve(uint256 id, Position storage p) internal {
        vault.unlock(p.reserved);
        Market storage m = markets[p.marketId];
        m.reserved = m.reserved > p.reserved ? m.reserved - p.reserved : 0;
        _closeOpenId(id);
    }

    function _closeOpenId(uint256 id) internal {
        uint256 index = _openIdIndex[id];
        uint256 last = _openIds.length - 1;
        if (index != last) {
            uint256 moved = _openIds[last];
            _openIds[index] = moved;
            _openIdIndex[moved] = index;
        }
        _openIds.pop();
        delete _openIdIndex[id];
    }

    // --- admin -------------------------------------------------------------

    function listMarket(bytes32 marketId, uint128 minPrice, uint128 maxPrice, uint128 maxReserve)
        external
        onlyAdmin
    {
        if (markets[marketId].minPrice != 0 || markets[marketId].enabled) revert AlreadyListed();
        if (minPrice == 0 || maxPrice <= minPrice || maxPrice >= ONE) revert InvalidBand();

        markets[marketId] = Market({
            enabled: true,
            resolved: false,
            minPrice: minPrice,
            maxPrice: maxPrice,
            maxReserve: maxReserve,
            reserved: 0,
            finalPrice: 0
        });
        marketList.push(marketId);
        emit MarketListed(marketId, minPrice, maxPrice);
    }

    /// @notice List with the current default band.
    function listMarketWithDefaults(bytes32 marketId, uint128 maxReserve) external onlyAdmin {
        if (markets[marketId].minPrice != 0 || markets[marketId].enabled) revert AlreadyListed();
        markets[marketId] = Market({
            enabled: true,
            resolved: false,
            minPrice: defaultMinPrice,
            maxPrice: defaultMaxPrice,
            maxReserve: maxReserve,
            reserved: 0,
            finalPrice: 0
        });
        marketList.push(marketId);
        emit MarketListed(marketId, defaultMinPrice, defaultMaxPrice);
    }

    function updateMarket(
        bytes32 marketId,
        bool enabled,
        uint128 minPrice,
        uint128 maxPrice,
        uint128 maxReserve
    ) external onlyAdmin {
        if (minPrice == 0 || maxPrice <= minPrice || maxPrice >= ONE) revert InvalidBand();
        Market storage m = markets[marketId];
        // Reopening a decided market would let people bet on a known outcome.
        if (m.resolved) revert MarketAlreadyResolved();
        m.enabled = enabled;
        m.minPrice = minPrice;
        m.maxPrice = maxPrice;
        m.maxReserve = maxReserve;
        emit MarketUpdated(marketId, enabled, minPrice, maxPrice, maxReserve);
    }

    /// @dev Disabling blocks new positions; open ones can still close or liquidate.
    /**
     * @notice Record a market's outcome so open positions can be settled.
     *
     * @param finalPrice 0 for NO, 1e18 for YES. Values in between are allowed
     * for the rare market that resolves to a partial outcome.
     *
     * @dev Admin-only and one-way. This is the most consequential input in the
     * system after the oracle: it decides every remaining payout on the market
     * at once, and there is no appeal. It is deliberately not on the keeper's
     * hot key. Confirm the outcome on Polymarket first — the keeper will alert
     * when it sees a market close, but it cannot resolve it for you.
     *
     * Listing stays; only trading stops. Positions are then settled through
     * `settlePosition`, which anyone may call.
     */
    function resolveMarket(bytes32 marketId, uint256 finalPrice) external onlyAdmin {
        if (finalPrice > ONE) revert InvalidBand();

        Market storage m = markets[marketId];
        if (m.minPrice == 0) revert MarketNotListed();
        if (m.resolved) revert MarketAlreadyResolved();

        m.resolved = true;
        m.finalPrice = uint128(finalPrice);
        m.enabled = false;

        emit MarketResolved(marketId, finalPrice);
    }

    function setMarketEnabled(bytes32 marketId, bool enabled) external onlyAdmin {
        if (markets[marketId].resolved) revert MarketAlreadyResolved();
        Market storage m = markets[marketId];
        m.enabled = enabled;
        emit MarketUpdated(marketId, enabled, m.minPrice, m.maxPrice, m.maxReserve);
    }

    function setOracle(address oracle_) external onlyAdmin {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = IHedgeOracle(oracle_);
        emit OracleSet(oracle_);
    }

    function setRiskParams(
        uint256 maxMargin_,
        uint256 maxPositionSize_,
        uint256 maxLeverageBps_,
        uint256 maxPoolExposureBps_
    ) external onlyAdmin {
        if (maxLeverageBps_ < BPS || maxPoolExposureBps_ > BPS) revert InvalidParams();
        if (maxMargin_ == 0 || maxPositionSize_ == 0) revert InvalidParams();
        // Crossing the floor and the ceiling would make every open revert.
        if (maxMargin_ < minMargin) revert InvalidParams();
        maxMargin = maxMargin_;
        maxPositionSize = maxPositionSize_;
        maxLeverageBps = maxLeverageBps_;
        maxPoolExposureBps = maxPoolExposureBps_;
        emit RiskParamsSet(maxMargin_, maxPositionSize_, maxLeverageBps_, maxPoolExposureBps_);
    }

    /// @dev Only applies to positions opened after the call; existing ones keep
    /// the rate they were opened at.
    function setBorrowRateBps(uint256 bpsPerHour) external onlyAdmin {
        if (bpsPerHour > MAX_BORROW_RATE_BPS) revert InvalidParams();
        borrowRateBps = bpsPerHour;
        emit BorrowRateSet(bpsPerHour);
    }

    function setFeeParams(uint256 openFeeBps_, uint256 closeFeeBps_, uint256 spreadBps_)
        external
        onlyAdmin
    {
        // Loose ceilings rather than exact values, so fees stay obviously bounded.
        if (openFeeBps_ > 1_000 || closeFeeBps_ > 1_000 || spreadBps_ > 1_000) {
            revert InvalidParams();
        }
        openFeeBps = openFeeBps_;
        closeFeeBps = closeFeeBps_;
        spreadBps = spreadBps_;
        emit FeeParamsSet(openFeeBps_, closeFeeBps_, spreadBps_);
    }

    function setMinMargin(uint256 minMargin_) external onlyAdmin {
        // A zero floor reopens the dust griefing this exists to prevent.
        if (minMargin_ == 0 || minMargin_ > maxMargin) revert InvalidParams();
        minMargin = minMargin_;
        emit MinMarginSet(minMargin_);
    }

    function setStaleCloseDelay(uint256 seconds_) external onlyAdmin {
        // Too short and it becomes a way to dodge a loss during a brief blip.
        if (seconds_ < 1 hours) revert InvalidParams();
        staleCloseDelay = seconds_;
        emit StaleCloseDelaySet(seconds_);
    }

    function setLiquidationThresholdBps(uint256 bps) external onlyAdmin {
        if (bps == 0 || bps > BPS) revert InvalidParams();
        liquidationThresholdBps = bps;
        emit LiquidationThresholdSet(bps);
    }

    function setDefaultBand(uint128 minPrice, uint128 maxPrice) external onlyAdmin {
        if (minPrice == 0 || maxPrice <= minPrice || maxPrice >= ONE) revert InvalidBand();
        defaultMinPrice = minPrice;
        defaultMaxPrice = maxPrice;
        emit DefaultBandSet(minPrice, maxPrice);
    }

    function setOpeningPaused(bool paused) external onlyAdmin {
        openingPaused = paused;
        // Admin overrides either way, so a guardian pause never outlives it.
        pausedByGuardian = false;
        emit OpeningPausedSet(paused, msg.sender);
    }

    function setGuardian(address guardian_) external onlyAdmin {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /**
     * @notice Guardian brake on new positions.
     * @dev Cannot clear a pause the admin set, so a compromised keeper can
     * stall trading but never resume it against the admin's wishes. The worst
     * it can do is deny service, which is recoverable; the alternative is
     * having nobody able to react for minutes while the vault bleeds.
     */
    function guardianSetPaused(bool paused) external onlyGuardian {
        if (!paused && !pausedByGuardian) revert NotGuardianPause();
        openingPaused = paused;
        pausedByGuardian = paused;
        emit OpeningPausedSet(paused, msg.sender);
    }

    function setLeverageTiers(LeverageTier[] calldata tiers) external onlyAdmin {
        // An empty schedule would silently fall through to the raw ceiling,
        // which is the opposite of what tiers are for.
        if (tiers.length == 0 || tiers[0].minTvl != 0) revert InvalidTiers();

        delete _leverageTiers;
        uint128 previousTvl;
        for (uint256 i; i < tiers.length; ++i) {
            // Ascending order is what effectiveMaxLeverageBps relies on.
            if (i != 0 && tiers[i].minTvl <= previousTvl) revert InvalidTiers();
            if (tiers[i].maxLeverageBps < BPS || tiers[i].maxLeverageBps > maxLeverageBps) {
                revert InvalidTiers();
            }
            previousTvl = tiers[i].minTvl;
            _leverageTiers.push(tiers[i]);
        }
        emit LeverageTiersSet(tiers.length);
    }
}
