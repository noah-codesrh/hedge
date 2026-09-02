import type { Route } from "./+types/api.rh.sponsor-send";
import { getAddress } from "viem";
import { RH_CHAIN_ID } from "../lib/chains";
import {
  embeddedWalletId,
  privyAdmin,
  requirePrivyUser,
} from "../lib/server/privy-auth";
import { missingSecrets, serverSecrets } from "../lib/server/secrets";
import { refuseSponsoredCall } from "../lib/server/sponsor-policy";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
const DATA = /^0x[a-fA-F0-9]*$/;
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;
const PRIVY_API = "https://api.privy.io";
const SIGN_WINDOW_MS = 3 * 60 * 1000;

function rpcBody(token: string, data: `0x${string}`) {
  return {
    method: "eth_sendTransaction" as const,
    caip2: `eip155:${RH_CHAIN_ID}` as const,
    chain_type: "ethereum" as const,
    sponsor: true,
    params: {
      transaction: {
        to: getAddress(token),
        data,
        chain_id: RH_CHAIN_ID,
      },
    },
  };
}

function sponsorError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  console.error("[rh-sponsor-send]", err);
  if (/invalid jwt|invalid_data/i.test(message)) {
    return "Could not authorize this wallet. Sign in again and retry the send.";
  }
  if (/authorization-signature|authorization signature|no signatures/i.test(message)) {
    return "Could not authorize this wallet. Try the send again.";
  }
  if (/sponsor|gas|insufficient/i.test(message) && !/gasless/i.test(message)) {
    return "Could not sponsor gas for this send. Check Privy gas credits and retry.";
  }
  return "Could not send this token.";
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (missingSecrets(["privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Sending is not configured." }, { status: 503 });
  }

  const { userId, user } = await requirePrivyUser(request);
  const { privyAppId } = serverSecrets();
  if (!privyAppId) {
    return Response.json({ error: "Sending is not configured." }, { status: 503 });
  }

  let body: {
    from?: unknown;
    token?: unknown;
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
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const data = typeof body.data === "string" ? body.data.trim() : "";
  const chainId = Number(body.chainId);

  if (!ADDR.test(from) || !ADDR.test(token) || !DATA.test(data)) {
    return Response.json({ error: "Invalid sponsored send." }, { status: 400 });
  }
  if (chainId !== RH_CHAIN_ID) {
    return Response.json(
      { error: "Sponsored sends only run on Robinhood Chain." },
      { status: 400 },
    );
  }
  const { hedgeEngineAddress, hedgeVaultAddress, hedgeStockCollateral } =
    serverSecrets();
  const refusal = refuseSponsoredCall(token, data as `0x${string}`, {
    engine: hedgeEngineAddress,
    vault: hedgeVaultAddress,
    stockCollateral: hedgeStockCollateral,
  });
  if (refusal) {
    return Response.json({ error: refusal }, { status: 400 });
  }

  // Doubles as the ownership check: a wallet id only comes back for an
  // embedded wallet belonging to this user.
  const walletId = await embeddedWalletId(userId, from, user);
  if (!walletId) {
    return Response.json(
      { error: "That wallet is not linked to this account." },
      { status: 403 },
    );
  }

  const rpc = rpcBody(token, data as `0x${string}`);
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
    return Response.json({ error: "Send expired. Try again." }, { status: 400 });
  }

  try {
    const result = await privyAdmin().wallets().rpc(walletId, {
      ...rpc,
      request_expiry: requestExpiry,
      authorization_context: { signatures: [signature] },
    });
    // Privy has signed and broadcast by now, so the send has happened whether
    // or not a hash comes back with it. Report the hash when there is one and
    // null otherwise, rather than a placeholder the client has to decode.
    const { hash } = result.data as { hash?: unknown };
    if (typeof hash === "string" && TX_HASH.test(hash)) {
      return Response.json({ hash });
    }
    console.warn("[rh-sponsor-send] sent without a hash", result.data);
    return Response.json({ hash: null });
  } catch (err) {
    return Response.json({ error: sponsorError(err) }, { status: 502 });
  }
}
