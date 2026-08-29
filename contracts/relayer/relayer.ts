/**
 * Hedge leverage keeper.
 *
 * Three jobs, run on a timer:
 *
 *   1. Relay the Polymarket YES price for each whitelisted market onto the
 *      HedgeOracle on Robinhood Chain.
 *   2. Scan open positions and liquidate any whose oracle price has crossed the
 *      liquidation level set when the position was opened.
 *   3. Report on itself, loudly, so that when it stops doing 1 and 2 somebody
 *      finds out in minutes rather than from the vault balance.
 *
 * Jobs 1 and 2 are safe to run from more than one instance. Liquidation is
 * permissionless and re-verified on-chain, so a duplicate call simply reverts
 * with NotLiquidatable or PositionNotOpen rather than doing damage. Running two
 * keepers in different places is the cheapest availability you can buy, and the
 * only downside is a little wasted gas on races.
 *
 * Run: RELAYER_PRIVATE_KEY=0x… ORACLE_ADDRESS=0x… ENGINE_ADDRESS=0x… pnpm start
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  formatEther,
  http,
  parseEther,
  parseUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { engineAbi, oracleAbi } from "./abi.ts";
import { alert, resolve } from "./alerts.ts";
import { startHealthServer, status } from "./health.ts";
import {
  CLOB_BASE,
  GAMMA_BASE,
  RH_CHAIN_ID,
  RH_RPCS,
  loadMarkets,
  requireEnv,
  type ResolvedMarket,
} from "./config.ts";

const TICK_MS = Number(process.env.TICK_MS ?? 15_000);
const PAGE_SIZE = 200n;
/** Prices are 1e18 on-chain, where 1e18 is $1.00. */
const PRICE_DECIMALS = 18;

/** Warn below this much native gas. Roughly a day of ticks with headroom. */
const MIN_BALANCE_WEI = parseEther(process.env.MIN_BALANCE_ETH ?? "0.01");

/**
 * Consecutive failed ticks before the keeper pulls the guardian brake.
 *
 * Prices go stale on their own after `maxPriceAge` and trading halts anyway,
 * but that takes five minutes. If the chain is reachable and it is Polymarket
 * that is down, the keeper can still shut the door early — so it does.
 */
const FAILURES_BEFORE_PAUSE = Number(process.env.FAILURES_BEFORE_PAUSE ?? 4);

const robinhoodChain = defineChain({
  id: RH_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RH_RPCS } },
});

const account = privateKeyToAccount(requireEnv("RELAYER_PRIVATE_KEY") as Hex);
const oracleAddress = requireEnv("ORACLE_ADDRESS") as Hex;
const engineAddress = requireEnv("ENGINE_ADDRESS") as Hex;

const rpcTransport = fallback(
  RH_RPCS.map((url) =>
    http(url, {
      retryCount: 2,
      timeout: 12_000,
    }),
  ),
);

const publicClient = createPublicClient({ chain: robinhoodChain, transport: rpcTransport });
const walletClient = createWalletClient({
  account,
  chain: robinhoodChain,
  transport: rpcTransport,
});

const markets = loadMarkets();

/** Set at startup; when false the keeper never attempts to pause. */
let isGuardian = false;

// --- price sourcing ---------------------------------------------------------

/**
 * Local-only price overrides, e.g. MOCK_PRICES="my-market:0.42,other:0.55".
 *
 * Exists so `script/dryrun.sh` can walk a price down into a liquidation against
 * anvil without depending on live Polymarket data. Never set this in production.
 */
const mockPrices = new Map<string, number>(
  (process.env.MOCK_PRICES ?? "")
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const [slug, value] = pair.split(":");
      return [slug!.trim(), Number(value)] as const;
    }),
);

/**
 * Midpoint of the Polymarket order book for the YES token.
 *
 * The midpoint is used rather than last-trade because a thin book can print a
 * stale or wicked last price, and that price decides who gets liquidated.
 */
async function fetchYesPrice(market: ResolvedMarket): Promise<number | null> {
  const mock = mockPrices.get(market.slug);
  if (mock !== undefined) return mock;

  try {
    const res = await fetch(`${CLOB_BASE}/midpoint?token_id=${market.yesTokenId}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`[price] ${market.label}: CLOB responded ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { mid?: string };
    const mid = Number(body.mid);
    if (!Number.isFinite(mid) || mid <= 0 || mid >= 1) {
      console.warn(`[price] ${market.label}: unusable midpoint ${body.mid}`);
      return null;
    }
    return mid;
  } catch (err) {
    console.warn(`[price] ${market.label}: fetch failed`, err);
    return null;
  }
}

/**
 * How old an unchanged observation may get before it is re-pushed.
 *
 * Half of the oracle's own `maxPriceAge`, so there is a full window of slack
 * for a tick to fail and the next one to recover before anything goes stale.
 * Read from the chain rather than hardcoded because the admin can retune the
 * window, and a keeper working from a stale copy of it is how flat markets
 * silently stop trading.
 */
let cachedHeartbeat: bigint | null = null;
async function heartbeatSeconds(): Promise<bigint> {
  if (cachedHeartbeat !== null) return cachedHeartbeat;
  const maxAge = await publicClient.readContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: "maxPriceAge",
  });
  cachedHeartbeat = maxAge / 2n;
  return cachedHeartbeat;
}

/**
 * Push the true midpoint for every market that moved.
 *
 * The keeper deliberately does not clamp. The oracle applies `maxDeviationBps`
 * itself and records the unclamped target, which is what lets it advertise
 * `isConverging` and block opens while it walks a gap in. Clamping here would
 * hide the gap from the contract and reopen the arbitrage window.
 *
 * @returns how many markets were successfully priced.
 */
async function relayPrices(): Promise<number> {
  const ids: Hex[] = [];
  const targets: bigint[] = [];

  // Fetch every book in parallel; one slow market should not delay the rest.
  const quotes = await Promise.all(
    markets.map(async (market) => ({ market, mid: await fetchYesPrice(market) })),
  );

  const priced = quotes.filter((q) => q.mid !== null);
  if (priced.length === 0) {
    throw new Error(`no usable price for any of ${markets.length} market(s)`);
  }
  if (priced.length < markets.length) {
    await alert(
      "partial-prices",
      "warn",
      `priced ${priced.length}/${markets.length} markets; the rest will go stale`,
    );
  } else {
    await resolve("partial-prices", "all markets priced again");
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const refreshBefore = await heartbeatSeconds();

  for (const { market, mid } of priced) {
    const [last, updatedAt] = await publicClient.readContract({
      address: oracleAddress,
      abi: oracleAbi,
      functionName: "price",
      args: [market.marketId],
    });

    const target = parseUnits(mid!.toFixed(6), PRICE_DECIMALS);
    // An unchanged price still has to be re-pushed periodically. `maxPriceAge`
    // is measured against the timestamp, not the value, so a market that sits
    // flat for five minutes goes stale and stops quoting even though the
    // keeper is healthy and the price is correct. Skipping the write only
    // saves gas while the observation is still comfortably fresh.
    const ageing = now - updatedAt >= refreshBefore;
    if (target === last && !ageing) continue;

    ids.push(market.marketId);
    targets.push(target);
  }

  if (ids.length === 0) return priced.length;

  const hash = await walletClient.writeContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: "pushPrices",
    args: [ids, targets],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  status.pricesPushed += ids.length;
  console.log(`[price] pushed ${ids.length} market(s) · ${hash}`);

  await reportConvergence();
  return priced.length;
}

/**
 * Note markets the oracle is still walking toward truth. Opens are blocked
 * on-chain while this is true, so it is worth knowing it is happening —
 * a market stuck converging means the feed is oscillating or wrong.
 */
async function reportConvergence(): Promise<void> {
  const flags = await Promise.all(
    markets.map((market) =>
      publicClient.readContract({
        address: oracleAddress,
        abi: oracleAbi,
        functionName: "isConverging",
        args: [market.marketId],
      }),
    ),
  );

  const lagging = markets.filter((_, i) => flags[i]).map((m) => m.label);
  if (lagging.length > 0) {
    await alert(
      "converging",
      "warn",
      `oracle catching up on ${lagging.join(", ")} — opening is blocked for these until it lands`,
    );
  } else {
    await resolve("converging", "oracle back in line with Polymarket; opening re-enabled");
  }
}

// --- liquidation ------------------------------------------------------------

async function openIds(): Promise<bigint[]> {
  const total = await publicClient.readContract({
    address: engineAddress,
    abi: engineAbi,
    functionName: "openPositionCount",
  });

  const ids: bigint[] = [];
  for (let offset = 0n; offset < total; offset += PAGE_SIZE) {
    const page = await publicClient.readContract({
      address: engineAddress,
      abi: engineAbi,
      functionName: "openPositionIds",
      args: [offset, PAGE_SIZE],
    });
    ids.push(...page);
  }
  return ids;
}

async function liquidateUnderwater(ids: bigint[]) {
  if (ids.length === 0) return;

  // Filter with a view call first so we only pay gas on real liquidations.
  const flags = await Promise.all(
    ids.map((id) =>
      publicClient.readContract({
        address: engineAddress,
        abi: engineAbi,
        functionName: "isLiquidatable",
        args: [id],
      }),
    ),
  );

  for (const [index, liquidatable] of flags.entries()) {
    if (!liquidatable) continue;
    const id = ids[index]!;
    try {
      // Simulating first turns a race with another keeper into a cheap revert
      // here instead of a failed transaction on-chain.
      const { request } = await publicClient.simulateContract({
        account,
        address: engineAddress,
        abi: engineAbi,
        functionName: "liquidatePosition",
        args: [id],
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      status.liquidations += 1;
      console.log(`[liquidate] position ${id} · ${hash}`);
    } catch (err) {
      console.warn(`[liquidate] position ${id} skipped`, describe(err));
    }
  }
}

// --- resolution -------------------------------------------------------------

/**
 * Close out positions on markets that have resolved.
 *
 * Settlement is permissionless because once the outcome is known the payout is
 * pure arithmetic. Sweeping it here matters for the vault as much as for the
 * trader: until every position on a resolved market is settled, its reserve
 * stays locked and cannot back new trades.
 */
async function settleResolved(ids: bigint[]): Promise<void> {
  if (ids.length === 0) return;

  const flags = await Promise.all(
    ids.map((id) =>
      publicClient.readContract({
        address: engineAddress,
        abi: engineAbi,
        functionName: "isSettleable",
        args: [id],
      }),
    ),
  );

  for (const [index, settleable] of flags.entries()) {
    if (!settleable) continue;
    const id = ids[index]!;
    try {
      const { request } = await publicClient.simulateContract({
        account,
        address: engineAddress,
        abi: engineAbi,
        functionName: "settlePosition",
        args: [id],
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      status.settlements += 1;
      console.log(`[settle] position ${id} · ${hash}`);
    } catch (err) {
      console.warn(`[settle] position ${id} skipped`, describe(err));
    }
  }
}

/**
 * Watch for markets Polymarket has resolved but the admin has not.
 *
 * The keeper cannot resolve a market itself — that single call decides every
 * remaining payout, so it does not belong on a hot key. What it can do is
 * notice immediately and say exactly which call to make, because until the
 * admin makes it, open positions cannot be settled at all.
 */
async function checkResolutions(): Promise<void> {
  for (const market of markets) {
    let closed = false;
    let yesPrice: number | null = null;

    try {
      const res = await fetch(
        `${GAMMA_BASE}/markets?slug=${encodeURIComponent(market.slug)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) continue;
      const [row] = (await res.json()) as {
        closed?: boolean;
        outcomePrices?: string;
      }[];
      if (!row) continue;
      closed = row.closed === true;
      const prices = JSON.parse(row.outcomePrices ?? "[]") as string[];
      if (prices.length > 0) yesPrice = Number(prices[0]);
    } catch {
      // Gamma being unreachable is not a resolution signal; try next tick.
      continue;
    }

    if (!closed) {
      await resolve(`resolved-${market.slug}`, `${market.label} is trading again`);
      continue;
    }

    const [, alreadyResolved] = await publicClient.readContract({
      address: engineAddress,
      abi: engineAbi,
      functionName: "markets",
      args: [market.marketId],
    });
    if (alreadyResolved) continue;

    // 1e18 for YES, 0 for NO. Stated explicitly so the admin can copy it.
    const finalPrice =
      yesPrice === null ? null : yesPrice >= 0.5 ? 10n ** 18n : 0n;

    await alert(
      `resolved-${market.slug}`,
      "critical",
      `${market.label} has resolved on Polymarket${
        yesPrice === null ? "" : ` (YES=${yesPrice})`
      }. Positions cannot settle until you call ` +
        `resolveMarket(${market.marketId}, ${finalPrice ?? "<0 or 1e18>"}) as admin.`,
    );
  }
}

// --- self-monitoring --------------------------------------------------------

/**
 * A keeper that runs out of gas fails exactly like a keeper that has crashed,
 * except the process stays up and the logs stay quiet. Check every tick.
 */
async function checkBalance(): Promise<void> {
  const balance = await publicClient.getBalance({ address: account.address });
  status.balanceWei = balance.toString();
  status.lowBalance = balance < MIN_BALANCE_WEI;

  if (status.lowBalance) {
    await alert(
      "low-gas",
      "critical",
      `gas down to ${formatEther(balance)} ETH on ${account.address} — top it up or liquidations stop`,
    );
  } else {
    await resolve("low-gas", `gas topped up, ${formatEther(balance)} ETH available`);
  }
}

/** Pull the guardian brake, if this keeper holds the role. */
async function tryPause(reason: string): Promise<void> {
  if (!isGuardian) return;

  const paused = await publicClient.readContract({
    address: engineAddress,
    abi: engineAbi,
    functionName: "openingPaused",
  });
  if (paused) return;

  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: engineAddress,
      abi: engineAbi,
      functionName: "guardianSetPaused",
      args: [true],
    });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    status.openingPaused = true;
    await alert("guardian-pause", "critical", `opening paused: ${reason} · ${hash}`);
  } catch (err) {
    await alert(
      "guardian-pause-failed",
      "critical",
      `could not pause opening (${reason}): ${describe(err)}`,
    );
  }
}

/**
 * Lift a pause this keeper set, once it is healthy again.
 * Cannot touch a pause the admin set — the contract enforces that.
 */
async function tryResume(): Promise<void> {
  if (!isGuardian) return;

  const pausedByGuardian = await publicClient.readContract({
    address: engineAddress,
    abi: engineAbi,
    functionName: "pausedByGuardian",
  });
  if (!pausedByGuardian) {
    status.openingPaused = false;
    return;
  }

  try {
    const { request } = await publicClient.simulateContract({
      account,
      address: engineAddress,
      abi: engineAbi,
      functionName: "guardianSetPaused",
      args: [false],
    });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    status.openingPaused = false;
    await resolve("guardian-pause", `keeper recovered, opening resumed · ${hash}`);
  } catch (err) {
    console.warn("[guardian] resume failed", describe(err));
  }
}

function describe(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0];
}

// --- loop -------------------------------------------------------------------

/**
 * One pass. Throws only if the tick as a whole should count as failed, which is
 * what drives the health endpoint, the alerts and the guardian brake.
 */
async function tick() {
  status.ticks += 1;
  status.lastTickAt = Date.now();

  try {
    await checkBalance();
    await relayPrices();
    await checkResolutions();

    const ids = await openIds();
    // Settle first: a resolved position cannot be liquidated, and leaving it
    // open keeps its vault reserve locked.
    await settleResolved(ids);
    await liquidateUnderwater(ids);

    status.consecutiveFailures = 0;
    status.lastHealthyTickAt = Date.now();
    status.lastError = null;

    await resolve("relay-failing", "keeper is ticking cleanly again");
    await tryResume();
  } catch (err) {
    status.consecutiveFailures += 1;
    status.lastError = describe(err);

    await alert(
      "relay-failing",
      status.consecutiveFailures >= FAILURES_BEFORE_PAUSE ? "critical" : "warn",
      `tick failed ${status.consecutiveFailures}x: ${status.lastError}`,
    );

    if (status.consecutiveFailures >= FAILURES_BEFORE_PAUSE) {
      await tryPause(`${status.consecutiveFailures} consecutive failed ticks`);
    }
  }
}

async function readStartup(): Promise<{
  isReporter: boolean;
  guardianAddress: Hex;
}> {
  for (let attempt = 1; ; attempt++) {
    try {
      const [isReporter, guardianAddress] = await Promise.all([
        publicClient.readContract({
          address: oracleAddress,
          abi: oracleAbi,
          functionName: "isReporter",
          args: [account.address],
        }),
        publicClient.readContract({
          address: engineAddress,
          abi: engineAbi,
          functionName: "guardian",
        }),
      ]);
      return { isReporter, guardianAddress };
    } catch (err) {
      const wait = Math.min(30_000, 3_000 * attempt);
      console.error(
        `[keeper] RPC unreachable (attempt ${attempt}) via ${RH_RPCS.join(", ")}. ` +
          `Datacenter IPs often get Cloudflare 403 on the official RPC — set RH_RPC to a fallback. ` +
          `Retrying in ${wait}ms.`,
      );
      console.error(describe(err));
      await new Promise((done) => setTimeout(done, wait));
    }
  }
}

async function main() {
  console.log(`[keeper] RPC ${RH_RPCS.join(" → ")}`);
  const { isReporter, guardianAddress } = await readStartup();

  if (!isReporter) {
    throw new Error(
      `${account.address} is not an oracle reporter. Run setReporter(${account.address}, true) as admin first.`,
    );
  }

  isGuardian = guardianAddress.toLowerCase() === account.address.toLowerCase();
  status.watching = markets.length;

  const once = process.argv.includes("--once");
  if (!once) startHealthServer();

  console.log(
    `[keeper] ${account.address} watching ${markets.length} market(s) every ${TICK_MS}ms` +
      (isGuardian ? " · holds the guardian pause" : " · no guardian role"),
  );
  if (!isGuardian) {
    console.warn(
      "[keeper] not the guardian, so it cannot halt opening when it fails. " +
        `Run setGuardian(${account.address}) as admin to enable that.`,
    );
  }

  // A tick slower than half the staleness window leaves no room for a single
  // failed tick: the next attempt lands after the oracle has already expired
  // and every market stops quoting. Cheap to check, and the failure mode it
  // catches looks like a broken keeper rather than a misconfigured one.
  const maxAge = await publicClient.readContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: "maxPriceAge",
  });
  if (BigInt(TICK_MS) * 2n > maxAge * 1000n) {
    console.warn(
      `[keeper] TICK_MS=${TICK_MS}ms leaves no slack against maxPriceAge=${maxAge}s. ` +
        `One missed tick will stale every market. Use ${Number(maxAge) * 250}ms or less.`,
    );
  }

  await tick();
  if (once) return;

  await alert("startup", "info", `keeper online, watching ${markets.length} market(s)`);

  // A dying keeper should shut the door on its way out rather than leaving
  // positions unwatched until the price goes stale.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await tryPause(`keeper received ${signal}`);
      process.exit(0);
    });
  }

  // Sequential rather than setInterval so a slow tick cannot overlap itself
  // and submit two liquidations for the same position.
  for (;;) {
    await new Promise((done) => setTimeout(done, TICK_MS));
    await tick();
  }
}

main().catch(async (err) => {
  console.error(err);
  await alert("crashed", "critical", `keeper exited: ${describe(err)}`);
  process.exit(1);
});
