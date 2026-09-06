import type { Route } from "./+types/api.native.$slug";
import { bearerToken, requirePrivyUser } from "../lib/server/privy-auth";
import { getNativeMarket } from "../lib/server/native-markets";

export async function loader({ request, params }: Route.LoaderArgs) {
  const slug = params.slug;
  if (!slug) return Response.json({ error: "Missing market." }, { status: 400 });
  let userId: string | null = null;
  if (bearerToken(request)) {
    try {
      const session = await requirePrivyUser(request);
      userId = session.userId;
    } catch {
      userId = null;
    }
  }
  const { tracked, market, mine, quotes, escrowWallet, payoutLive } =
    await getNativeMarket(slug, userId);
  if (!market) return Response.json({ error: "Market not found." }, { status: 404 });
  return Response.json(
    { tracked, market, mine, quotes, escrowWallet, payoutLive },
    { headers: { "Cache-Control": "no-store" } },
  );
}
