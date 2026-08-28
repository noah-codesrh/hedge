import type { Route } from "./+types/api.relay.swap";
import { RH_CHAIN_ID } from "../lib/chains";
import { RELAY_ROUTER, USDG } from "../lib/robinhood";
import { requirePrivyUser, userHasWallet } from "../lib/server/privy-auth";
import { relayFetch } from "../lib/server/relay";
import { missingSecrets } from "../lib/server/secrets";

/**
 * Quotes a Robinhood Chain token into USDG.
 *
 * Deliberately separate from `/api/relay/quote`, which carries the USDG↔pUSD
 * legs every trade depends on. The shapes look similar enough to merge, but
 * that route is load-bearing for buying and cashing out, and a swap feature is
 * not worth the risk of disturbing it.
 *
 * Both chain ids and the destination currency are pinned rather than taken
 * from the caller: the only thing this endpoint will ever quote is "some token
 * you hold, into spendable cash". That keeps the sponsored-gas surface to a
 * single known router instead of wherever an arbitrary destination would send
 * the funds.
 */

const ADDR = /^0x[a-fA-F0-9]{40}$/;
const NATIVE = "0x0000000000000000000000000000000000000000";

type QuotePayload = Record<string, unknown>;

/** The step targets a swap actually executes, so we can vet them up front. */
function stepTargets(quote: unknown): string[] {
  const steps = (quote as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return [];
  const targets: string[] = [];
  for (const step of steps) {
    const items = (step as { items?: unknown })?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const to = (item as { data?: { to?: unknown } })?.data?.to;
      if (typeof to === "string") targets.push(to.toLowerCase());
    }
  }
  return targets;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (missingSecrets(["relayApiKey", "privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Swapping is not configured." }, { status: 503 });
  }

  const { user: privyUser } = await requirePrivyUser(request);

  let body: { user?: unknown; token?: unknown; amount?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const user = typeof body.user === "string" ? body.user.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : NATIVE;
  const amount = typeof body.amount === "string" ? body.amount.trim() : "";

  if (!ADDR.test(user)) {
    return Response.json({ error: "Invalid wallet address." }, { status: 400 });
  }
  if (!ADDR.test(token)) {
    return Response.json({ error: "Invalid token address." }, { status: 400 });
  }
  if (token.toLowerCase() === USDG.toLowerCase()) {
    return Response.json({ error: "That is already cash." }, { status: 400 });
  }
  if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
    return Response.json({ error: "Enter a valid amount." }, { status: 400 });
  }
  if (!userHasWallet(privyUser, user)) {
    return Response.json(
      { error: "That wallet is not linked to this account." },
      { status: 403 },
    );
  }

  const payload: QuotePayload = {
    user,
    recipient: user,
    originChainId: RH_CHAIN_ID,
    destinationChainId: RH_CHAIN_ID,
    originCurrency: token,
    destinationCurrency: USDG,
    amount,
    tradeType: "EXACT_INPUT",
    refundTo: user,
  };

  let quote: unknown;
  try {
    quote = await relayFetch("/quote/v2", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Relay indexes far more tokens on this chain than it can actually route,
    // so "no route" is an ordinary answer here, not a fault worth an error page.
    if (err instanceof Response) {
      const detail = (await err
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      const message = detail?.error ?? "";
      if (err.status === 400 || err.status === 422) {
        return Response.json(
          {
            error: /unsupported currency/i.test(message)
              ? "Hedge cannot swap this token yet — there is no route into USDG."
              : message || "Could not quote a swap for this token.",
          },
          { status: 422 },
        );
      }
      throw err;
    }
    return Response.json(
      { error: "Could not quote a swap. Try again in a moment." },
      { status: 502 },
    );
  }

  // A swap only ever touches the token being sold and Relay's router. Anything
  // else means the route changed shape, and sponsoring it blind is exactly the
  // hole the pinned address exists to close.
  const allowed = new Set([RELAY_ROUTER.toLowerCase(), token.toLowerCase()]);
  const unexpected = stepTargets(quote).filter((to) => !allowed.has(to));
  if (unexpected.length > 0) {
    console.error("[hedge] relay swap hit an unexpected target", unexpected);
    return Response.json(
      { error: "This swap route is not recognised. Nothing was sent." },
      { status: 502 },
    );
  }

  return Response.json(quote);
}
