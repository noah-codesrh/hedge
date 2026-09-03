import {
  agentJson,
  agentOptions,
  corsHeaders,
} from "../lib/server/agent-auth";
import { quoteAgentTicket } from "../lib/server/agent-catalog";

export function headers() {
  return corsHeaders();
}

function sideOf(value: string | null): "yes" | "no" | null {
  const s = (value ?? "").trim().toLowerCase();
  if (s === "yes" || s === "long") return "yes";
  if (s === "no" || s === "short") return "no";
  return null;
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return agentOptions();
  const url = new URL(request.url);
  const side = sideOf(url.searchParams.get("side"));
  const margin = Number(url.searchParams.get("margin"));
  const leverage = Number(url.searchParams.get("leverage") ?? "1");
  if (!side) return agentJson({ error: "Set side=yes or side=no." }, 400);
  if (!(margin > 0)) return agentJson({ error: "Set a margin in USDG." }, 400);
  if (!(leverage >= 1)) return agentJson({ error: "Leverage must be at least 1." }, 400);

  const result = await quoteAgentTicket({
    marketSlug: url.searchParams.get("marketSlug") ?? undefined,
    marketId: url.searchParams.get("marketId") ?? undefined,
    side,
    margin,
    leverage,
  });
  if ("error" in result) return agentJson({ error: result.error }, result.status);
  return agentJson(result);
}
