import {
  publicCorsHeaders,
  publicJson,
  publicOptions,
} from "../lib/server/public-cors";
import { listSpotMarkets } from "../lib/server/spot";

export function headers() {
  return publicCorsHeaders();
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return publicOptions();
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "80");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const page = await listSpotMarkets({
    origin: url.origin,
    q: url.searchParams.get("q") ?? undefined,
    limit: Number.isFinite(limit) ? limit : 80,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  return publicJson(page);
}
