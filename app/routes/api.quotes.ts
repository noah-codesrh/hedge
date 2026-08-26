import type { Route } from "./+types/api.quotes";
import { getMarketQuotes } from "../lib/polymarket";

export async function loader({ request }: Route.LoaderArgs) {
  const ids = new URL(request.url).searchParams.get("ids") ?? "";
  const marketIds = ids
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 40);
  if (marketIds.length === 0) return { quotes: {} as Record<string, { yes: number; no: number }> };
  try {
    const quotes = await getMarketQuotes(marketIds);
    return { quotes };
  } catch {
    return { quotes: {} as Record<string, { yes: number; no: number }> };
  }
}
