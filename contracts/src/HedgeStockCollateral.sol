// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Admin} from "./lib/Admin.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IHedgeLeverageEngine} from "./interfaces/IHedgeLeverageEngine.sol";

/**
 * @notice Stock escrow, LP book, and stock-margin leverage desk.
 *
 * Users deposit allowlisted Robinhood equity tokens. Those units stay theirs.
 * Withdraw returns the same ERC-20. A deposit that is not reserved against a
 * ticket is free liquidity in the book.
 *
 * `openWithStock` posts USDG margin to the existing leverage engine from this
 * contract's float, sized from the stock mark after a haircut, and freezes
 * the stock. On close the engine pays this contract. Profit goes to the user
 * in USDG and the stock is returned. A loss is taken from the stock at the
 * current mark. The user never sells the name for cash to open.
 */
contract HedgeStockCollateral is Admin, ReentrancyGuard {
    using SafeTransfer for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant ONE = 1e18;

    IERC20 public usdg;
    IHedgeLeverageEngine public leverageEngine;
    address public marksReporter;

    mapping(address token => bool) public listed;
    mapping(address token => uint256) public markUsd6;
    mapping(address user => mapping(address token => uint256)) public deposited;
    mapping(address user => mapping(address token => uint256)) public locked;
    mapping(address token => uint256) public totalDeposited;

    uint256 public haircutBps = 3_000;
    bool public depositsPaused;
    bool public openingPaused;

    struct Ticket {
        address user;
        address token;
        uint128 stockAmount;
        uint128 marginUsdg;
        uint64 engineId;
        bool open;
    }

    mapping(uint256 id => Ticket) public tickets;
    uint256 public nextTicketId = 1;
    mapping(address user => uint256[]) private _ticketIds;

    event TokenListed(address indexed token, bool on);
    event MarkSet(address indexed token, uint256 markUsd6);
    event HaircutSet(uint256 bps);
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Locked(address indexed user, address indexed token, uint256 amount);
    event Unlocked(address indexed user, address indexed token, uint256 amount);
    event TicketOpened(
        uint256 indexed id,
        address indexed user,
        address indexed token,
        uint256 stockAmount,
        uint256 marginUsdg,
        uint256 engineId
    );
    event TicketClosed(
        uint256 indexed id,
        address indexed user,
        uint256 payout,
        uint256 stockReturned,
        uint256 stockSeized,
        uint256 usdgPaid
    );
    event UsdgEngineSet(address indexed usdg, address indexed engine);
    event DepositsPausedSet(bool paused);
    event OpeningPausedSet(bool paused);
    event DeskFunded(uint256 amount);
    event DeskSwept(address indexed to, uint256 amount);
    event MarksReporterSet(address indexed reporter);

    error TokenNotListed();
    error ZeroAmount();
    error InsufficientFree();
    error DepositsArePaused();
    error OpeningIsPaused();
    error MarkNotSet();
    error EngineNotSet();
    error NotTicketOwner();
    error TicketNotOpen();
    error InvalidHaircut();
    error DeskDry();
    error NotMarksWriter();
    error LengthMismatch();

    constructor(address initialAdmin) Admin(initialAdmin) {}

    function setListed(address token, bool on) external onlyAdmin {
        if (token == address(0)) revert ZeroAddress();
        listed[token] = on;
        emit TokenListed(token, on);
    }

    modifier onlyMarksWriter() {
        if (msg.sender != admin && msg.sender != marksReporter) revert NotMarksWriter();
        _;
    }

    function setMarksReporter(address reporter) external onlyAdmin {
        marksReporter = reporter;
        emit MarksReporterSet(reporter);
    }

    function setMark(address token, uint256 mark) external onlyMarksWriter {
        if (token == address(0)) revert ZeroAddress();
        markUsd6[token] = mark;
        emit MarkSet(token, mark);
    }

    function pushMarks(address[] calldata tokens, uint256[] calldata marks) external onlyMarksWriter {
        if (tokens.length != marks.length) revert LengthMismatch();
        for (uint256 i; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert ZeroAddress();
            markUsd6[tokens[i]] = marks[i];
            emit MarkSet(tokens[i], marks[i]);
        }
    }

    function setHaircut(uint256 bps) external onlyAdmin {
        if (bps >= BPS) revert InvalidHaircut();
        haircutBps = bps;
        emit HaircutSet(bps);
    }

    function setUsdgEngine(address usdg_, address engine_) external onlyAdmin {
        if (usdg_ == address(0) || engine_ == address(0)) revert ZeroAddress();
        usdg = IERC20(usdg_);
        leverageEngine = IHedgeLeverageEngine(engine_);
        emit UsdgEngineSet(usdg_, engine_);
    }

    function setDepositsPaused(bool paused) external onlyAdmin {
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    function setOpeningPaused(bool paused) external onlyAdmin {
        openingPaused = paused;
        emit OpeningPausedSet(paused);
    }

    function fundDesk(uint256 amount) external onlyAdmin {
        if (amount == 0) revert ZeroAmount();
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        emit DeskFunded(amount);
    }

    function sweepUsdg(address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        usdg.safeTransfer(to, amount);
        emit DeskSwept(to, amount);
    }

    function sweepToken(address token, address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function deposit(address token, uint256 amount) external nonReentrant {
        if (depositsPaused) revert DepositsArePaused();
        if (!listed[token]) revert TokenNotListed();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        deposited[msg.sender][token] += amount;
        totalDeposited[token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (_free(msg.sender, token) < amount) revert InsufficientFree();

        deposited[msg.sender][token] -= amount;
        totalDeposited[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function quoteMargin(address token, uint256 stockAmount) public view returns (uint256 marginUsdg) {
        if (!listed[token]) revert TokenNotListed();
        uint256 mark = markUsd6[token];
        if (mark == 0) revert MarkNotSet();
        if (stockAmount == 0) revert ZeroAmount();
        uint256 notional = (stockAmount * mark) / ONE;
        return (notional * (BPS - haircutBps)) / BPS;
    }

    function openWithStock(
        address token,
        uint256 stockAmount,
        bytes32 marketId,
        bool isLong,
        uint256 leverageBps
    ) external nonReentrant returns (uint256 ticketId) {
        if (openingPaused) revert OpeningIsPaused();
        if (address(leverageEngine) == address(0) || address(usdg) == address(0)) {
            revert EngineNotSet();
        }
        if (!listed[token]) revert TokenNotListed();
        if (stockAmount == 0) revert ZeroAmount();

        uint256 margin = quoteMargin(token, stockAmount);
        if (usdg.balanceOf(address(this)) < margin) revert DeskDry();

        _pullOrReserve(msg.sender, token, stockAmount);

        usdg.approve(address(leverageEngine), margin);
        uint256 engineId = leverageEngine.openPosition(marketId, isLong, margin, leverageBps);
        usdg.approve(address(leverageEngine), 0);

        ticketId = nextTicketId++;
        tickets[ticketId] = Ticket({
            user: msg.sender,
            token: token,
            stockAmount: uint128(stockAmount),
            marginUsdg: uint128(margin),
            engineId: uint64(engineId),
            open: true
        });
        _ticketIds[msg.sender].push(ticketId);
        emit TicketOpened(ticketId, msg.sender, token, stockAmount, margin, engineId);
    }

    function closeTicket(uint256 ticketId) external nonReentrant {
        Ticket storage t = tickets[ticketId];
        if (!t.open) revert TicketNotOpen();
        if (t.user != msg.sender) revert NotTicketOwner();

        t.open = false;
        // A keeper liquidation closes the engine row while this ticket is
        // still open. Treat that as a full margin loss and seize stock.
        (, , , bool stillOpen, , , , , , , , , ) = leverageEngine.positions(t.engineId);
        uint256 payout = stillOpen ? leverageEngine.closePosition(t.engineId) : 0;

        uint256 stockAmount = t.stockAmount;
        uint256 seized;
        uint256 paid;
        if (payout >= t.marginUsdg) {
            paid = payout - t.marginUsdg;
            if (paid > 0) usdg.safeTransfer(t.user, paid);
        } else {
            uint256 loss = uint256(t.marginUsdg) - payout;
            seized = _seize(stockAmount, loss, t.token);
        }

        uint256 returned = stockAmount - seized;
        _release(t.user, t.token, stockAmount, seized);
        if (returned > 0) IERC20(t.token).safeTransfer(t.user, returned);

        emit TicketClosed(ticketId, t.user, payout, returned, seized, paid);
    }

    function freeOf(address user, address token) external view returns (uint256) {
        return _free(user, token);
    }

    function ticketCount(address user) external view returns (uint256) {
        return _ticketIds[user].length;
    }

    function ticketIdAt(address user, uint256 index) external view returns (uint256) {
        return _ticketIds[user][index];
    }

    function _pullOrReserve(address user, address token, uint256 amount) private {
        uint256 free = _free(user, token);
        if (free < amount) {
            uint256 need = amount - free;
            IERC20(token).safeTransferFrom(user, address(this), need);
            deposited[user][token] += need;
            totalDeposited[token] += need;
            emit Deposited(user, token, need);
        }
        locked[user][token] += amount;
        emit Locked(user, token, amount);
    }

    function _release(address user, address token, uint256 stockAmount, uint256 seized) private {
        locked[user][token] -= stockAmount;
        deposited[user][token] -= stockAmount;
        totalDeposited[token] -= stockAmount;
        emit Unlocked(user, token, stockAmount);
        if (seized > 0) emit Withdrawn(user, token, seized);
    }

    function _seize(uint256 stockAmount, uint256 lossUsdg, address token) private view returns (uint256) {
        uint256 mark = markUsd6[token];
        if (mark == 0) return stockAmount;
        uint256 value = (stockAmount * mark) / ONE;
        if (value == 0 || lossUsdg >= value) return stockAmount;
        return (stockAmount * lossUsdg) / value;
    }

    function _free(address user, address token) private view returns (uint256) {
        uint256 held = deposited[user][token];
        uint256 used = locked[user][token];
        return held > used ? held - used : 0;
    }
}
