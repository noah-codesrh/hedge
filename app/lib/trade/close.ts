import { OrderSide, OrderType, WalletType } from "@polymarket/client";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { encodeFunctionData, erc20Abi } from "viem";
import { POLYGON_CHAIN_ID, PUSD } from "../chains";
import { isUserRejection, sleep, waitForReceipt } from "../evm";
import { isEmbeddedWallet } from "../wallet";
import {
  authedJson,
  embeddedPolygonProvider,
  ensureSecureClient,
  openPolymarketSession,
  readPusd,
  readPusdBalance,
  waitForPusd,
  type TradingClient,
} from "./session";
import {
  pollRelayStatus,
  quotedUsdg,
  relayDepositAddress,
  relayRequestId,
  type RelayQuote,
} from "./relay-steps";

export type CloseStep = "sell" | "move" | "convert" | "arrive";
export type CashOutStep = "move" | "convert" | "arrive";

export type PrivyAuthorizationPayload = {
  version: 1;
  method: "POST";
  url: string;
  body: unknown;
  headers: {
    "privy-app-id": string;
    "privy-request-expiry"?: string;
  };
};

export type SignPrivyAuthorization = (
  payload: PrivyAuthorizationPayload,
) => Promise<string>;

export type CloseInput = {
  tokenId: string;
  shares: number;
  marketPrice: number;
  cashAddress: string;
  accessToken: string;
  tradingWallet: ConnectedWallet;
  signAuthorization: SignPrivyAuthorization;
};

export type CashOutInput = {
  cashAddress: string;
  accessToken: string;
  tradingWallet: ConnectedWallet;
  signAuthorization: SignPrivyAuthorization;
};

export type CloseResult = {
  sharesSold: number;
  pusd: number;
  usdg: number;
  conversionId: string | null;
  depositWallet: string;
};

export class CloseError extends Error {
  sold?: boolean;
  pusdHeld?: number;
  constructor(message: string, extra?: { sold?: boolean; pusdHeld?: number }) {
    super(message);
    this.name = "CloseError";
    this.sold = extra?.sold;
    this.pusdHeld = extra?.pusdHeld;
  }
}

const MIN_CONVERT = 1;

function friendlyCloseError(err: unknown, fallback: string) {
  if (isUserRejection(err)) return "Wallet request was cancelled.";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/derive api key|create api key|\/auth\/(?:derive-)?api-key/i.test(message)) {
    return "Could not connect this wallet to Polymarket. Try again.";
  }
  if (/trading is disabled|clob.*maintenance/i.test(message)) {
    return "Polymarket trading is down for maintenance. Try Close again in a few minutes.";
  }
  if (
    /insufficient funds/i.test(message) &&
    !/gasless/i.test(message)
  ) {
    return "Could not sponsor Polygon gas for this hop. Add a small Privy gas-credit limit, then try Cash out again.";
  }
  return message || fallback;
}

async function requireClob(token: string) {
  try {
    const clob = await authedJson<{ ok?: boolean }>(token, "/api/pm/status");
    if (clob.ok === false) {
      throw new Error(
        "Polymarket trading is down for maintenance. Try again after clob.polymarket.com is back.",
      );
    }
  } catch (err) {
    if (/trading is down for maintenance/i.test(String(err))) throw err;
  }
}

async function readUsdg(address: string) {
  const res = await fetch(`/api/assets?address=${encodeURIComponent(address)}`);
  const data = (await res.json().catch(() => null)) as {
    assets?: { symbol?: string; balance?: number }[];
  } | null;
  const row = data?.assets?.find((a) => a.symbol === "USDG");
  return typeof row?.balance === "number" && Number.isFinite(row.balance)
    ? row.balance
    : 0;
}

async function waitForUsdg(address: string, before: number, expected: number | null) {
  const target = Math.max(0.01, (expected ?? 0) * 0.9);
  const started = Date.now();
  let latest = before;
  while (Date.now() - started < 45_000) {
    latest = await readUsdg(address);
    const gained = latest - before;
    if (gained >= target || (expected == null && gained > 0.005)) {
      return { balance: latest, gained };
    }
    await sleep(1_000);
  }
  return { balance: latest, gained: Math.max(0, latest - before) };
}

async function sellPosition(
  client: TradingClient,
  input: CloseInput,
  builderCode: string,
) {
  const shares = Number(Math.max(0, input.shares).toFixed(6));
  if (shares < 0.01) throw new Error("This position is too small to close.");

  let minPrice = Math.max(0.01, input.marketPrice - 0.05);
  try {
    const estimate = await client.estimateMarketPrice({
      tokenId: input.tokenId,
      side: OrderSide.SELL,
      shares,
      orderType: OrderType.FAK,
    });
    if (Number.isFinite(estimate) && estimate > 0) {
      minPrice = Math.max(0.01, Math.floor((estimate - 0.02) * 100) / 100);
    }
  } catch {
    /* use UI price buffer */
  }

  const response = await client.placeMarketOrder({
    tokenId: input.tokenId,
    side: OrderSide.SELL,
    shares,
    minPrice,
    builderCode: builderCode as `0x${string}`,
    orderType: OrderType.FAK,
  });

  if (!response.ok) {
    throw new Error(
      friendlyCloseError(response.message, response.message) ||
        "The sell order was rejected.",
    );
  }

  try {
    await client.waitForOrderFillSettlement(response, { timeoutMs: 15_000 });
  } catch {
    /* matched fills can settle asynchronously */
  }

  const taking = Number(response.takingAmount);
  const making = Number(response.makingAmount);
  const pusd = Number.isFinite(taking) && taking > 0 ? taking : 0;
  const sold = Number.isFinite(making) && making > 0 ? making : 0;
  if (pusd <= 0 && sold <= 0) {
    throw new Error("This outcome had no fillable liquidity.");
  }
  return {
    sharesSold: sold > 0 ? sold : shares,
    pusd,
    orderId: String(response.orderId ?? "") || null,
  };
}

async function finishConversion(
  accessToken: string,
  cashAddress: string,
  beforeUsdg: number,
  requestId: string,
  expected: number | null,
  pusdHeld: number,
  onArrive: () => void,
) {
  onArrive();
  try {
    await pollRelayStatus(accessToken, requestId);
  } catch (err) {
    throw new CloseError(
      friendlyCloseError(err, "Conversion is still pending."),
      { sold: true, pusdHeld },
    );
  }
  const arrived = await waitForUsdg(cashAddress, beforeUsdg, expected);
  const usdg =
    arrived.gained > 0.005 ? arrived.gained : expected ?? pusdHeld;
  return { usdg, conversionId: requestId };
}

async function convertProxyViaRelay(input: {
  accessToken: string;
  cashAddress: string;
  funder: string;
  client: TradingClient;
  proxy: Awaited<ReturnType<typeof readPusdBalance>>;
  beforeUsdg: number;
  onArrive: () => void;
}) {
  let quote: RelayQuote;
  try {
    quote = await authedJson<RelayQuote>(input.accessToken, "/api/relay/quote", {
      method: "POST",
      body: JSON.stringify({
        user: input.cashAddress,
        recipient: input.cashAddress,
        amount: input.proxy.raw.toString(),
        direction: "out",
        mode: "deposit",
        refundTo: input.funder,
      }),
    });
  } catch (err) {
    throw new CloseError(
      `pUSD is still in the Polymarket proxy. ${friendlyCloseError(err, "Relay could not quote a cash-out route.")}`,
      { sold: true, pusdHeld: input.proxy.pusd },
    );
  }
  const dest = relayDepositAddress(quote);
  const requestId = relayRequestId(quote);
  if (!dest || !requestId) {
    throw new CloseError(
      "Relay did not return a deposit address. Try Cash out again.",
      { sold: true, pusdHeld: input.proxy.pusd },
    );
  }
  try {
    const handle = await input.client.transferErc20({
      amount: input.proxy.raw,
      recipientAddress: dest as `0x${string}`,
      tokenAddress: PUSD,
      metadata: "Hedge cash out pUSD to Relay",
    });
    await handle.wait();
  } catch (err) {
    throw new CloseError(
      `pUSD is still in the Polymarket proxy. ${friendlyCloseError(err, "Polymarket relayer could not send pUSD to Relay.")}`,
      { sold: true, pusdHeld: input.proxy.pusd },
    );
  }
  return finishConversion(
    input.accessToken,
    input.cashAddress,
    input.beforeUsdg,
    requestId,
    quotedUsdg(quote),
    input.proxy.pusd,
    input.onArrive,
  );
}

async function sendPusdFromTrader(input: {
  accessToken: string;
  tradingWallet: ConnectedWallet;
  recipient: string;
  amount: bigint;
  signAuthorization: SignPrivyAuthorization;
}) {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [input.recipient as `0x${string}`, input.amount],
  });
  const tx = {
    from: input.tradingWallet.address,
    to: PUSD,
    data,
    chainId: POLYGON_CHAIN_ID,
  };
  const prepared = await authedJson<{
    hash?: string;
    requestExpiry?: number;
    payload?: PrivyAuthorizationPayload;
  }>(input.accessToken, "/api/pm/sponsor-tx", {
    method: "POST",
    body: JSON.stringify(tx),
  });
  let hash = typeof prepared.hash === "string" ? prepared.hash : "";
  if (!hash && prepared.payload) {
    const signature = await input.signAuthorization(prepared.payload);
    const submitted = await authedJson<{ hash?: string }>(
      input.accessToken,
      "/api/pm/sponsor-tx",
      {
        method: "POST",
        body: JSON.stringify({
          ...tx,
          signature,
          requestExpiry: prepared.requestExpiry,
        }),
      },
    );
    hash = typeof submitted.hash === "string" ? submitted.hash : "";
  }
  if (hash.length === 66) {
    const provider = await embeddedPolygonProvider(input.tradingWallet);
    await waitForReceipt(provider, hash);
  } else {
    await sleep(2_500);
  }
}

function requireGaslessClient(client: TradingClient) {
  if (
    client.account.walletType === WalletType.EOA ||
    client.account.wallet.toLowerCase() === client.account.signer.toLowerCase()
  ) {
    throw new Error("Could not open the Polymarket proxy wallet.");
  }
}

async function convertPusdToUsdg(input: {
  accessToken: string;
  tradingWallet: ConnectedWallet;
  trader: string;
  funder: string;
  cashAddress: string;
  client: TradingClient;
  pusd: number;
  signAuthorization: SignPrivyAuthorization;
  onStep: (step: CashOutStep) => void;
}) {
  requireGaslessClient(input.client);
  input.onStep("move");

  const traderHeld = await readPusdBalance(input.accessToken, input.trader);
  if (traderHeld.raw > 0n && traderHeld.pusd >= 0.01) {
    const beforeProxy = await readPusd(input.accessToken, input.funder);
    try {
      await sendPusdFromTrader({
        accessToken: input.accessToken,
        tradingWallet: input.tradingWallet,
        recipient: input.funder,
        amount: traderHeld.raw,
        signAuthorization: input.signAuthorization,
      });
      await waitForPusd(
        input.accessToken,
        input.funder,
        beforeProxy,
        traderHeld.pusd,
      );
    } catch (err) {
      throw new CloseError(
        friendlyCloseError(err, "Could not move pUSD into the Polymarket proxy."),
        { sold: true, pusdHeld: traderHeld.pusd },
      );
    }
  }

  input.onStep("convert");
  const proxy = await readPusdBalance(input.accessToken, input.funder);
  if (proxy.raw <= 0n || proxy.pusd < MIN_CONVERT) {
    throw new CloseError(
      `pUSD is ${Math.max(proxy.pusd, traderHeld.pusd, input.pusd).toFixed(2)}. Convert needs at least $1 in the Polymarket proxy — tap Cash out again.`,
      { sold: true, pusdHeld: Math.max(proxy.pusd, traderHeld.pusd, input.pusd) },
    );
  }

  const beforeUsdg = await readUsdg(input.cashAddress);
  const result = await convertProxyViaRelay({
    accessToken: input.accessToken,
    cashAddress: input.cashAddress,
    funder: input.funder,
    client: input.client,
    proxy,
    beforeUsdg,
    onArrive: () => input.onStep("arrive"),
  });
  return { ...result, pusd: proxy.pusd };
}

export async function runCashOut(
  input: CashOutInput,
  hooks: { onStep: (step: CashOutStep) => void },
): Promise<CloseResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.cashAddress)) {
    throw new Error("Connect the wallet that holds your USDG.");
  }
  if (!isEmbeddedWallet(input.tradingWallet.walletClientType)) {
    throw new Error("Could not create a trading wallet.");
  }

  hooks.onStep("move");
  let session;
  try {
    session = await openPolymarketSession({
      tradingWallet: input.tradingWallet,
      accessToken: input.accessToken,
    });
  } catch (err) {
    throw new Error(friendlyCloseError(err, "Could not open the Polymarket proxy wallet."));
  }

  const signerPusd = await readPusd(input.accessToken, session.trader);
  const proxyPusd = await readPusd(input.accessToken, session.funder);
  if (signerPusd + proxyPusd < 0.01) {
    throw new Error("No pUSD to cash out.");
  }

  const client = await ensureSecureClient(session);
  const converted = await convertPusdToUsdg({
    accessToken: input.accessToken,
    tradingWallet: input.tradingWallet,
    trader: session.trader,
    funder: session.funder,
    cashAddress: input.cashAddress,
    client,
    pusd: signerPusd + proxyPusd,
    signAuthorization: input.signAuthorization,
    onStep: hooks.onStep,
  });

  return {
    sharesSold: 0,
    pusd: converted.pusd,
    usdg: converted.usdg,
    conversionId: converted.conversionId,
    depositWallet: session.funder,
  };
}

export async function runClosePosition(
  input: CloseInput,
  hooks: { onStep: (step: CloseStep) => void },
): Promise<CloseResult> {
  if (!input.tokenId) throw new Error("This outcome is not tradeable yet.");
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.cashAddress)) {
    throw new Error("Connect the wallet that holds your USDG.");
  }
  if (!isEmbeddedWallet(input.tradingWallet.walletClientType)) {
    throw new Error("Could not create a trading wallet.");
  }

  hooks.onStep("sell");
  await requireClob(input.accessToken);

  let session;
  try {
    session = await openPolymarketSession({
      tradingWallet: input.tradingWallet,
      accessToken: input.accessToken,
    });
  } catch (err) {
    throw new Error(friendlyCloseError(err, "Could not open the Polymarket proxy wallet."));
  }

  const { builderCode } = await authedJson<{ builderCode: string }>(
    input.accessToken,
    "/api/pm/config",
  );
  const beforeProxy = await readPusd(input.accessToken, session.funder);

  let sold;
  let client: TradingClient;
  try {
    client = await ensureSecureClient(session);
    try {
      await embeddedPolygonProvider(input.tradingWallet);
    } catch {
      /* gasless sell does not require POL */
    }
    await client.setupTradingApprovals();
    sold = await sellPosition(client, input, builderCode);
  } catch (err) {
    throw new Error(friendlyCloseError(err, "Could not sell this position."));
  }

  hooks.onStep("move");
  const arrived = await waitForPusd(
    input.accessToken,
    session.funder,
    beforeProxy,
    sold.pusd > 0 ? sold.pusd : null,
  );
  const pusd = Math.max(arrived.balance, sold.pusd, arrived.gained);

  try {
    const converted = await convertPusdToUsdg({
      accessToken: input.accessToken,
      tradingWallet: input.tradingWallet,
      trader: session.trader,
      funder: session.funder,
      cashAddress: input.cashAddress,
      client,
      pusd,
      signAuthorization: input.signAuthorization,
      onStep: (step) => hooks.onStep(step),
    });

    return {
      sharesSold: sold.sharesSold,
      pusd: converted.pusd,
      usdg: converted.usdg,
      conversionId: converted.conversionId,
      depositWallet: session.funder,
    };
  } catch (err) {
    if (err instanceof CloseError) throw err;
    throw new CloseError(
      `Position sold. pUSD is still in the Polymarket wallet. ${friendlyCloseError(err, "Tap Cash out to convert it to USDG.")}`,
      { sold: true, pusdHeld: pusd },
    );
  }
}
