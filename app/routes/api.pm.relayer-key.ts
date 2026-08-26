import type { Route } from "./+types/api.pm.relayer-key";
import { requirePrivySession } from "../lib/server/privy-auth";
import { missingSecrets, serverSecrets } from "../lib/server/secrets";

export async function loader({ request }: Route.LoaderArgs) {
  if (missingSecrets(["privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Sign in to continue." }, { status: 503 });
  }
  await requirePrivySession(request);

  if (missingSecrets(["relayerApiKeyId", "relayerApiKeyAddress"]).length > 0) {
    return Response.json(
      { error: "Polymarket relayer is not configured." },
      { status: 503 },
    );
  }

  const secrets = serverSecrets();
  return Response.json({
    key: secrets.relayerApiKeyId,
    address: secrets.relayerApiKeyAddress,
  });
}
