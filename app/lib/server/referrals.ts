import {
  REFERRAL_MIN_CLAIM,
  REFERRAL_SHARE_BPS,
  REFERRAL_TAKE_BPS,
  parseReferralCode,
  randomReferralCode,
  referralShareOfVolume,
} from "../referral";
import { supabaseAdmin } from "./supabase";

const UNIQUE_VIOLATION = "23505";

async function lookupOwner(code: string) {
  const db = supabaseAdmin();
  if (!db) return null;
  const live = await db
    .from("referral_codes")
    .select("privy_user_id, code")
    .eq("code", code)
    .maybeSingle();
  if (live.data?.privy_user_id) return live.data.privy_user_id as string;
  const old = await db
    .from("referral_code_history")
    .select("privy_user_id")
    .eq("code", code)
    .maybeSingle();
  return (old.data?.privy_user_id as string | undefined) ?? null;
}

export async function setReferralCode(userId: string, raw: string) {
  const db = supabaseAdmin();
  if (!db) return { error: "Tracking is not connected.", status: 503 as const };
  const code = parseReferralCode(raw);
  if (!code) {
    return {
      error:
        "Use 3 to 24 letters, numbers, or hyphens. Start and end with a letter or number.",
      status: 400 as const,
    };
  }

  const owner = await lookupOwner(code);
  if (owner && owner !== userId) {
    return { error: "That name is taken.", status: 409 as const };
  }

  const current = await db
    .from("referral_codes")
    .select("code")
    .eq("privy_user_id", userId)
    .maybeSingle();
  const previous = (current.data?.code as string | undefined) ?? null;
  if (previous && previous !== code) {
    await db.from("referral_code_history").upsert(
      {
        code: previous,
        privy_user_id: userId,
        replaced_at: new Date().toISOString(),
      },
      { onConflict: "code" },
    );
  }

  const { error } = await db.from("referral_codes").upsert(
    {
      privy_user_id: userId,
      code,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "privy_user_id" },
  );
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: "That name is taken.", status: 409 as const };
    }
    console.error("[referral] set code", error);
    return { error: "Could not save that name.", status: 502 as const };
  }
  return { ok: true as const, code };
}

async function ensureReferralCode(userId: string) {
  const db = supabaseAdmin();
  if (!db) return null;
  const current = await db
    .from("referral_codes")
    .select("code")
    .eq("privy_user_id", userId)
    .maybeSingle();
  if (current.data?.code) return current.data.code as string;

  for (let i = 0; i < 12; i++) {
    const code = randomReferralCode();
    if (!parseReferralCode(code)) continue;
    const taken = await lookupOwner(code);
    if (taken) continue;
    const { error } = await db.from("referral_codes").insert({
      privy_user_id: userId,
      code,
    });
    if (!error) return code;
    if (error.code === UNIQUE_VIOLATION) {
      const again = await db
        .from("referral_codes")
        .select("code")
        .eq("privy_user_id", userId)
        .maybeSingle();
      if (again.data?.code) return again.data.code as string;
      continue;
    }
    console.error("[referral] assign code", error);
    return null;
  }
  return null;
}

export async function bindReferral(userId: string, raw: string) {
  const db = supabaseAdmin();
  if (!db) return { error: "Tracking is not connected.", status: 503 as const };
  const code = parseReferralCode(raw);
  if (!code) return { ok: true as const, bound: false };

  const existing = await db
    .from("referrals")
    .select("referrer_id")
    .eq("referee_id", userId)
    .maybeSingle();
  if (existing.data?.referrer_id) return { ok: true as const, bound: false };

  const referrerId = await lookupOwner(code);
  if (!referrerId || referrerId === userId) {
    return { ok: true as const, bound: false };
  }

  const { error } = await db.from("referrals").insert({
    referee_id: userId,
    referrer_id: referrerId,
    code,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: true as const, bound: false };
    console.error("[referral] bind", error);
    return { error: "Could not save the referral.", status: 502 as const };
  }
  return { ok: true as const, bound: true };
}

export async function creditReferralTrade(input: {
  refereeId: string;
  tradeId: string | null;
  volume: number;
}) {
  const db = supabaseAdmin();
  if (!db || !(input.volume > 0)) return;
  const link = await db
    .from("referrals")
    .select("referrer_id, referee_id")
    .eq("referee_id", input.refereeId)
    .maybeSingle();
  const referrerId = link.data?.referrer_id as string | undefined;
  if (!referrerId) return;

  const amount = referralShareOfVolume(input.volume);
  if (amount < 0.000001) return;

  const { error } = await db.from("referral_earnings").insert({
    referrer_id: referrerId,
    referee_id: input.refereeId,
    trade_id: input.tradeId,
    volume: input.volume,
    take_bps: REFERRAL_TAKE_BPS,
    share_bps: REFERRAL_SHARE_BPS,
    amount,
    status: "pending",
  });
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error("[referral] credit", error);
  }
}

export async function loadReferralStats(userId: string) {
  const db = supabaseAdmin();
  if (!db) {
    return {
      tracked: false,
      payoutReady: false,
      code: null as string | null,
      referred: 0,
      volume: 0,
      earned: 0,
      claimable: 0,
      paid: 0,
      minClaim: REFERRAL_MIN_CLAIM,
      takeBps: REFERRAL_TAKE_BPS,
      shareBps: REFERRAL_SHARE_BPS,
      leaders: [] as Array<{ code: string; referred: number; volume: number }>,
    };
  }

  const [codeRow, links, earnings, leaders] = await Promise.all([
    db
      .from("referral_codes")
      .select("code")
      .eq("privy_user_id", userId)
      .maybeSingle(),
    db
      .from("referrals")
      .select("referee_id")
      .eq("referrer_id", userId),
    db
      .from("referral_earnings")
      .select("amount, volume, status")
      .eq("referrer_id", userId),
    db
      .from("referral_earnings")
      .select("referrer_id, volume")
      .limit(4000),
  ]);

  if (codeRow.error || links.error || earnings.error) {
    console.error(
      "[referral] stats",
      codeRow.error ?? links.error ?? earnings.error,
    );
    return {
      tracked: false,
      payoutReady: false,
      code: null,
      referred: 0,
      volume: 0,
      earned: 0,
      claimable: 0,
      paid: 0,
      minClaim: REFERRAL_MIN_CLAIM,
      takeBps: REFERRAL_TAKE_BPS,
      shareBps: REFERRAL_SHARE_BPS,
      leaders: [],
    };
  }

  const rows = earnings.data ?? [];
  const claimable = rows
    .filter((row) => row.status === "pending")
    .reduce((acc, row) => acc + Number(row.amount ?? 0), 0);
  const paidTotal = rows
    .filter((row) => row.status === "paid")
    .reduce((acc, row) => acc + Number(row.amount ?? 0), 0);
  const volume = rows.reduce((acc, row) => acc + Number(row.volume ?? 0), 0);
  const earned = rows.reduce((acc, row) => acc + Number(row.amount ?? 0), 0);

  const byReferrer = new Map<string, number>();
  for (const row of leaders.data ?? []) {
    const id = String(row.referrer_id ?? "");
    if (!id) continue;
    byReferrer.set(id, (byReferrer.get(id) ?? 0) + Number(row.volume ?? 0));
  }
  const topIds = [...byReferrer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);
  const names =
    topIds.length > 0
      ? await db
          .from("referral_codes")
          .select("privy_user_id, code")
          .in("privy_user_id", topIds)
      : { data: [] as Array<{ privy_user_id: string; code: string }> };
  const nameById = new Map(
    (names.data ?? []).map((row) => [row.privy_user_id, row.code]),
  );
  const referredBy =
    topIds.length > 0
      ? await db.from("referrals").select("referrer_id").in("referrer_id", topIds)
      : { data: [] as Array<{ referrer_id: string }> };
  const countBy = new Map<string, number>();
  for (const row of referredBy.data ?? []) {
    const id = String(row.referrer_id);
    countBy.set(id, (countBy.get(id) ?? 0) + 1);
  }

  const assigned =
    (codeRow.data?.code as string | undefined) ??
    (await ensureReferralCode(userId));

  return {
    tracked: true,
    payoutReady: false,
    code: assigned,
    referred: links.data?.length ?? 0,
    volume,
    earned,
    claimable,
    paid: paidTotal,
    minClaim: REFERRAL_MIN_CLAIM,
    takeBps: REFERRAL_TAKE_BPS,
    shareBps: REFERRAL_SHARE_BPS,
    leaders: topIds.map((id) => ({
      code: nameById.get(id) ?? `${id.slice(0, 6)}`,
      referred: countBy.get(id) ?? 0,
      volume: byReferrer.get(id) ?? 0,
    })),
  };
}

export async function claimReferral() {
  return {
    error: "Top referrers are paid manually.",
    status: 503 as const,
  };
}
