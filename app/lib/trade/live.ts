import { OrderSide, OrderType } from "@polymarket/client";
import { signerFrom } from "@polymarket/client/viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { createWalletClient, custom, type Hex } from "viem";
import { isEmbeddedWallet, robinhoodProvider } from "../wallet";
import { polygon } from "../chains";
import { isUserRejection, sleep, waitForReceipt, type Eip1193 } from "../evm";
import { clobTick } from "../format";
import { loadTradingCreds, saveTradingCreds, clearTradingCreds } from "./creds";
import { resolvePolymarketFunder } from "../pm-funder";
import { saveDepositWallet } from "../pm-wallet";
import {
  authedJson,
  createClobCredentials,
  embeddedPolygonProvider,
  openTradingClient,
  polymarketAuth,
  readPusd,
  readPusdBalance,
  storedCreds,
  waitForPusd,
  type TradingClient,
} from "./session";
import {
  executeRelayQuote,
  pollRelayStatus,
  quotedPusd,
  relayDepositAddress,
  relayRequestId,
  RelayTimeoutError,
  type RelayQuote,
} from "./relay-steps";
import { encodeErc20Transfer, USDG } from "../robinhood";
import {
  sponsoredTokenSend,
  type SignPrivyAuthorization,
} from "../sponsored-send";

export type ConvertStep = "swap" | "setup" | "debit" | "convert" | "fill";

export type LiveTradeInput = {
  amountUsdg: number;
  tokenId: string;
  side: "yes" | "no";
  marketPrice: number;
  cashAddress: string;
  accessToken: string;
  cashWallet: ConnectedWallet;
  tradingWallet: ConnectedWallet;
  /** Enables the gasless deposit-address retry when a permit route is refused. */
  signAuthorization?: SignPrivyAuthorization;
};

export type LiveTradeResult = {
  conversionId: string;
  depositWallet: string;
  usdg: number;
  pusd: number;
  shares: number;
  entryPrice: number;
  orderId: string | null;
};

export class LiveTradeError extends Error {
  depositWallet?: string;
  pusdReceived?: number;
  constructor(
    message: string,
    extra?: { depositWallet?: string; pusdReceived?: number },
  ) {
    super(message);
    this.name = "LiveTradeError";
    this.depositWallet = extra?.depositWallet;
    this.pusdReceived = extra?.pusdReceived;
  }
}

function usdgBaseUnits(amount: number) {
  const raw = Math.round(amount * 10 ** 6);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error("Enter a valid USDG amount.");
  }
  return BigInt(raw).toString();
}

async function readUsdgUnits(address: string) {
  const res = await fetch(`/api/assets?address=${encodeURIComponent(address)}`);
  const data = (await res.json().catch(() => null)) as {
    assets?: { symbol?: string; balanceRaw?: string; balance?: number }[];
  } | null;
  const row = data?.assets?.find((a) => a.symbol === "USDG");
  try {
    return BigInt(row?.balanceRaw ?? "0");
  } catch {
    return 0n;
  }
}

function unitsToUsdg(raw: bigint) {
  return Number(raw) / 1e6;
}

/**
 * Wait for a sponsored transfer to actually show up as a balance drop.
 *
 * Gas-sponsored sends go out as user operations, which resolve to a
 * transaction hash only after they are bundled — Privy returns none, so there
 * is nothing to wait on with a receipt. The balance is the only honest signal
 * that the tokens moved.
 */
async function usdgLeft(address: string, before: bigint, amount: bigint) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await readUsdgUnits(address)) <= before - amount) return true;
    await sleep(2_000);
  }
  return false;
}

/**
 * Largest whole-cent spend that `available` pUSD base units fully covers.
 *
 * The CLOB rejects an order whose maker amount exceeds the proxy balance, so
 * this always rounds down — rounding to the nearest cent can land a few base
 * units above the balance and the rejection reads as an allowance error.
 *
 * Rounding down is not enough on its own. When the balance is the binding
 * constraint and it is already an exact number of cents — 5.02 pUSD is exactly
 * 5_020_000 units — the floor is a no-op and the order spends every last base
 * unit. That leaves nothing for the rounding the CLOB applies when it builds
 * the maker amount, nor for its balance cache trailing the chain by a moment,
 * and either one puts the order a hair over what it will accept. Worse, the
 * rejection is not self-clearing: a retry re-reads the same balance, computes
 * the same amount and fails the same way, so "tap Buy again" loops forever.
 *
 * Holding a nickel back when the CLOB cache is the binding constraint costs
 * at most $0.05 on a trade that is spending the wallet dry, and only on the
 * trades that would otherwise have failed outright.
 */
function spendableCents(wanted: number, available: bigint) {
  const wantedUnits = BigInt(Math.max(0, Math.floor(wanted * 1e6)));
  const capped = wantedUnits < available ? wantedUnits : available;
  let cents = capped / 10_000n;
  // Hold a nickel when the order would spend the CLOB's cached balance dry.
  // Maker-amount rounding, builder fees inside maxSpend, and a cache that
  // still trails the last refresh all land in that range. Sizing off chain
  // pUSD after a cash-out is what made "tap Buy again" loop: the cache was
  // still ~0 while the proxy already held the new conversion.
  if (cents > 5n && cents * 10_000n + 40_000n >= available) cents -= 5n;
  else if (cents > 0n && cents * 10_000n >= available) cents -= 1n;
  return Number(cents) / 100;
}

function errorText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const extra =
      "code" in err && (err as { code?: unknown }).code != null
        ? String((err as { code: unknown }).code)
        : "";
    const status =
      "status" in err && (err as { status?: unknown }).status != null
        ? String((err as { status: unknown }).status)
        : "";
    return [err.name, err.message, extra, status, errorText(err.cause)]
      .filter(Boolean)
      .join(" ");
  }
  if (typeof err === "object") {
    const row = err as Record<string, unknown>;
    return [row.message, row.error, row.reason, row.status]
      .filter((value) => value != null && value !== "")
      .map((value) => String(value))
      .join(" ");
  }
  return String(err);
}

const CLOB_COLLATERAL = "COLLATERAL" as never;

function unitsOf(balance: unknown): bigint {
  if (typeof balance === "bigint") return balance >= 0n ? balance : 0n;
  if (typeof balance === "number" && Number.isFinite(balance) && balance >= 0) {
    if (!Number.isInteger(balance) || balance < 1_000) {
      return BigInt(Math.round(balance * 1e6));
    }
    return BigInt(Math.round(balance));
  }
  if (typeof balance === "string") {
    const trimmed = balance.trim();
    if (!trimmed) return 0n;
    if (/[eE.]/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) return 0n;
      return BigInt(Math.round(n * 1e6));
    }
    try {
      const n = BigInt(trimmed);
      return n >= 0n ? n : 0n;
    } catch {
      return 0n;
    }
  }
  return 0n;
}

async function readClobCollateral(trading: TradingClient, refresh: boolean) {
  try {
    const { updateBalanceAllowance, fetchBalanceAllowance } = await import(
      "@polymarket/client/actions"
    );
    const request = { assetType: CLOB_COLLATERAL };
    const res = refresh
      ? await updateBalanceAllowance(trading, request)
      : await fetchBalanceAllowance(trading, request);
    const units = unitsOf(res?.balance);
    if (units === 0n && res?.balance != null && String(res.balance) !== "0") {
      console.warn("[hedge] CLOB collateral parsed 0", res.balance);
    }
    return units;
  } catch (err) {
    console.warn("[hedge] CLOB collateral read", err);
    return null;
  }
}

/**
 * The CLOB rejects against its own cached collateral, not chain `balanceOf`.
 * A cash-out zeros that cache. The next conversion credits the proxy on
 * chain first, so a single refresh often still reads 0. Wait until the
 * cache is close to the chain balance before sizing the order.
 */
async function waitForClobCollateral(
  trading: TradingClient,
  chainRaw: bigint,
  timeoutMs = 20_000,
) {
  const slack = 50_000n;
  const target = chainRaw > slack ? chainRaw - slack : chainRaw;
  const deadline = Date.now() + timeoutMs;
  let latest = 0n;
  for (let i = 0; Date.now() < deadline; i++) {
    const raw = await readClobCollateral(trading, i % 4 === 0);
    if (raw != null) latest = raw;
    if (latest >= target && (target === 0n || latest > 0n)) return latest;
    await sleep(1_200);
  }
  return latest;
}

function coverable(chainRaw: bigint, clobRaw: bigint | null) {
  if (clobRaw == null || clobRaw <= 0n) return chainRaw;
  return clobRaw < chainRaw ? clobRaw : chainRaw;
}

/**
 * Wrap a failed leg with a short ref code.
 *
 * Several legs collapse into the same sentence once `friendlyError` is done
 * with them — "invalid signature" alone can come from the Polymarket
 * credential handshake or from either relay call — so a screenshot of the
 * error is not enough to say which one broke. The ref names the leg, and the
 * raw error goes to the console next to it.
 */
function failLeg(leg: string, err: unknown, fallback: string): Error {
  console.error(`[hedge] trade failed at ${leg}`, err);
  return new Error(`${friendlyError(err, fallback)} (ref: ${leg})`);
}

/** The CLOB refusing an order for collateral rather than anything else. */
function isBalanceShortfall(err: unknown) {
  const message = errorText(err);
  if (
    /liquidity|no match/i.test(message) &&
    !/allowance|not enough balance/i.test(message)
  ) {
    return false;
  }
  if (
    /allowance|not enough balance|insufficient (?:balance|collateral)|underfunded/i.test(
      message,
    )
  ) {
    return true;
  }
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    Number((err as { status: unknown }).status) === 400
  ) {
    return !/signature|unauthorized|disabled|maintenance/i.test(message);
  }
  return false;
}

/** Relay turning down a permit signature, as opposed to a transport failure. */
function isSignatureRejection(err: unknown) {
  const message = errorText(err);
  return /invalid signature|signature (?:is )?(?:invalid|expired)|permit/i.test(
    message,
  );
}

function friendlyError(err: unknown, fallback: string) {
  if (isUserRejection(err)) return "Wallet request was cancelled.";
  const message = errorText(err);
  if (/insufficient funds|gas/i.test(message) && !/gasless/i.test(message)) {
    return "This wallet needs a little ETH on Robinhood Chain for gas.";
  }
  // The SDK tops up a missing approval and retries before surfacing this, so a
  // rejection that reaches us is a balance shortfall, not a missing approval.
  if (/allowance|not enough balance|insufficient (?:balance|collateral)/i.test(message)) {
    return "Polymarket rejected the order because the proxy balance did not cover it. Your pUSD is safe. Tap Buy again.";
  }
  if (/USDG|transfer amount exceeds/i.test(message)) {
    return "Not enough USDG to complete this conversion.";
  }
  if (/derive api key|create api key|\/auth\/(?:derive-)?api-key/i.test(message)) {
    return "Could not connect this wallet to Polymarket. Try Buy again.";
  }
  if (/invalid signature/i.test(message)) {
    return "The wallet signature did not match. Stay on Robinhood Chain in this wallet and try Buy again.";
  }
  if (/trading is disabled|clob.*maintenance/i.test(message)) {
    return "Polymarket trading is down for maintenance. Your pUSD is already in the proxy wallet — try Buy again in a few minutes. Hedge will use that balance instead of converting more USDG.";
  }
  return message || fallback;
}

export async function runLiveTrade(
  input: LiveTradeInput,
  hooks: {
    onStep: (step: ConvertStep) => void;
    onQuote?: (pusd: number) => void;
  },
): Promise<LiveTradeResult> {
  const amount = Math.round(input.amountUsdg * 100) / 100;
  if (!input.tokenId) throw new Error("This outcome is not tradeable yet.");
  if (amount < 1) throw new Error("Minimum buy is $1 USDG.");
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.cashAddress)) {
    throw new Error("Your wallet isn't ready yet. Try Buy again.");
  }

  hooks.onStep("setup");

  const cash = input.cashAddress as Hex;
  const trader = input.tradingWallet.address as Hex;

  if (!isEmbeddedWallet(input.tradingWallet.walletClientType)) {
    throw new Error("Could not create a trading wallet.");
  }

  let funder: string;
  try {
    funder = await resolvePolymarketFunder(trader);
  } catch (err) {
    throw failLeg("funder", err, "Could not derive the Polymarket proxy wallet.");
  }
  if (funder.toLowerCase() === trader.toLowerCase()) {
    throw new Error("Could not derive the Polymarket proxy wallet.");
  }
  saveDepositWallet(trader, funder);

  /**
   * Put the cash wallet on Robinhood Chain before anything else is read off it.
   *
   * The relay steps below run with `skipChainSwitch: true`, so the signature
   * step signs on whatever chain the wallet is currently sitting on rather
   * than the one the step is for. That is fine on a fresh session — Privy
   * opens on Robinhood Chain — but the fill switches this same wallet to
   * Polygon and never switches back. For an email or social login the trading
   * and cash wallets are one embedded wallet, so every buy after the first one
   * signed the Robinhood Chain step while parked on Polygon and came back as
   * "invalid signature", and each retry re-parked it, so it never recovered.
   */
  let cashProvider: Eip1193;
  try {
    cashProvider = await robinhoodProvider(input.cashWallet);
  } catch (err) {
    throw failLeg("rh-chain", err, "Could not switch this wallet to Robinhood Chain.");
  }

  let tradingProvider: Eip1193;
  try {
    // Read after the switch above, since a provider fetched earlier stays
    // bound to the chain it was fetched on. Not moved to Polygon here: that
    // would pull the ground out from under the USDG leg when both roles are
    // the same embedded wallet. The fill switches to Polygon on its own once
    // the conversion is done.
    tradingProvider = (await input.tradingWallet.getEthereumProvider()) as Eip1193;
  } catch (err) {
    throw failLeg("trade-provider", err, "Could not prepare the Polymarket trading wallet.");
  }

  const walletClient = createWalletClient({
    account: trader,
    chain: polygon,
    transport: custom(tradingProvider),
  });
  const signer = signerFrom(walletClient);
  const signing = polymarketAuth(input.accessToken);

  const quoteBody = {
    user: cash,
    recipient: funder,
    amount: usdgBaseUnits(amount),
  };
  const beforePromise = readPusd(input.accessToken, funder);
  const configPromise = authedJson<{ builderCode: string }>(
    input.accessToken,
    "/api/pm/config",
  );

  let creds = loadTradingCreds(trader);
  try {
    if (!creds) {
      creds = await createClobCredentials(walletClient, trader);
      saveTradingCreds(trader, creds);
    }
  } catch (err) {
    throw failLeg("creds", err, "Could not connect this wallet to Polymarket.");
  }
  if (!creds) {
    throw new Error("Polymarket did not return trading credentials.");
  }

  void openTradingClient(signer, signing, creds, funder).catch((err) => {
    console.warn("[hedge] Polymarket proxy session deferred", err);
  });

  const { builderCode } = await configPromise;
  const before = await beforePromise;
  const spendable = Number(Math.max(0, before).toFixed(6));
  const onChainUsdg = await readUsdgUnits(cash);
  const maxConvert = onChainUsdg > 10_000n ? onChainUsdg - 10_000n : 0n;
  const maxConvertNum = unitsToUsdg(maxConvert);
  const shortfall = Math.max(0, amount - spendable);
  const useExisting =
    spendable >= 1 && (spendable + 0.25 >= amount || shortfall < 1);

  let requestId = "existing-pusd";
  let pusd = spendable;

  if (useExisting) {
    pusd = Number(Math.min(spendable, amount).toFixed(6));
    hooks.onQuote?.(pusd);
  } else {
    try {
      const clob = await authedJson<{ ok?: boolean; status?: string }>(
        input.accessToken,
        "/api/pm/status",
      );
      if (clob.ok === false) {
        throw new Error(
          "Polymarket trading is down for maintenance. Your USDG was not converted. Try Buy again after clob.polymarket.com is back.",
        );
      }
    } catch (err) {
      if (/trading is down for maintenance/i.test(String(err))) throw err;
      /* status page unreachable — continue */
    }
    let convertAmount =
      spendable >= 0.01 && shortfall >= 1
        ? Math.round(shortfall * 100) / 100
        : amount;
    convertAmount = Math.min(convertAmount, Math.floor(maxConvertNum * 100) / 100);
    // Relay keeps a few cents, so a $5 debit often lands 4.96 pUSD. Convert a
    // little extra when the wallet has it so the fill can still spend $5.
    if (convertAmount >= 1 && maxConvertNum >= convertAmount + 0.05) {
      convertAmount = Math.round((convertAmount + 0.05) * 100) / 100;
    }
    if (convertAmount < 1) {
      if (spendable >= 1) {
        pusd = Number(Math.min(spendable, amount).toFixed(6));
        hooks.onQuote?.(pusd);
      } else {
        throw new Error(
          `Not enough USDG in this wallet (${unitsToUsdg(onChainUsdg).toFixed(2)}). Deposit more, then try Buy again.`,
        );
      }
    } else {
    quoteBody.amount = usdgBaseUnits(convertAmount);

    hooks.onStep("debit");
    const quote = await authedJson<RelayQuote>(
      input.accessToken,
      "/api/relay/quote",
      {
        method: "POST",
        body: JSON.stringify(quoteBody),
      },
    );
    const expectedPusd = quotedPusd(quote);
    if (expectedPusd != null) hooks.onQuote?.(spendable + expectedPusd);

    let broadcast = false;
    let viaDeposit = false;
    try {
      requestId = await executeRelayQuote(
        cashProvider,
        input.accessToken,
        cash,
        quote,
        {
          skipChainSwitch: true,
          onBroadcast: () => {
            broadcast = true;
          },
        },
      );
    } catch (err) {
      // The quote above is a permit route whenever Relay will sell us one, and
      // Relay can reject that permit signature at execute time even though it
      // quoted happily. Nothing recovers from that on its own: the same route
      // is requoted on every attempt and fails the same way. So re-quote once
      // without the permit and convert by approval instead.
      //
      // Only safe while nothing has been broadcast. Past that point a retry
      // could convert the same USDG twice, so the original error stands.
      if (broadcast || !isSignatureRejection(err) || !input.signAuthorization) {
        throw failLeg("relay-exec", err, "Could not convert USDG to pUSD.");
      }
      console.warn("[hedge] permit route refused, retrying via deposit address", err);
      const signAuthorization = input.signAuthorization;
      try {
        const direct = await authedJson<RelayQuote>(
          input.accessToken,
          "/api/relay/quote",
          {
            method: "POST",
            body: JSON.stringify({ ...quoteBody, mode: "direct" }),
          },
        );
        const dest = relayDepositAddress(direct, { strict: true });
        const directId = relayRequestId(direct);
        if (!dest || !directId) {
          throw new Error("Relay could not create a deposit address.");
        }
        // Plain ERC-20 transfer, so there is no signature for Relay to refuse
        // and no approval for the sponsor policy to turn down. Gas is on
        // Hedge, which matters because this wallet holds USDG and no ETH.
        const sending = BigInt(quoteBody.amount);
        const usdgBefore = await readUsdgUnits(cash);
        if (usdgBefore < sending) {
          throw new Error("Not enough USDG left to cover this conversion.");
        }
        const depositData = encodeErc20Transfer(dest, sending);
        const embeddedCash = isEmbeddedWallet(input.cashWallet.walletClientType);
        let sponsored = false;
        if (embeddedCash && signAuthorization) {
          try {
            await sponsoredTokenSend({
              accessToken: input.accessToken,
              from: cash,
              token: USDG,
              data: depositData,
              signAuthorization,
            });
            sponsored = true;
          } catch (sendErr) {
            const msg = sendErr instanceof Error ? sendErr.message : String(sendErr ?? "");
            if (!/not linked to this account/i.test(msg)) throw sendErr;
          }
        }
        if (!sponsored) {
          const hash = (await cashProvider.request({
            method: "eth_sendTransaction",
            params: [
              {
                from: cash,
                to: USDG,
                data: depositData,
                value: "0x0",
              },
            ],
          })) as string;
          await waitForReceipt(cashProvider, hash);
        }
        // Privy sponsors this as a user operation and hands back no
        // transaction hash, so the call returning is not evidence the transfer
        // happened. Watch the balance instead: without this we would start
        // polling Relay for a deposit that may never have been made and sit at
        // "converting" until the timeout, which is what a stuck buy looks like.
        if (!(await usdgLeft(cash, usdgBefore, sending))) {
          throw new Error(
            "The sponsored USDG transfer did not confirm. Nothing left your wallet — try Buy again.",
          );
        }
        requestId = directId;
        viaDeposit = true;
      } catch (retryErr) {
        throw failLeg("relay-deposit", retryErr, "Could not convert USDG to pUSD.");
      }
    }

    hooks.onStep("convert");
    /**
     * A timeout here is not a failure. The USDG is already gone by this point,
     * and Relay going quiet only means it has not finished — a deposit-address
     * route routinely outlasts this window because it waits for the deposit to
     * confirm before filling. Reporting an error would be wrong twice over: the
     * conversion usually lands seconds later, and the trader is told to retry
     * something that already happened.
     *
     * pUSD arriving in the proxy is the real success condition, so on a timeout
     * fall through and watch the balance. An explicit failure or refund still
     * stops the trade.
     */
    let statusPending = false;
    if (viaDeposit) {
      // Deposits we make ourselves do not get a status Relay will answer for:
      // it never returns anything but pending for this id, so polling it just
      // burns the clock and then reports a failure for a conversion that is
      // fine. The deposit is already sitting in Relay's depository by now, so
      // the only thing left to establish is that the pUSD came out the other
      // side — which the balance watch below does directly.
      statusPending = true;
    } else {
      try {
        await pollRelayStatus(input.accessToken, requestId);
      } catch (err) {
        if (!(err instanceof RelayTimeoutError)) {
          throw failLeg("relay-status", err, "Conversion is still pending.");
        }
        statusPending = true;
        console.warn("[hedge] relay still pending, watching the proxy balance");
      }
    }

    const arrived = await waitForPusd(
      input.accessToken,
      funder,
      before,
      expectedPusd,
      statusPending ? 180_000 : 45_000,
    );
    pusd = Number(Math.min(arrived.balance, amount).toFixed(6));
    if (pusd < 0.01) {
      throw new LiveTradeError(
        "Your USDG is converting and has not landed yet. Nothing is lost — it goes to your Polymarket wallet, and the next Buy will spend it instead of converting again. Give it a minute.",
        { depositWallet: funder },
      );
    }
    hooks.onQuote?.(pusd);
    }
  }

  hooks.onStep("fill");
  let depositWallet = funder;
  // What the proxy actually holds, which the order size drops below once the
  // CLOB makes us give up a cent. Failure messages quote a balance, so they
  // have to read this rather than the amount we ended up bidding.
  let held = pusd;
  try {
    await embeddedPolygonProvider(input.tradingWallet);
    const fillProvider = (await input.tradingWallet.getEthereumProvider()) as Eip1193;
    const fillWalletClient = createWalletClient({
      account: trader,
      chain: polygon,
      transport: custom(fillProvider),
    });
    const fillSigner = signerFrom(fillWalletClient);

    let client;
    try {
      client = await openTradingClient(fillSigner, signing, creds, funder);
    } catch (err) {
      console.warn("[hedge] Retrying Polymarket session with fresh L1 keys", err);
      clearTradingCreds(trader);
      creds = await createClobCredentials(fillWalletClient, trader);
      saveTradingCreds(trader, creds);
      client = await openTradingClient(fillSigner, signing, creds, funder);
    }
    if (client.account.wallet.toLowerCase() === trader.toLowerCase()) {
      throw new Error("Could not open the Polymarket proxy wallet.");
    }
    const sessionCreds = storedCreds(client.credentials);
    if (sessionCreds) saveTradingCreds(trader, sessionCreds);
    // The order draws on the session's wallet, which is not always the address
    // we derived, so size the spend against that wallet's balance.
    depositWallet = client.account.wallet;
    if (depositWallet.toLowerCase() !== funder.toLowerCase()) {
      saveDepositWallet(trader, depositWallet);
    }

    const trading = client;
    await trading.setupTradingApprovals();

    const live = await readPusdBalance(input.accessToken, depositWallet);
    held = live.pusd;
    const clobRaw = await waitForClobCollateral(trading, live.raw);
    if (clobRaw <= 0n && live.raw >= 1_000_000n) {
      throw new LiveTradeError(
        `Your ${live.pusd.toFixed(2)} pUSD is already in the Polymarket proxy wallet, but Polymarket has not credited it for trading yet. Tap Buy again in a few seconds. Hedge will spend that balance instead of converting more USDG.`,
        { depositWallet, pusdReceived: live.pusd },
      );
    }
    const available = coverable(live.raw, clobRaw);
    pusd = spendableCents(pusd, available);
    console.warn(
      `[hedge] fill cover chain=${live.pusd.toFixed(2)} clob=${(Number(clobRaw) / 1e6).toFixed(2)} spend=${pusd.toFixed(2)}`,
    );
    if (pusd < 1) {
      throw new LiveTradeError(
        `Your Polymarket proxy wallet holds ${live.pusd.toFixed(2)} pUSD. Polymarket needs a little over $1.00 to place an order. Add some more and try Buy again.`,
        { depositWallet, pusdReceived: live.pusd },
      );
    }

    let maxPrice = clobTick(input.marketPrice + 0.05);
    try {
      const estimate = await trading.estimateMarketPrice({
        tokenId: input.tokenId,
        side: OrderSide.BUY,
        amount: pusd,
        orderType: OrderType.FAK,
      });
      if (Number.isFinite(estimate) && estimate > 0) {
        maxPrice = clobTick(estimate + 0.02);
      }
    } catch {
      /* use UI price buffer */
    }

    /**
     * Size against the CLOB cache, then drop a nickel and re-read it if the
     * book still says the proxy cannot cover the maker amount.
     */
    const sendOrder = async () => {
      for (let attempt = 0; ; attempt++) {
        const next = Number((pusd - 0.05).toFixed(2));
        const canRetry = attempt < 6 && next >= 1;
        try {
          const sent = await trading.placeMarketOrder({
            tokenId: input.tokenId,
            side: OrderSide.BUY,
            amount: pusd,
            maxSpend: pusd,
            maxPrice,
            builderCode: builderCode as Hex,
            orderType: OrderType.FAK,
          });
          if (sent.ok || !canRetry || !isBalanceShortfall(sent.message)) {
            return sent;
          }
        } catch (err) {
          if (!canRetry || !isBalanceShortfall(err)) throw err;
        }
        console.warn(
          `[hedge] CLOB refused ${pusd.toFixed(2)} pUSD on balance, retrying at ${next.toFixed(2)}`,
        );
        await sleep(400);
        const again = await readPusdBalance(input.accessToken, depositWallet);
        const againClob = await readClobCollateral(trading, true);
        held = again.pusd;
        pusd = spendableCents(next, coverable(again.raw, againClob));
      }
    };
    const response = await sendOrder();

    if (!response.ok) {
      throw new LiveTradeError(
        `Your ${held.toFixed(2)} pUSD is in the Polymarket proxy wallet, but the order was rejected: ${friendlyError(response.message, response.message)}`,
        { depositWallet, pusdReceived: held },
      );
    }

    if (response.ok) {
      try {
        await client.waitForOrderFillSettlement(response, { timeoutMs: 8_000 });
      } catch {
        /* matched fills can settle asynchronously */
      }
    }

    const taking = Number(response.takingAmount);
    const making = Number(response.makingAmount);
    if (!Number.isFinite(taking) || taking <= 0) {
      throw new LiveTradeError(
        `Your ${held.toFixed(2)} pUSD is still in the Polymarket proxy wallet, but this outcome had no fillable liquidity.`,
        { depositWallet, pusdReceived: held },
      );
    }

    const entryPrice =
      Number.isFinite(making) && making > 0 && taking > 0
        ? making / taking
        : input.marketPrice;

    return {
      conversionId: requestId,
      depositWallet: client.account.wallet,
      usdg: amount,
      pusd,
      shares: taking,
      entryPrice,
      orderId: String(response.orderId ?? "") || null,
    };
  } catch (err) {
    if (err instanceof LiveTradeError) throw err;
    console.error("[hedge] fill failed", err);
    throw new LiveTradeError(
      `Your ${held.toFixed(2)} pUSD is still in the Polymarket proxy wallet. ${friendlyError(err, "Try Buy again to fill from that balance.")}`,
      { depositWallet, pusdReceived: held },
    );
  }
}
