import type { ConnectedWallet } from "@privy-io/react-auth";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Hex,
} from "viem";
import { robinhoodChain } from "./chains";
import {
  POOL_ADDRESS,
  POOL_SIDE_A,
  POOL_SIDE_B,
  poolAbi,
  poolIsLive,
  poolMarketId,
} from "./hedge-pool";
import type { NativeSide } from "./native";
import { readAllowance, toUsdgRaw, waitForTx } from "./leverage-chain";
import { USDG } from "./robinhood";
import { sponsoredTokenSend, type SignPrivyAuthorization } from "./sponsored-send";
import { isEmbeddedWallet, robinhoodProvider } from "./wallet";

const client = createPublicClient({ chain: robinhoodChain, transport: http() });

export type PoolSendContext = {
  accessToken: string;
  from: string;
  signAuthorization: SignPrivyAuthorization;
  wallet?: ConnectedWallet;
};

const REVERTS: Record<string, string> = {
  StakeOutOfRange: "Tickets are $1–$25 USDG.",
  AlreadyTicketed: "One ticket per wallet on this card.",
  WindowLocked: "This window is locked.",
  MarketNotListed: "This card is not on chain yet.",
  MarketResolved: "This window has settled.",
  DeskCapReached: "The desk is at its $200 cap.",
  StakingIsPaused: "New tickets are paused.",
  NothingToClaim: "Nothing to claim on this ticket.",
  NoTicket: "No ticket in this wallet.",
  InvalidSide: "Pick a side.",
};

const APPROVAL_BUDGET = 250;

function readableRevert(err: unknown): string {
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  for (const [name, message] of Object.entries(REVERTS)) {
    if (text.includes(name)) return message;
  }
  if (/insufficient funds|exceeds balance|transfer amount/i.test(text)) {
    return "Not enough USDG in your wallet.";
  }
  return "That didn't go through. Try again in a moment.";
}

async function simulate(account: string, functionName: "stake" | "claim", args: readonly unknown[]) {
  if (!poolIsLive) throw new Error("Pool is under maintenance.");
  try {
    await client.simulateContract({
      account: account as Hex,
      address: POOL_ADDRESS as Hex,
      abi: poolAbi,
      functionName,
      args: args as never,
    });
  } catch (err) {
    throw new Error(readableRevert(err));
  }
}

async function sendFromWallet(wallet: ConnectedWallet, from: string, to: string, data: Hex) {
  const provider = await robinhoodProvider(wallet);
  try {
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data }],
    })) as string;
    await waitForTx(hash);
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

async function send(ctx: PoolSendContext, to: string, data: Hex) {
  const external = ctx.wallet && !isEmbeddedWallet(ctx.wallet.walletClientType);
  if (external && ctx.wallet) {
    return sendFromWallet(ctx.wallet, ctx.from, to, data);
  }
  try {
    const hash = await sponsoredTokenSend({
      accessToken: ctx.accessToken,
      from: ctx.from,
      token: to,
      data,
      signAuthorization: ctx.signAuthorization,
    });
    await waitForTx(hash);
    return hash;
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    if (ctx.wallet && /not linked to this account/i.test(text)) {
      return sendFromWallet(ctx.wallet, ctx.from, to, data);
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

export async function stakeOnPool(
  ctx: PoolSendContext,
  input: { slug: string; side: NativeSide; amount: number },
) {
  if (!poolIsLive) throw new Error("Pool is under maintenance.");
  const amount = toUsdgRaw(input.amount);
  const args = [poolMarketId(input.slug), sideCode(input.side), amount] as const;
  await ensureAllowance(ctx, amount);
  await simulate(ctx.from, "stake", args);
  return send(
    ctx,
    POOL_ADDRESS,
    encodeFunctionData({ abi: poolAbi, functionName: "stake", args }),
  );
}

export async function claimPool(ctx: PoolSendContext, slug: string) {
  if (!poolIsLive) throw new Error("Pool is under maintenance.");
  const args = [poolMarketId(slug)] as const;
  await simulate(ctx.from, "claim", args);
  return send(
    ctx,
    POOL_ADDRESS,
    encodeFunctionData({ abi: poolAbi, functionName: "claim", args }),
  );
}
