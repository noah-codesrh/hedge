import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChain } from "../chains";
import {
  POOL_OUTCOME_VOID,
  POOL_SIDE_A,
  POOL_SIDE_B,
  poolAbi,
  poolMarketId,
} from "../hedge-pool";
import { toUsdgRaw, toUsd } from "../leverage-chain";
import type { NativeSide } from "../native";
import { RH_RPC, RH_RPC_FALLBACK } from "../robinhood";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
const HASH = /^0x[a-fA-F0-9]{64}$/;

const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: fallback([
    http(RH_RPC_FALLBACK, { timeout: 12_000 }),
    http(RH_RPC, { timeout: 12_000 }),
  ]),
});

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function nativePoolAddress() {
  const fromEnv =
    requiredEnv("HEDGE_POOL_ADDRESS") ?? requiredEnv("VITE_HEDGE_POOL_ADDRESS");
  return fromEnv && ADDR.test(fromEnv) ? fromEnv.toLowerCase() : null;
}

export function nativePoolConfigured() {
  return Boolean(nativePoolAddress());
}

function reporterKey(): Hex | null {
  const raw =
    requiredEnv("NATIVE_POOL_KEY") ?? requiredEnv("NATIVE_ESCROW_KEY");
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return /^0x[a-fA-F0-9]{64}$/.test(key) ? key : null;
}

function pool() {
  const address = nativePoolAddress();
  if (!address) return null;
  return { address: address as Hex, abi: poolAbi } as const;
}

async function reporterWallet() {
  const key = reporterKey();
  const box = pool();
  if (!key || !box) return null;
  const account = privateKeyToAccount(key);
  return {
    account,
    box,
    wallet: createWalletClient({
      account,
      chain: robinhoodChain,
      transport: fallback([
        http(RH_RPC_FALLBACK, { timeout: 20_000 }),
        http(RH_RPC, { timeout: 20_000 }),
      ]),
    }),
  };
}

export async function ensurePoolListed(input: {
  slug: string;
  lockAt: string;
  expiryAt: string;
}) {
  const box = pool();
  if (!box) return { ok: true as const, skipped: true };
  const id = poolMarketId(input.slug);
  const market = await publicClient.readContract({
    ...box,
    functionName: "markets",
    args: [id],
  });
  if (market[5]) return { ok: true as const, skipped: true };
  const lockAt = Math.floor(Date.parse(input.lockAt) / 1000);
  const expiryAt = Math.floor(Date.parse(input.expiryAt) / 1000);
  if (!(lockAt > Math.floor(Date.now() / 1000) && expiryAt > lockAt)) {
    return { ok: true as const, skipped: true };
  }
  const writer = await reporterWallet();
  if (!writer) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  try {
    const hash = await writer.wallet.writeContract({
      ...writer.box,
      functionName: "listMarket",
      args: [id, BigInt(lockAt), BigInt(expiryAt)],
    });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return { ok: true as const, hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list this card.";
    if (/MarketListedAlready/i.test(message)) return { ok: true as const, skipped: true };
    console.error("[native] listMarket", error);
    return { error: message, status: 502 as const };
  }
}

export async function resolvePool(slug: string, side: NativeSide | "void") {
  const writer = await reporterWallet();
  if (!writer) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  const id = poolMarketId(slug);
  const market = await publicClient.readContract({
    ...writer.box,
    functionName: "markets",
    args: [id],
  });
  if (!market[5]) return { ok: true as const, skipped: true };
  if (market[4] !== 0) return { ok: true as const, skipped: true };
  const outcome =
    side === "void" ? POOL_OUTCOME_VOID : side === "b" ? POOL_SIDE_B : POOL_SIDE_A;
  try {
    const hash = await writer.wallet.writeContract({
      ...writer.box,
      functionName: "resolve",
      args: [id, outcome],
    });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return { ok: true as const, hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not settle.";
    if (/EmptyWinningSide/i.test(message) && side !== "void") {
      return resolvePool(slug, "void");
    }
    if (/MarketResolved/i.test(message)) return { ok: true as const, skipped: true };
    console.error("[native] resolve", error);
    return { error: message, status: 502 as const };
  }
}

export async function poolTicket(slug: string, wallet: string) {
  const box = pool();
  if (!box || !ADDR.test(wallet)) return null;
  try {
    const row = await publicClient.readContract({
      ...box,
      functionName: "tickets",
      args: [poolMarketId(slug), wallet as Hex],
    });
    return { side: Number(row[0]), amount: toUsd(row[1]), claimed: Boolean(row[2]) };
  } catch {
    return null;
  }
}

export async function verifyPoolStakeTx(input: {
  hash: string;
  from: string;
  amount: number;
  slug: string;
}) {
  const box = pool();
  if (!box) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  if (!HASH.test(input.hash)) {
    return { error: "Missing stake transaction.", status: 400 as const };
  }
  if (!ADDR.test(input.from)) {
    return { error: "Connect a wallet that can send USDG.", status: 400 as const };
  }
  const want = toUsdgRaw(input.amount);
  const hash = input.hash as Hex;
  const from = input.from.toLowerCase();
  const id = poolMarketId(input.slug).toLowerCase();
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash, timeout: 60_000 })
    .catch(async () => publicClient.getTransactionReceipt({ hash }));
  if (!receipt) {
    return { error: "Stake transaction is not on chain yet.", status: 404 as const };
  }
  if (receipt.status !== "success") {
    return { error: "Stake transaction reverted.", status: 409 as const };
  }
  if (receipt.to?.toLowerCase() !== box.address.toLowerCase()) {
    return { error: "That hash is not a pool stake.", status: 400 as const };
  }
  const stakes = parseEventLogs({
    abi: poolAbi,
    logs: receipt.logs,
    eventName: "Staked",
  });
  const match = stakes.find(
    (log) =>
      log.args.user?.toLowerCase() === from &&
      log.args.id?.toLowerCase() === id &&
      log.args.amount === want,
  );
  if (!match) {
    return {
      error: "That transaction did not stake this ticket on the pool.",
      status: 400 as const,
    };
  }
  return { ok: true as const, hash, from, amountRaw: want };
}
