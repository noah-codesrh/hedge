import type { Route } from "./+types/api.venue.chat";
import {
  requirePrivyUser,
  userHasWallet,
} from "../lib/server/privy-auth";
import {
  insertVenueComment,
  loadVenueFeed,
} from "../lib/server/venue-chat";

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const eventId = new URL(request.url).searchParams.get("eventId")?.trim();
  if (!eventId) {
    return Response.json({ error: "eventId is required." }, { status: 400 });
  }
  const feed = await loadVenueFeed(eventId);
  return Response.json(feed, {
    headers: { "Cache-Control": "public, max-age=8" },
  });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { userId, user } = await requirePrivyUser(request);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId = text(body.eventId, 64);
  if (!eventId) {
    return Response.json({ error: "eventId is required." }, { status: 400 });
  }

  const wallet = text(body.wallet, 42);
  if (wallet && !userHasWallet(user, wallet)) {
    return Response.json(
      { error: "That wallet is not linked to this account." },
      { status: 403 },
    );
  }

  const photo = text(body.photo, 400);
  if (photo && !/^https:\/\//i.test(photo)) {
    return Response.json({ error: "Invalid photo." }, { status: 400 });
  }

  const result = await insertVenueComment({
    userId,
    eventId,
    eventSlug: text(body.eventSlug, 160),
    marketId: text(body.marketId, 64),
    body: body.body,
    wallet,
    photo,
    nickname: text(body.nickname, 24),
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true, message: result.message });
}
