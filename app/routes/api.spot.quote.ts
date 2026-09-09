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
  const side = parseSpotSide(url.searchParams.get("side"));
  const amount = parseSpotAmount(url.searchParams.get("amount"));
  if (!side) return publicJson({ error: "Set side=yes or side=no." }, 400);
  if (amount == null) return publicJson({ error: "Set amount to at least $1." }, 400);

  const result = await quoteSpotTicket({
    origin: url.origin,
    marketSlug: url.searchParams.get("marketSlug") ?? undefined,
    marketId: url.searchParams.get("marketId") ?? undefined,
    side,
    amount,
    ref: url.searchParams.get("ref") ?? undefined,
  });
  if ("error" in result) {
    const { error, status } = result;
    return publicJson({ error }, status);
  }
  return publicJson(result);
}
