// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Admin} from "./lib/Admin.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {IHedgeVault} from "./interfaces/IHedgeVault.sol";

/**
 * @notice Dual-tranche USDG vault backing the leverage engine.
 *
 * Two pools of capital sit behind every leveraged position:
 *
 *   Junior — protocol seed plus token-tax injections. Absorbs the first loss
 *            whenever a trader wins, and is the last to be repaid.
 *   Senior — public LP deposits. Cannot lose a cent until the junior tranche
 *            is completely exhausted.
 *
 * Senior depositors hold shares rather than a fixed balance, so fee income and
 * any eventual loss accrue pro rata without touching every account.
 */
contract HedgeVault is Admin, ReentrancyGuard, IHedgeVault {
    using SafeTransfer for IERC20;

    uint256 private constant BPS = 10_000;

    /// @notice USDG's precision. Every cap is written in these units.
    uint8 public constant ASSET_DECIMALS = 6;

    IERC20 public immutable assetToken;

    /// @notice The only contract allowed to reserve capital or settle trades.
    address public engine;

    /// @notice Senior capital, growing with fees and shrinking only after junior is gone.
    uint256 public seniorAssets;
    uint256 public totalSeniorShares;
    mapping(address lp => uint256) public seniorSharesOf;

    /// @notice Protocol-owned first-loss capital.
    uint256 public juniorAssets;

    /// @notice Reserved against open positions; cannot be withdrawn by LPs.
    uint256 public lockedAssets;

    /// @notice Fee split. The remainder of each stream goes to the junior tranche.
    uint256 public feeSeniorBps = 7_000;

    /// @notice Split applied to margin absorbed from liquidations.
    uint256 public liquidationSeniorBps = 7_000;

    /// @notice Senior deposits are refused past this, so junior cover is never diluted away.
    uint256 public seniorCap = type(uint256).max;

    bool public depositsPaused;

    event EngineSet(address indexed engine);
    event SeniorDeposit(address indexed lp, uint256 assets, uint256 shares);
    event SeniorWithdraw(address indexed lp, uint256 assets, uint256 shares);
    event JuniorDeposit(address indexed from, uint256 assets);
    event JuniorWithdraw(address indexed to, uint256 assets);
    event FeeCollected(uint256 amount, uint256 toSenior, uint256 toJunior);
    event MarginAbsorbed(uint256 amount, uint256 toSenior, uint256 toJunior);
    event ProfitPaid(address indexed to, uint256 amount, uint256 fromJunior, uint256 fromSenior);
    event Locked(uint256 amount, uint256 totalLocked);
    event Unlocked(uint256 amount, uint256 totalLocked);
    event FeeSplitSet(uint256 seniorBps);
    event LiquidationSplitSet(uint256 seniorBps);
    event SeniorCapSet(uint256 cap);
    event DepositsPausedSet(bool paused);

    error NotEngine();
    error ZeroAmount();
    error InsufficientFreeAssets();
    error InsufficientShares();
    error CapExceeded();
    error DepositsArePaused();
    error InvalidSplit();
    error EngineAlreadySet();
    error InsufficientJunior();
    error UnexpectedDecimals();

    modifier onlyEngine() {
        if (msg.sender != engine) revert NotEngine();
        _;
    }

    constructor(address initialAdmin, address usdg) Admin(initialAdmin) {
        if (usdg == address(0)) revert ZeroAddress();
        // The engine's caps are literals in 6-decimal units ($5 == 5e6), so a
        // token with different precision would rescale every limit by orders of
        // magnitude instead of failing visibly. Catch it at deploy time.
        if (IERC20(usdg).decimals() != ASSET_DECIMALS) revert UnexpectedDecimals();
        assetToken = IERC20(usdg);
    }

    // --- views -------------------------------------------------------------

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function totalAssets() public view returns (uint256) {
        return seniorAssets + juniorAssets;
    }

    function freeAssets() public view returns (uint256) {
        uint256 total = totalAssets();
        return total > lockedAssets ? total - lockedAssets : 0;
    }

    /// @notice USDG a senior LP would receive for their shares right now.
    function seniorAssetsOf(address lp) external view returns (uint256) {
        if (totalSeniorShares == 0) return 0;
        return (seniorSharesOf[lp] * seniorAssets) / totalSeniorShares;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        if (totalSeniorShares == 0 || seniorAssets == 0) return assets;
        return (assets * totalSeniorShares) / seniorAssets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalSeniorShares == 0) return 0;
        return (shares * seniorAssets) / totalSeniorShares;
    }

    // --- senior tranche ----------------------------------------------------

    function depositSenior(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (depositsPaused) revert DepositsArePaused();
        if (seniorAssets + assets > seniorCap) revert CapExceeded();

        shares = convertToShares(assets);
        if (shares == 0) revert ZeroAmount();

        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        seniorAssets += assets;
        totalSeniorShares += shares;
        seniorSharesOf[msg.sender] += shares;

        emit SeniorDeposit(msg.sender, assets, shares);
    }

    function withdrawSenior(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (seniorSharesOf[msg.sender] < shares) revert InsufficientShares();

        assets = convertToAssets(shares);
        // Locked capital is backing live positions, so it is not withdrawable
        // even though it still belongs to the tranche on paper.
        if (assets > freeAssets()) revert InsufficientFreeAssets();

        seniorSharesOf[msg.sender] -= shares;
        totalSeniorShares -= shares;
        seniorAssets -= assets;
        assetToken.safeTransfer(msg.sender, assets);

        emit SeniorWithdraw(msg.sender, assets, shares);
    }

    // --- junior tranche ----------------------------------------------------

    /// @notice Open to anyone so the token-tax collector can inject without being admin.
    function depositJunior(uint256 assets) external nonReentrant {
        if (assets == 0) revert ZeroAmount();
        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        juniorAssets += assets;
        emit JuniorDeposit(msg.sender, assets);
    }

    function withdrawJunior(address to, uint256 assets) external onlyAdmin nonReentrant {
        if (assets == 0) revert ZeroAmount();
        if (assets > juniorAssets) revert InsufficientJunior();
        if (assets > freeAssets()) revert InsufficientFreeAssets();

        juniorAssets -= assets;
        assetToken.safeTransfer(to, assets);
        emit JuniorWithdraw(to, assets);
    }

    // --- engine hooks ------------------------------------------------------

    function lock(uint256 amount) external onlyEngine {
        if (amount > freeAssets()) revert InsufficientFreeAssets();
        lockedAssets += amount;
        emit Locked(amount, lockedAssets);
    }

    function unlock(uint256 amount) external onlyEngine {
        // Clamped rather than reverting: a settlement path must never be blocked
        // by a reservation that drifted, or positions would be stuck open.
        uint256 release = amount > lockedAssets ? lockedAssets : amount;
        lockedAssets -= release;
        emit Unlocked(release, lockedAssets);
    }

    function collectFee(uint256 amount) external onlyEngine {
        if (amount == 0) return;
        uint256 toSenior = (amount * feeSeniorBps) / BPS;
        uint256 toJunior = amount - toSenior;
        seniorAssets += toSenior;
        juniorAssets += toJunior;
        emit FeeCollected(amount, toSenior, toJunior);
    }

    function absorbMargin(uint256 amount) external onlyEngine {
        if (amount == 0) return;
        uint256 toSenior = (amount * liquidationSeniorBps) / BPS;
        uint256 toJunior = amount - toSenior;
        seniorAssets += toSenior;
        juniorAssets += toJunior;
        emit MarginAbsorbed(amount, toSenior, toJunior);
    }

    /**
     * @notice Pay a trader's profit, draining the junior tranche first.
     * @dev This is the first-loss rule. Senior capital is only touched once
     * junior is at zero, which is the protection senior LPs are promised.
     */
    function payProfit(address to, uint256 amount) external onlyEngine nonReentrant {
        if (amount == 0) return;

        uint256 fromJunior = amount > juniorAssets ? juniorAssets : amount;
        uint256 fromSenior = amount - fromJunior;
        // Should be unreachable while the OI cap holds, but a silent underflow
        // here would corrupt every LP's share price.
        if (fromSenior > seniorAssets) revert InsufficientFreeAssets();

        juniorAssets -= fromJunior;
        seniorAssets -= fromSenior;
        assetToken.safeTransfer(to, amount);

        emit ProfitPaid(to, amount, fromJunior, fromSenior);
    }

    // --- admin -------------------------------------------------------------

    /// @dev One-time, so a compromised admin cannot repoint the vault at a drainer.
    function setEngine(address newEngine) external onlyAdmin {
        if (newEngine == address(0)) revert ZeroAddress();
        if (engine != address(0)) revert EngineAlreadySet();
        engine = newEngine;
        emit EngineSet(newEngine);
    }

    function setFeeSeniorBps(uint256 bps) external onlyAdmin {
        if (bps > BPS) revert InvalidSplit();
        feeSeniorBps = bps;
        emit FeeSplitSet(bps);
    }

    function setLiquidationSeniorBps(uint256 bps) external onlyAdmin {
        if (bps > BPS) revert InvalidSplit();
        liquidationSeniorBps = bps;
        emit LiquidationSplitSet(bps);
    }

    function setSeniorCap(uint256 cap) external onlyAdmin {
        seniorCap = cap;
        emit SeniorCapSet(cap);
    }

    function setDepositsPaused(bool paused) external onlyAdmin {
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }
}
