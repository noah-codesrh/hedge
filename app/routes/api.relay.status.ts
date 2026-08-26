import type { Route } from "./+types/api.relay.status";
import { requirePrivySession } from "../lib/server/privy-auth";
import { relayFetch } from "../lib/server/relay";
import { missingSecrets } from "../lib/server/secrets";

export async function loader({ request }: Route.LoaderArgs) {
  if (missingSecrets(["relayApiKey", "privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Relay is not configured." }, { status: 503 });
  }
  await requirePrivySession(request);
  const requestId = new URL(request.url).searchParams.get("requestId")?.trim() ?? "";
  if (!requestId || requestId.length > 200) {
    return Response.json({ error: "Missing request id." }, { status: 400 });
  }
  const status = await relayFetch(
    `/intents/status/v3?requestId=${encodeURIComponent(requestId)}`,
  );
  return Response.json(status);
}
