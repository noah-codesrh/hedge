const GAMMA = "https://gamma-api.polymarket.com";
const CACHE_MS = 30_000;

export type PolyComment = {
  id: string;
  body: string;
  author: string;
  avatarUrl: string | null;
  createdAt: string;
  reactions: number;
};

type Cache = { at: number; comments: PolyComment[] };
const cache = new Map<string, Cache>();

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function shorten(address: string) {
  if (address.length > 10) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  return address;
}

function mapComment(raw: Record<string, unknown>): PolyComment | null {
  const body = text(raw.body);
  if (!body) return null;
  const profile = (raw.profile ?? {}) as Record<string, unknown>;
  const author =
    text(profile.pseudonym) ||
    text(profile.name) ||
    shorten(text(raw.userAddress) || "Polymarket");
  const createdAt = text(raw.createdAt) || new Date().toISOString();
  const reactions = Number(raw.reactionCount);
  return {
    id: String(raw.id ?? `${createdAt}:${author}`),
    body,
    author,
    avatarUrl: text(profile.profileImage) || null,
    createdAt,
    reactions: Number.isFinite(reactions) ? reactions : 0,
  };
}

/**
 * Comments on a Polymarket event. Cached so a busy market page does not
 * hammer Gamma from every tab.
 */
export async function fetchPolymarketComments(
  eventId: string,
): Promise<PolyComment[]> {
  const key = eventId.trim();
  if (!key) return [];
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.comments;

  const params = new URLSearchParams({
    parent_entity_type: "Event",
    parent_entity_id: key,
    limit: "40",
    order: "createdAt",
    ascending: "false",
  });

  try {
    const res = await fetch(`${GAMMA}/comments?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn("[venue-chat] gamma comments", res.status);
      return hit?.comments ?? [];
    }
    const rows: unknown = await res.json();
    const comments = Array.isArray(rows)
      ? rows
          .map((row) =>
            row && typeof row === "object"
              ? mapComment(row as Record<string, unknown>)
              : null,
          )
          .filter((row): row is PolyComment => row !== null)
      : [];
    cache.set(key, { at: Date.now(), comments });
    return comments;
  } catch (err) {
    console.warn("[venue-chat] gamma comments", err);
    return hit?.comments ?? [];
  }
}
