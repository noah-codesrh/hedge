import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  fallback,
  http,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChain } from "../chains";
import { toUsdgRaw, toUsd } from "../leverage-chain";
import { RH_RPC, RH_RPC_FALLBACK, USDG } from "../robinhood";

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

export function nativeEscrowAddress() {
  const fromEnv = requiredEnv("NATIVE_ESCROW_WALLET");
  if (fromEnv && ADDR.test(fromEnv)) return fromEnv.toLowerCase();
  const key = nativeEscrowKey();
  if (!key) return null;
  try {
    return privateKeyToAccount(key).address.toLowerCase();
  } catch {
    return null;
  }
}

function nativeEscrowKey(): Hex | null {
  const raw = requiredEnv("NATIVE_ESCROW_KEY");
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return /^0x[a-fA-F0-9]{64}$/.test(key) ? key : null;
}

export function nativeEscrowConfigured() {
  return Boolean(nativeEscrowAddress());
}

export function nativePayoutConfigured() {
  return Boolean(nativeEscrowAddress() && nativeEscrowKey());
}

export async function verifyNativeStakeTx(input: {
  hash: string;
  from: string;
  amount: number;
}) {
  const escrow = nativeEscrowAddress();
  if (!escrow) {
    return { error: "Pool payout wallet is not configured.", status: 503 as const };
  }
  if (!HASH.test(input.hash)) {
    return { error: "Missing stake transaction.", status: 400 as const };
  }
  if (!ADDR.test(input.from)) {
    return { error: "Connect a wallet that can send USDG.", status: 400 as const };
  }
  const want = toUsdgRaw(input.amount);
  if (want <= 0n) {
    return { error: "Stake is too small.", status: 400 as const };
  }
  const hash = input.hash as Hex;
  const from = input.from.toLowerCase();
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash, timeout: 60_000 })
    .catch(async () => publicClient.getTransactionReceipt({ hash }));
  if (!receipt) {
    return { error: "Stake transaction is not on chain yet.", status: 404 as const };
  }
  if (receipt.status !== "success") {
    return { error: "Stake transaction reverted.", status: 409 as const };
  }
  if (receipt.to?.toLowerCase() !== USDG.toLowerCase()) {
    return { error: "That hash is not a USDG transfer.", status: 400 as const };
  }
  const transfers = parseEventLogs({
    abi: erc20Abi,
    logs: receipt.logs,
    eventName: "Transfer",
  });
  const match = transfers.find(
    (log) =>
      log.address.toLowerCase() === USDG.toLowerCase() &&
      log.args.from?.toLowerCase() === from &&
      log.args.to?.toLowerCase() === escrow &&
      log.args.value === want,
  );
  if (!match) {
    return {
      error: "That transaction did not send the stake USDG to the pool wallet.",
      status: 400 as const,
    };
  }
  return { ok: true as const, hash, from, amountRaw: want };
}

export async function payUsdg(to: string, amount: number) {
  const escrow = nativeEscrowAddress();
  const key = nativeEscrowKey();
  if (!escrow || !key) {
    return { error: "Pool payout wallet is not configured.", status: 503 as const };
  }
  if (!ADDR.test(to)) {
    return { error: "Winning ticket has no wallet to pay.", status: 400 as const };
  }
  const raw = toUsdgRaw(amount);
  if (raw <= 0n) return { ok: true as const, hash: null as string | null, amount: 0 };
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== escrow) {
    return {
      error: "NATIVE_ESCROW_KEY does not match NATIVE_ESCROW_WALLET.",
      status: 503 as const,
    };
  }
  const wallet = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: fallback([
      http(RH_RPC_FALLBACK, { timeout: 20_000 }),
      http(RH_RPC, { timeout: 20_000 }),
    ]),
  });
  try {
    const hash = await wallet.writeContract({
      address: USDG as Hex,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as Hex, raw],
    });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return { ok: true as const, hash, amount: toUsd(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout failed.";
    console.error("[native] payout", error);
    return { error: message, status: 502 as const };
  }
}
