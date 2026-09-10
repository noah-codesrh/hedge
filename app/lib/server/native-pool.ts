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
  POOL_LEGACY_ADDRESS,
  POOL_OUTCOME_VOID,
  POOL_SIDE_A,
  POOL_SIDE_B,
  poolAbi,
  poolMarketId,
} from "../hedge-pool";
import { toUsdgRaw, toUsd } from "../leverage-chain";
import {
  NATIVE_MAX_STAKE,
  NATIVE_MIN_STAKE,
  NATIVE_USER_CAP,
  type NativeSide,
} from "../native";
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

function poolAddresses() {
  const out: string[] = [];
  const add = (value: string | null) => {
    if (!value || !ADDR.test(value)) return;
    const lower = value.toLowerCase();
    if (!out.includes(lower)) out.push(lower);
  };
  add(nativePoolAddress());
  add(POOL_LEGACY_ADDRESS);
  return out;
}

function poolBox(address: string) {
  return { address: address as Hex, abi: poolAbi } as const;
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

const SETTLE_DOWN = "Could not settle this card. Try again in a moment.";

function settleError(error: unknown) {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  if (/insufficient funds|exceeds the balance|gas \* price \+ value/i.test(text)) {
    return SETTLE_DOWN;
  }
  if (/EmptyWinningSide/i.test(text)) return text;
  if (/MarketResolved/i.test(text)) return text;
  if (/NotLister|Not authorized|NotReporter/i.test(text)) {
    return "Pool is under maintenance.";
  }
  return SETTLE_DOWN;
}

let limitsAttempted = false;
const listing = new Map<
  string,
  Promise<{ ok: true; skipped?: boolean; hash?: Hex } | { error: string; status: number }>
>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Raise on-chain $1–$25 / $1,000 defaults to the app desk if the reporter key
 * is also admin. No-op when already matched or the key cannot sign setLimits.
 */
export async function ensurePoolLimits() {
  if (limitsAttempted) return { ok: true as const, skipped: true };
  limitsAttempted = true;
  const box = pool();
  if (!box) return { ok: true as const, skipped: true };
  const minStake = toUsdgRaw(NATIVE_MIN_STAKE);
  const maxStake = toUsdgRaw(NATIVE_MAX_STAKE);
  const deskCap = toUsdgRaw(NATIVE_USER_CAP);
  try {
    const [currentMin, currentMax, currentCap, admin] = await Promise.all([
      publicClient.readContract({ ...box, functionName: "minStake" }),
      publicClient.readContract({ ...box, functionName: "maxStake" }),
      publicClient.readContract({ ...box, functionName: "deskCap" }),
      publicClient.readContract({ ...box, functionName: "admin" }),
    ]);
    if (currentMin === minStake && currentMax === maxStake && currentCap === deskCap) {
      return { ok: true as const, skipped: true };
    }
    const writer = await reporterWallet();
    if (!writer) return { ok: true as const, skipped: true };
    if (writer.account.address.toLowerCase() !== admin.toLowerCase()) {
      console.warn(
        "[native] pool limits need the admin key. Current cap",
        currentCap.toString(),
      );
      return { ok: true as const, skipped: true };
    }
    const hash = await writer.wallet.writeContract({
      ...writer.box,
      functionName: "setLimits",
      args: [minStake, maxStake, deskCap],
    });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return { ok: true as const, hash };
  } catch (error) {
    console.error("[native] setLimits", error);
    return { ok: true as const, skipped: true };
  }
}

export async function ensurePoolListed(input: {
  slug: string;
  lockAt: string;
  expiryAt: string;
}) {
  const pending = listing.get(input.slug);
  if (pending) return pending;
  const next = listMarketNow(input).finally(() => listing.delete(input.slug));
  listing.set(input.slug, next);
  return next;
}

async function listMarketNow(input: {
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
    return { error: "This window is locked.", status: 409 as const };
  }
  const writer = await reporterWallet();
  if (!writer) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  try {
    await publicClient.simulateContract({
      account: writer.account,
      ...writer.box,
      functionName: "listMarket",
      args: [id, BigInt(lockAt), BigInt(expiryAt)],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/MarketListedAlready/i.test(message)) {
      return { ok: true as const, skipped: true };
    }
    console.error("[native] listMarket simulate", error);
    return {
      error: /NotLister|Not authorized/i.test(message)
        ? "Pool is under maintenance."
        : "Could not open this card on chain.",
      status: 502 as const,
    };
  }
  try {
    const hash = await withTimeout(
      writer.wallet.writeContract({
        ...writer.box,
        functionName: "listMarket",
        args: [id, BigInt(lockAt), BigInt(expiryAt)],
      }),
      15_000,
      "Could not open this card on chain. Try again.",
    );
    for (let i = 0; i < 8; i++) {
      const row = await publicClient.readContract({
        ...box,
        functionName: "markets",
        args: [id],
      });
      if (row[5]) return { ok: true as const, hash };
      await sleep(400);
    }
    return { ok: true as const, hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list this card.";
    if (/MarketListedAlready/i.test(message)) return { ok: true as const, skipped: true };
    console.error("[native] listMarket", error);
    return {
      error: /insufficient funds|gas/i.test(message)
        ? "Pool is under maintenance."
        : message,
      status: 502 as const,
    };
  }
}

export async function resolvePool(slug: string, side: NativeSide | "void") {
  const writer = await reporterWallet();
  if (!writer) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  const gas = await publicClient.getBalance({ address: writer.account.address });
  if (gas < 50_000_000_000_000n) {
    console.error("[native] resolve reporter has no gas", writer.account.address);
    return { error: SETTLE_DOWN, status: 503 as const };
  }
  const id = poolMarketId(slug);
  const outcome =
    side === "void" ? POOL_OUTCOME_VOID : side === "b" ? POOL_SIDE_B : POOL_SIDE_A;
  let last: { ok: true; skipped?: boolean; hash?: Hex } | { error: string; status: number } =
    { ok: true as const, skipped: true };
  for (const address of poolAddresses()) {
    const box = poolBox(address);
    const market = await publicClient.readContract({
      ...box,
      functionName: "markets",
      args: [id],
    });
    if (!market[5] || market[4] !== 0) continue;
    try {
      const hash = await writer.wallet.writeContract({
        ...box,
        account: writer.account,
        functionName: "resolve",
        args: [id, outcome],
      });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      last = { ok: true as const, hash };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (/EmptyWinningSide/i.test(raw) && side !== "void") {
        return resolvePool(slug, "void");
      }
      if (/MarketResolved/i.test(raw)) {
        last = { ok: true as const, skipped: true };
        continue;
      }
      console.error("[native] resolve", address, error);
      return { error: settleError(error), status: 502 as const };
    }
  }
  return last;
}

export async function poolTicket(slug: string, wallet: string) {
  if (!ADDR.test(wallet)) return null;
  const id = poolMarketId(slug);
  for (const address of poolAddresses()) {
    const ticket = await readTicket(address, id, wallet);
    if (ticket && (ticket.amount > 0 || ticket.claimed)) return ticket;
  }
  return null;
}

/** Ticket on the live pool only. Legacy tickets stay off Your tickets. */
export async function poolTicketLive(slug: string, wallet: string) {
  const address = nativePoolAddress();
  if (!address || !ADDR.test(wallet)) return null;
  return readTicket(address, poolMarketId(slug), wallet);
}

/** USDG `claim` would pay right now. Zero if the card is still unresolved on-chain. */
export async function poolPreviewPayout(slug: string, wallet: string) {
  if (!ADDR.test(wallet)) return 0;
  const id = poolMarketId(slug);
  for (const address of poolAddresses()) {
    try {
      const raw = await publicClient.readContract({
        ...poolBox(address),
        functionName: "previewPayout",
        args: [id, wallet as Hex],
      });
      const amount = toUsd(raw);
      if (amount > 0) return amount;
    } catch {
      /* pool missing this id */
    }
  }
  return 0;
}

export async function poolMarketState(slug: string) {
  const id = poolMarketId(slug);
  for (const address of poolAddresses()) {
    try {
      const row = await publicClient.readContract({
        ...poolBox(address),
        functionName: "markets",
        args: [id],
      });
      if (!row[5]) continue;
      return {
        address,
        lockAt: Number(row[0]),
        expiryAt: Number(row[1]),
        poolA: toUsd(row[2]),
        poolB: toUsd(row[3]),
        outcome: Number(row[4]),
        listed: Boolean(row[5]),
      };
    } catch {
      /* try the other pool */
    }
  }
  return null;
}

async function readTicket(address: string, id: Hex, wallet: string) {
  try {
    const row = await publicClient.readContract({
      ...poolBox(address),
      functionName: "tickets",
      args: [id, wallet as Hex],
    });
    return {
      side: Number(row[0]),
      amount: toUsd(row[1]),
      claimed: Boolean(row[2]),
    };
  } catch {
    return null;
  }
}

/** First live refundable pool create block. Logs before this are not ours. */
const LIVE_POOL_FROM_BLOCK = 57_405_228n;

export type LivePoolTicket = {
  id: Hex;
  wallet: string;
  side: number;
  amount: number;
  claimed: boolean;
};

/**
 * Tickets this wallet still holds on the live pool. Finds them from Staked
 * logs so Your tickets can recover a send that never wrote a DB row.
 */
export async function listLiveTicketsForWallets(wallets: string[]) {
  const address = nativePoolAddress();
  if (!address) return [] as LivePoolTicket[];
  const out: LivePoolTicket[] = [];
  const seen = new Set<string>();
  for (const wallet of wallets) {
    if (!ADDR.test(wallet)) continue;
    let logs: Awaited<ReturnType<typeof publicClient.getContractEvents>>;
    try {
      logs = await publicClient.getContractEvents({
        address: address as Hex,
        abi: poolAbi,
        eventName: "Staked",
        args: { user: wallet as Hex },
        fromBlock: LIVE_POOL_FROM_BLOCK,
        toBlock: "latest",
      });
    } catch (error) {
      console.error("[native] live ticket logs", wallet, error);
      continue;
    }
    for (const log of logs) {
      const id = log.args.id;
      if (!id) continue;
      const key = `${id}:${wallet.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ticket = await readTicket(address, id, wallet);
      if (!ticket || (!(ticket.amount > 0) && !ticket.claimed)) continue;
      out.push({ id, wallet, ...ticket });
    }
  }
  return out;
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

export async function verifyPoolRefundTx(input: {
  hash: string;
  from: string;
  slug: string;
}) {
  const box = pool();
  if (!box) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  if (!HASH.test(input.hash)) {
    return { error: "Missing refund transaction.", status: 400 as const };
  }
  if (!ADDR.test(input.from)) {
    return { error: "Connect the wallet that holds this ticket.", status: 400 as const };
  }
  const hash = input.hash as Hex;
  const from = input.from.toLowerCase();
  const id = poolMarketId(input.slug).toLowerCase();
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash, timeout: 60_000 })
    .catch(async () => publicClient.getTransactionReceipt({ hash }));
  if (!receipt) {
    return { error: "Refund transaction is not on chain yet.", status: 404 as const };
  }
  if (receipt.status !== "success") {
    return { error: "Refund transaction reverted.", status: 409 as const };
  }
  if (receipt.to?.toLowerCase() !== box.address.toLowerCase()) {
    return { error: "That hash is not a pool refund.", status: 400 as const };
  }
  const refunds = parseEventLogs({
    abi: poolAbi,
    logs: receipt.logs,
    eventName: "Refunded",
  });
  const match = refunds.find(
    (log) =>
      log.args.user?.toLowerCase() === from && log.args.id?.toLowerCase() === id,
  );
  if (!match) {
    return {
      error: "That transaction did not refund this ticket.",
      status: 400 as const,
    };
  }
  return { ok: true as const, hash, from, amountRaw: match.args.amount };
}
