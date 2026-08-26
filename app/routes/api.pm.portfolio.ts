import type { Route } from "./+types/api.pm.portfolio";
import { loadPolymarketPortfolio } from "../lib/polymarket-portfolio";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

export async function loader({ request }: Route.LoaderArgs) {
  const raw = new URL(request.url).searchParams.get("addresses") ?? "";
  const addresses = raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => ADDR.test(a))
    .slice(0, 6);
  if (addresses.length === 0) {
    return {
      open: [],
      closed: [],
      activity: [],
      positionsValue: 0,
      positionsPnl: null as number | null,
    };
  }
  try {
    return await loadPolymarketPortfolio(addresses);
  } catch {
    return {
      open: [],
      closed: [],
      activity: [],
      positionsValue: 0,
      positionsPnl: null as number | null,
    };
  }
}
