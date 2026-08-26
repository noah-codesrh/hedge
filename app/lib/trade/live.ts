import { OrderSide, OrderType } from "@polymarket/client";
import { signerFrom } from "@polymarket/client/viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { createWalletClient, custom, type Hex } from "viem";
import { isEmbeddedWallet } from "../wallet";
import { polygon } from "../chains";
import { isUserRejection, type Eip1193 } from "../evm";
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
} from "./session";
import {
  executeRelayQuote,
  pollRelayStatus,
  quotedPusd,
  type RelayQuote,
} from "./relay-steps";

export type ConvertStep = "setup" | "debit" | "convert" | "fill";

export type LiveTradeInput = {
  amountUsdg: number;
  tokenId: string;
  side: "yes" | "no";
  marketPrice: number;
  cashAddress: string;
  accessToken: string;
  cashWallet: ConnectedWallet;
  tradingWallet: ConnectedWallet;
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
 * Largest whole-cent spend that `available` pUSD base units fully covers.
 * The CLOB rejects an order whose maker amount exceeds the proxy balance, so
 * this always rounds down — rounding to the nearest cent can land a few base
 * units above the balance and the rejection reads as an allowance error.
 */
function spendableCents(wanted: number, available: bigint) {
  const wantedUnits = BigInt(Math.max(0, Math.floor(wanted * 1e6)));
  const units = wantedUnits < available ? wantedUnits : available;
  return Number(units / 10_000n) / 100;
}

function friendlyError(err: unknown, fallback: string) {
  if (isUserRejection(err)) return "Wallet request was cancelled.";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/insufficient funds|gas/i.test(message) && !/gasless/i.test(message)) {
    return "This wallet needs a little ETH on Robinhood Chain for gas.";
  }
  // The SDK tops up a missing approval and retries before surfacing this, so a
  // rejection that reaches us is a balance shortfall, not a missing approval.
  if (/allowance|not enough balance/i.test(message)) {
    return "Polymarket rejected the order because the proxy balance did not cover it. Your pUSD is safe — tap Buy again.";
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
    throw new Error(
      friendlyError(err, "Could not derive the Polymarket proxy wallet."),
    );
  }
  if (funder.toLowerCase() === trader.toLowerCase()) {
    throw new Error("Could not derive the Polymarket proxy wallet.");
  }
  saveDepositWallet(trader, funder);

  let tradingProvider: Eip1193;
  try {
    tradingProvider = (await input.tradingWallet.getEthereumProvider()) as Eip1193;
  } catch (err) {
    throw new Error(
      friendlyError(err, "Could not prepare the Polymarket trading wallet."),
    );
  }
  const cashProvider = (await input.cashWallet.getEthereumProvider()) as Eip1193;

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
    console.error("[hedge] Polymarket L1 credentials failed", err);
    throw new Error(
      friendlyError(err, "Could not connect this wallet to Polymarket."),
    );
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

    try {
      requestId = await executeRelayQuote(
        cashProvider,
        input.accessToken,
        cash,
        quote,
        { skipChainSwitch: true },
      );
    } catch (err) {
      throw new Error(friendlyError(err, "Could not convert USDG to pUSD."));
    }

    hooks.onStep("convert");
    try {
      await pollRelayStatus(input.accessToken, requestId);
    } catch (err) {
      throw new Error(friendlyError(err, "Conversion is still pending."));
    }

    const arrived = await waitForPusd(
      input.accessToken,
      funder,
      before,
      expectedPusd,
    );
    pusd = Number(Math.min(arrived.balance, Math.max(amount, spendable)).toFixed(6));
    if (pusd < 0.01) {
      throw new LiveTradeError(
        "USDG left this wallet, but pUSD has not arrived in your Polymarket proxy wallet yet. Wait a moment and try again.",
        { depositWallet: funder },
      );
    }
    hooks.onQuote?.(pusd);
    }
  }

  hooks.onStep("fill");
  let depositWallet = funder;
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

    await client.setupTradingApprovals();
    try {
      const { updateBalanceAllowance } = await import("@polymarket/client/actions");
      // AssetType lives in @polymarket/bindings, which the SDK does not
      // re-export; the enum member is this exact string.
      await updateBalanceAllowance(client, {
        assetType: "COLLATERAL" as never,
      });
    } catch (err) {
      console.warn("[hedge] CLOB allowance cache refresh", err);
    }

    const live = await readPusdBalance(input.accessToken, depositWallet);
    pusd = spendableCents(pusd, live.raw);
    if (pusd < 1) {
      throw new LiveTradeError(
        `Your Polymarket proxy wallet holds ${live.pusd.toFixed(2)} pUSD. Polymarket needs at least $1.00 to place an order — add a little more and try Buy again.`,
        { depositWallet, pusdReceived: live.pusd },
      );
    }

    let maxPrice = clobTick(input.marketPrice + 0.05);
    try {
      const estimate = await client.estimateMarketPrice({
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

    const response = await client.placeMarketOrder({
      tokenId: input.tokenId,
      side: OrderSide.BUY,
      amount: pusd,
      maxSpend: pusd,
      maxPrice,
      builderCode: builderCode as Hex,
      orderType: OrderType.FAK,
    });

    if (!response.ok) {
      throw new LiveTradeError(
        `Your ${pusd.toFixed(2)} pUSD is in the Polymarket proxy wallet, but the order was rejected: ${friendlyError(response.message, response.message)}`,
        { depositWallet, pusdReceived: pusd },
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
        `Your ${pusd.toFixed(2)} pUSD is still in the Polymarket proxy wallet, but this outcome had no fillable liquidity.`,
        { depositWallet, pusdReceived: pusd },
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
      `Your ${pusd.toFixed(2)} pUSD is still in the Polymarket proxy wallet. ${friendlyError(err, "Try Buy again to fill from that balance.")}`,
      { depositWallet, pusdReceived: pusd },
    );
  }
}
