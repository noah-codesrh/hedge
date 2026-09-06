// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Admin} from "./lib/Admin.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/**
 * @notice USDG parimutuel pool. Tickets live here, not in a hot wallet.
 *
 * `stake` pulls USDG and enforces the desk rules the app used to check after
 * the transfer: $1–$25, one ticket per wallet per market, lock before expiry,
 * $200 open float. `resolve` is a reporter push after expiry. `claim` is a
 * pull: winners split the pot, a void refunds the stake.
 *
 * Odds stay off-chain (Dexscreener). This contract only holds the money.
 */
contract HedgePool is Admin, ReentrancyGuard {
    using SafeTransfer for IERC20;

    uint8 public constant ASSET_DECIMALS = 6;
    uint8 public constant SIDE_A = 1;
    uint8 public constant SIDE_B = 2;
    uint8 public constant OUTCOME_VOID = 3;

    IERC20 public immutable usdg;
    address public reporter;

    uint256 public minStake = 1e6;
    uint256 public maxStake = 25e6;
    uint256 public deskCap = 200e6;
    /// @notice USDG in unresolved markets. Counts against `deskCap`.
    uint256 public deskOpen;
    bool public stakingPaused;

    struct Market {
        uint64 lockAt;
        uint64 expiryAt;
        uint128 poolA;
        uint128 poolB;
        uint8 outcome;
        bool listed;
    }

    struct Ticket {
        uint8 side;
        uint128 amount;
        bool claimed;
    }

    mapping(bytes32 id => Market) public markets;
    mapping(bytes32 id => mapping(address user => Ticket)) public tickets;

    event ReporterSet(address indexed reporter);
    event LimitsSet(uint256 minStake, uint256 maxStake, uint256 deskCap);
    event StakingPausedSet(bool paused);
    event MarketListed(bytes32 indexed id, uint64 lockAt, uint64 expiryAt);
    event Staked(bytes32 indexed id, address indexed user, uint8 side, uint256 amount);
    event Resolved(bytes32 indexed id, uint8 outcome, uint256 poolA, uint256 poolB);
    event Claimed(bytes32 indexed id, address indexed user, uint256 paid);

    error UnexpectedDecimals();
    error NotLister();
    error InvalidLimits();
    error InvalidWindow();
    error InvalidSide();
    error InvalidOutcome();
    error StakeOutOfRange();
    error AlreadyTicketed();
    error WindowLocked();
    error TooEarly();
    error MarketNotListed();
    error MarketListedAlready();
    error MarketResolved();
    error DeskCapReached();
    error StakingIsPaused();
    error EmptyWinningSide();
    error NothingToClaim();
    error NoTicket();

    modifier onlyLister() {
        if (msg.sender != admin && msg.sender != reporter) revert NotLister();
        _;
    }

    constructor(address initialAdmin, address usdg_) Admin(initialAdmin) {
        if (usdg_ == address(0)) revert ZeroAddress();
        if (IERC20(usdg_).decimals() != ASSET_DECIMALS) revert UnexpectedDecimals();
        usdg = IERC20(usdg_);
    }

    function setReporter(address next) external onlyAdmin {
        reporter = next;
        emit ReporterSet(next);
    }

    function setLimits(uint256 minStake_, uint256 maxStake_, uint256 deskCap_) external onlyAdmin {
        if (minStake_ == 0 || maxStake_ < minStake_ || deskCap_ < maxStake_) revert InvalidLimits();
        minStake = minStake_;
        maxStake = maxStake_;
        deskCap = deskCap_;
        emit LimitsSet(minStake_, maxStake_, deskCap_);
    }

    function setStakingPaused(bool paused) external onlyAdmin {
        stakingPaused = paused;
        emit StakingPausedSet(paused);
    }

    /**
     * @notice Opens a card. `id` is `keccak256(slug)`, matching the app.
     * @dev One window per id. A resolved slug is history; a new week needs a
     * new id, not a rewrite that would strand unclaimed tickets.
     */
    function listMarket(bytes32 id, uint64 lockAt, uint64 expiryAt) external onlyLister {
        Market storage m = markets[id];
        if (m.listed) revert MarketListedAlready();
        if (!(lockAt > block.timestamp && expiryAt > lockAt)) revert InvalidWindow();
        m.lockAt = lockAt;
        m.expiryAt = expiryAt;
        m.listed = true;
        emit MarketListed(id, lockAt, expiryAt);
    }

    function stake(bytes32 id, uint8 side, uint256 amount) external nonReentrant {
        if (stakingPaused) revert StakingIsPaused();
        if (side != SIDE_A && side != SIDE_B) revert InvalidSide();
        if (amount < minStake || amount > maxStake) revert StakeOutOfRange();

        Market storage m = markets[id];
        if (!m.listed) revert MarketNotListed();
        if (m.outcome != 0) revert MarketResolved();
        if (block.timestamp >= m.lockAt) revert WindowLocked();

        Ticket storage t = tickets[id][msg.sender];
        if (t.amount != 0) revert AlreadyTicketed();
        if (deskOpen + amount > deskCap) revert DeskCapReached();

        usdg.safeTransferFrom(msg.sender, address(this), amount);

        t.side = side;
        t.amount = uint128(amount);
        if (side == SIDE_A) m.poolA += uint128(amount);
        else m.poolB += uint128(amount);
        deskOpen += amount;

        emit Staked(id, msg.sender, side, amount);
    }

    function resolve(bytes32 id, uint8 outcome) external onlyLister nonReentrant {
        if (outcome != SIDE_A && outcome != SIDE_B && outcome != OUTCOME_VOID) {
            revert InvalidOutcome();
        }
        Market storage m = markets[id];
        if (!m.listed) revert MarketNotListed();
        if (m.outcome != 0) revert MarketResolved();
        if (block.timestamp < m.expiryAt) revert TooEarly();
        if (outcome == SIDE_A && m.poolA == 0) revert EmptyWinningSide();
        if (outcome == SIDE_B && m.poolB == 0) revert EmptyWinningSide();

        m.outcome = outcome;
        deskOpen -= uint256(m.poolA) + uint256(m.poolB);
        emit Resolved(id, outcome, m.poolA, m.poolB);
    }

    function claim(bytes32 id) external nonReentrant {
        uint256 paid = previewPayout(id, msg.sender);
        Ticket storage t = tickets[id][msg.sender];
        if (t.amount == 0) revert NoTicket();
        if (t.claimed || paid == 0) revert NothingToClaim();
        t.claimed = true;
        usdg.safeTransfer(msg.sender, paid);
        emit Claimed(id, msg.sender, paid);
    }

    function previewPayout(bytes32 id, address user) public view returns (uint256) {
        Ticket memory t = tickets[id][user];
        Market memory m = markets[id];
        if (t.amount == 0 || t.claimed || m.outcome == 0) return 0;
        if (m.outcome == OUTCOME_VOID) return t.amount;
        if (m.outcome != t.side) return 0;
        uint256 side = m.outcome == SIDE_A ? m.poolA : m.poolB;
        uint256 pot = uint256(m.poolA) + uint256(m.poolB);
        return (uint256(t.amount) * pot) / side;
    }
}
