import { serverSecrets } from "./secrets";

const RELAY_HOST = "https://api.relay.link";

function relayKey() {
  const key = serverSecrets().relayApiKey;
  if (!key) throw new Error("Relay is not configured.");
  return key;
}

export function isRelayPath(path: string) {
  return (
    path.startsWith("/quote") ||
    path.startsWith("/intents") ||
    path.startsWith("/execute")
  );
}

export async function relayFetch(path: string, init: RequestInit = {}) {
  const url = new URL(path, RELAY_HOST);
  if (url.origin !== new URL(RELAY_HOST).origin) {
    throw new Error("Invalid Relay endpoint.");
  }
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("x-api-key", relayKey());
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 240) };
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Relay request failed (${res.status})`;
    throw Response.json({ error: message }, { status: res.status >= 500 ? 502 : res.status });
  }
  return data;
}
