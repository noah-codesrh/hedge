import {
  createWalletClient,
  custom,
  getAddress,
  parseSignature,
  serializeSignature,
  type Hex,
} from "viem";
import {
  ensureChain,
  isUserRejection,
  sleep,
  toHexQuantity,
  waitForReceipt,
  type Eip1193,
} from "../evm";
import {
  POLYGON_ADD_CHAIN,
  ROBINHOOD_ADD_CHAIN,
  polygon,
  robinhoodChain,
  type AddableChain,
} from "../chains";

type RelaySignData = {
  signatureKind?: string;
  domain?: Record<string, unknown>;
  types?: Record<string, { name: string; type: string }[]>;
  primaryType?: string;
  value?: string | number | Record<string, unknown>;
  message?: string;
};

type RelayPost = {
  endpoint?: string;
  method?: string;
  body?: unknown;
};

export type RelayStepItem = {
  status?: string;
  data?: {
    from?: string;
    to?: string;
    data?: string;
    value?: string | number | Record<string, unknown>;
    chainId?: number;
    gas?: string | number;
    maxFeePerGas?: string | number;
    maxPriorityFeePerGas?: string | number;
    sign?: RelaySignData;
    post?: RelayPost;
  } & RelaySignData;
  post?: RelayPost;
  check?: {
    endpoint?: string;
    method?: string;
  };
};

export type RelayStep = {
  id?: string;
  kind?: string;
  requestId?: string;
  depositAddress?: string;
  items?: RelayStepItem[];
};

export type RelayQuote = {
  requestId?: string;
  depositAddress?: string;
  steps?: RelayStep[];
  details?: {
    depositAddress?: string;
    currencyOut?: {
      amount?: string;
      currency?: { decimals?: number };
    };
  };
};

function stepKind(step: RelayStep, item: RelayStepItem) {
  const k = (step.kind ?? "").toLowerCase();
  if (k) return k;
  if (item.data?.sign || item.data?.signatureKind || item.data?.post || item.post) {
    return "signature";
  }
  return "transaction";
}

function signData(item: RelayStepItem): RelaySignData | null {
  const data = item.data;
  if (!data) return null;
  if (data.sign && typeof data.sign === "object") return data.sign;
  if (data.signatureKind || data.message || data.types || data.domain) return data;
  return null;
}

function postData(item: RelayStepItem): RelayPost | undefined {
  return item.data?.post ?? item.post;
}

function requestIdFrom(quote: RelayQuote, check?: { endpoint?: string }) {
  if (quote.requestId) return quote.requestId;
  const endpoint = check?.endpoint ?? "";
  const match = /requestId=([^&]+)/.exec(endpoint);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function chainFor(chainId?: number): AddableChain {
  if (chainId === POLYGON_ADD_CHAIN.chainId) return POLYGON_ADD_CHAIN;
  if (chainId === ROBINHOOD_ADD_CHAIN.chainId || chainId == null) {
    return ROBINHOOD_ADD_CHAIN;
  }
  throw new Error(`Unsupported origin chain ${chainId}.`);
}

function viemChain(chainId?: number) {
  return chainFor(chainId).chainId === POLYGON_ADD_CHAIN.chainId
    ? polygon
    : robinhoodChain;
}

function numericChainId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    try {
      return Number(BigInt(value));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function originChain(item: RelayStepItem) {
  const sign = signData(item);
  return chainFor(
    numericChainId(sign?.domain?.chainId) ??
      numericChainId(item.data?.chainId) ??
      ROBINHOOD_ADD_CHAIN.chainId,
  );
}

function typedDomain(domain: Record<string, unknown> | undefined) {
  const next = { ...(domain ?? {}) };
  const chainId = numericChainId(next.chainId);
  if (chainId != null) next.chainId = chainId;
  return next;
}

function normalizeSig(signature: unknown) {
  const raw = typeof signature === "string" ? signature.trim() : "";
  if (!raw.startsWith("0x")) return raw;
  try {
    return serializeSignature(parseSignature(raw as Hex));
  } catch {
    return raw;
  }
}

async function authedFetch(
  token: string,
  url: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");
  const res = await fetch(url, { ...init, headers });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(err);
  }
  return data;
}

async function signItem(provider: Eip1193, from: string, item: RelayStepItem) {
  const data = signData(item);
  if (!data) throw new Error("Relay asked for a signature without payload.");
  const account = getAddress(from);
  const walletClient = createWalletClient({
    account,
    chain: viemChain(numericChainId(data.domain?.chainId) ?? originChain(item).chainId),
    transport: custom(provider),
  });
  const kind = (
    data.signatureKind ??
    (data.types || data.domain ? "eip712" : "eip191")
  ).toLowerCase();
  if (kind === "eip712") {
    const types = { ...(data.types ?? {}) };
    delete (types as { EIP712Domain?: unknown }).EIP712Domain;
    const primaryType = data.primaryType ?? Object.keys(types)[0];
    if (!primaryType) {
      throw new Error("Relay permit is missing its EIP-712 type.");
    }
    const message =
      typeof data.value === "object" && data.value != null ? data.value : {};
    const signature = await walletClient.signTypedData({
      account,
      domain: typedDomain(data.domain),
      types,
      primaryType,
      message,
    } as Parameters<typeof walletClient.signTypedData>[0]);
    return normalizeSig(signature);
  }
  const message =
    typeof data.message === "string"
      ? data.message
      : typeof data.value === "string"
        ? data.value
        : "";
  if (!message) throw new Error("Relay asked for a signature without a message.");
  if (/^0x[0-9a-fA-F]{64}$/.test(message)) {
    return normalizeSig(
      await walletClient.signMessage({
        account,
        message: { raw: message as Hex },
      }),
    );
  }
  return normalizeSig(await walletClient.signMessage({ account, message }));
}

function txCall(item: RelayStepItem) {
  const data = item.data;
  if (!data?.to) throw new Error("Relay transaction is missing a destination.");
  return {
    to: data.to,
    data: data.data || "0x",
    value: toHexQuantity(
      typeof data.value === "object" ? "0" : (data.value ?? "0"),
    ),
    chainId: data.chainId,
    from: data.from,
    gas: data.gas,
    maxFeePerGas: data.maxFeePerGas,
    maxPriorityFeePerGas: data.maxPriorityFeePerGas,
  };
}

async function sendCalls(
  provider: Eip1193,
  from: string,
  items: RelayStepItem[],
  skipChainSwitch = false,
) {
  if (items.length === 0) return;
  const first = txCall(items[0]!);
  if (!skipChainSwitch) await ensureChain(provider, chainFor(first.chainId));
  if (items.length === 1) {
    await sendTx(provider, items[0]!, skipChainSwitch);
    return;
  }
  const calls = items.map((item) => {
    const tx = txCall(item);
    return { to: tx.to, data: tx.data, value: tx.value };
  });
  try {
    const id = await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          from,
          chainId: chainFor(first.chainId).hex,
          atomicRequired: false,
          calls,
        },
      ],
    });
    const hash =
      typeof id === "string"
        ? id
        : id && typeof id === "object" && "id" in id
          ? String((id as { id: unknown }).id)
          : null;
    if (hash && hash.startsWith("0x") && hash.length === 66) {
      await waitForReceipt(provider, hash);
    }
  } catch (err) {
    if (isUserRejection(err)) throw err;
    for (const item of items) await sendTx(provider, item, skipChainSwitch);
  }
}

async function sendTx(
  provider: Eip1193,
  item: RelayStepItem,
  skipChainSwitch = false,
) {
  const data = item.data;
  if (!data?.to) throw new Error("Relay transaction is missing a destination.");
  if (!skipChainSwitch) await ensureChain(provider, chainFor(data.chainId));
  const tx: Record<string, string> = {
    from: data.from ?? "",
    to: data.to,
    data: data.data || "0x",
    value: toHexQuantity(
      typeof data.value === "object" ? "0" : (data.value ?? "0"),
    ),
  };
  if (data.gas != null) tx.gas = toHexQuantity(data.gas);
  if (data.maxFeePerGas != null) tx.maxFeePerGas = toHexQuantity(data.maxFeePerGas);
  if (data.maxPriorityFeePerGas != null) {
    tx.maxPriorityFeePerGas = toHexQuantity(data.maxPriorityFeePerGas);
  }
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [tx],
  })) as string;
  await waitForReceipt(provider, hash);
  return hash;
}

function enqueueSteps(
  queued: { item: RelayStepItem; kind: string }[],
  steps: RelayStep[] | undefined,
) {
  for (const step of steps ?? []) {
    for (const item of step.items ?? []) {
      if (item.status === "complete" || item.status === "completed") continue;
      queued.push({ item, kind: stepKind(step, item) });
    }
  }
}

export async function pollRelayStatus(
  token: string,
  requestId: string,
  timeoutMs = 120_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = (await authedFetch(
      token,
      `/api/relay/status?requestId=${encodeURIComponent(requestId)}`,
    )) as { status?: string };
    const status = (data.status ?? "").toLowerCase();
    if (status === "success" || status === "complete" || status === "completed") {
      return data;
    }
    if (
      status === "failure" ||
      status === "failed" ||
      status === "refund" ||
      status === "refunded"
    ) {
      throw new Error(
        status === "refund" || status === "refunded"
          ? "Relay refunded the conversion. Funds should return to the origin wallet."
          : "Relay could not complete the conversion.",
      );
    }
    await sleep(1_000);
  }
  throw new Error("Timed out waiting for the conversion to finish.");
}

export async function executeRelayQuote(
  provider: Eip1193,
  token: string,
  from: string,
  quote: RelayQuote,
  opts?: { skipChainSwitch?: boolean; signaturesOnly?: boolean },
) {
  const skipChainSwitch = opts?.skipChainSwitch === true;
  const signaturesOnly = opts?.signaturesOnly === true;
  const queued: { item: RelayStepItem; kind: string }[] = [];
  enqueueSteps(queued, quote.steps);

  let requestId = quote.requestId ?? null;
  let i = 0;
  while (i < queued.length) {
    const cur = queued[i]!;
    try {
      if (cur.kind === "signature") {
        // Permit digest includes domain.chainId. Switch only when the wallet
        // is clearly on another chain; skip if already 4663 or chain is unread.
        await ensureChain(provider, originChain(cur.item));
        const signature = await signItem(provider, from, cur.item);
        const post = postData(cur.item);
        if (post?.endpoint) {
          const result = (await authedFetch(token, "/api/relay/forward", {
            method: "POST",
            body: JSON.stringify({
              endpoint: post.endpoint,
              method: post.method ?? "POST",
              body: post.body ?? {},
              signature,
            }),
          })) as { steps?: RelayStep[]; requestId?: string };
          enqueueSteps(queued, result?.steps);
          if (typeof result?.requestId === "string") requestId = result.requestId;
        }
        const body = post?.body;
        if (body && typeof body === "object" && "requestId" in body) {
          const id = (body as { requestId?: unknown }).requestId;
          if (typeof id === "string" && id) requestId = id;
        }
      } else if (cur.kind === "transaction" || cur.kind === "tx") {
        if (signaturesOnly) {
          throw new Error(
            "Relay asked this wallet to send a Polygon transaction. Hedge will not spend POL — use Cash out again so pUSD stays in the proxy.",
          );
        }
        const batch = [cur.item];
        const chainId = cur.item.data?.chainId;
        while (i + 1 < queued.length) {
          const next = queued[i + 1]!;
          if (next.kind !== "transaction" && next.kind !== "tx") break;
          if (
            next.item.data?.chainId != null &&
            chainId != null &&
            next.item.data.chainId !== chainId
          ) {
            break;
          }
          batch.push(next.item);
          i += 1;
        }
        await sendCalls(provider, from, batch, skipChainSwitch);
      }
    } catch (err) {
      if (isUserRejection(err)) {
        throw new Error("Wallet request was cancelled.");
      }
      throw err instanceof Error ? err : new Error("Relay step failed.");
    }
    requestId = requestIdFrom(quote, cur.item.check) ?? requestId;
    i += 1;
  }

  if (!requestId) throw new Error("Relay did not return a request id.");
  return requestId;
}

export function quotedPusd(quote: RelayQuote) {
  const raw = quote.details?.currencyOut?.amount;
  const decimals = quote.details?.currencyOut?.currency?.decimals ?? 6;
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return Number.isFinite(n) ? n : null;
}

export const quotedUsdg = quotedPusd;

const ADDR = /^0x[a-fA-F0-9]{40}$/;

export function relayDepositAddress(quote: RelayQuote) {
  const candidates = [
    quote.depositAddress,
    quote.details?.depositAddress,
    ...(quote.steps ?? []).map((step) => step.depositAddress),
    ...(quote.steps ?? []).flatMap((step) =>
      step.id === "deposit" || step.kind === "deposit"
        ? (step.items ?? []).map((item) => item.data?.to)
        : [],
    ),
  ];
  for (const value of candidates) {
    if (typeof value === "string" && ADDR.test(value)) return value;
  }
  return null;
}

export function relayRequestId(quote: RelayQuote) {
  if (typeof quote.requestId === "string" && quote.requestId) return quote.requestId;
  for (const step of quote.steps ?? []) {
    if (typeof step.requestId === "string" && step.requestId) return step.requestId;
    for (const item of step.items ?? []) {
      const id = requestIdFrom(quote, item.check);
      if (id) return id;
    }
  }
  return null;
}
