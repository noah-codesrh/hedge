import type { Route } from "./+types/api.pm.account";
import { loadPolymarketAccounts } from "../lib/polymarket-account";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

export async function loader({ request }: Route.LoaderArgs) {
  const raw = new URL(request.url).searchParams.get("addresses") ?? "";
  const addresses = raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => ADDR.test(a));
  try {
    const accounts = await loadPolymarketAccounts(addresses);
    return { accounts };
  } catch {
    return { accounts: [] };
  }
}
