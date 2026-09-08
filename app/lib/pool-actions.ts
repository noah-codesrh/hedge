import type { ConnectedWallet } from "@privy-io/react-auth";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
  type Hex,
} from "viem";
import { robinhoodChain } from "./chains";
import {
  POOL_ADDRESS,
  POOL_LEGACY_ADDRESS,
  POOL_SIDE_A,
  POOL_SIDE_B,
  poolAbi,
  poolIsLive,
  poolMarketId,
} from "./hedge-pool";
import { NATIVE_MAX_STAKE, NATIVE_POOL_OPEN, type NativeSide } from "./native";
import { readAllowance, toUsdgRaw } from "./leverage-chain";
import { RH_RPC, RH_RPC_FALLBACK, USDG } from "./robinhood";
import { sponsoredTokenSend, type SignPrivyAuthorization } from "./sponsored-send";
import { isEmbeddedWallet, robinhoodProvider } from "./wallet";

const client = createPublicClient({
  chain: robinhoodChain,
  transport: fallback([
    http(RH_RPC_FALLBACK, { timeout: 8_000 }),
    http(RH_RPC, { timeout: 8_000 }),
  ]),
});

export type PoolSendContext = {
  accessToken: string;
  from: string;
  signAuthorization: SignPrivyAuthorization;
  wallet?: ConnectedWallet;
};

const REVERTS: Record<string, string> = {
  StakeOutOfRange: `Tickets are $1–$${NATIVE_MAX_STAKE} USDG.`,
  AlreadyTicketed: "One ticket per wallet on this card.",
  WindowLocked: "This window is locked.",
  MarketNotListed: "This card is not on chain yet.",
  MarketResolved: "This window has settled.",
  DeskCapReached: "The desk is at its cap.",
  StakingIsPaused: "New tickets are paused.",
  NothingToClaim: "Nothing to claim on this ticket.",
  NoTicket: "No ticket in this wallet.",
  InvalidSide: "Pick a side.",
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const APPROVAL_BUDGET = 250;

function poolTargets() {
  const out: Hex[] = [];
  const add = (value: string) => {
    const next = value.trim() as Hex;
    if (!ADDRESS.test(next)) return;
    const lower = next.toLowerCase() as Hex;
    if (!out.includes(lower)) out.push(lower);
  };
  add(POOL_ADDRESS);
  add(POOL_LEGACY_ADDRESS);
  return out;
}

function readableRevert(err: unknown): string {
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  for (const [name, message] of Object.entries(REVERTS)) {
    if (text.includes(name)) return message;
  }
  if (/insufficient funds|exceeds balance|transfer amount/i.test(text)) {
    return "Not enough USDG in your wallet.";
  }
  if (/timed out|timeout|took too long/i.test(text)) {
    return "Robinhood Chain is slow right now. Try again in a moment.";
  }
  return "That didn't go through. Try again in a moment.";
}

async function simulate(
  account: string,
  functionName: "stake" | "claim" | "refund",
  args: readonly unknown[],
  address: string = POOL_ADDRESS,
) {
  if (!poolIsLive && functionName !== "claim") {
    throw new Error("Pool is under maintenance.");
  }
  if (!ADDRESS.test(address)) throw new Error("Pool is under maintenance.");
  try {
    await client.simulateContract({
      account: account as Hex,
      address: address as Hex,
      abi: poolAbi,
      functionName,
      args: args as never,
    });
  } catch (err) {
    throw new Error(readableRevert(err));
  }
}

async function waitMined(hash: string) {
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash: hash as Hex,
      timeout: 12_000,
      pollingInterval: 700,
    });
    if (receipt.status === "reverted") {
      throw new Error("That transaction reverted. Try again.");
    }
  } catch (err) {
    const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    if (/timed out|timeout/i.test(text)) return;
    throw err instanceof Error ? err : new Error("That didn't go through.");
  }
}

async function sendFromWallet(
  wallet: ConnectedWallet,
  from: string,
  to: string,
  data: Hex,
  wait: boolean,
) {
  const provider = await robinhoodProvider(wallet);
  try {
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data }],
    })) as string;
    if (!hash) throw new Error("Wallet did not return a transaction hash.");
    if (wait) await waitMined(hash);
    return hash;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/user rejected|denied|rejected the request/i.test(text)) {
      throw new Error("Wallet request was cancelled.");
    }
    if (/insufficient funds|gas/i.test(text)) {
      throw new Error(
        "This connected wallet needs a little RH ETH for gas. The app can only sponsor Privy embedded wallets.",
      );
    }
    throw err instanceof Error ? err : new Error("The wallet could not send this transaction.");
  }
}

async function send(
  ctx: PoolSendContext,
  to: string,
  data: Hex,
  wait = true,
) {
  const external = ctx.wallet && !isEmbeddedWallet(ctx.wallet.walletClientType);
  if (external && ctx.wallet) {
    return sendFromWallet(ctx.wallet, ctx.from, to, data, wait);
  }
  try {
    const hash = await sponsoredTokenSend({
      accessToken: ctx.accessToken,
      from: ctx.from,
      token: to,
      data,
      signAuthorization: ctx.signAuthorization,
    });
    if (!hash) throw new Error("Stake transaction did not return a hash.");
    if (wait) await waitMined(hash);
    return hash;
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    if (ctx.wallet && /not linked to this account/i.test(text)) {
      return sendFromWallet(ctx.wallet, ctx.from, to, data, wait);
    }
    throw err;
  }
}

async function ensureAllowance(ctx: PoolSendContext, amount: bigint) {
  const current = await readAllowance(ctx.from, POOL_ADDRESS);
  if (current >= amount) return;
  const grant =
    toUsdgRaw(APPROVAL_BUDGET) > amount ? toUsdgRaw(APPROVAL_BUDGET) : amount;
  await send(
    ctx,
    USDG,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [POOL_ADDRESS as Hex, grant],
    }),
  );
}

function sideCode(side: NativeSide) {
  return side === "b" ? POOL_SIDE_B : POOL_SIDE_A;
}

async function requireListed(slug: string) {
  const id = poolMarketId(slug);
  for (let i = 0; i < 8; i++) {
    const row = await client.readContract({
      address: POOL_ADDRESS as Hex,
      abi: poolAbi,
      functionName: "markets",
      args: [id],
    });
    if (row[4] !== 0) throw new Error("This window has settled.");
    if (row[5]) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("This card is not on chain yet.");
}

export async function stakeOnPool(
  ctx: PoolSendContext,
  input: { slug: string; side: NativeSide; amount: number },
) {
  if (!NATIVE_POOL_OPEN || !poolIsLive) throw new Error("Pool is under maintenance.");
  const amount = toUsdgRaw(input.amount);
  const args = [poolMarketId(input.slug), sideCode(input.side), amount] as const;
  await requireListed(input.slug);
  await ensureAllowance(ctx, amount);
  await simulate(ctx.from, "stake", args);
  return send(
    ctx,
    POOL_ADDRESS,
    encodeFunctionData({ abi: poolAbi, functionName: "stake", args }),
    false,
  );
}

export async function claimPool(ctx: PoolSendContext, slug: string) {
  const args = [poolMarketId(slug)] as const;
  const targets = poolTargets();
  if (targets.length === 0) throw new Error("Pool is under maintenance.");
  let last = "No ticket in this wallet.";
  for (const to of targets) {
    try {
      await simulate(ctx.from, "claim", args, to);
      return send(
        ctx,
        to,
        encodeFunctionData({ abi: poolAbi, functionName: "claim", args }),
      );
    } catch (err) {
      last = err instanceof Error ? err.message : last;
    }
  }
  throw new Error(last);
}

export async function refundPool(ctx: PoolSendContext, slug: string) {
  if (!poolIsLive) throw new Error("Pool is under maintenance.");
  const args = [poolMarketId(slug)] as const;
  await simulate(ctx.from, "refund", args);
  return send(
    ctx,
    POOL_ADDRESS,
    encodeFunctionData({ abi: poolAbi, functionName: "refund", args }),
  );
}
