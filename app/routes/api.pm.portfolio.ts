import type { Route } from "./+types/api.pm.portfolio";
import { loadPolymarketPortfolio, mergeActivity } from "../lib/polymarket-portfolio";
import { listWalletTransfers } from "../lib/wallet-activity";

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
    const [portfolio, transfers] = await Promise.all([
      loadPolymarketPortfolio(addresses),
      listWalletTransfers(addresses).catch(() => []),
    ]);
    return {
      ...portfolio,
      activity: mergeActivity(transfers, portfolio.activity),
    };
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
