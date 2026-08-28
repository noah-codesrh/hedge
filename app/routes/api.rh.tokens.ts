import type { Route } from "./+types/api.rh.tokens";
import { listOwnedTokens, USDG } from "../lib/robinhood";

/**
 * Everything the address holds that could be swapped into cash.
 *
 * USDG is dropped because it is already the destination, and dust is dropped
 * because a swap that cannot clear Relay's fee is only a way to lose the
 * token. Public like `/api/assets`: balances are on a public chain and the
 * swap itself is gated where it matters, on the sponsored-send route.
 */
const DUST_USD = 0.01;

export async function loader({ request }: Route.LoaderArgs) {
  const address = new URL(request.url).searchParams.get("address")?.trim();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return { tokens: [], error: "Missing wallet address" };
  }
  try {
    const owned = await listOwnedTokens(address);
    const tokens = owned.filter(
      (t) =>
        t.address?.toLowerCase() !== USDG.toLowerCase() &&
        (t.valueUsd == null || t.valueUsd >= DUST_USD),
    );
    return { tokens, error: null as string | null };
  } catch (e) {
    return {
      tokens: [],
      error: e instanceof Error ? e.message : "Failed to load tokens",
    };
  }
}
