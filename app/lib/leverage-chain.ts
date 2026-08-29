import {
  createPublicClient,
  fallback,
  http,
  keccak256,
  stringToBytes,
  type Hex,
} from "viem";
import { robinhoodChain } from "./chains";
import { RH_RPC, RH_RPC_FALLBACK } from "./robinhood";
import { engineAbi, vaultAbi } from "./leverage-abi";
import {
  ENGINE_ADDRESS,
  LEVERAGE_MARKETS,
  VAULT_ADDRESS,
  earnIsLive,
  engineIsDeployed,
  leverageIsLive,
} from "./leverage";

/**
 * Reads against the Hedge contracts on Robinhood Chain.
 *
 * Read-only by design. Every state change goes through `leverage-actions.ts`,
 * which routes via the sponsored-send endpoint so the app pays gas — traders
 * hold USDG here, not ETH.
 *
 * Batched reads use plain `Promise.all` rather than viem's `multicall`.
 * Robinhood Chain has no Multicall3 in its chain definition, and viem throws
 * `ChainDoesNotSupportContract` rather than falling back, so multicall would
 * fail every read here. A handful of parallel `eth_call`s costs a little more
 * round-trip and always works.
 */
const client = createPublicClient({
  chain: robinhoodChain,
  transport: fallback([
    http(RH_RPC_FALLBACK, { timeout: 6_000 }),
    http(RH_RPC, { timeout: 6_000 }),
  ]),
});

export const USDG_DECIMALS = 6;
const USDG_UNIT = 1_000_000n;
const PRICE_UNIT = 10n ** 18n;

const engine = { address: ENGINE_ADDRESS as Hex, abi: engineAbi } as const;
const vault = { address: VAULT_ADDRESS as Hex, abi: vaultAbi } as const;

/** Mirrors `marketIdFor` in the keeper: the on-chain key is the slug's hash. */
export function marketIdFor(slug: string): Hex {
  return keccak256(stringToBytes(slug));
}

const MARKET_BY_ID = new Map(
  LEVERAGE_MARKETS.map((m) => [marketIdFor(m.marketSlug), m]),
);

/** USDG has 6 decimals, so a plain number is exact well past any position size. */
export function toUsd(raw: bigint): number {
  return Number(raw) / Number(USDG_UNIT);
}

export function toUsdgRaw(amount: number): bigint {
  return BigInt(Math.round(amount * Number(USDG_UNIT)));
}

/** Outcome prices are 1e18 == $1.00. */
export function toPrice(raw: bigint): number {
  return Number((raw * 1_000_000n) / PRICE_UNIT) / 1_000_000;
}

export type ChainQuote = {
  size: number;
  entryPrice: number;
  fee: number;
  netMargin: number;
  shares: number;
  liquidationPrice: number;
  reserve: number;
  hasCapacity: boolean;
};

/**
 * The engine's own quote for a prospective position.
 *
 * `quoteLeverage` in `leverage.ts` computes the same thing in the browser for
 * instant feedback while typing; this is the authoritative version and is what
 * the confirmation step should show, because it is the arithmetic the chain
 * will actually run.
 */
export async function quoteOpenOnChain(input: {
  marketSlug: string;
  isLong: boolean;
  margin: number;
  leverage: number;
}): Promise<ChainQuote | null> {
  if (!engineIsDeployed) return null;

  try {
    const q = await client.readContract({
      ...engine,
      functionName: "quoteOpen",
      args: [
        marketIdFor(input.marketSlug),
        input.isLong,
        toUsdgRaw(input.margin),
        BigInt(Math.round(input.leverage * 10_000)),
      ],
    });

    return {
      size: toUsd(q.size),
      entryPrice: toPrice(q.entryPrice),
      fee: toUsd(q.fee),
      netMargin: toUsd(q.netMargin),
      shares: toUsd(q.shares),
      liquidationPrice: toPrice(q.liquidationPrice),
      reserve: toUsd(q.reserve),
      hasCapacity: q.hasCapacity,
    };
  } catch {
    // A stale oracle, an unlisted market or an out-of-band price all revert
    // here. The panel falls back to its local estimate and the open itself
    // will surface the specific reason.
    return null;
  }
}

export type EngineState = {
  maxLeverage: number;
  nextTier: { atTvl: number; leverage: number } | null;
  /** `used` is reserved now, `ceiling` is the most that may ever be. */
  capacity: { used: number; ceiling: number; available: number };
  minMargin: number;
  maxMargin: number;
  openingPaused: boolean;
  borrowRateBps: number;
};

/** Pool-wide numbers the trade panel needs: leverage on offer and headroom. */
export async function readEngineState(): Promise<EngineState | null> {
  if (!engineIsDeployed) return null;

  try {
    const [maxLeverageBps, nextTier, capacity, minMargin, maxMargin, paused, rate] =
      await Promise.all([
        client.readContract({ ...engine, functionName: "effectiveMaxLeverageBps" }),
        client.readContract({ ...engine, functionName: "nextLeverageTier" }),
        client.readContract({ ...engine, functionName: "capacity" }),
        client.readContract({ ...engine, functionName: "minMargin" }),
        client.readContract({ ...engine, functionName: "maxMargin" }),
        client.readContract({ ...engine, functionName: "openingPaused" }),
        client.readContract({ ...engine, functionName: "borrowRateBps" }),
      ]);

    const [atTvl, tierBps] = nextTier;

    return {
      maxLeverage: Number(maxLeverageBps) / 10_000,
      nextTier:
        tierBps > 0n
          ? { atTvl: toUsd(atTvl), leverage: Number(tierBps) / 10_000 }
          : null,
      capacity: {
        used: toUsd(capacity[0]),
        ceiling: toUsd(capacity[1]),
        available: toUsd(capacity[2]),
      },
      minMargin: toUsd(minMargin),
      maxMargin: toUsd(maxMargin),
      openingPaused: paused,
      borrowRateBps: Number(rate),
    };
  } catch {
    return null;
  }
}

export type LeverageTier = { minTvl: number; leverage: number };

/**
 * The tier schedule, so the Earn page can show what a bigger vault unlocks.
 *
 * Read from the chain rather than mirrored in the client: the schedule is
 * admin-settable, and a hardcoded copy would quietly start lying the first
 * time it changed.
 */
export async function readLeverageTiers(): Promise<LeverageTier[]> {
  if (!engineIsDeployed) return [];
  try {
    const tiers = await client.readContract({
      ...engine,
      functionName: "leverageTiers",
    });
    return tiers.map((t) => ({
      minTvl: toUsd(t.minTvl),
      leverage: Number(t.maxLeverageBps) / 10_000,
    }));
  } catch {
    return [];
  }
}

/** Leverage the schedule allows at a hypothetical TVL. Mirrors the engine loop. */
export function leverageAtTvl(tiers: LeverageTier[], tvl: number): number {
  let allowed = 1;
  for (const tier of tiers) {
    if (tvl < tier.minTvl) break;
    allowed = tier.leverage;
  }
  return allowed;
}

export type LeveragePosition = {
  id: bigint;
  marketSlug: string;
  marketId: Hex;
  /** The registry entry, when the position is on a market the app still lists. */
  label: string | null;
  eventSlug: string | null;
  gammaMarketId: string | null;
  isLong: boolean;
  entryPrice: number;
  size: number;
  margin: number;
  netMargin: number;
  shares: number;
  leverage: number;
  /** Live, including carry. The open-time figure is `liquidationPriceAtOpen`. */
  liquidationPrice: number;
  liquidationPriceAtOpen: number;
  funding: number;
  pnl: number;
  /** What the trader would receive closing right now, before the exit fee. */
  value: number;
  openedAt: number;
  atRisk: boolean;
  resolved: boolean;
};

/**
 * Every open levered position belonging to `trader`.
 *
 * Scans the engine's open-position list and filters client-side. There is no
 * per-trader index on-chain and no subgraph, but the list is bounded by what
 * the vault can reserve at once — a few dozen at this size — so one multicall
 * covers it. If open interest ever outgrows that, this wants an indexer rather
 * than a bigger page.
 */
export async function readPositionsFor(
  trader: string,
): Promise<LeveragePosition[]> {
  if (!leverageIsLive || !trader) return [];

  try {
    const ids = await client.readContract({
      ...engine,
      functionName: "openPositionIds",
      args: [0n, 500n],
    });
    if (ids.length === 0) return [];

    const raw = await Promise.all(
      ids.map((id) =>
        client.readContract({ ...engine, functionName: "positions", args: [id] }),
      ),
    );

    const mine = ids
      .map((id, i) => ({ id, p: raw[i]! }))
      .filter(
        ({ p }) => p[3] && p[0].toLowerCase() === trader.toLowerCase(),
      );
    if (mine.length === 0) return [];

    // pnlOf and liquidationPriceNow revert on a stale or resolved feed, which
    // must not blank the whole list — a trader needs to see their position
    // most when the feed is misbehaving.
    const detail = await Promise.allSettled(
      mine.flatMap(({ id }) => [
        client.readContract({ ...engine, functionName: "pnlOf", args: [id] }),
        client.readContract({ ...engine, functionName: "fundingOwed", args: [id] }),
        client.readContract({ ...engine, functionName: "liquidationPriceNow", args: [id] }),
        client.readContract({ ...engine, functionName: "isLiquidatable", args: [id] }),
      ]),
    );

    const resolved = await Promise.all(
      mine.map(({ p }) =>
        client.readContract({ ...engine, functionName: "markets", args: [p[1]] }),
      ),
    );

    return mine.map(({ id, p }, i) => {
      const marketId = p[1];
      const known = MARKET_BY_ID.get(marketId) ?? null;
      const entryPrice = toPrice(p[4]);
      const size = toUsd(p[5]);
      const margin = toUsd(p[6]);
      const shares = toUsd(p[8]);

      const pnlResult = detail[i * 4]!;
      const fundingResult = detail[i * 4 + 1]!;
      const liqResult = detail[i * 4 + 2]!;
      const riskResult = detail[i * 4 + 3]!;

      const pnl =
        pnlResult.status === "fulfilled" ? toUsd(pnlResult.value as bigint) : 0;
      const funding =
        fundingResult.status === "fulfilled"
          ? toUsd(fundingResult.value as bigint)
          : 0;
      const netMargin = toUsd(p[7]);

      return {
        id,
        marketId,
        marketSlug: known?.marketSlug ?? marketId,
        label: known?.marketSlug ?? null,
        eventSlug: known?.eventSlug ?? null,
        gammaMarketId: known?.marketId ?? null,
        isLong: p[2],
        entryPrice,
        size,
        margin,
        netMargin,
        shares,
        leverage: margin > 0 ? size / margin : 1,
        liquidationPrice:
          liqResult.status === "fulfilled"
            ? toPrice(liqResult.value as bigint)
            : toPrice(p[9]),
        liquidationPriceAtOpen: toPrice(p[9]),
        funding,
        pnl,
        value: Math.max(0, netMargin + pnl - funding),
        openedAt: Number(p[11]) * 1000,
        atRisk: riskResult.status === "fulfilled" && riskResult.value === true,
        resolved: resolved[i]![1],
      };
    });
  } catch {
    return [];
  }
}

export type VaultState = {
  tvl: number;
  senior: number;
  junior: number;
  locked: number;
  free: number;
  utilisation: number;
  depositsPaused: boolean;
  /** Room left under the senior cap, or null when uncapped. */
  seniorRoom: number | null;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("rpc timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function readVaultState(): Promise<VaultState | null> {
  if (!earnIsLive) return null;

  try {
    const [tvl, senior, junior, locked, free, paused, cap] = await withTimeout(
      Promise.all([
        client.readContract({ ...vault, functionName: "totalAssets" }),
        client.readContract({ ...vault, functionName: "seniorAssets" }),
        client.readContract({ ...vault, functionName: "juniorAssets" }),
        client.readContract({ ...vault, functionName: "lockedAssets" }),
        client.readContract({ ...vault, functionName: "freeAssets" }),
        client.readContract({ ...vault, functionName: "depositsPaused" }),
        client.readContract({ ...vault, functionName: "seniorCap" }),
      ]),
      10_000,
    );

    const total = toUsd(tvl);
    const uncapped = cap > 2n ** 200n;

    return {
      tvl: total,
      senior: toUsd(senior),
      junior: toUsd(junior),
      locked: toUsd(locked),
      free: toUsd(free),
      utilisation: total > 0 ? toUsd(locked) / total : 0,
      depositsPaused: paused,
      seniorRoom: uncapped ? null : Math.max(0, toUsd(cap - senior)),
    };
  } catch {
    return null;
  }
}

export type LpPosition = {
  shares: bigint;
  /** Current redemption value of those shares. */
  assets: number;
};

export async function readLpPosition(lp: string): Promise<LpPosition | null> {
  if (!earnIsLive || !lp) return null;

  try {
    const [shares, assets] = await Promise.all([
      client.readContract({ ...vault, functionName: "seniorSharesOf", args: [lp as Hex] }),
      client.readContract({ ...vault, functionName: "seniorAssetsOf", args: [lp as Hex] }),
    ]);
    return { shares, assets: toUsd(assets) };
  } catch {
    return null;
  }
}

export async function readUsdgBalance(owner: string): Promise<number> {
  if (!owner) return 0;
  try {
    const raw = await client.readContract({
      address: (await import("./robinhood")).USDG as Hex,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "a", type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "balanceOf",
      args: [owner as Hex],
    });
    return toUsd(raw);
  } catch {
    return 0;
  }
}

export async function readAllowance(owner: string, spender: string) {
  if (!owner || !spender) return 0n;
  try {
    return await client.readContract({
      address: (await import("./robinhood")).USDG as Hex,
      abi: [
        {
          type: "function",
          name: "allowance",
          stateMutability: "view",
          inputs: [
            { name: "o", type: "address" },
            { name: "s", type: "address" },
          ],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "allowance",
      args: [owner as Hex, spender as Hex],
    });
  } catch {
    return 0n;
  }
}

/** Blocks until a sponsored transaction is mined, so reads afterwards are fresh. */
export async function waitForTx(hash: string | null) {
  if (!hash) return;
  try {
    await client.waitForTransactionReceipt({
      hash: hash as Hex,
      timeout: 60_000,
    });
  } catch {
    /* the send already happened; a slow receipt is not a failure */
  }
}

/**
 * Senior APR from realised fee income over a recent window.
 *
 * Derived from `FeeCollected` and `MarginAbsorbed` on the vault rather than a
 * stored figure, because both streams accrue continuously and neither is
 * snapshotted on-chain. Returns null when there is not enough history to say
 * anything honest — an APR extrapolated from two hours of trading would be
 * noise dressed up as a number.
 */
export async function readSeniorApr(): Promise<{
  apr: number;
  apy: number;
  windowDays: number;
  feesToSenior: number;
} | null> {
  if (!earnIsLive) return null;

  try {
    const [latest, senior] = await Promise.all([
      client.getBlockNumber(),
      client.readContract({ ...vault, functionName: "seniorAssets" }),
    ]);
    const seniorUsd = toUsd(senior);
    if (seniorUsd <= 0) return null;

    // Robinhood Chain blocks are ~2s, so a week is ~302k blocks. Providers cap
    // log ranges, so this stays well inside a typical 100k-block limit and
    // reports the window it actually covered.
    const span = 100_000n;
    const fromBlock = latest > span ? latest - span : 0n;

    const [fees, absorbed, fromBlockData, latestBlockData] = await Promise.all([
      client.getLogs({
        address: VAULT_ADDRESS as Hex,
        event: vaultAbi.find((e) => e.name === "FeeCollected") as never,
        fromBlock,
        toBlock: latest,
      }),
      client.getLogs({
        address: VAULT_ADDRESS as Hex,
        event: vaultAbi.find((e) => e.name === "MarginAbsorbed") as never,
        fromBlock,
        toBlock: latest,
      }),
      client.getBlock({ blockNumber: fromBlock }),
      client.getBlock({ blockNumber: latest }),
    ]);

    const sum = (logs: unknown[]) =>
      logs.reduce<bigint>((total, log) => {
        const args = (log as { args?: { toSenior?: bigint } }).args;
        return total + (args?.toSenior ?? 0n);
      }, 0n);

    const feesToSenior = toUsd(sum(fees) + sum(absorbed));

    const seconds =
      Number(latestBlockData.timestamp) - Number(fromBlockData.timestamp);
    const windowDays = seconds / 86_400;

    // Under a day of history annualises to nonsense.
    if (windowDays < 1) return null;

    const apr = (feesToSenior / seniorUsd) * (365 / windowDays) * 100;
    const apy = ((1 + apr / 100 / 52) ** 52 - 1) * 100;

    return { apr, apy, windowDays, feesToSenior };
  } catch {
    return null;
  }
}
