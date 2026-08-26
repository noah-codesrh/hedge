import type { AddableChain } from "./chains";

export type Eip1193 = {
  request: (args: { method: string; params?: any }) => Promise<any>;
};

export function toHexQuantity(value: unknown): `0x${string}` {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "0x" || trimmed === "0") return "0x0";
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
      return (trimmed.length === 2 ? "0x0" : trimmed.toLowerCase()) as `0x${string}`;
    }
    if (/^\d+$/.test(trimmed)) return `0x${BigInt(trimmed).toString(16)}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `0x${BigInt(Math.trunc(value)).toString(16)}`;
  }
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  return "0x0";
}

function chainIdOf(value: unknown) {
  try {
    if (value == null || value === "") return null;
    return BigInt(value as string);
  } catch {
    return null;
  }
}

function errorCode(err: unknown): number {
  if (!err || typeof err !== "object") return NaN;
  if ("code" in err) return Number((err as { code: unknown }).code);
  return NaN;
}

function isUnknownChainError(err: unknown) {
  if (errorCode(err) === 4902) return true;
  if (!err || typeof err !== "object" || !("data" in err)) return false;
  const nested = (err as { data?: { originalError?: { code?: unknown } } }).data
    ?.originalError?.code;
  return Number(nested) === 4902;
}

export async function ensureChain(provider: Eip1193, chain: AddableChain) {
  const current = chainIdOf(
    await provider.request({ method: "eth_chainId" }).catch(() => null),
  );
  if (current === BigInt(chain.hex)) return;
  // Don't pop switch/add UI if we can't read the chain — Robinhood and
  // WalletConnect wallets treat that as "reconnect".
  if (current == null) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.hex }],
    });
    return;
  } catch (err) {
    if (errorCode(err) === 4001) throw err;
    if (!isUnknownChainError(err)) throw err;
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: chain.hex,
        chainName: chain.name,
        nativeCurrency: chain.native,
        rpcUrls: [chain.rpcUrl],
        blockExplorerUrls: [chain.explorer],
      },
    ],
  });
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: chain.hex }],
  });
}

export async function waitForReceipt(
  provider: Eip1193,
  hash: string,
  timeoutMs = 180_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") {
        throw new Error("On-chain transaction reverted.");
      }
      return receipt;
    }
    await sleep(1_200);
  }
  throw new Error("Timed out waiting for the transaction to confirm.");
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isUserRejection(err: unknown) {
  if (!err || typeof err !== "object") {
    return typeof err === "string" && /reject|denied|cancel/i.test(err);
  }
  const code = "code" in err ? Number((err as { code: unknown }).code) : NaN;
  if (code === 4001 || code === 5000) return true;
  const message =
    "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  return /user rejected|user denied|rejected the request|cancelled|canceled/i.test(
    message,
  );
}
