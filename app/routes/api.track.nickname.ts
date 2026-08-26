import type { Route } from "./+types/api.track.nickname";
import { requirePrivyUser, userHasWallet } from "../lib/server/privy-auth";
import { supabaseAdmin } from "../lib/server/supabase";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
/** Matches the maxLength on the nickname input. */
const MAX_NICKNAME = 24;

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const db = supabaseAdmin();
  if (!db) return Response.json({ ok: true, recorded: false });

  const { userId, user } = await requirePrivyUser(request);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nickname = text(body.nickname, MAX_NICKNAME);
  if (!nickname) {
    return Response.json({ error: "Enter a nickname." }, { status: 400 });
  }

  const wallet = text(body.wallet, 42);
  if (wallet && (!ADDR.test(wallet) || !userHasWallet(user, wallet))) {
    return Response.json(
      { error: "That wallet is not linked to this account." },
      { status: 403 },
    );
  }
  const address = wallet ? wallet.toLowerCase() : null;

  // Compare against what is stored rather than what the client claims, so a
  // stale tab or a repeated save cannot invent a change that never happened.
  const { data: existing, error: readError } = await db
    .from("profiles")
    .select("nickname")
    .eq("privy_user_id", userId)
    .maybeSingle();

  if (readError) {
    console.error("[track-nickname] read", readError);
    return Response.json({ error: "Could not save the nickname." }, { status: 502 });
  }

  const previous = existing?.nickname ?? null;
  const changed = previous !== nickname;

  const { error: upsertError } = await db.from("profiles").upsert(
    {
      privy_user_id: userId,
      nickname,
      wallet: address,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "privy_user_id" },
  );

  if (upsertError) {
    console.error("[track-nickname] upsert", upsertError);
    return Response.json({ error: "Could not save the nickname." }, { status: 502 });
  }

  if (!changed) return Response.json({ ok: true, recorded: false });

  const { error: logError } = await db.from("nickname_changes").insert({
    privy_user_id: userId,
    wallet: address,
    previous_nickname: previous,
    nickname,
  });

  if (logError) {
    // The profile is already current; losing one history row is not worth
    // failing the user's save over.
    console.error("[track-nickname] history", logError);
  }

  return Response.json({ ok: true, recorded: true });
}
