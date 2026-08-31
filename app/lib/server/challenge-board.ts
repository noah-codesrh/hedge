import {
  CHALLENGE_END,
  CHALLENGE_LEAGUE,
  CHALLENGE_START,
  type BoardRow,
  type ChallengeBoard,
} from "../challenge";
import { supabaseAdmin } from "./supabase";

export type { BoardRow, ChallengeBoard };

type TradeRow = {
  privy_user_id: string;
  wallet: string;
  direction: "buy" | "sell";
  usdg: number | string;
  shares: number | string | null;
  league: string | null;
  event_slug: string | null;
  created_at: string;
};

function num(value: number | string | null | undefined) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function displayName(
  nickname: string | null | undefined,
  wallet: string,
) {
  const nick = nickname?.trim();
  if (nick) return nick;
  if (wallet.length > 10) return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  return wallet || "Trader";
}

function isEplRow(row: TradeRow) {
  if (row.league === CHALLENGE_LEAGUE) return true;
  const slug = (row.event_slug ?? "").toLowerCase();
  return /\bepl\b/.test(slug) || slug.includes("premier-league");
}

export async function loadChallengeBoard(): Promise<ChallengeBoard> {
  const db = supabaseAdmin();
  if (!db) return { volume: [], pnl: [], tracked: false };

  const { data, error } = await db
    .from("trades")
    .select(
      "privy_user_id, wallet, direction, usdg, shares, league, event_slug, created_at",
    )
    .gte("created_at", CHALLENGE_START.toISOString())
    .lte("created_at", CHALLENGE_END.toISOString())
    .limit(20_000);

  if (error || !data) {
    if (error) console.error("[challenge-board]", error);
    return { volume: [], pnl: [], tracked: true };
  }

  const rows = (data as TradeRow[]).filter(isEplRow);
  const byUser = new Map<
    string,
    {
      wallet: string;
      buyUsd: number;
      sellUsd: number;
      buyShares: number;
      sellShares: number;
      trades: number;
    }
  >();

  for (const row of rows) {
    const id = row.privy_user_id;
    const cur = byUser.get(id) ?? {
      wallet: row.wallet,
      buyUsd: 0,
      sellUsd: 0,
      buyShares: 0,
      sellShares: 0,
      trades: 0,
    };
    const usdg = num(row.usdg);
    const shares = num(row.shares);
    if (row.direction === "buy") {
      cur.buyUsd += usdg;
      cur.buyShares += shares;
    } else {
      cur.sellUsd += usdg;
      cur.sellShares += shares;
    }
    cur.trades += 1;
    cur.wallet = row.wallet || cur.wallet;
    byUser.set(id, cur);
  }

  const ids = [...byUser.keys()];
  const nicknames = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await db
      .from("profiles")
      .select("privy_user_id, nickname")
      .in("privy_user_id", ids);
    for (const p of profiles ?? []) {
      if (p.nickname) nicknames.set(p.privy_user_id, p.nickname);
    }
  }

  const ranked = [...byUser.entries()].map(([userId, a]) => {
    const avgCost = a.buyShares > 0 ? a.buyUsd / a.buyShares : 0;
    const sold = Math.min(a.sellShares, a.buyShares);
    const pnl = a.sellUsd - avgCost * sold;
    return {
      userId,
      wallet: a.wallet,
      name: displayName(nicknames.get(userId), a.wallet),
      volume: a.buyUsd,
      pnl,
      trades: a.trades,
      closed: a.sellShares > 0,
    };
  });

  const volume = [...ranked]
    .filter((r) => r.volume > 0)
    .sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name))
    .slice(0, 50)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const pnl = [...ranked]
    .filter((r) => r.closed)
    .sort((a, b) => b.pnl - a.pnl || a.name.localeCompare(b.name))
    .slice(0, 50)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return { volume, pnl, tracked: true };
}
