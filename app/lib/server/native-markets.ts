import {
  NATIVE_MAX_STAKE,
  NATIVE_MIN_STAKE,
  NATIVE_SEED,
  NATIVE_USER_CAP,
  rollingNativeSpecs,
  nativePhase,
  niceStrike,
  parseSide,
  parseStake,
  payoutIfWin,
  pvpQuestion,
  strikeQuestion,
  timeframeFromSlug,
  resolveNativeOutcome,
  type NativeKind,
  type NativeMarketSpec,
  type NativeMetric,
  type NativeSide,
  type NativeTimeframe,
  type NativeTicketView,
} from "../native";
import { fetchNativeQuotes, type NativeQuote } from "./native-quotes";
import {
  nativeEscrowAddress,
  nativePayoutConfigured,
  payUsdg,
  verifyNativeStakeTx,
} from "./native-escrow";
import {
  ensurePoolListed,
  nativePoolAddress,
  nativePoolConfigured,
  poolTicket,
  resolvePool,
  verifyPoolStakeTx,
} from "./native-pool";
import { supabaseAdmin } from "./supabase";
import { toUsd, toUsdgRaw } from "../leverage-chain";

const UNIQUE_VIOLATION = "23505";

export type NativeMarketRow = {
  id: string;
  slug: string;
  kind: NativeKind;
  title: string;
  token_a: string;
  token_b: string | null;
  metric: NativeMetric | null;
  strike: number | null;
  open_at: string;
  lock_at: string;
  expiry_at: string;
  seed_a: number;
  seed_b: number;
  open_mcap_a: number | null;
  open_mcap_b: number | null;
  open_price_a: number | null;
  open_price_b: number | null;
  resolved_side: NativeSide | "void" | null;
  resolved_at: string | null;
};

export type NativeStakeRow = {
  id: string;
  created_at: string;
  market_id: string;
  privy_user_id: string;
  wallet: string | null;
  side: NativeSide;
  amount: number;
  tx_hash: string | null;
  payout_tx: string | null;
  payout_amount: number | null;
};

function n(value: unknown) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function asMarket(row: Record<string, unknown>): NativeMarketRow {
  return {
    id: String(row.id),
    slug: String(row.slug),
    kind: row.kind === "pvp" ? "pvp" : "strike",
    title: String(row.title),
    token_a: String(row.token_a),
    token_b: row.token_b ? String(row.token_b) : null,
    metric: row.metric === "price" ? "price" : row.metric === "marketCap" ? "marketCap" : null,
    strike: row.strike != null ? n(row.strike) : null,
    open_at: String(row.open_at),
    lock_at: String(row.lock_at),
    expiry_at: String(row.expiry_at),
    seed_a: n(row.seed_a),
    seed_b: n(row.seed_b),
    open_mcap_a: row.open_mcap_a != null ? n(row.open_mcap_a) : null,
    open_mcap_b: row.open_mcap_b != null ? n(row.open_mcap_b) : null,
    open_price_a: row.open_price_a != null ? n(row.open_price_a) : null,
    open_price_b: row.open_price_b != null ? n(row.open_price_b) : null,
    resolved_side:
      row.resolved_side === "b"
        ? "b"
        : row.resolved_side === "void"
          ? "void"
          : row.resolved_side === "a"
            ? "a"
            : null,
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
  };
}

export type NativePublicMarket = NativeMarketRow & {
  timeframe: NativeTimeframe | null;
  phase: ReturnType<typeof nativePhase>;
  poolA: number;
  poolB: number;
  tickets: number;
  quoteA: NativeQuote | null;
  quoteB: NativeQuote | null;
};

function quoteFor(quotes: NativeQuote[], symbol: string | null) {
  if (!symbol) return null;
  return quotes.find((q) => q.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

function view(
  market: NativeMarketRow,
  stakes: Array<{ side: NativeSide; amount: number }>,
  quotes: NativeQuote[],
): NativePublicMarket {
  const userA = stakes
    .filter((s) => s.side === "a")
    .reduce((acc, s) => acc + s.amount, 0);
  const userB = stakes
    .filter((s) => s.side === "b")
    .reduce((acc, s) => acc + s.amount, 0);
  return {
    ...market,
    timeframe: timeframeFromSlug(market.slug),
    phase: nativePhase(market),
    poolA: market.seed_a + userA,
    poolB: market.seed_b + userB,
    tickets: stakes.length,
    quoteA: quoteFor(quotes, market.token_a),
    quoteB: quoteFor(quotes, market.token_b),
  };
}

async function loadStakes(marketIds: string[]) {
  const db = supabaseAdmin();
  if (!db || marketIds.length === 0) return [] as NativeStakeRow[];
  const { data, error } = await db
    .from("native_stakes")
    .select(
      "id, created_at, market_id, privy_user_id, wallet, side, amount, tx_hash, payout_tx, payout_amount",
    )
    .in("market_id", marketIds);
  if (error) {
    console.error("[native] stakes", error);
    if (/tx_hash|payout_tx|payout_amount/i.test(error.message ?? "")) {
      const retry = await db
        .from("native_stakes")
        .select("id, created_at, market_id, privy_user_id, wallet, side, amount")
        .in("market_id", marketIds);
      return (retry.data ?? []).map((row) => ({
        id: String(row.id),
        created_at: String(row.created_at),
        market_id: String(row.market_id),
        privy_user_id: String(row.privy_user_id),
        wallet: row.wallet ? String(row.wallet) : null,
        side: row.side === "b" ? ("b" as const) : ("a" as const),
        amount: n(row.amount),
        tx_hash: null,
        payout_tx: null,
        payout_amount: null,
      }));
    }
    return [];
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    created_at: String(row.created_at),
    market_id: String(row.market_id),
    privy_user_id: String(row.privy_user_id),
    wallet: row.wallet ? String(row.wallet) : null,
    side: row.side === "b" ? "b" as const : "a" as const,
    amount: n(row.amount),
    tx_hash: row.tx_hash ? String(row.tx_hash) : null,
    payout_tx: row.payout_tx ? String(row.payout_tx) : null,
    payout_amount: row.payout_amount != null ? n(row.payout_amount) : null,
  }));
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readMarketRow(slug: string) {
  const db = supabaseAdmin();
  if (!db) return { row: null as Record<string, unknown> | null, error: null };
  const query = UUID.test(slug)
    ? db.from("native_markets").select("*").eq("id", slug)
    : db.from("native_markets").select("*").eq("slug", slug);
  const { data, error } = await query.maybeSingle();
  return { row: (data as Record<string, unknown> | null) ?? null, error };
}

function ticketPayout(
  market: NativePublicMarket,
  side: NativeSide,
  amount: number,
  payoutAmount: number | null,
) {
  if (payoutAmount != null) return payoutAmount;
  if (market.resolved_side === "void") return amount;
  if (market.resolved_side && side !== market.resolved_side) return 0;
  return payoutIfWin(
    amount,
    side === "a" ? market.poolA : market.poolB,
    side === "a" ? market.poolB : market.poolA,
  );
}

export async function listMyNativeTickets(userId: string) {
  const listed = await listNativeMarkets();
  const db = supabaseAdmin();
  if (!db || !listed.tracked) return { tickets: [] as NativeTicketView[] };
  const { data, error } = await db
    .from("native_stakes")
    .select(
      "id, created_at, market_id, privy_user_id, wallet, side, amount, tx_hash, payout_tx, payout_amount",
    )
    .eq("privy_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[native] my tickets", error);
    return { tickets: [] as NativeTicketView[] };
  }
  const byId = new Map(listed.markets.map((market) => [market.id, market]));
  const tickets: NativeTicketView[] = [];
  for (const row of data ?? []) {
    const market = byId.get(String(row.market_id));
    if (!market) continue;
    const side = row.side === "b" ? ("b" as const) : ("a" as const);
    const amount = n(row.amount);
    const onchain = row.wallet
      ? await poolTicket(market.slug, String(row.wallet))
      : null;
    const claimed = Boolean(row.payout_tx) || Boolean(onchain?.claimed);
    tickets.push({
      id: String(row.id),
      slug: market.slug,
      title: market.title,
      kind: market.kind,
      token_a: market.token_a,
      token_b: market.token_b,
      side,
      amount,
      payout: ticketPayout(
        market,
        side,
        amount,
        row.payout_amount != null ? n(row.payout_amount) : null,
      ),
      payoutTx: claimed ? String(row.payout_tx ?? "claimed") : null,
      txHash: row.tx_hash ? String(row.tx_hash) : null,
      phase: market.phase,
      resolved_side: market.resolved_side,
      expiry_at: market.expiry_at,
    });
  }
  return { tickets };
}

async function insertMarket(row: Record<string, unknown>) {
  const db = supabaseAdmin();
  if (!db) return null;
  const { data, error } = await db
    .from("native_markets")
    .insert(row)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    console.error("[native] insert market", error);
    return null;
  }
  return data ? asMarket(data as Record<string, unknown>) : null;
}

function marketPayload(
  spec: NativeMarketSpec,
  quotes: NativeQuote[],
  lock: Date,
  expiry: Date,
  openAt: Date,
  slug: string,
) {
  const qA = quoteFor(quotes, spec.tokenA);
  const qB = quoteFor(quotes, spec.tokenB);
  const strike =
    spec.kind === "strike"
      ? niceStrike(qA?.marketCap ?? 1_000_000)
      : null;
  const title =
    spec.kind === "pvp" && spec.tokenB
      ? pvpQuestion(spec.tokenA, spec.tokenB)
      : strikeQuestion(spec.tokenA, strike ?? 0, spec.metric ?? "marketCap");
  return {
    slug,
    kind: spec.kind,
    title,
    token_a: spec.tokenA,
    token_b: spec.tokenB,
    metric: spec.metric,
    strike,
    open_at: openAt.toISOString(),
    lock_at: lock.toISOString(),
    expiry_at: expiry.toISOString(),
    seed_a: NATIVE_SEED,
    seed_b: NATIVE_SEED,
    open_mcap_a: qA?.marketCap ?? null,
    open_mcap_b: qB?.marketCap ?? null,
    open_price_a: qA?.priceUsd ?? null,
    open_price_b: qB?.priceUsd ?? null,
  };
}

export async function ensureDefaultMarkets() {
  const db = supabaseAdmin();
  if (!db) return;
  const existing = await db.from("native_markets").select("slug");
  const slugs = new Set((existing.data ?? []).map((row) => String(row.slug)));
  const needed = rollingNativeSpecs().filter((row) => !slugs.has(row.slug));
  if (needed.length > 0) {
    const quotes = await fetchNativeQuotes();
    for (const row of needed) {
      await insertMarket(
        marketPayload(
          row.spec,
          quotes,
          row.lockAt,
          row.expiryAt,
          row.openAt,
          row.slug,
        ),
      );
    }
  }
  await db
    .from("native_markets")
    .update({ seed_a: NATIVE_SEED, seed_b: NATIVE_SEED })
    .is("resolved_side", null);
}

function fallbackMarkets(quotes: NativeQuote[]): NativePublicMarket[] {
  return rollingNativeSpecs().map((row) => {
    const payload = marketPayload(
      row.spec,
      quotes,
      row.lockAt,
      row.expiryAt,
      row.openAt,
      row.slug,
    );
    return {
      id: row.slug,
      slug: row.slug,
      kind: row.spec.kind,
      title: payload.title,
      token_a: payload.token_a,
      token_b: payload.token_b,
      metric: payload.metric,
      strike: payload.strike,
      timeframe: row.timeframe,
      open_at: payload.open_at,
      lock_at: payload.lock_at,
      expiry_at: payload.expiry_at,
      seed_a: payload.seed_a,
      seed_b: payload.seed_b,
      open_mcap_a: payload.open_mcap_a,
      open_mcap_b: payload.open_mcap_b,
      open_price_a: payload.open_price_a,
      open_price_b: payload.open_price_b,
      resolved_side: null,
      resolved_at: null,
      phase: nativePhase({
        lock_at: payload.lock_at,
        expiry_at: payload.expiry_at,
      }),
      poolA: NATIVE_SEED,
      poolB: NATIVE_SEED,
      tickets: 0,
      quoteA: quoteFor(quotes, row.spec.tokenA),
      quoteB: quoteFor(quotes, row.spec.tokenB),
    };
  });
}

async function openDeskVolume() {
  const db = supabaseAdmin();
  if (!db) return 0;
  const { data: open, error } = await db
    .from("native_markets")
    .select("id")
    .is("resolved_side", null);
  if (error) {
    console.error("[native] open markets", error);
    return 0;
  }
  const ids = (open ?? []).map((row) => String(row.id));
  if (ids.length === 0) return 0;
  const { data: stakes, error: stakeError } = await db
    .from("native_stakes")
    .select("amount")
    .in("market_id", ids);
  if (stakeError) {
    console.error("[native] desk volume", stakeError);
    return 0;
  }
  return (stakes ?? []).reduce((acc, row) => acc + n(row.amount), 0);
}

function winnerPayouts(stakes: NativeStakeRow[], outcome: NativeSide) {
  const poolA =
    stakes.filter((s) => s.side === "a").reduce((acc, s) => acc + toUsdgRaw(s.amount), 0n);
  const poolB =
    stakes.filter((s) => s.side === "b").reduce((acc, s) => acc + toUsdgRaw(s.amount), 0n);
  const pot = poolA + poolB;
  const winners = stakes.filter((s) => s.side === outcome);
  const side = outcome === "a" ? poolA : poolB;
  if (winners.length === 0 || side <= 0n || pot <= 0n) return [];
  let remaining = pot;
  return winners.map((stake, i) => {
    const last = i === winners.length - 1;
    const raw = last
      ? remaining
      : (toUsdgRaw(stake.amount) * pot) / side;
    if (!last) remaining -= raw;
    return { stake, amount: toUsd(raw) };
  });
}

async function markStakePaid(
  id: string,
  payoutTx: string | null,
  payoutAmount: number,
) {
  const db = supabaseAdmin();
  if (!db) return;
  await db
    .from("native_stakes")
    .update({
      payout_tx: payoutTx,
      payout_amount: payoutAmount,
    })
    .eq("id", id);
}

async function onChainStake(slug: string, wallet: string | null) {
  if (!wallet || !nativePoolConfigured()) return false;
  const ticket = await poolTicket(slug, wallet);
  return Boolean(ticket && ticket.amount > 0);
}

async function payMarket(
  slug: string,
  stakes: NativeStakeRow[],
  outcome: NativeSide | "void",
) {
  let paid = 0;
  if (outcome === "void") {
    for (const stake of stakes) {
      if (stake.payout_tx) continue;
      if (!stake.wallet) continue;
      if (await onChainStake(slug, stake.wallet)) continue;
      if (!nativePayoutConfigured()) {
        return { paid, error: "Pool is under maintenance." };
      }
      const result = await payUsdg(stake.wallet, stake.amount);
      if ("error" in result) return { paid, error: result.error };
      await markStakePaid(stake.id, result.hash, stake.amount);
      paid += 1;
    }
    return { paid };
  }
  const payouts = winnerPayouts(stakes, outcome);
  for (const row of payouts) {
    if (row.stake.payout_tx) continue;
    if (!row.stake.wallet) continue;
    if (await onChainStake(slug, row.stake.wallet)) continue;
    if (!nativePayoutConfigured()) {
      return { paid, error: "Pool is under maintenance." };
    }
    const result = await payUsdg(row.stake.wallet, row.amount);
    if ("error" in result) return { paid, error: result.error };
    await markStakePaid(row.stake.id, result.hash, row.amount);
    paid += 1;
  }
  return { paid };
}

async function settleExpiredMarkets(quotes: NativeQuote[]) {
  const db = supabaseAdmin();
  if (!db) return;
  const { data } = await db.from("native_markets").select("*").is("resolved_side", null);
  for (const raw of data ?? []) {
    const market = asMarket(raw as Record<string, unknown>);
    if (nativePhase(market) !== "locked") continue;
    const outcome = resolveNativeOutcome(
      market,
      quoteFor(quotes, market.token_a),
      quoteFor(quotes, market.token_b),
    );
    if (!outcome) continue;
    await settleNative(market.slug, outcome);
  }
}

export async function listNativeMarkets() {
  const quotes = await fetchNativeQuotes().catch(() => [] as NativeQuote[]);
  const db = supabaseAdmin();
  if (!db) {
    return {
      tracked: false,
      markets: fallbackMarkets(quotes),
      quotes,
      deskUsed: 0,
      deskCap: NATIVE_USER_CAP,
    };
  }
  await ensureDefaultMarkets();
  try {
    await settleExpiredMarkets(quotes);
  } catch (error) {
    console.error("[native] auto settle", error);
  }
  const { data, error } = await db
    .from("native_markets")
    .select("*")
    .is("resolved_side", null)
    .order("expiry_at", { ascending: true });
  if (error) {
    console.error("[native] list", error);
    return {
      tracked: false,
      markets: fallbackMarkets(quotes),
      quotes,
      deskUsed: 0,
      deskCap: NATIVE_USER_CAP,
    };
  }
  const rows = (data ?? []).map((row) => asMarket(row as Record<string, unknown>));
  const stakes = await loadStakes(rows.map((row) => row.id));
  const byMarket = new Map<string, NativeStakeRow[]>();
  for (const stake of stakes) {
    const list = byMarket.get(stake.market_id) ?? [];
    list.push(stake);
    byMarket.set(stake.market_id, list);
  }
  const deskUsed = await openDeskVolume();
  const pool = nativePoolAddress();
  return {
    tracked: true,
    quotes,
    markets: rows.map((row) => view(row, byMarket.get(row.id) ?? [], quotes)),
    deskUsed,
    deskCap: NATIVE_USER_CAP,
    escrowWallet: pool ?? nativeEscrowAddress(),
    payoutLive: nativePoolConfigured() || nativePayoutConfigured(),
  };
}

export async function getNativeMarket(slug: string, userId?: string | null) {
  const listed = await listNativeMarkets();
  const { tracked, markets, quotes, escrowWallet, payoutLive } = listed;
  let market = markets.find((row) => row.slug === slug || row.id === slug) ?? null;
  if (!market) {
    const { row } = await readMarketRow(slug);
    if (row) {
      const stored = asMarket(row);
      const stakes = await loadStakes([stored.id]);
      market = view(stored, stakes, quotes);
    }
  }
  if (!market) {
    return {
      tracked,
      market: null,
      mine: null,
      quotes,
      escrowWallet,
      payoutLive,
    };
  }
  if (!userId || !tracked) {
    return { tracked, market, mine: null, quotes, escrowWallet, payoutLive };
  }
  const db = supabaseAdmin();
  if (!db) {
    return { tracked, market, mine: null, quotes, escrowWallet, payoutLive };
  }
  const { data } = await db
    .from("native_stakes")
    .select(
      "id, created_at, market_id, privy_user_id, wallet, side, amount, tx_hash, payout_tx, payout_amount",
    )
    .eq("market_id", market.id)
    .eq("privy_user_id", userId)
    .maybeSingle();
  if (!data) {
    return { tracked, market, mine: null, quotes, escrowWallet, payoutLive };
  }
  const onchain = data.wallet
    ? await poolTicket(market.slug, String(data.wallet))
    : null;
  const claimed = Boolean(data.payout_tx) || Boolean(onchain?.claimed);
  const mine = {
    id: String(data.id),
    side: data.side === "b" ? ("b" as const) : ("a" as const),
    amount: n(data.amount),
    payout: ticketPayout(
      market,
      data.side === "b" ? "b" : "a",
      n(data.amount),
      data.payout_amount != null ? n(data.payout_amount) : null,
    ),
    payoutTx: claimed
      ? String(data.payout_tx ?? "claimed")
      : null,
    txHash: data.tx_hash ? String(data.tx_hash) : null,
  };
  return { tracked, market, mine, quotes, escrowWallet, payoutLive };
}

export async function stakeNative(input: {
  userId: string;
  slug: string;
  side: unknown;
  amount: unknown;
  wallet?: string | null;
  txHash?: string | null;
}) {
  const db = supabaseAdmin();
  if (!db) return { error: "Pool tracking is not connected.", status: 503 as const };
  if (!nativePoolConfigured() && !nativeEscrowAddress()) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  if (!input.slug.trim()) return { error: "Market not found.", status: 404 as const };
  const side = parseSide(input.side);
  const amount = parseStake(input.amount);
  if (!side) return { error: "Pick a side.", status: 400 as const };
  if (!amount) {
    return {
      error: `Stake between ${NATIVE_MIN_STAKE} and ${NATIVE_MAX_STAKE} USDG.`,
      status: 400 as const,
    };
  }
  const wallet = input.wallet?.trim() || null;
  if (!wallet) {
    return { error: "Connect a wallet that holds USDG.", status: 400 as const };
  }
  await ensureDefaultMarkets();
  const { row, error: readError } = await readMarketRow(input.slug.trim());
  if (readError) {
    console.error("[native] stake read", readError);
    return { error: "Could not load that market.", status: 502 as const };
  }
  if (!row) return { error: "Market not found.", status: 404 as const };
  const market = asMarket(row as Record<string, unknown>);
  if (nativePhase(market) !== "open") {
    return { error: "This window is locked.", status: 409 as const };
  }
  const { data: existing } = await db
    .from("native_stakes")
    .select("id")
    .eq("market_id", market.id)
    .eq("privy_user_id", input.userId)
    .maybeSingle();
  if (existing?.id) {
    return { error: "One ticket per wallet on this card.", status: 409 as const };
  }
  const deskUsed = await openDeskVolume();
  if (deskUsed + amount > NATIVE_USER_CAP + 1e-9) {
    return {
      error: `Desk cap is ${NATIVE_USER_CAP} USDG. ${Math.max(0, NATIVE_USER_CAP - deskUsed).toFixed(0)} left.`,
      status: 409 as const,
    };
  }
  if (nativePoolConfigured()) {
    const listed = await ensurePoolListed({
      slug: market.slug,
      lockAt: market.lock_at,
      expiryAt: market.expiry_at,
    });
    if ("error" in listed) {
      return { error: listed.error, status: listed.status };
    }
  }
  const verified = nativePoolConfigured()
    ? await verifyPoolStakeTx({
        hash: String(input.txHash ?? ""),
        from: wallet,
        amount,
        slug: market.slug,
      })
    : await verifyNativeStakeTx({
        hash: String(input.txHash ?? ""),
        from: wallet,
        amount,
      });
  if ("error" in verified) {
    return { error: verified.error, status: verified.status };
  }
  const { error } = await db.from("native_stakes").insert({
    market_id: market.id,
    privy_user_id: input.userId,
    wallet,
    side,
    amount,
    tx_hash: verified.hash,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: "One ticket per wallet on this card.", status: 409 as const };
    }
    console.error("[native] stake", error);
    return { error: "Could not place that ticket.", status: 502 as const };
  }
  return { ok: true as const, amount, side, txHash: verified.hash };
}

export async function settleNative(slug: string, rawSide: unknown) {
  const db = supabaseAdmin();
  if (!db) return { error: "Pool tracking is not connected.", status: 503 as const };
  const { row } = await readMarketRow(slug);
  if (!row) return { error: "Market not found.", status: 404 as const };
  const market = asMarket(row as Record<string, unknown>);
  if (market.resolved_side) {
    const stakes = await loadStakes([market.id]);
    const paid = await payMarket(market.slug, stakes, market.resolved_side);
    return { ok: true as const, side: market.resolved_side, ...paid };
  }
  let side: NativeSide | "void" | null = parseSide(rawSide);
  if (!side) {
    const quotes = await fetchNativeQuotes().catch(() => [] as NativeQuote[]);
    side = resolveNativeOutcome(
      market,
      quoteFor(quotes, market.token_a),
      quoteFor(quotes, market.token_b),
    );
  }
  if (!side) {
    return { error: "Live tape is not ready to settle this card.", status: 409 as const };
  }
  const { error } = await db
    .from("native_markets")
    .update({
      resolved_side: side,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", market.id);
  if (error) {
    console.error("[native] settle", error);
    return { error: "Could not settle.", status: 502 as const };
  }
  if (nativePoolConfigured()) {
    const resolved = await resolvePool(market.slug, side);
    if ("error" in resolved) {
      return { error: resolved.error, status: resolved.status };
    }
  }
  const stakes = await loadStakes([market.id]);
  const paid = await payMarket(market.slug, stakes, side);
  return { ok: true as const, side, ...paid };
}

export async function settleExpired() {
  const quotes = await fetchNativeQuotes().catch(() => [] as NativeQuote[]);
  await settleExpiredMarkets(quotes);
  return { ok: true as const };
}
