export type VenueSource = "hedge" | "polymarket";

export type VenueMessage = {
  id: string;
  source: VenueSource;
  author: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  reactions: number;
};

export function venueAvatarUrl(seed: string, photo?: string | null) {
  if (photo && photo.startsWith("http")) return photo;
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1b1b1b`;
}

export type VenueFeed = {
  eventId: string;
  messages: VenueMessage[];
  hedgeLive: boolean;
};

export const VENUE_BODY_MAX = 400;

export async function loadVenueFeed(eventId: string): Promise<VenueFeed> {
  const res = await fetch(
    `/api/venue/chat?eventId=${encodeURIComponent(eventId)}`,
  );
  if (!res.ok) {
    throw new Error("Could not load venue chat.");
  }
  return (await res.json()) as VenueFeed;
}

export async function postVenueComment(
  accessToken: string,
  report: {
    eventId: string;
    eventSlug?: string | null;
    marketId?: string | null;
    wallet?: string | null;
    photo?: string | null;
    nickname?: string | null;
    body: string;
  },
): Promise<{ ok: true; message: VenueMessage }> {
  const res = await fetch("/api/venue/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(report),
  });
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    message?: VenueMessage;
  } | null;
  if (!res.ok || !data?.message) {
    throw new Error(data?.error ?? "Could not post.");
  }
  return { ok: true, message: data.message };
}
