import type { ConnectedWallet } from "@privy-io/react-auth";
import { RELAY_ROUTER, USDG } from "../robinhood";
import { ROBINHOOD_ADD_CHAIN } from "../chains";
import { ensureChain, isUserRejection, sleep, toHexQuantity, waitForReceipt } from "../evm";
import type { Eip1193 } from "../evm";
import { isEmbeddedWallet, robinhoodProvider } from "../wallet";
import { sponsoredTokenSend, type SignPrivyAuthorization } from "../sponsored-send";
import { unwrapRelayQuote, type RelayQuote, type RelayStepItem } from "./relay-steps";

/**
 * Selling a token a trader already holds for USDG they can bet with.
 *
 * Kept out of `live.ts` on purpose. That file is the buy path and is the most
 * load-bearing code here; this shares its shape but none of its stakes, and a
 * swap going wrong should never be able to break a trade.
 *
 * The route is Relay's, same-chain on Robinhood Chain, which settles in one
 * transaction rather than the cross-chain wait the buy path deals with. So
 * there is no status polling to babysit: once the swap lands, the USDG is
 * already there, and watching the balance is both simpler and truer than
 * asking Relay whether it thinks it finished.
 */

export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export type SwapStep = "quote" | "approve" | "swap" | "settle";

export type SwapToken = {
  /** null for native ETH. */
  address: string | null;
  symbol: string;
  decimals: number;
};

export class SwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwapError";
  }
}

type QuoteDetails = {
  currencyOut?: { amount?: string; amountUsd?: string; currency?: { decimals?: number } };
  currencyIn?: { amountUsd?: string };
  totalImpact?: { percent?: string };
};

export type SwapQuote = {
  raw: RelayQuote;
  /** USDG the trader receives, already scaled out of base units. */
  usdgOut: number;
  /** Negative means the swap costs more than the token is worth. */
  impactPercent: number | null;
};

function detailsOf(quote: RelayQuote): QuoteDetails {
  return (unwrapRelayQuote(quote) as { details?: QuoteDetails }).details ?? {};
}

function itemValue(item: RelayStepItem) {
  const value = item.data?.value;
  if (typeof value === "object" || value == null) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** allowance(owner,spender) — read back to prove an approval actually landed. */
function encodeAllowance(owner: string, spender: string) {
  const pad = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return `0xdd62ed3e${pad(owner)}${pad(spender)}` as `0x${string}`;
}

/**
 * Blocks until the token actually reports the allowance.
 *
 * A sponsored approval is a user operation and usually comes back without a
 * hash, so there is no receipt to wait on. Firing the swap straight after
 * means racing the approval onto the chain, and losing that race reverts the
 * swap for no reason the trader could act on.
 */
async function waitForAllowance(
  provider: Eip1193,
  token: string,
  owner: string,
  spender: string,
  needed: bigint,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const hex = (await provider.request({
        method: "eth_call",
        params: [{ to: token, data: encodeAllowance(owner, spender) }, "latest"],
      })) as string;
      if (BigInt(hex || "0x0") >= needed) return true;
    } catch {
      /* a flaky read is not a failed approval */
    }
    await sleep(2_000);
  }
  return false;
}

async function readUsdgUnits(address: string) {
  const res = await fetch(`/api/assets?address=${encodeURIComponent(address)}`);
  const data = (await res.json().catch(() => null)) as {
    assets?: { symbol: string; balanceRaw: string }[];
  } | null;
  const row = data?.assets?.find((a) => a.symbol === "USDG");
  try {
    return BigInt(row?.balanceRaw ?? "0");
  } catch {
    return 0n;
  }
}

export async function quoteSwapToCash(input: {
  accessToken: string;
  address: string;
  token: SwapToken;
  amountRaw: bigint;
}): Promise<SwapQuote> {
  const res = await fetch("/api/relay/swap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({
      user: input.address,
      token: input.token.address ?? NATIVE_TOKEN,
      amount: input.amountRaw.toString(),
    }),
  });
  const body = (await res.json().catch(() => null)) as
    | (RelayQuote & { error?: string })
    | null;
  if (!res.ok) {
    throw new SwapError(body?.error ?? "Could not quote this swap.");
  }
  if (!body) throw new SwapError("Could not quote this swap.");

  const details = detailsOf(body);
  const raw = details.currencyOut?.amount;
  const decimals = details.currencyOut?.currency?.decimals ?? 6;
  const usdgOut =
    raw && /^[0-9]+$/.test(raw) ? Number(BigInt(raw)) / 10 ** decimals : 0;
  if (!Number.isFinite(usdgOut) || usdgOut <= 0) {
    throw new SwapError("This swap would return nothing. Try a larger amount.");
  }
  const impact = Number(details.totalImpact?.percent);
  return {
    raw: body,
    usdgOut,
    impactPercent: Number.isFinite(impact) ? impact : null,
  };
}

/**
 * Runs the quote's steps and resolves to the USDG that actually arrived.
 *
 * Each transaction goes one of two ways. A zero-value call from an embedded
 * wallet is sponsored, because those traders hold no ETH and would otherwise
 * be unable to sell anything. Anything carrying value — selling native ETH —
 * has to come from the wallet itself, since sponsorship covers gas and not
 * the amount being sold.
 */
export async function runSwapToCash(
  input: {
    accessToken: string;
    wallet: ConnectedWallet;
    address: string;
    token: SwapToken;
    /** What the quote was taken for, and the allowance the swap needs. */
    amountRaw: bigint;
    quote: SwapQuote;
    signAuthorization?: SignPrivyAuthorization;
  },
  hooks: { onStep?: (step: SwapStep) => void } = {},
): Promise<{ usdg: number }> {
  const amountIn = input.amountRaw;
  const before = await readUsdgUnits(input.address);

  let provider: Eip1193;
  try {
    provider = await robinhoodProvider(input.wallet);
  } catch (err) {
    throw new SwapError(
      friendly(err, "Could not switch this wallet to Robinhood Chain."),
    );
  }

  const embedded = isEmbeddedWallet(input.wallet.walletClientType);
  const sellingToken = (input.token.address ?? "").toLowerCase();
  const router = RELAY_ROUTER.toLowerCase();

  const steps = unwrapRelayQuote(input.quote.raw).steps ?? [];
  for (const step of steps) {
    const kind = (step.id ?? step.kind ?? "").toLowerCase();
    hooks.onStep?.(kind === "approve" ? "approve" : "swap");
    for (const item of step.items ?? []) {
      if (item.status === "complete" || item.status === "completed") continue;
      const to = item.data?.to;
      if (!to) throw new SwapError("Relay returned a step with no destination.");

      // The server vetted this too. Repeated here because this is the last
      // point before the trader's wallet signs, and a wrong target is the one
      // mistake that cannot be undone afterwards.
      const target = to.toLowerCase();
      if (target !== router && target !== sellingToken) {
        throw new SwapError("This swap route is not recognised. Nothing was sent.");
      }

      const value = itemValue(item);
      const data = (item.data?.data || "0x") as `0x${string}`;

      try {
        if (embedded && value === 0n && input.signAuthorization) {
          await sponsoredTokenSend({
            accessToken: input.accessToken,
            from: input.address,
            token: to,
            data,
            signAuthorization: input.signAuthorization,
          });
          if (kind === "approve" && input.token.address) {
            const landed = await waitForAllowance(
              provider,
              input.token.address,
              input.address,
              RELAY_ROUTER,
              amountIn,
            );
            if (!landed) {
              throw new SwapError(
                `The approval for ${input.token.symbol} has not confirmed yet. Nothing was swapped — try again in a moment.`,
              );
            }
          }
        } else {
          await ensureChain(provider, ROBINHOOD_ADD_CHAIN);
          const tx: Record<string, string> = {
            from: input.address,
            to,
            data,
            value: toHexQuantity(value),
          };
          const hash = (await provider.request({
            method: "eth_sendTransaction",
            params: [tx],
          })) as string;
          await waitForReceipt(provider, hash);
        }
      } catch (err) {
        if (err instanceof SwapError) throw err;
        if (isUserRejection(err)) {
          throw new SwapError("Wallet request was cancelled.");
        }
        throw new SwapError(
          friendly(
            err,
            kind === "approve"
              ? `Could not approve ${input.token.symbol}.`
              : `Could not swap ${input.token.symbol} into cash.`,
          ),
        );
      }
    }
  }

  hooks.onStep?.("settle");
  const arrived = await waitForUsdg(input.address, before);
  if (arrived <= 0n) {
    throw new SwapError(
      "The swap went through but the cash has not shown up yet. Give it a moment and check your balance before trying again.",
    );
  }
  return { usdg: Number(arrived) / 1e6 };
}

/**
 * Watches for the USDG to land rather than trusting the send.
 *
 * A sponsored send is a user operation and often comes back without a hash, so
 * there is nothing to wait on. The balance is the one signal that cannot be
 * wrong.
 */
async function waitForUsdg(address: string, before: bigint) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const now = await readUsdgUnits(address);
    if (now > before) return now - before;
    await sleep(2_000);
  }
  return 0n;
}

function friendly(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/insufficient funds|gas required/i.test(message)) {
    return "This wallet needs a little ETH on Robinhood Chain to cover gas for this swap.";
  }
  if (/user rejected|denied/i.test(message)) return "Wallet request was cancelled.";
  return message.trim() || fallback;
}
