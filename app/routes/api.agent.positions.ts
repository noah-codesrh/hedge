import {
  agentJson,
  agentOptions,
  corsHeaders,
} from "../lib/server/agent-auth";
import { listAgentPositionsLog } from "../lib/server/agent-bets";
import { parseAgentWallet } from "../lib/server/agent-executor";
import { readPositionsFor } from "../lib/leverage-chain";

export function headers() {
  return corsHeaders();
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return agentOptions();
  const url = new URL(request.url);
  const wallet = parseAgentWallet(url.searchParams.get("wallet"));
  if (!wallet) {
    return agentJson({ error: "Set ?wallet=0x… to the agent wallet." }, 400);
  }
  const live = await readPositionsFor(wallet);
  const log = await listAgentPositionsLog(wallet.toLowerCase());
  const positions = live.map((p) => ({
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
  return agentJson({ wallet, positions, recent: log });
}
