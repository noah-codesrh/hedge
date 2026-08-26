import {
  createPublicClient,
  createSecureClient,
  relayerApiKey,
  remoteBuilderSigning,
  type ApiKeyAuthorization,
} from "@polymarket/client";
import { createOrDeriveApiKey } from "@polymarket/client/actions";
import { signerFrom } from "@polymarket/client/viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { createWalletClient, custom, getAddress, type Hex } from "viem";
import { POLYGON_ADD_CHAIN, POLYGON_CHAIN_HEX, POLYGON_CHAIN_ID, polygon } from "../chains";
import { ensureChain, sleep, type Eip1193 } from "../evm";
import { resolvePolymarketFunder } from "../pm-funder";
import { saveDepositWallet } from "../pm-wallet";
import { isEmbeddedWallet } from "../wallet";
import {
  clearTradingCreds,
  loadTradingCreds,
  saveTradingCreds,
  type StoredApiCreds,
} from "./creds";

export type TradingClient = Awaited<ReturnType<typeof createSecureClient>>;

export type PolymarketSession = {
  trader: Hex;
  funder: string;
  walletClient: ReturnType<typeof createWalletClient>;
  signer: ReturnType<typeof signerFrom>;
  signing: ApiKeyAuthorization;
  creds: StoredApiCreds;
  tradingProvider: Eip1193;
  clientPromise: Promise<TradingClient | null>;
};

export async function authedJson<T>(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(err);
  }
  return data as T;
}

type RelayerAuthRequest = {
  body?: string;
  method: string;
  path: string;
};

function headerMap(value: HeadersInit) {
  const headers = new Headers(value);
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function authorize(
  auth: ApiKeyAuthorization,
  request: RelayerAuthRequest,
): Promise<HeadersInit> {
  return (
    auth as ApiKeyAuthorization & {
      authorize(request: RelayerAuthRequest): Promise<HeadersInit>;
    }
  ).authorize(request);
}

/**
 * Builder HMAC for CLOB attribution, plus Relayer API key so proxy
 * transfers/approvals go through Polymarket's gasless relayer (no POL).
 * https://docs.polymarket.com/trading/gasless
 */
export function polymarketAuth(accessToken: string): ApiKeyAuthorization {
  const builder = remoteBuilderSigning({
    url: "/api/pm/builder-sign",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  let relayer: ReturnType<typeof relayerApiKey> | null | undefined;

  const loadRelayer = async () => {
    if (relayer !== undefined) return relayer;
    try {
      const cfg = await authedJson<{ key?: string; address?: string }>(
        accessToken,
        "/api/pm/relayer-key",
      );
      if (
        typeof cfg.key === "string" &&
        cfg.key &&
        typeof cfg.address === "string" &&
        /^0x[a-fA-F0-9]{40}$/.test(cfg.address)
      ) {
        relayer = relayerApiKey({ key: cfg.key, address: cfg.address });
      } else {
        relayer = null;
      }
    } catch {
      relayer = null;
    }
    return relayer;
  };

  return {
    get isBuilderKey() {
      return true;
    },
    get supportGasless() {
      return true;
    },
    async authorize(request: RelayerAuthRequest) {
      const [builderHeaders, relayerAuth] = await Promise.all([
        authorize(builder, request),
        loadRelayer(),
      ]);
      if (!relayerAuth) return builderHeaders;
      return {
        ...headerMap(builderHeaders),
        ...headerMap(await authorize(relayerAuth, request)),
      };
    },
  } as ApiKeyAuthorization;
}

export function tokenBaseUnits(amount: number) {
  const raw = Math.round(amount * 10 ** 6);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error("Enter a valid amount.");
  }
  return BigInt(raw).toString();
}

export function storedCreds(value: {
  key?: unknown;
  apiKey?: unknown;
  secret?: unknown;
  passphrase?: unknown;
} | null | undefined): StoredApiCreds | undefined {
  const key = value?.key ?? value?.apiKey;
  if (!key || !value?.secret || !value?.passphrase) return undefined;
  return {
    key: String(key),
    secret: String(value.secret),
    passphrase: String(value.passphrase),
  };
}

const CLOB_AUTH_MESSAGE =
  "This message attests that I control the given wallet";

export async function createClobCredentials(
  walletClient: ReturnType<typeof createWalletClient>,
  signerAddress: Hex,
): Promise<StoredApiCreds> {
  const address = getAddress(signerAddress);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await walletClient.signTypedData({
    account: address,
    domain: {
      name: "ClobAuthDomain",
      version: "1",
      chainId: 137,
    },
    types: {
      ClobAuth: [
        { name: "address", type: "address" },
        { name: "timestamp", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "message", type: "string" },
      ],
    },
    primaryType: "ClobAuth",
    message: {
      address,
      timestamp: String(timestamp),
      nonce: 0n,
      message: CLOB_AUTH_MESSAGE,
    },
  });

  const creds = await createOrDeriveApiKey(createPublicClient(), {
    address: address as never,
    nonce: 0,
    signature: signature as never,
    timestamp,
  });
  const stored = storedCreds(creds);
  if (!stored) {
    throw new Error("Polymarket did not return trading credentials.");
  }
  return stored;
}

export async function openTradingClient(
  signer: ReturnType<typeof signerFrom>,
  signing: ApiKeyAuthorization,
  creds: StoredApiCreds,
  funder: string,
) {
  try {
    return await createSecureClient({
      signer,
      credentials: creds as never,
      apiKey: signing,
      wallet: funder,
    });
  } catch (err) {
    console.warn("[hedge] Builder session with explicit funder failed", err);
    return createSecureClient({
      signer,
      credentials: creds as never,
      apiKey: signing,
    });
  }
}

/** Silent for Privy embedded (`showWalletUIs: false`). Needed for CLOB approvals. */
export async function embeddedPolygonProvider(wallet: ConnectedWallet) {
  const provider = (await wallet.getEthereumProvider()) as Eip1193;
  const current = await provider.request({ method: "eth_chainId" }).catch(() => null);
  try {
    if (current != null && BigInt(current as string) === BigInt(POLYGON_CHAIN_HEX)) {
      return provider;
    }
  } catch {
    /* read chain id and switch below */
  }
  try {
    await wallet.switchChain(POLYGON_CHAIN_ID);
  } catch {
    await ensureChain(provider, POLYGON_ADD_CHAIN);
  }
  return (await wallet.getEthereumProvider()) as Eip1193;
}

export async function readPusdBalance(token: string, wallet: string) {
  const data = await authedJson<{ pusd?: number; raw?: string }>(
    token,
    `/api/pm/balance?wallet=${encodeURIComponent(wallet)}`,
  );
  const pusd =
    typeof data.pusd === "number" && Number.isFinite(data.pusd) ? data.pusd : 0;
  let raw = 0n;
  try {
    raw = BigInt(data.raw ?? "0");
  } catch {
    raw = BigInt(Math.max(0, Math.round(pusd * 1e6)));
  }
  return { pusd, raw };
}

export async function readPusd(token: string, wallet: string) {
  return (await readPusdBalance(token, wallet)).pusd;
}

export async function waitForPusd(
  token: string,
  wallet: string,
  before: number,
  expected: number | null,
) {
  const target = Math.max(0.01, (expected ?? 0) * 0.9);
  const started = Date.now();
  let latest = before;
  while (Date.now() - started < 45_000) {
    latest = await readPusd(token, wallet);
    const gained = latest - before;
    if (gained >= target || (expected == null && gained > 0.005)) {
      return { balance: latest, gained };
    }
    await sleep(1_000);
  }
  return { balance: latest, gained: Math.max(0, latest - before) };
}

export async function openPolymarketSession(input: {
  tradingWallet: ConnectedWallet;
  accessToken: string;
}): Promise<PolymarketSession> {
  const trader = input.tradingWallet.address as Hex;
  if (!isEmbeddedWallet(input.tradingWallet.walletClientType)) {
    throw new Error("Could not create a trading wallet.");
  }

  const funder = await resolvePolymarketFunder(trader);
  if (funder.toLowerCase() === trader.toLowerCase()) {
    throw new Error("Could not derive the Polymarket proxy wallet.");
  }
  saveDepositWallet(trader, funder);

  const tradingProvider = (await input.tradingWallet.getEthereumProvider()) as Eip1193;
  const walletClient = createWalletClient({
    account: trader,
    chain: polygon,
    transport: custom(tradingProvider),
  });
  const signer = signerFrom(walletClient);
  const signing = polymarketAuth(input.accessToken);

  let creds = loadTradingCreds(trader);
  if (!creds) {
    creds = await createClobCredentials(walletClient, trader);
    saveTradingCreds(trader, creds);
  }

  const clientPromise = openTradingClient(
    signer,
    signing,
    creds,
    funder,
  ).catch((err) => {
    console.warn("[hedge] Polymarket proxy session deferred", err);
    return null;
  });

  return {
    trader,
    funder,
    walletClient,
    signer,
    signing,
    creds,
    tradingProvider,
    clientPromise,
  };
}

export async function ensureSecureClient(session: PolymarketSession) {
  let { creds } = session;
  let client = await session.clientPromise;
  if (
    !client ||
    client.account.wallet.toLowerCase() === session.trader.toLowerCase()
  ) {
    try {
      client = await openTradingClient(
        session.signer,
        session.signing,
        creds,
        session.funder,
      );
    } catch (err) {
      console.warn("[hedge] Retrying Polymarket session with fresh L1 keys", err);
      clearTradingCreds(session.trader);
      creds = await createClobCredentials(session.walletClient, session.trader);
      saveTradingCreds(session.trader, creds);
      session.creds = creds;
      client = await openTradingClient(
        session.signer,
        session.signing,
        creds,
        session.funder,
      );
    }
  }
  if (client.account.wallet.toLowerCase() === session.trader.toLowerCase()) {
    throw new Error("Could not open the Polymarket proxy wallet.");
  }
  const sessionCreds = storedCreds(client.credentials);
  if (sessionCreds) {
    saveTradingCreds(session.trader, sessionCreds);
    session.creds = sessionCreds;
  }
  if (client.account.wallet.toLowerCase() !== session.funder.toLowerCase()) {
    saveDepositWallet(session.trader, client.account.wallet);
  }
  return client;
}
