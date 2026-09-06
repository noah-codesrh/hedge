import type { Route } from "./+types/api.native.tickets";
import { requirePrivyUser } from "../lib/server/privy-auth";
import { listMyNativeTickets } from "../lib/server/native-markets";

export async function loader({ request }: Route.LoaderArgs) {
  const { userId } = await requirePrivyUser(request);
  const { tickets } = await listMyNativeTickets(userId);
  return Response.json(
    { tickets },
    { headers: { "Cache-Control": "no-store" } },
  );
}
