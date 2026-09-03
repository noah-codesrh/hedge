import { supabaseAdmin } from "./supabase";

export type AgentBetRow = {
  id: string;
  created_at: string;
  agent: string;
  kind: "open" | "close";
  market_slug: string;
  title: string | null;
  side: "yes" | "no";
  margin: number;
  leverage: number;
  position_id: string | null;
  tx_hash: string | null;
  status: string;
};

export async function findIdempotentBet(agent: string, key: string) {
  const db = supabaseAdmin();
  if (!db) return null;
  const { data, error } = await db
    .from("agent_bets")
    .select(
      "id, created_at, agent, kind, market_slug, title, side, margin, leverage, position_id, tx_hash, status",
    )
    .eq("agent", agent)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) {
    console.error("[agent-bets] idempotent", error);
    return null;
  }
  return (data as AgentBetRow | null) ?? null;
}

export async function insertAgentBet(input: {
  agent: string;
  kind: "open" | "close";
  marketSlug: string;
  title: string | null;
  side: "yes" | "no";
  margin: number;
  leverage: number;
  positionId: string | null;
  txHash: string | null;
  idempotencyKey: string | null;
}) {
  const db = supabaseAdmin();
  if (!db) return { id: null as string | null };
  const { data, error } = await db
    .from("agent_bets")
    .insert({
      agent: input.agent,
      kind: input.kind,
      market_slug: input.marketSlug,
      title: input.title,
      side: input.side,
      margin: input.margin,
      leverage: input.leverage,
      position_id: input.positionId,
      tx_hash: input.txHash,
      idempotency_key: input.idempotencyKey,
      status: "filled",
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[agent-bets] insert", error);
    return { id: null as string | null };
  }
  return { id: (data?.id as string | undefined) ?? null };
}

export async function agentOwnsPosition(agent: string, positionId: string) {
  const db = supabaseAdmin();
  if (!db) return true;
  const { data, error } = await db
    .from("agent_bets")
    .select("id")
    .eq("agent", agent)
    .eq("kind", "open")
    .eq("position_id", positionId)
    .limit(1);
  if (error) {
    console.error("[agent-bets] owns", error);
    return false;
  }
  return (data ?? []).length > 0;
}

export async function agentNotionalToday(agent: string) {
  const db = supabaseAdmin();
  if (!db) return 0;
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await db
    .from("agent_bets")
    .select("margin, leverage")
    .eq("agent", agent)
    .eq("kind", "open")
    .gte("created_at", since.toISOString());
  if (error) {
    console.error("[agent-bets] daily", error);
    return 0;
  }
  return (data ?? []).reduce((sum, row) => {
    const margin = Number(row.margin) || 0;
    const leverage = Number(row.leverage) || 1;
    return sum + margin * leverage;
  }, 0);
}

export async function listPublicAgentBets(limit = 40): Promise<AgentBetRow[]> {
  const db = supabaseAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from("agent_bets")
    .select(
      "id, created_at, agent, kind, market_slug, title, side, margin, leverage, position_id, tx_hash, status",
    )
    .eq("status", "filled")
    .order("created_at", { ascending: false })
    .limit(Math.min(80, Math.max(1, limit)));
  if (error) {
    console.error("[agent-bets] list", error);
    return [];
  }
  return (data ?? []) as AgentBetRow[];
}

export async function listAgentPositionsLog(agent: string) {
  const db = supabaseAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from("agent_bets")
    .select(
      "id, created_at, agent, kind, market_slug, title, side, margin, leverage, position_id, tx_hash, status",
    )
    .eq("agent", agent)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[agent-bets] mine", error);
    return [];
  }
  return (data ?? []) as AgentBetRow[];
}
