import { formatUnits } from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { sleep } from "./evm";
import type { SendContext } from "./leverage-actions";
import { notifyBalancesChanged } from "./positions";
import type { SignPrivyAuthorization } from "./sponsored-send";
import {
  readWalletStock,
  toStockRaw,
  withdrawStock,
  type StockHolding,
} from "./stock-collateral";
import type { StockToken } from "./stock-tokens";
import { quoteSwapToCash, runSwapToCash, SwapError } from "./trade/swap";

/**
 * Turns listed stock into spendable USDG on Robinhood Chain.
 *
 * Spot buys and native tickets cannot spend NVDA/AAPL/etc. on the book, so
 * this sells the shares first. Levered tickets still lock stock on the desk;
 * this path is only the convert-then-trade option. Close and cash-out stay
 * in USDG either way.
 */

export async function convertStockToCash(input: {
  accessToken: string;
  wallet: ConnectedWallet;
  address: string;
  token: StockToken;
  amount: number;
  holding?: StockHolding | null;
  signAuthorization?: SignPrivyAuthorization;
  onStep?: (step: "withdraw" | "quote" | "approve" | "swap" | "settle") => void;
}): Promise<{ usdg: number }> {
  const raw = toStockRaw(input.amount, input.token.decimals);
  if (raw <= 0n) throw new Error("Enter an amount first.");

  const walletBal = input.holding?.wallet ?? 0n;
  const free = input.holding?.free ?? 0n;
  if (walletBal + free < raw) {
    throw new Error(`Not enough ${input.token.symbol} in this wallet.`);
  }

  const ctx: SendContext = {
    accessToken: input.accessToken,
    from: input.address,
    wallet: input.wallet,
    signAuthorization:
      input.signAuthorization ??
      (async () => {
        throw new Error("Could not authorize this wallet.");
      }),
  };

  if (walletBal < raw && free > 0n) {
    input.onStep?.("withdraw");
    const need = raw - walletBal;
    await withdrawStock(
      ctx,
      input.token.address,
      formatUnits(need, input.token.decimals),
      input.token.decimals,
    );
    const landed = await waitForWalletStock(
      input.address,
      input.token.address,
      raw,
    );
    if (!landed) {
      throw new Error(
        `${input.token.symbol} is still leaving the desk. Wait a moment and try again.`,
      );
    }
  }

  const swapToken = {
    address: input.token.address,
    symbol: input.token.symbol,
    decimals: input.token.decimals,
  };

  input.onStep?.("quote");
  let quote;
  try {
    quote = await quoteSwapToCash({
      accessToken: input.accessToken,
      address: input.address,
      token: swapToken,
      amountRaw: raw,
    });
  } catch (err) {
    if (err instanceof SwapError) throw err;
    throw new Error(
      err instanceof Error
        ? err.message
        : `Could not quote ${input.token.symbol} into USDG.`,
    );
  }

  const { usdg } = await runSwapToCash(
    {
      accessToken: input.accessToken,
      wallet: input.wallet,
      address: input.address,
      token: swapToken,
      amountRaw: raw,
      quote,
      signAuthorization: input.signAuthorization,
    },
    { onStep: input.onStep },
  );

  notifyBalancesChanged();
  return { usdg };
}

async function waitForWalletStock(user: string, token: string, needed: bigint) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const bal = await readWalletStock(user, token);
    if (bal >= needed) return true;
    await sleep(1_500);
  }
  return false;
}
