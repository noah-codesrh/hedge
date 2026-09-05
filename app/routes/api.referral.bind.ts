import type { Route } from "./+types/api.referral.bind";
import { requirePrivyUser } from "../lib/server/privy-auth";
import { bindReferral } from "../lib/server/referrals";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  const { userId } = await requirePrivyUser(request);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const result = await bindReferral(userId, String(body.code ?? ""));
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result);
}
