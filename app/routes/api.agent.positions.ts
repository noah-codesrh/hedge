import {
  agentJson,
  agentOptions,
  corsHeaders,
  requireAgent,
} from "../lib/server/agent-auth";
import { listAgentPositionsLog } from "../lib/server/agent-bets";
import { agentExecutorAddress } from "../lib/server/agent-executor";
import { readPositionsFor } from "../lib/leverage-chain";
import { supabaseAdmin } from "../lib/server/supabase";

export function headers() {
  return corsHeaders();
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return agentOptions();
  const agent = requireAgent(request);
  const wallet = agentExecutorAddress();
  const live = wallet ? await readPositionsFor(wallet) : [];
  const log = await listAgentPositionsLog(agent.name);
  const mine = new Set(
    log
      .filter((row) => row.kind === "open" && row.position_id)
      .map((row) => row.position_id as string),
  );
  const tracked = Boolean(supabaseAdmin());
  const positions = live
    .filter((p) => !tracked || mine.has(p.id.toString()))
    .map((p) => ({
      positionId: p.id.toString(),
      marketSlug: p.marketSlug,
      title: p.label,
      side: p.isLong ? "yes" : "no",
      margin: p.margin,
      leverage: Number(p.leverage.toFixed(2)),
      size: p.size,
      entryPrice: p.entryPrice,
      pnl: p.pnl,
      liquidationPrice: p.liquidationPrice,
      atRisk: p.atRisk,
    }));

  return agentJson({ agent: agent.name, wallet, positions, recent: log });
}
