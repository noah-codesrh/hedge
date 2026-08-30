import type { Route } from "./+types/api.rh.cash-in";
import { getAddress } from "viem";
import {
  embeddedWalletId,
  privyAdmin,
  requirePrivyUser,
} from "../lib/server/privy-auth";
import { missingSecrets, serverSecrets } from "../lib/server/secrets";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
const PRIVY_API = "https://api.privy.io";
const SIGN_WINDOW_MS = 3 * 60 * 1000;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MIN_USDC = 500_000n;
const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base.drpc.org",
];

function transferError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  console.error("[rh-cash-in]", err);
  if (/invalid jwt|invalid_data/i.test(message)) {
    return "Could not authorize this wallet. Sign in again and retry.";
  }
  if (/authorization-signature|authorization signature|no signatures/i.test(message)) {
    return "Could not authorize this conversion. Trying again.";
  }
  if (/insufficient|balance/i.test(message)) {
    return "waiting";
  }
  return message || "Could not convert the deposit to USDG.";
}

function decimalFromRaw(raw: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

function encodeBalanceOf(owner: string) {
  return `0x70a08231${owner.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}

async function rpcCall(url: string, body: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("rpc returned html");
  const data: unknown = JSON.parse(text);
  const err = (data as { error?: { message?: string } }).error;
  if (err) throw new Error(err.message ?? "RPC failed");
  return (data as { result?: string }).result || "0x0";
}

async function baseUsdcRaw(owner: string) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: BASE_USDC, data: encodeBalanceOf(owner) }, "latest"],
  });
  let last: Error | null = null;
  for (let round = 0; round < 3; round++) {
    for (const url of BASE_RPCS) {
      try {
        return BigInt(await rpcCall(url, body));
      } catch (e) {
        last = e instanceof Error ? e : new Error("RPC failed");
      }
    }
  }
  throw last ?? new Error("RPC failed");
}

type TransferBody = ReturnType<typeof transferBody>;

function transferBody(address: string, amount: string, variant: number) {
  const destination = {
    address,
    asset: "usdg" as const,
    chain: "robinhood" as const,
  };
  const shared = {
    destination,
    amount,
    amount_type: "exact_input" as const,
    slippage_bps: 150,
  };
  if (variant % 2 === 1) {
    return {
      ...shared,
      source: { asset_address: BASE_USDC, chain: "base" as const },
    };
  }
  return {
    ...shared,
    source: { asset: "usdc" as const, chain: "base" as const },
  };
}

async function sendTransfer(
  walletId: string,
  rpc: TransferBody,
  signature: string,
  requestExpiry: number,
) {
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return await privyAdmin().wallets()._transfer(walletId, {
        ...rpc,
        "privy-authorization-signature": signature,
        "privy-request-expiry": String(requestExpiry),
      });
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : String(err ?? "");
      if (/authorization|invalid jwt|unsupported|not supported/i.test(message)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)));
    }
  }
  throw last;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (missingSecrets(["privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Deposits are not configured." }, { status: 503 });
  }

  const { userId, user } = await requirePrivyUser(request);
  const { privyAppId } = serverSecrets();
  if (!privyAppId) {
    return Response.json({ error: "Deposits are not configured." }, { status: 503 });
  }

  let body: {
    from?: unknown;
    amount?: unknown;
    signature?: unknown;
    requestExpiry?: unknown;
    variant?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const from = typeof body.from === "string" ? body.from.trim() : "";
  if (!ADDR.test(from)) {
    return Response.json({ error: "Invalid wallet address." }, { status: 400 });
  }

  const walletId = await embeddedWalletId(userId, from, user);
  if (!walletId) {
    return Response.json(
      {
        error:
          "Automatic conversion only runs on your Hedge wallet. Use Transfer Crypto for an external wallet.",
      },
      { status: 403 },
    );
  }

  const address = getAddress(from);
  const signature =
    typeof body.signature === "string" ? body.signature.trim() : "";
  const variant = Number(body.variant);
  const route = Number.isFinite(variant) && variant > 0 ? Math.floor(variant) : 0;

  let usdc: bigint;
  try {
    usdc = await baseUsdcRaw(address);
  } catch (err) {
    console.error("[rh-cash-in] base usdc", err);
    return Response.json({ status: "waiting", usdc: "0" });
  }

  if (!signature) {
    if (usdc < MIN_USDC) {
      return Response.json({
        status: "waiting",
        usdc: decimalFromRaw(usdc, 6),
      });
    }
    const amount = decimalFromRaw(usdc, 6);
    const rpc = transferBody(address, amount, route);
    const requestExpiry = Date.now() + SIGN_WINDOW_MS;
    return Response.json({
      status: "ready",
      amount,
      variant: route,
      requestExpiry,
      payload: {
        version: 1,
        method: "POST",
        url: `${PRIVY_API}/v1/wallets/${walletId}/transfer`,
        body: rpc,
        headers: {
          "privy-app-id": privyAppId,
          "privy-request-expiry": String(requestExpiry),
        },
      },
    });
  }

  const amount = typeof body.amount === "string" ? body.amount.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    return Response.json({ error: "Invalid conversion amount." }, { status: 400 });
  }
  const requestExpiry = Number(body.requestExpiry);
  if (!Number.isFinite(requestExpiry) || requestExpiry <= Date.now()) {
    return Response.json({ status: "waiting", usdc: decimalFromRaw(usdc, 6) });
  }

  const rpc = transferBody(address, amount, route);
  try {
    const result = await sendTransfer(walletId, rpc, signature, requestExpiry);
    return Response.json({
      status: "sent",
      id: result.id,
      amount,
    });
  } catch (err) {
    const message = transferError(err);
    if (message === "waiting") {
      return Response.json({ status: "waiting", usdc: decimalFromRaw(usdc, 6) });
    }
    return Response.json({ error: message }, { status: 502 });
  }
}
