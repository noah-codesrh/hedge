import type { Route } from "./+types/api.native.refund";
import { requirePrivyUser, userHasWallet } from "../lib/server/privy-auth";
import { refundNative } from "../lib/server/native-markets";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

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
  const wallet = String(body.wallet ?? "").trim();
  if (wallet && ADDR.test(wallet) && !userHasWallet(user, wallet)) {
    return Response.json(
      { error: "That wallet is not linked to this account." },
      { status: 403 },
    );
  }
  const result = await refundNative({
    userId,
    slug: String(body.slug ?? ""),
    wallet: ADDR.test(wallet) ? wallet : null,
    txHash: String(body.txHash ?? ""),
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result);
}
