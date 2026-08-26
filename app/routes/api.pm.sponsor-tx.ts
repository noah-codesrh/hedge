import type { Route } from "./+types/api.pm.sponsor-tx";
import { decodeFunctionData, erc20Abi, getAddress } from "viem";
import { POLYGON_CHAIN_ID, PUSD } from "../lib/chains";
import { deriveDepositWallet } from "../lib/pm-funder";
import { privyAdmin, requirePrivyUser } from "../lib/server/privy-auth";
import { missingSecrets, serverSecrets } from "../lib/server/secrets";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
const DATA = /^0x[a-fA-F0-9]*$/;
const PRIVY_API = "https://api.privy.io";
const SIGN_WINDOW_MS = 3 * 60 * 1000;

function linkedEmbeddedWalletId(
  user: {
    linked_accounts?: Array<{
      type?: string;
      id?: string | null;
      address?: string;
      connector_type?: string;
      wallet_client_type?: string;
    }>;
  },
  address: string,
) {
  const target = address.toLowerCase();
  for (const account of user.linked_accounts ?? []) {
    if (account.type !== "wallet") continue;
    if (account.address?.toLowerCase() !== target) continue;
    const embedded =
      account.connector_type === "embedded" ||
      account.wallet_client_type === "privy";
    if (embedded && typeof account.id === "string" && account.id) {
      return account.id;
    }
  }
  return null;
}

async function embeddedWalletId(
  userId: string,
  address: string,
  user: Parameters<typeof linkedEmbeddedWalletId>[0],
) {
  const linked = linkedEmbeddedWalletId(user, address);
  if (linked) return linked;

  const target = address.toLowerCase();
  for await (const wallet of privyAdmin().wallets().list({
    user_id: userId,
    address: getAddress(address),
    chain_type: "ethereum",
  })) {
    if (wallet.address.toLowerCase() === target) return wallet.id;
  }
  return null;
}

function rpcBody(data: `0x${string}`) {
  return {
    method: "eth_sendTransaction" as const,
    caip2: "eip155:137" as const,
    chain_type: "ethereum" as const,
    sponsor: true,
    params: {
      transaction: {
        to: getAddress(PUSD),
        data,
        chain_id: POLYGON_CHAIN_ID,
      },
    },
  };
}

function sponsorError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  console.error("[sponsor-tx]", err);
  if (/invalid jwt|invalid_data/i.test(message)) {
    return "Could not authorize the trading wallet. Sign in again and retry cash out.";
  }
  if (/authorization-signature|authorization signature|no signatures/i.test(message)) {
    return "Could not authorize the trading wallet. Try Cash out again.";
  }
  if (/sponsor|gas|insufficient/i.test(message) && !/gasless/i.test(message)) {
    return "Could not sponsor Polygon gas. Check Privy gas credits and retry.";
  }
  return "Could not move pUSD into the Polymarket proxy.";
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (missingSecrets(["privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Trading is not configured." }, { status: 503 });
  }

  const { userId, user } = await requirePrivyUser(request);
  const { privyAppId } = serverSecrets();
  if (!privyAppId) {
    return Response.json({ error: "Trading is not configured." }, { status: 503 });
  }

  let body: {
    from?: unknown;
    to?: unknown;
    data?: unknown;
    chainId?: unknown;
    signature?: unknown;
    requestExpiry?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const data = typeof body.data === "string" ? body.data.trim() : "";
  const chainId = Number(body.chainId);
  if (!ADDR.test(from) || !ADDR.test(to) || !DATA.test(data) || chainId !== POLYGON_CHAIN_ID) {
    return Response.json({ error: "Invalid sponsored transaction." }, { status: 400 });
  }
  if (to.toLowerCase() !== PUSD.toLowerCase()) {
    return Response.json({ error: "Invalid sponsored transaction." }, { status: 400 });
  }

  let recipient: string;
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: data as `0x${string}` });
    if (decoded.functionName !== "transfer") {
      return Response.json({ error: "Invalid sponsored transaction." }, { status: 400 });
    }
    recipient = getAddress(String(decoded.args[0]));
  } catch {
    return Response.json({ error: "Invalid sponsored transaction." }, { status: 400 });
  }

  const proxy = deriveDepositWallet(from);
  if (recipient.toLowerCase() !== proxy.toLowerCase()) {
    return Response.json(
      { error: "pUSD can only move into this account's Polymarket proxy." },
      { status: 403 },
    );
  }

  const walletId = await embeddedWalletId(userId, from, user);
  if (!walletId) {
    return Response.json(
      { error: "That trading wallet is not linked to this account." },
      { status: 403 },
    );
  }

  const rpc = rpcBody(data as `0x${string}`);
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";

  if (!signature) {
    const requestExpiry = Date.now() + SIGN_WINDOW_MS;
    return Response.json({
      requestExpiry,
      payload: {
        version: 1,
        method: "POST",
        url: `${PRIVY_API}/v1/wallets/${walletId}/rpc`,
        body: rpc,
        headers: {
          "privy-app-id": privyAppId,
          "privy-request-expiry": String(requestExpiry),
        },
      },
    });
  }

  const requestExpiry = Number(body.requestExpiry);
  if (!Number.isFinite(requestExpiry) || requestExpiry <= Date.now()) {
    return Response.json({ error: "Cash out expired. Try again." }, { status: 400 });
  }

  try {
    const result = await privyAdmin().wallets().rpc(walletId, {
      ...rpc,
      request_expiry: requestExpiry,
      authorization_context: { signatures: [signature] },
    });
    const hash =
      result.method === "eth_sendTransaction" ? result.data.hash : "";
    return Response.json({
      hash: typeof hash === "string" && hash.startsWith("0x") ? hash : "0x",
    });
  } catch (err) {
    return Response.json({ error: sponsorError(err) }, { status: 502 });
  }
}
