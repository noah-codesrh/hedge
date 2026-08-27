import type { Route } from "./+types/api.pm.book";
import { getOrderBooks } from "../lib/orderbook";

export async function loader({ request }: Route.LoaderArgs) {
  const tokenIds = (new URL(request.url).searchParams.get("tokenIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9]+$/.test(id))
    .slice(0, 4);

  if (tokenIds.length === 0) {
    return Response.json({ books: {} });
  }

  try {
    return Response.json(
      { books: await getOrderBooks(tokenIds) },
      // A stale book quotes a fill the user cannot get, so keep this short.
      { headers: { "Cache-Control": "public, max-age=2" } },
    );
  } catch {
    return Response.json({ books: {} });
  }
}
