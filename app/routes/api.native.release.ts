import type { Route } from "./+types/api.native.release";
import { requirePrivyUser, linkedWalletAddresses } from "../lib/server/privy-auth";
import { releaseNativeTicket } from "../lib/server/native-markets";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  const { userId, user } = await requirePrivyUser(request);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const result = await releaseNativeTicket({
    userId,
    wallets: linkedWalletAddresses(user),
    slug: String(body.slug ?? ""),
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result);
}
