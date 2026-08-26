import type { Route } from "./+types/api.pm.builder-sign";
import { buildHmacSignature } from "@polymarket/client";
import { requirePrivySession } from "../lib/server/privy-auth";
import { missingSecrets, serverSecrets } from "../lib/server/secrets";

function isBuilderPath(path: string) {
  if (!path || path.includes("..") || path.length > 300) return false;
  if (path.startsWith("/")) return true;
  try {
    const host = new URL(path).hostname;
    return host === "polymarket.com" || host.endsWith(".polymarket.com");
  } catch {
    return false;
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const missing = missingSecrets([
    "privyAppId",
    "privyAppSecret",
    "builderApiKey",
    "builderSecret",
    "builderPassphrase",
  ]);
  if (missing.length > 0) {
    return Response.json(
      { error: "Polymarket builder signing is not configured." },
      { status: 503 },
    );
  }

  await requirePrivySession(request);

  let payload: { body?: unknown; method?: unknown; path?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const method =
    typeof payload.method === "string" ? payload.method.toUpperCase() : "";
  const path = typeof payload.path === "string" ? payload.path : "";
  if (!method || !isBuilderPath(path)) {
    return Response.json({ error: "Invalid builder request." }, { status: 400 });
  }

  const body =
    typeof payload.body === "string"
      ? payload.body
      : payload.body == null
        ? undefined
        : JSON.stringify(payload.body);

  const secrets = serverSecrets();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await buildHmacSignature(
    secrets.builderSecret!,
    timestamp,
    method,
    path,
    body,
  );

  return Response.json({
    POLY_BUILDER_API_KEY: secrets.builderApiKey,
    POLY_BUILDER_PASSPHRASE: secrets.builderPassphrase,
    POLY_BUILDER_SIGNATURE: signature,
    POLY_BUILDER_TIMESTAMP: `${timestamp}`,
  });
}
