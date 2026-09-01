import { shorten } from "../format";
import {
  VENUE_BODY_MAX,
  venueAvatarUrl,
  type VenueFeed,
  type VenueMessage,
} from "../venue-chat";
import { fetchPolymarketComments } from "./polymarket-comments";
import { supabaseAdmin } from "./supabase";

const FEED_LIMIT = 50;
const COOLDOWN_MS = 4_000;

type HedgeRow = {
  id: string;
  created_at: string;
  privy_user_id: string;
  body: string;
};

function hedgeName(
  nickname: string | null | undefined,
  wallet: string | null | undefined,
) {
  const nick = nickname?.trim();
  if (nick) return nick;
  const short = shorten(wallet);
  return short || "Anonymous";
}

export function cleanVenueBody(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, VENUE_BODY_MAX);
}

function toHedgeMessage(
  row: HedgeRow,
  profile: { nickname?: string | null; wallet?: string | null } | undefined,
  photo?: string | null,
): VenueMessage {
  const wallet = profile?.wallet ?? null;
  const author = hedgeName(profile?.nickname, wallet);
  const seed = wallet || row.privy_user_id;
  return {
    id: `hedge:${row.id}`,
    source: "hedge",
    author,
    avatarUrl: venueAvatarUrl(seed, photo),
    body: row.body,
    createdAt: row.created_at,
    reactions: 0,
  };
}

export async function loadVenueFeed(eventId: string): Promise<VenueFeed> {
  const [poly, hedge] = await Promise.all([
    fetchPolymarketComments(eventId),
    loadHedgeComments(eventId),
  ]);

  const messages: VenueMessage[] = [
    ...hedge.messages,
    ...poly.map((row) => ({
      id: `pm:${row.id}`,
      source: "polymarket" as const,
      author: row.author,
      avatarUrl: venueAvatarUrl(row.author, row.avatarUrl),
      body: row.body,
      createdAt: row.createdAt,
      reactions: row.reactions,
    })),
  ]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, FEED_LIMIT)
    .reverse();

  return { eventId, messages, hedgeLive: hedge.live };
}

async function loadHedgeComments(eventId: string): Promise<{
  live: boolean;
  messages: VenueMessage[];
}> {
  const db = supabaseAdmin();
  if (!db) return { live: false, messages: [] };

  const { data, error } = await db
    .from("venue_comments")
    .select("id, created_at, privy_user_id, body")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);

  if (error) {
    console.error("[venue-chat] read", error);
    return { live: false, messages: [] };
  }

  const rows = (data ?? []) as HedgeRow[];
  const ids = [...new Set(rows.map((row) => row.privy_user_id))];
  const profiles = new Map<
    string,
    { nickname: string | null; wallet: string | null }
  >();
  if (ids.length > 0) {
    const { data } = await db
      .from("profiles")
      .select("privy_user_id, nickname, wallet")
      .in("privy_user_id", ids);
    for (const profile of data ?? []) {
      profiles.set(profile.privy_user_id, {
        nickname: profile.nickname ?? null,
        wallet: profile.wallet ?? null,
      });
    }
  }

  return {
    live: true,
    messages: rows.map((row) =>
      toHedgeMessage(row, profiles.get(row.privy_user_id)),
    ),
  };
}

export async function insertVenueComment(input: {
  userId: string;
  eventId: string;
  eventSlug: string | null;
  marketId: string | null;
  body: unknown;
  wallet?: string | null;
  photo?: string | null;
  nickname?: string | null;
}): Promise<
  | { ok: true; message: VenueMessage }
  | { ok: false; status: number; error: string }
> {
  const body = cleanVenueBody(input.body);
  if (!body) return { ok: false, status: 400, error: "Write something first." };

  const db = supabaseAdmin();
  if (!db) {
    return {
      ok: false,
      status: 503,
      error: "Hedge chat is not connected yet.",
    };
  }

  const { data: last, error: lastError } = await db
    .from("venue_comments")
    .select("created_at")
    .eq("privy_user_id", input.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastError) {
    console.error("[venue-chat] cooldown", lastError);
    return { ok: false, status: 502, error: "Could not post." };
  }

  if (last?.created_at) {
    const age = Date.now() - Date.parse(last.created_at);
    if (Number.isFinite(age) && age < COOLDOWN_MS) {
      return {
        ok: false,
        status: 429,
        error: "Wait a few seconds before posting again.",
      };
    }
  }

  const { data, error } = await db
    .from("venue_comments")
    .insert({
      privy_user_id: input.userId,
      event_id: input.eventId,
      event_slug: input.eventSlug,
      market_id: input.marketId,
      body,
    })
    .select("id, created_at, privy_user_id, body")
    .single();

  if (error || !data) {
    console.error("[venue-chat] insert", error);
    return { ok: false, status: 502, error: "Could not post." };
  }

  const wallet = input.wallet?.toLowerCase() ?? null;
  const nickname = input.nickname?.trim().slice(0, 24) || null;
  if (wallet || nickname) {
    const row: Record<string, string> = {
      privy_user_id: input.userId,
      updated_at: new Date().toISOString(),
    };
    if (wallet) row.wallet = wallet;
    if (nickname) row.nickname = nickname;
    await db.from("profiles").upsert(row, { onConflict: "privy_user_id" });
  }

  const { data: profile } = await db
    .from("profiles")
    .select("nickname, wallet")
    .eq("privy_user_id", input.userId)
    .maybeSingle();

  return {
    ok: true,
    message: toHedgeMessage(
      data as HedgeRow,
      {
        nickname: profile?.nickname ?? null,
        wallet: profile?.wallet ?? wallet,
      },
      input.photo,
    ),
  };
}
