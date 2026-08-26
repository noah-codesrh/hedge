import type { Route } from "./+types/api.pm.config";
import { missingSecrets, serverSecrets } from "../lib/server/secrets";

export async function loader(_args: Route.LoaderArgs) {
  const missing = missingSecrets(["builderCode"]);
  if (missing.length > 0) {
    return Response.json(
      { error: "Polymarket builder code is not configured." },
      { status: 503 },
    );
  }
  return Response.json({ builderCode: serverSecrets().builderCode });
}
