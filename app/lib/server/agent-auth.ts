import { createHash, timingSafeEqual } from "node:crypto";
import { serverSecrets } from "./secrets";

export type AgentIdentity = {
  name: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

function parseKeys() {
  const { agentApiKey, agentApiKeys } = serverSecrets();
  const out: { name: string; secret: string }[] = [];
  if (agentApiKey) out.push({ name: "default", secret: agentApiKey });
  for (const part of (agentApiKeys ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const name = trimmed.slice(0, colon).trim();
    const secret = trimmed.slice(colon + 1).trim();
    if (name && secret) out.push({ name, secret });
  }
  return out;
}

export function agentKeysConfigured() {
  return parseKeys().length > 0;
}

export function presentedAgentKey(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const named = (request.headers.get("x-hedge-agent-key") ?? "").trim();
  return named || null;
}

export function identifyAgent(request: Request): AgentIdentity | null {
  const presented = presentedAgentKey(request);
  if (!presented) return null;
  const presentedHash = sha256(presented);
  for (const row of parseKeys()) {
    const stored = sha256(row.secret);
    if (
      presentedHash.length === stored.length &&
      timingSafeEqual(presentedHash, stored)
    ) {
      return { name: row.name };
    }
  }
  return null;
}

export function requireAgent(request: Request): AgentIdentity {
  if (!agentKeysConfigured()) {
    throw Response.json(
      { error: "The agent wall is not accepting keys yet." },
      { status: 503, headers: corsHeaders() },
    );
  }
  const agent = identifyAgent(request);
  if (!agent) {
    throw Response.json(
      { error: "Missing or invalid agent key." },
      { status: 401, headers: corsHeaders() },
    );
  }
  return agent;
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Hedge-Agent-Key, Idempotency-Key",
    "Access-Control-Max-Age": "86400",
  };
}

export function agentJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders() });
}

export function agentOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
