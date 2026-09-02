/**
 * Push Polymarket Yes prices onto the live oracle when a trader is about to
 * open or close. Replaces the always-on Railway keeper for that job.
 *
 * Same contracts, same reporter key. Gas is spent only on a real ticket (and
 * any liquidation that becomes valid after the push). Stop the Railway
 * process so it does not also try to write.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  formatEther,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  stringToBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { LEVERAGE_MARKETS } from "../leverage";
import { RH_CHAIN_ID, RH_RPC, RH_RPC_FALLBACK } from "../robinhood";
import { serverSecrets } from "./secrets";

const LIVE_ORACLE = "0x19E7bd8d16b5D8dD1b619da5a791e6a04fFd3461" as Hex;
const CLOB_BASE = "https://clob.polymarket.com";
const PRICE_DECIMALS = 18;
const WALK_MAX = 3;
const FRESH_SLACK_SECONDS = 45n;

const oracleAbi = parseAbi([
  "function priceDetail(bytes32 marketId) view returns (uint256 value, uint256 target, uint256 updatedAt)",
  "function isConverging(bytes32 marketId) view returns (bool)",
  "function maxPriceAge() view returns (uint256)",
  "function isReporter(address) view returns (bool)",
  "function pushPrice(bytes32 marketId, uint256 target)",
]);

const engineAbi = parseAbi([
  "function guardian() view returns (address)",
  "function pausedByGuardian() view returns (bool)",
  "function guardianSetPaused(bool paused)",
  "function openPositionIds(uint256 offset, uint256 limit) view returns (uint256[])",
  "function positions(uint256) view returns (address trader, bytes32 marketId, bool isLong, bool isOpen, uint128 entryPrice, uint128 size, uint128 margin, uint128 netMargin, uint128 shares, uint128 liquidationPrice, uint128 reserved, uint64 openedAt, uint64 borrowRateBps)",
  "function isLiquidatable(uint256 id) view returns (bool)",
  "function isSettleable(uint256 id) view returns (bool)",
  "function liquidatePosition(uint256 id)",
  "function settlePosition(uint256 id)",
]);

const chain = defineChain({
  id: RH_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RH_RPC_FALLBACK, RH_RPC] } },
});

const transport = fallback([
  http(RH_RPC_FALLBACK, { retryCount: 2, timeout: 12_000 }),
  http(RH_RPC, { retryCount: 2, timeout: 12_000 }),
]);

function marketIdFor(slug: string): Hex {
  return keccak256(stringToBytes(slug));
}

function listedBySlug() {
  return new Map(LEVERAGE_MARKETS.map((m) => [m.marketSlug, m]));
}

export function reporterConfigured() {
  const { oracleReporterKey } = serverSecrets();
  return Boolean(oracleReporterKey);
}

async function fetchYesMid(yesTokenId: string): Promise<number> {
  const res = await fetch(`${CLOB_BASE}/midpoint?token_id=${yesTokenId}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Polymarket book returned ${res.status}.`);
  const body = (await res.json()) as { mid?: string };
  const mid = Number(body.mid);
  if (!Number.isFinite(mid) || mid <= 0 || mid >= 1) {
    throw new Error("Polymarket did not return a usable Yes price.");
  }
  return mid;
}

function describe(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export type OracleRefreshResult = {
  ok: true;
  pushed: number;
  liquidated: number;
  settled: number;
  opened: boolean;
};

const inflight = new Map<string, Promise<void>>();

async function withSlugLock(slug: string, work: () => Promise<void>) {
  const prior = inflight.get(slug) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = prior.then(work).finally(release);
  inflight.set(slug, gate);
  await next;
}

export async function refreshOracleFor(slugs: string[]): Promise<OracleRefreshResult> {
  const { oracleReporterKey, hedgeEngineAddress, oracleAddress } = serverSecrets();
  if (!oracleReporterKey) {
    throw new Error("Oracle reporter key is not configured on the server.");
  }
  if (!hedgeEngineAddress) {
    throw new Error("Engine address is not configured.");
  }

  const wanted = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))];
  const listed = listedBySlug();
  const markets = wanted
    .map((slug) => listed.get(slug))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (markets.length === 0) {
    throw new Error("That market is not on the leverage list.");
  }

  const account = privateKeyToAccount(oracleReporterKey as Hex);
  const oracle = (oracleAddress ?? LIVE_ORACLE) as Hex;
  const engine = hedgeEngineAddress as Hex;

  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });

  const reporter = await publicClient.readContract({
    address: oracle,
    abi: oracleAbi,
    functionName: "isReporter",
    args: [account.address],
  });
  if (!reporter) {
    throw new Error("This key is not a reporter on the live oracle.");
  }

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error(`The price-feed wallet has no RH ETH left (${formatEther(balance)}).`);
  }

  let opened = true;
  try {
    opened = await maybeUnpause(publicClient, wallet, engine, account);
  } catch (err) {
    console.warn("[oracle-refresh] could not lift the guardian pause", describe(err));
  }

  let pushed = 0;
  const priced = new Set<Hex>();
  const maxAge = await publicClient.readContract({
    address: oracle,
    abi: oracleAbi,
    functionName: "maxPriceAge",
  });

  for (const market of markets) {
    await withSlugLock(market.marketSlug, async () => {
      const n = await pushUntilFresh({
        publicClient,
        wallet,
        account,
        oracle,
        yesTokenId: market.yesTokenId,
        marketId: marketIdFor(market.marketSlug),
        maxAge,
      });
      pushed += n;
      priced.add(marketIdFor(market.marketSlug).toLowerCase() as Hex);
    });
  }

  const { liquidated, settled } = await sweep(publicClient, wallet, account, engine, priced);

  return { ok: true, pushed, liquidated, settled, opened };
}

async function maybeUnpause(
  publicClient: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>,
  engine: Hex,
  reporter: PrivateKeyAccount,
) {
  const [pausedByGuardian, guardian] = await Promise.all([
    publicClient.readContract({
      address: engine,
      abi: engineAbi,
      functionName: "pausedByGuardian",
    }),
    publicClient.readContract({
      address: engine,
      abi: engineAbi,
      functionName: "guardian",
    }),
  ]);
  if (!pausedByGuardian) return true;
  if (guardian.toLowerCase() !== reporter.address.toLowerCase()) return false;

  const { request } = await publicClient.simulateContract({
    account: reporter,
    address: engine,
    abi: engineAbi,
    functionName: "guardianSetPaused",
    args: [false],
  });
  const hash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[oracle-refresh] opening resumed · ${hash}`);
  return true;
}

async function pushUntilFresh(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  wallet: ReturnType<typeof createWalletClient>;
  account: PrivateKeyAccount;
  oracle: Hex;
  yesTokenId: string;
  marketId: Hex;
  maxAge: bigint;
}) {
  const mid = await fetchYesMid(input.yesTokenId);
  const target = parseUnits(mid.toFixed(6), PRICE_DECIMALS);
  let writes = 0;

  for (let i = 0; i < WALK_MAX; i++) {
    const [value, onchainTarget, updatedAt] = await input.publicClient.readContract({
      address: input.oracle,
      abi: oracleAbi,
      functionName: "priceDetail",
      args: [input.marketId],
    });
    const now = BigInt(Math.floor(Date.now() / 1000));
    const age = updatedAt === 0n ? input.maxAge + 1n : now - updatedAt;
    const fresh = updatedAt !== 0n && age + FRESH_SLACK_SECONDS < input.maxAge;
    const caughtUp = value === onchainTarget;
    if (fresh && caughtUp && onchainTarget === target) break;

    const { request } = await input.publicClient.simulateContract({
      account: input.account,
      address: input.oracle,
      abi: oracleAbi,
      functionName: "pushPrice",
      args: [input.marketId, target],
    });
    const hash = await input.wallet.writeContract(request);
    await input.publicClient.waitForTransactionReceipt({ hash });
    writes += 1;

    const still = await input.publicClient.readContract({
      address: input.oracle,
      abi: oracleAbi,
      functionName: "isConverging",
      args: [input.marketId],
    });
    if (!still) break;
  }

  return writes;
}

async function sweep(
  publicClient: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>,
  account: PrivateKeyAccount,
  engine: Hex,
  priced: Set<Hex>,
) {
  let liquidated = 0;
  let settled = 0;
  if (priced.size === 0) return { liquidated, settled };

  const ids = await publicClient.readContract({
    address: engine,
    abi: engineAbi,
    functionName: "openPositionIds",
    args: [0n, 500n],
  });

  for (const id of ids) {
    const pos = await publicClient.readContract({
      address: engine,
      abi: engineAbi,
      functionName: "positions",
      args: [id],
    });
    if (!pos[3] || !priced.has(pos[1].toLowerCase() as Hex)) continue;

    try {
      const settleable = await publicClient.readContract({
        address: engine,
        abi: engineAbi,
        functionName: "isSettleable",
        args: [id],
      });
      if (settleable) {
        const { request } = await publicClient.simulateContract({
          account,
          address: engine,
          abi: engineAbi,
          functionName: "settlePosition",
          args: [id],
        });
        const hash = await wallet.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        settled += 1;
        continue;
      }
      const liq = await publicClient.readContract({
        address: engine,
        abi: engineAbi,
        functionName: "isLiquidatable",
        args: [id],
      });
      if (!liq) continue;
      const { request } = await publicClient.simulateContract({
        account,
        address: engine,
        abi: engineAbi,
        functionName: "liquidatePosition",
        args: [id],
      });
      const hash = await wallet.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      liquidated += 1;
    } catch (err) {
      console.warn(`[oracle-refresh] sweep ${id} skipped`, describe(err));
    }
  }

  return { liquidated, settled };
}

export function refreshErrorMessage(err: unknown) {
  const text = describe(err);
  if (/no RH ETH|insufficient funds|gas/i.test(text)) {
    return "The price-feed wallet needs a little RH ETH.";
  }
  if (/not a reporter/i.test(text)) {
    return "The server key is not allowed to push prices.";
  }
  if (/not configured/i.test(text)) {
    return "Price push is not configured on the server.";
  }
  return text.length < 180 ? text : "Could not refresh the on-chain price.";
}
