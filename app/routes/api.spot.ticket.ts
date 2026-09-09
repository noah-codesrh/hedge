import {
  publicCorsHeaders,
  publicJson,
  publicOptions,
} from "../lib/server/public-cors";
import { quoteSpotTicket } from "../lib/server/spot";
import { parseSpotAmount, parseSpotSide } from "../lib/spot-ticket";

export function headers() {
  return publicCorsHeaders();
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return publicOptions();
  const url = new URL(request.url);
  const side = parseSpotSide(url.searchParams.get("side")) ?? "yes";
  const amount = parseSpotAmount(url.searchParams.get("amount"));

  const result = await quoteSpotTicket({
    origin: url.origin,
    marketSlug: url.searchParams.get("marketSlug") ?? undefined,
    marketId: url.searchParams.get("marketId") ?? undefined,
    side,
    amount: amount ?? 5,
    ref: url.searchParams.get("ref") ?? undefined,
  });
  if ("error" in result) {
    const { error, status } = result;
    return publicJson({ error }, status);
  }
  return publicJson(result);
}
