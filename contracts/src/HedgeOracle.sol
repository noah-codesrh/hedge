// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Admin} from "./lib/Admin.sol";
import {IHedgeOracle} from "./interfaces/IHedgeOracle.sol";

/**
 * @notice Polymarket YES prices relayed onto Robinhood Chain.
 *
 * Polymarket settles on Polygon, so there is no way to read a binary outcome
 * price here directly. Whitelisted reporters push it instead, which makes the
 * reporter set the trust boundary for the whole system: a wrong price mints or
 * destroys trader PnL.
 *
 * Three guards limit the damage:
 *
 *  - Prices go stale on a timer, so a silent relayer halts trading rather than
 *    letting anyone trade against a frozen quote.
 *  - A single update cannot move the settlement price further than
 *    `maxDeviationBps`, so one bad print cannot liquidate everybody at once.
 *  - Because of that clamp, a real gap takes several updates to arrive, and
 *    during that walk the settlement price is knowingly behind the truth. The
 *    oracle records the reporter's true target alongside the clamped value and
 *    exposes `isConverging`, so the engine can refuse to open new positions
 *    against a price it already knows is stale.
 *
 * That last point is the important one. Without it, anyone watching Polymarket
 * could open into the lag and take free money off the vault.
 */
contract HedgeOracle is Admin, IHedgeOracle {
    /// @dev 1e18 == $1.00. Binary outcomes are strictly within (0, 1).
    uint256 public constant ONE = 1e18;

    struct Observation {
        /// @dev Settlement price: clamped, and what everything else reads.
        uint128 value;
        /// @dev The reporter's unclamped price. Equal to `value` once caught up.
        uint128 target;
        uint64 updatedAt;
    }

    mapping(bytes32 marketId => Observation) private _observations;
    mapping(address reporter => bool) public isReporter;

    /// @notice A price older than this cannot be traded against.
    uint256 public maxPriceAge = 5 minutes;

    /// @notice Largest move a single update may apply to the settlement price.
    uint256 public maxDeviationBps = 2_000;

    event PriceUpdated(
        bytes32 indexed marketId, uint256 value, uint256 target, uint256 updatedAt
    );
    event ReporterSet(address indexed reporter, bool allowed);
    event MaxPriceAgeSet(uint256 seconds_);
    event MaxDeviationSet(uint256 bps);

    error NotReporter();
    error InvalidPrice();
    error NoPrice();
    error StalePrice();
    error LengthMismatch();

    modifier onlyReporter() {
        if (!isReporter[msg.sender]) revert NotReporter();
        _;
    }

    constructor(address initialAdmin) Admin(initialAdmin) {}

    // --- reads -------------------------------------------------------------

    function price(bytes32 marketId) public view returns (uint256 value, uint256 updatedAt) {
        Observation memory o = _observations[marketId];
        return (o.value, o.updatedAt);
    }

    /// @notice Settlement price, the reporter's true target, and the timestamp.
    function priceDetail(bytes32 marketId)
        external
        view
        returns (uint256 value, uint256 target, uint256 updatedAt)
    {
        Observation memory o = _observations[marketId];
        return (o.value, o.target, o.updatedAt);
    }

    function requireFreshPrice(bytes32 marketId) external view returns (uint256) {
        Observation memory o = _observations[marketId];
        if (o.updatedAt == 0) revert NoPrice();
        if (block.timestamp - o.updatedAt > maxPriceAge) revert StalePrice();
        return o.value;
    }

    /**
     * @notice True while the settlement price is still walking toward a gap.
     * @dev The engine blocks opening here. Closing and liquidation stay
     * available: those positions already carry real exposure, and freezing
     * their exits would be worse than settling a few ticks behind.
     */
    function isConverging(bytes32 marketId) external view returns (bool) {
        Observation memory o = _observations[marketId];
        return o.updatedAt != 0 && o.value != o.target;
    }

    function isStale(bytes32 marketId) external view returns (bool) {
        Observation memory o = _observations[marketId];
        return o.updatedAt == 0 || block.timestamp - o.updatedAt > maxPriceAge;
    }

    // --- reporting ---------------------------------------------------------

    /**
     * @notice Report the true Polymarket price. The clamp is applied here.
     * @dev Reporters always send the real midpoint; the oracle decides how far
     * the settlement price may travel this tick. Keeping the clamp on-chain is
     * what makes `isConverging` trustworthy — a reporter cannot hide a gap by
     * pre-clamping it off-chain.
     */
    function pushPrice(bytes32 marketId, uint256 target) public onlyReporter {
        // A binary outcome at exactly 0 or 1 has resolved; there is nothing left
        // to trade and a 0 entry price would divide by zero downstream.
        if (target == 0 || target >= ONE) revert InvalidPrice();

        Observation memory previous = _observations[marketId];
        uint256 next = target;

        if (previous.updatedAt != 0) {
            uint256 last = previous.value;
            uint256 limit = (last * maxDeviationBps) / 10_000;
            if (target > last && target - last > limit) next = last + limit;
            else if (last > target && last - target > limit) next = last - limit;
        }

        _observations[marketId] =
            Observation(uint128(next), uint128(target), uint64(block.timestamp));
        emit PriceUpdated(marketId, next, target, block.timestamp);
    }

    function pushPrices(bytes32[] calldata marketIds, uint256[] calldata targets)
        external
        onlyReporter
    {
        if (marketIds.length != targets.length) revert LengthMismatch();
        for (uint256 i; i < marketIds.length; ++i) {
            pushPrice(marketIds[i], targets[i]);
        }
    }

    /// @notice Jump straight to a price, skipping the walk. For a genuine gap
    /// the admin has independently confirmed.
    function adminSetPrice(bytes32 marketId, uint256 value) external onlyAdmin {
        if (value == 0 || value >= ONE) revert InvalidPrice();
        _observations[marketId] =
            Observation(uint128(value), uint128(value), uint64(block.timestamp));
        emit PriceUpdated(marketId, value, value, block.timestamp);
    }

    // --- admin -------------------------------------------------------------

    function setReporter(address reporter, bool allowed) external onlyAdmin {
        if (reporter == address(0)) revert ZeroAddress();
        isReporter[reporter] = allowed;
        emit ReporterSet(reporter, allowed);
    }

    function setMaxPriceAge(uint256 seconds_) external onlyAdmin {
        maxPriceAge = seconds_;
        emit MaxPriceAgeSet(seconds_);
    }

    function setMaxDeviationBps(uint256 bps) external onlyAdmin {
        maxDeviationBps = bps;
        emit MaxDeviationSet(bps);
    }
}
