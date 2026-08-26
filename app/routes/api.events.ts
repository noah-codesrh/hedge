import type { Route } from "./+types/api.events";
import { listEventPage } from "../lib/polymarket";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag") ?? "all";
  const sort = url.searchParams.get("sort") ?? "trending";
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return listEventPage({
    tag,
    sort,
    offset: Number.isFinite(offset) ? offset : 0,
  });
}
