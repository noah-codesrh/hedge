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
  return agentJson({ markets: await listAgentMarkets() });
}
