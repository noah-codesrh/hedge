import type { Route } from "./+types/api.events";
import { localeFromRequest } from "../lib/i18n";
import { listEventPage } from "../lib/polymarket";
import { publicCorsHeaders } from "../lib/server/public-cors";

export function headers() {
  return publicCorsHeaders();
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag") ?? "all";
  const sort = url.searchParams.get("sort") ?? "trending";
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return listEventPage({
    tag,
    sort,
    offset: Number.isFinite(offset) ? offset : 0,
    locale: localeFromRequest(request),
  });
}
