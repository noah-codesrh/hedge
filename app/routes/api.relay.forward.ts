import type { Route } from "./+types/api.relay.forward";
import { requirePrivySession } from "../lib/server/privy-auth";
import { isRelayPath, relayFetch } from "../lib/server/relay";
import { missingSecrets } from "../lib/server/secrets";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (missingSecrets(["relayApiKey", "privyAppId", "privyAppSecret"]).length > 0) {
    return Response.json({ error: "Relay is not configured." }, { status: 503 });
  }
  await requirePrivySession(request);

  let body: {
    endpoint?: unknown;
    method?: unknown;
    body?: unknown;
    signature?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const method =
    typeof body.method === "string" ? body.method.toUpperCase() : "POST";
  const signature =
    typeof body.signature === "string" ? body.signature.trim() : "";
  if (!endpoint.startsWith("/") || !isRelayPath(endpoint.split("?")[0] ?? "")) {
    return Response.json({ error: "Invalid Relay endpoint." }, { status: 400 });
  }

  const url = new URL(endpoint, "https://api.relay.link");
  if (signature) {
    // Match Relay's SDK: signature is a query param, not the JSON body.
    url.searchParams.set("signature", signature);
  }

  const data = await relayFetch(`${url.pathname}${url.search}`, {
    method,
    body:
      method === "GET" || method === "HEAD"
        ? undefined
        : JSON.stringify(body.body ?? {}),
  });
  return Response.json(data);
}
