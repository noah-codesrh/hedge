import type { Route } from "./+types/api.native.tickets";
import { requirePrivyUser, linkedWalletAddresses } from "../lib/server/privy-auth";
import { listMyNativeTickets } from "../lib/server/native-markets";

export async function loader({ request }: Route.LoaderArgs) {
  const { userId, user } = await requirePrivyUser(request);
  const { tickets } = await listMyNativeTickets(
    userId,
    linkedWalletAddresses(user),
  );
  return Response.json(
    { tickets },
    { headers: { "Cache-Control": "no-store" } },
  );
}
