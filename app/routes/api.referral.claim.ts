import type { Route } from "./+types/api.referral.claim";
import { requirePrivyUser } from "../lib/server/privy-auth";
import { claimReferral } from "../lib/server/referrals";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  await requirePrivyUser(request);
  const result = await claimReferral();
  return Response.json({ error: result.error }, { status: result.status });
}
