import {
  agentJson,
  agentOptions,
  corsHeaders,
} from "../lib/server/agent-auth";
import { listAgentMarkets } from "../lib/server/agent-catalog";

export function headers() {
  return corsHeaders();
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return agentOptions();
  const url = new URL(request.url);
  const deskParam = (url.searchParams.get("desk") ?? "all").trim().toLowerCase();
  const desk =
    deskParam === "leverage" || deskParam === "spot" || deskParam === "all"
      ? deskParam
      : "all";
  const limit = Number(url.searchParams.get("limit") ?? "80");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const page = await listAgentMarkets({
    q: url.searchParams.get("q") ?? undefined,
    desk,
    limit: Number.isFinite(limit) ? limit : 80,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  return agentJson(page);
}
