import type { Route } from "./+types/api.relay.quote";
import { PUSD, POLYGON_CHAIN_ID, RH_CHAIN_ID } from "../lib/chains";
import { USDG } from "../lib/robinhood";
import { requirePrivyUser, userHasWallet } from "../lib/server/privy-auth";
import { relayFetch } from "../lib/server/relay";
import { missingSecrets } from "../lib/server/secrets";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";
/** Cap per hop in USDC (6 decimals). $5 matches Relay's fee-sponsorship example. */
const MAX_SPONSOR = "5000000";

type QuotePayload = Record<string, unknown>;

async function firstQuote(payloads: QuotePayload[]) {
  let last: unknown;
  for (const payload of payloads) {
    try {
      return await relayFetch("/quote/v2", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (err) {
      last = err;
      if (!(err instanceof Response) || (err.status !== 400 && err.status !== 422)) {
        throw err;
      }
    }
  }
  throw last;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (missingSecrets(["relayApiKey", "privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Relay is not configured." }, { status: 503 });
  }

  const { user: privyUser } = await requirePrivyUser(request);

  let body: {
    user?: unknown;
    recipient?: unknown;
    amount?: unknown;
    direction?: unknown;
    mode?: unknown;
    refundTo?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const user = typeof body.user === "string" ? body.user.trim() : "";
  const recipient =
    typeof body.recipient === "string" ? body.recipient.trim() : "";
  const amount = typeof body.amount === "string" ? body.amount.trim() : "";
  const outbound = body.direction === "out";
  const mode =
    body.mode === "deposit" || body.mode === "permit" ? body.mode : outbound ? "auto" : "in";
  const refundTo =
    typeof body.refundTo === "string" && ADDR.test(body.refundTo.trim())
      ? body.refundTo.trim()
      : ZERO;

  if (!ADDR.test(user) || !ADDR.test(recipient)) {
    return Response.json({ error: "Invalid wallet addresses." }, { status: 400 });
  }
  if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
    return Response.json({ error: "Enter a valid amount." }, { status: 400 });
  }

  const originOk = userHasWallet(privyUser, user);
  const destOk = userHasWallet(privyUser, recipient);
  if (outbound && mode === "deposit") {
    if (!destOk) {
      return Response.json(
        { error: "That wallet is not linked to this account." },
        { status: 403 },
      );
    }
  } else if (!originOk) {
    return Response.json(
      { error: "That wallet is not linked to this account." },
      { status: 403 },
    );
  }

  const sponsored = {
    subsidizeFees: true as const,
    maxSubsidizationAmount: MAX_SPONSOR,
  };

  if (outbound) {
    const depositBase: QuotePayload = {
      user: recipient,
      recipient,
      originChainId: POLYGON_CHAIN_ID,
      destinationChainId: RH_CHAIN_ID,
      originCurrency: PUSD,
      destinationCurrency: USDG,
      amount,
      tradeType: "EXACT_INPUT",
      useDepositAddress: true,
    };
    const deposit: QuotePayload[] = [
      { ...depositBase, strict: true, refundTo, ...sponsored },
      { ...depositBase, strict: true, refundTo },
      { ...depositBase, ...sponsored },
      depositBase,
    ];
    const permitBase: QuotePayload = {
      user,
      recipient,
      originChainId: POLYGON_CHAIN_ID,
      destinationChainId: RH_CHAIN_ID,
      originCurrency: PUSD,
      destinationCurrency: USDG,
      amount,
      tradeType: "EXACT_INPUT",
      usePermit: true,
    };
    const permit: QuotePayload[] = [
      { ...permitBase, ...sponsored },
      permitBase,
    ];
    const payloads =
      mode === "deposit" ? deposit : mode === "permit" ? permit : [...deposit, ...permit];
    try {
      return Response.json(await firstQuote(payloads));
    } catch (err) {
      if (err instanceof Response) throw err;
      throw Response.json(
        { error: "Could not quote a cash-out route. Try again in a moment." },
        { status: 502 },
      );
    }
  }

  const inboundBase = {
    user,
    recipient,
    originChainId: RH_CHAIN_ID,
    destinationChainId: POLYGON_CHAIN_ID,
    originCurrency: USDG,
    destinationCurrency: PUSD,
    amount,
    tradeType: "EXACT_INPUT" as const,
  };

  try {
    const quote = await firstQuote([
      { ...inboundBase, usePermit: true, ...sponsored },
      { ...inboundBase, usePermit: true },
      inboundBase,
    ]);
    return Response.json(quote);
  } catch (err) {
    if (err instanceof Response) throw err;
    throw err;
  }
}
