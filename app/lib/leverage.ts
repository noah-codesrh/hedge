import type { Market } from "./types";

/**
 * The markets Hedge offers leverage on.
 *
 * Deliberately a hand-checked allowlist rather than a rule evaluated at
 * runtime. Leverage puts vault capital behind a trader, so which markets
 * qualify is a risk decision, not a UI one — and the vault can only back a
 * handful at a time.
 *
 * Entries come from `contracts/relayer/screen-markets.ts`, which filters
 * Polymarket for the three market types the brief blacklists: high-odds
 * markets that never liquidate, long-horizon markets that lock capital for
 * years, and thin markets that cannot be priced reliably.
 *
 * This list must stay in step with two other places, or the UI will offer
 * leverage the chain refuses:
 *
 *   - `contracts/relayer/markets.json`, which decides what the keeper prices.
 *   - The markets listed on-chain via `Configure.s.sol`.
 *
 * Short-horizon markets resolve constantly, so re-run the screener and refresh
 * all three together. `pnpm screen` in `contracts/relayer` prints candidates.
 */
export type LeverageMarket = {
  /** Gamma market id. Selects the market within its event via `?m=`. */
  marketId: string;
  /** Parent event slug. Several of these share one event. */
  eventSlug: string;
  /** Polymarket market slug. The join key with the keeper's markets.json. */
  marketSlug: string;
  /** Polymarket YES CLOB token. The join key with the on-chain oracle. */
  yesTokenId: string;
  /**
   * Risk cap for this market, independent of the pool. Volatile or thinner
   * markets get less even when the vault could support more.
   */
  maxLeverage: number;
};

export const LEVERAGE_MARKETS: LeverageMarket[] = [
  {
    marketId: "3847190",
    eventSlug: "what-price-will-bitcoin-hit-in-august-2026",
    marketSlug: "will-bitcoin-dip-to-77pt5k-in-august-2026",
    yesTokenId:
      "60432943459727811939876579458127882879093448601070549237658505707253776040466",
    maxLeverage: 3,
  },
  {
    marketId: "3257386",
    eventSlug: "what-price-will-ethereum-hit-in-august-2026",
    marketSlug: "will-ethereum-reach-2600-in-august-2026",
    yesTokenId:
      "87205176363338814709708203899309446917881667334315183367756187844453520430452",
    maxLeverage: 3,
  },
  {
    marketId: "3491474",
    eventSlug: "iran-oman-hormuz-management-agreement-byptptpt-20260804222725871",
    marketSlug: "iran-oman-hormuz-agreement-by-september-30",
    yesTokenId:
      "68003608521015222679268138757769131071496782683879354114198876947977145147842",
    maxLeverage: 3,
  },
  {
    marketId: "601819",
    eventSlug: "brazil-presidential-election",
    marketSlug: "will-luiz-incio-lula-da-silva-win-the-2026-brazilian-presidential-election",
    yesTokenId:
      "30630994248667897740988010928640156931882346081873066002335460180076741328029",
    maxLeverage: 2,
  },
];

/**
 * Leverage steps offered in the panel. 1x is an ordinary unlevered buy and
 * goes through the normal Polymarket path, so it is always available.
 */
export const LEVERAGE_STEPS = [1, 2, 3] as const;

/**
 * HedgeLeverageEngine on Robinhood Chain.
 *
 * Levered orders settle against this contract rather than Polymarket, so until
 * it is deployed and this is set the panel shows the sizing but refuses to
 * submit. Silently falling back to an unlevered buy would fill a trader at 1x
 * on a ticket that says 3x, which is the one outcome worth engineering against.
 */
export const ENGINE_ADDRESS = (
  import.meta.env.VITE_HEDGE_ENGINE_ADDRESS ?? ""
).trim();

/** HedgeVault on Robinhood Chain. Backs the Earn page. */
export const VAULT_ADDRESS = (
  import.meta.env.VITE_HEDGE_VAULT_ADDRESS ?? ""
).trim();

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Contract is addressed. Used for read-only chain calls, not for user trading. */
export const engineIsDeployed = ADDRESS.test(ENGINE_ADDRESS);
export const vaultIsDeployed = ADDRESS.test(VAULT_ADDRESS);

/**
 * Master switch for leveraged trading.
 *
 * Opt-in rather than opt-out: the contracts can be deployed, funded and
 * addressed in `.env` long before traders should see a 2x/3x selector, and
 * "someone set an address" is not the same decision as "this is open".
 *
 * Earn is independent. The vault can take senior deposits while this is off,
 * so the pool can be seeded before the first levered ticket is offered.
 *
 * Set `VITE_LEVERAGE_ENABLED=true` to turn trading on. Read at build time by
 * Vite, so flipping it needs a rebuild.
 */
export const leverageEnabled =
  (import.meta.env.VITE_LEVERAGE_ENABLED ?? "").trim() === "true";

export const leverageIsLive = leverageEnabled && engineIsDeployed;
export const earnIsLive = vaultIsDeployed;

/** The engine's tradeable band. Outside it, opening reverts on-chain. */
export const PRICE_BAND = { min: 0.35, max: 0.65 } as const;

/** Entry and exit fee, charged on total position size rather than margin. */
export const FEE_BPS = 150;
/** Added to the entry price against the trader, in the direction of the bet. */
export const SPREAD_BPS = 100;
/** A position closes once losses eat this share of net margin. */
export const LIQUIDATION_THRESHOLD_BPS = 9_000;
/** Share of every fee that goes to senior LPs. The rest funds the junior tranche. */
export const SENIOR_FEE_SHARE = 0.7;
/** Most of the vault that may be reserved against open trades at once. */
export const MAX_UTILISATION = 0.3;

/**
 * Projected senior yield at a given level of trading activity.
 *
 * This is a forecast, not a measurement — `readSeniorApr` reports what the
 * vault has actually collected. It exists because at launch there is no
 * history to measure, and an LP still has to decide whether the risk is worth
 * it. Driving it off trades per day rather than a utilisation percentage is
 * deliberate: an LP can form a view on "thirty trades a day" in a way they
 * cannot on "45% capacity utilisation".
 *
 * Only entry and exit fees are counted. The spread and absorbed liquidation
 * margin also accrue to the vault, so a real month should land above this
 * rather than below, which is the direction a projection shown to depositors
 * ought to err in.
 */
export function projectSeniorYield(input: {
  /** Senior capital the fees are spread across, including any pending deposit. */
  seniorBase: number;
  tradesPerDay: number;
  /** Margin x leverage on a typical ticket. */
  avgPositionSize: number;
}): { apr: number; apy: number; dailyVolume: number; dailyFees: number } | null {
  const { seniorBase, tradesPerDay, avgPositionSize } = input;
  if (!(seniorBase > 0) || !(tradesPerDay > 0) || !(avgPositionSize > 0)) {
    return null;
  }

  const dailyVolume = tradesPerDay * avgPositionSize;
  // Charged on the way in and again on the way out, both on total size.
  const dailyFees = dailyVolume * (FEE_BPS / 10_000) * 2;
  const toSenior = dailyFees * SENIOR_FEE_SHARE;

  const apr = (toSenior * 365) / seniorBase;
  // Weekly compounding, matching how fee payouts land back in the tranche.
  const apy = Math.pow(1 + apr / 52, 52) - 1;

  return { apr, apy, dailyVolume, dailyFees: toSenior };
}

const BY_TOKEN = new Map(LEVERAGE_MARKETS.map((m) => [m.yesTokenId, m]));
const BY_ID = new Map(LEVERAGE_MARKETS.map((m) => [m.marketId, m]));
const BY_SLUG = new Map(LEVERAGE_MARKETS.map((m) => [m.marketSlug, m]));

/**
 * The leverage config for a market, or null if it is a normal market.
 *
 * Matches on the YES token first because that is what the oracle keys on, so
 * it cannot drift; ids and slugs are fallbacks for partial market records.
 *
 * Returns null for everything while the feature is switched off. This is the
 * single chokepoint the trade panel funnels through — with no config there is
 * no selector, no engine polling and no levered branch, so an allowlisted
 * market behaves exactly like any other market rather than offering sizing it
 * cannot fill.
 */
export function leverageFor(market: Market): LeverageMarket | null {
  if (!leverageEnabled) return null;
  return (
    (market.yes.tokenId ? BY_TOKEN.get(market.yes.tokenId) : undefined) ??
    BY_ID.get(market.id) ??
    BY_SLUG.get(market.slug) ??
    null
  );
}

export function isLeverageMarket(market: Market): boolean {
  return leverageFor(market) !== null;
}

/**
 * Whether the price is inside the band the engine will open at.
 *
 * A market can be leverage-listed and still be temporarily unopenable: prices
 * drift, and outside $0.35–$0.65 there is too little room left for a position
 * to be worth backing.
 */
export function isWithinBand(price: number): boolean {
  return price >= PRICE_BAND.min && price <= PRICE_BAND.max;
}

export type LeverageQuote = {
  /** Total exposure: margin x leverage. */
  size: number;
  /** Entry after the spread is applied against the trader. */
  entryPrice: number;
  /** Charged up front, out of margin. */
  fee: number;
  /** Margin left backing the position once the fee is taken. */
  netMargin: number;
  shares: number;
  /** Price at which the position is closed and the margin is lost. */
  liquidationPrice: number;
  /** How far the price has to move against the trader to wipe them out. */
  liquidationDistance: number;
};

/**
 * Mirrors `HedgeLeverageEngine.quoteOpen`.
 *
 * Kept in plain numbers rather than bigint because this only ever drives
 * display. The chain recomputes all of it at 1e18 precision on open, so treat
 * anything here as an estimate to within rounding.
 */
export function quoteLeverage(
  margin: number,
  leverage: number,
  spotPrice: number,
  isLong: boolean,
): LeverageQuote | null {
  if (!(margin > 0) || !(spotPrice > 0) || !(leverage >= 1)) return null;

  const size = margin * leverage;
  const entryPrice = isLong
    ? spotPrice * (1 + SPREAD_BPS / 10_000)
    : spotPrice * (1 - SPREAD_BPS / 10_000);
  if (!(entryPrice > 0) || entryPrice >= 1) return null;

  const fee = (size * FEE_BPS) / 10_000;
  const netMargin = margin - fee;
  if (netMargin <= 0) return null;

  const shares = size / entryPrice;
  const maxLoss = (netMargin * LIQUIDATION_THRESHOLD_BPS) / 10_000;

  // Long: the position dies when the shares lose `maxLoss` of value.
  // Short: when they gain it. Both clamp into the (0, 1) outcome range.
  const liquidationPrice = isLong
    ? Math.max(0, (entryPrice * (size - maxLoss)) / size)
    : Math.min(1, (entryPrice * (size + maxLoss)) / size);

  return {
    size,
    entryPrice,
    fee,
    netMargin,
    shares,
    liquidationPrice,
    liquidationDistance: Math.abs(liquidationPrice - spotPrice),
  };
}
