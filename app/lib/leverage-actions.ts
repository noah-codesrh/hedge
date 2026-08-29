import type { ConnectedWallet } from "@privy-io/react-auth";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Hex,
} from "viem";
import { robinhoodChain } from "./chains";
import { engineAbi, vaultAbi } from "./leverage-abi";
import { ENGINE_ADDRESS, VAULT_ADDRESS } from "./leverage";
import { marketIdFor, readAllowance, toUsdgRaw, waitForTx } from "./leverage-chain";
import { USDG } from "./robinhood";
import { sponsoredTokenSend, type SignPrivyAuthorization } from "./sponsored-send";
import { isEmbeddedWallet, robinhoodProvider } from "./wallet";

const client = createPublicClient({ chain: robinhoodChain, transport: http() });

export type SendContext = {
  accessToken: string;
  /** Wallet holding the USDG — embedded (sponsored) or a linked external. */
  from: string;
  signAuthorization: SignPrivyAuthorization;
  wallet?: ConnectedWallet;
};

/**
 * Custom errors the engine and vault raise, in plain language.
 *
 * Worth the maintenance: without this a full pool, a paused market and a stale
 * oracle all look like the same opaque failure, and the first of those is a
 * normal state the trader needs to understand rather than an error.
 */
const REVERTS: Record<string, string> = {
  PoolCapacityReached:
    "The pool is full right now — more liquidity is on the way. Try a smaller size.",
  MarketCapacityReached:
    "This market has taken all the leverage the pool will back for now.",
  MarketNotEnabled: "Leverage isn't open on this market.",
  PriceOutOfBand:
    "This market has drifted outside the $0.35–$0.65 band where leverage is offered.",
  PriceConverging:
    "The price feed is catching up after a jump. Opening reopens in a few seconds.",
  StalePrice: "The price feed is stale. Give it a moment and try again.",
  OpeningIsPaused: "New leveraged positions are paused.",
  MarginTooLarge: "That's above the deposit cap for a leveraged position.",
  MarginTooSmall: "That's below the minimum for a leveraged position.",
  PositionTooLarge: "That position would be larger than the current cap.",
  LeverageTooHigh: "That's more leverage than the pool can back right now.",
  RemainderTooSmall:
    "Closing that much would leave a position too small to keep open. Close all of it instead.",
  NotPositionOwner: "That position belongs to another wallet.",
  PositionNotOpen: "That position is already closed.",
  MarketAlreadyResolved: "This market has resolved — settle the position instead.",
  NotStaleEnough: "The emergency exit only opens after the feed has been down for 24 hours.",
  InsufficientFreeAssets: "The vault doesn't have that much free to pay out right now.",
  InsufficientShares: "You don't have that many shares.",
  CapExceeded: "The senior tranche is at its cap. Deposits reopen when it's raised.",
  DepositsArePaused: "Vault deposits are paused.",
  ZeroAmount: "Enter an amount first.",
};

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

/**
 * Runs the call against the chain before paying for it.
 *
 * Two reasons. It turns a custom error into a sentence, which the sponsored
 * send cannot do because Privy only reports that the transaction failed. And
 * it means a doomed call never reaches the gas budget at all.
 */
async function simulate(
  account: string,
  address: Hex,
  abi: typeof engineAbi | typeof vaultAbi,
  functionName: string,
  args: readonly unknown[],
) {
  try {
    await client.simulateContract({
      account: account as Hex,
      address,
      abi: abi as never,
      functionName: functionName as never,
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

async function send(ctx: SendContext, to: string, data: Hex) {
  const external =
    ctx.wallet && !isEmbeddedWallet(ctx.wallet.walletClientType);

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

/**
 * Standing allowance granted when a top-up is needed, in USDG.
 *
 * Approving the exact amount would be tighter, but it puts a second
 * transaction in front of every single trade, and each one has to be mined
 * before the next can be simulated. That is the difference between a trade
 * feeling instant and taking twenty seconds, on a venue whose whole pitch is
 * getting in and out quickly.
 *
 * So: a budget rather than an exact amount, and a bounded one rather than the
 * usual unlimited approval. At a $5 margin cap this covers around fifty trades
 * before it is topped up again, and the worst case if the engine were ever
 * compromised is capped at this figure instead of the wallet.
 */
const APPROVAL_BUDGET = 250;

/**
 * Ensures `spender` can pull `amount`, topping up to a budget when it cannot.
 *
 * Returns whether it had to send a transaction, so the caller can tell the
 * trader why the first trade takes longer than the ones after it.
 */
async function ensureAllowance(
  ctx: SendContext,
  spender: string,
  amount: bigint,
): Promise<boolean> {
  const current = await readAllowance(ctx.from, spender);
  if (current >= amount) return false;

  // Never approve less than the trade needs, however the budget is set.
  const grant = toUsdgRaw(APPROVAL_BUDGET) > amount ? toUsdgRaw(APPROVAL_BUDGET) : amount;

  await send(
    ctx,
    USDG,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender as Hex, grant],
    }),
  );
  return true;
}

/**
 * Where a submission has got to, so the button can say something true.
 *
 * A levered open is up to three sequential on-chain steps and the first trade
 * from a wallet is materially slower than the rest. One undifferentiated
 * spinner across all of it reads as a hang.
 */
export type TradeStage = "approving" | "checking" | "submitting";

export type StageFn = (stage: TradeStage) => void;

export async function openLeveragePosition(
  ctx: SendContext,
  input: { marketSlug: string; isLong: boolean; margin: number; leverage: number },
  onStage?: StageFn,
) {
  const marginRaw = toUsdgRaw(input.margin);
  const args = [
    marketIdFor(input.marketSlug),
    input.isLong,
    marginRaw,
    BigInt(Math.round(input.leverage * 10_000)),
  ] as const;

  onStage?.("approving");
  await ensureAllowance(ctx, ENGINE_ADDRESS, marginRaw);

  onStage?.("checking");
  await simulate(ctx.from, ENGINE_ADDRESS as Hex, engineAbi, "openPosition", args);

  onStage?.("submitting");
  return send(
    ctx,
    ENGINE_ADDRESS,
    encodeFunctionData({ abi: engineAbi, functionName: "openPosition", args }),
  );
}

/**
 * Closes a position, in whole or in part.
 *
 * `fractionBps` of 10_000 closes all of it. The engine refuses to leave a
 * remainder below its minimum margin, so the UI should offer a "close all"
 * rather than let someone scrape a position down to dust.
 */
export async function closeLeveragePosition(
  ctx: SendContext,
  id: bigint,
  fractionBps = 10_000,
  onStage?: StageFn,
) {
  const args = [id, BigInt(fractionBps)] as const;
  onStage?.("checking");
  await simulate(ctx.from, ENGINE_ADDRESS as Hex, engineAbi, "reducePosition", args);

  onStage?.("submitting");
  return send(
    ctx,
    ENGINE_ADDRESS,
    encodeFunctionData({ abi: engineAbi, functionName: "reducePosition", args }),
  );
}

/** Last resort when the feed has been frozen for a day: exit at zero PnL. */
export async function emergencyCloseLeveragePosition(ctx: SendContext, id: bigint) {
  const args = [id] as const;
  await simulate(ctx.from, ENGINE_ADDRESS as Hex, engineAbi, "emergencyClose", args);

  return send(
    ctx,
    ENGINE_ADDRESS,
    encodeFunctionData({ abi: engineAbi, functionName: "emergencyClose", args }),
  );
}

export async function depositToVault(ctx: SendContext, amount: number) {
  const raw = toUsdgRaw(amount);
  await ensureAllowance(ctx, VAULT_ADDRESS, raw);
  await simulate(ctx.from, VAULT_ADDRESS as Hex, vaultAbi, "depositSenior", [raw]);

  return send(
    ctx,
    VAULT_ADDRESS,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "depositSenior",
      args: [raw],
    }),
  );
}

export async function withdrawFromVault(ctx: SendContext, shares: bigint) {
  await simulate(ctx.from, VAULT_ADDRESS as Hex, vaultAbi, "withdrawSenior", [shares]);

  return send(
    ctx,
    VAULT_ADDRESS,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawSenior",
      args: [shares],
    }),
  );
}
