import {
  NATIVE_MAX_STAKE,
  NATIVE_MIN_STAKE,
  NATIVE_POOL_OPEN,
  NATIVE_SEED,
  NATIVE_USER_CAP,
  rollingNativeSpecs,
  nativeDefaultSpecs,
  nativePhase,
  niceStrike,
  parseSide,
  parseStake,
  displayImpliedP,
  payoutIfWin,
  protocolBoost,
  isDroppedNativeMarket,
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
  ensurePoolLimits,
  ensurePoolListed,
  listLiveTicketsForWallets,
  nativePoolAddress,
  nativePoolConfigured,
  poolTicket,
  poolTicketLive,
  poolMarketState,
  poolPreviewPayout,
  resolvePool,
  verifyPoolRefundTx,
  verifyPoolStakeTx,
} from "./native-pool";
import { supabaseAdmin } from "./supabase";
import { toUsd, toUsdgRaw } from "../leverage-chain";
import {
  POOL_SIDE_A,
  POOL_SIDE_B,
  poolMarketId,
} from "../hedge-pool";

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
  protocolBoost: number;
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
    protocolBoost: protocolBoost(market.slug),
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
    protocolBoost(market.slug),
  );
}

async function backfillLiveTickets(userId: string, wallets: string[]) {
  if (!nativePoolConfigured() || wallets.length === 0) return;
  const db = supabaseAdmin();
  if (!db) return;
  const live = await listLiveTicketsForWallets(wallets);
  if (live.length === 0) return;
  const { data, error } = await db.from("native_markets").select("*");
  if (error) {
    console.error("[native] backfill markets", error);
    return;
  }
  const byHash = new Map<string, NativeMarketRow>();
  for (const raw of data ?? []) {
    const market = asMarket(raw as Record<string, unknown>);
    byHash.set(poolMarketId(market.slug).toLowerCase(), market);
  }
  let wrote = false;
  for (const ticket of live) {
    if (!(ticket.amount >= NATIVE_MIN_STAKE) && !ticket.claimed) continue;
    const market = byHash.get(ticket.id.toLowerCase());
    if (!market) continue;
    const side: NativeSide | null =
      ticket.side === POOL_SIDE_B ? "b" : ticket.side === POOL_SIDE_A ? "a" : null;
    if (!side) continue;
    const { data: existing } = await db
      .from("native_stakes")
      .select("id")
      .eq("market_id", market.id)
      .eq("privy_user_id", userId)
      .maybeSingle();
    if (existing?.id) continue;
    const { error: insertError } = await db.from("native_stakes").insert({
      market_id: market.id,
      privy_user_id: userId,
      wallet: ticket.wallet,
      side,
      amount: ticket.amount,
      tx_hash: null,
    });
    if (insertError && insertError.code !== UNIQUE_VIOLATION) {
      console.error("[native] backfill insert", insertError);
      continue;
    }
    wrote = true;
  }
  if (wrote) invalidateNativeDesk();
}

export async function listMyNativeTickets(
  userId: string,
  wallets: string[] = [],
) {
  const listed = await listNativeMarkets();
  const db = supabaseAdmin();
  if (!db || !listed.tracked) return { tickets: [] as NativeTicketView[] };
  await backfillLiveTickets(userId, wallets).catch((error) =>
    console.error("[native] backfill", error),
  );
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
  const missingIds = [
    ...new Set(
      (data ?? [])
        .map((row) => String(row.market_id))
        .filter((id) => !listed.markets.some((market) => market.id === id)),
    ),
  ];
  const extraById = new Map<string, NativePublicMarket>();
  if (missingIds.length > 0) {
    const { data: extra } = await db
      .from("native_markets")
      .select("*")
      .in("id", missingIds);
    const extraRows = (extra ?? []).map((row) =>
      asMarket(row as Record<string, unknown>),
    );
    const extraStakes = await loadStakes(extraRows.map((row) => row.id));
    const byMarket = new Map<string, NativeStakeRow[]>();
    for (const stake of extraStakes) {
      const list = byMarket.get(stake.market_id) ?? [];
      list.push(stake);
      byMarket.set(stake.market_id, list);
    }
    for (const row of extraRows) {
      extraById.set(row.id, view(row, byMarket.get(row.id) ?? [], listed.quotes));
    }
  }
  const byId = new Map(listed.markets.map((market) => [market.id, market]));
  for (const [id, market] of extraById) byId.set(id, market);
  const tickets: NativeTicketView[] = [];
  const claimed = await Promise.all(
    (data ?? []).map(async (row) => {
      const market = byId.get(String(row.market_id));
      if (!market) return null;
      const wallet = row.wallet ? String(row.wallet) : "";
      const live = wallet ? await poolTicketLive(market.slug, wallet) : null;
      const onchain = wallet ? await poolTicket(market.slug, wallet) : null;
      const onLive = Boolean(live && (live.amount > 0 || live.claimed));
      const onAny = Boolean(onchain && (onchain.amount > 0 || onchain.claimed));
      if (nativePoolConfigured() && onAny && !onLive) return null;
      const claimable = wallet
        ? (await poolPreviewPayout(market.slug, wallet)) > 0
        : false;
      const expired = Date.now() >= Date.parse(market.expiry_at);
      const releasable = Boolean(
        expired && onchain && onchain.amount > 0 && !onchain.claimed,
      );
      return {
        row,
        market,
        claimed: Boolean(row.payout_tx) || Boolean(onchain?.claimed),
        claimable,
        releasable,
      };
    }),
  );
  for (const item of claimed) {
    if (!item) continue;
    const { row, market } = item;
    const side = row.side === "b" ? ("b" as const) : ("a" as const);
    const amount = n(row.amount);
    const pA = displayImpliedP(market);
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
      payoutTx: item.claimed ? String(row.payout_tx ?? "claimed") : null,
      txHash: row.tx_hash ? String(row.tx_hash) : null,
      wallet: row.wallet ? String(row.wallet) : null,
      phase: market.phase,
      resolved_side: market.resolved_side,
      expiry_at: market.expiry_at,
      timeframe: market.timeframe ?? timeframeFromSlug(market.slug),
      implied: side === "a" ? pA : 1 - pA,
      created_at: String(row.created_at),
      claimable: item.claimable,
      releasable: item.releasable,
    });
  }
  return { tickets };
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
    spec.prompt ??
    (spec.kind === "pvp" && spec.tokenB
      ? pvpQuestion(spec.tokenA, spec.tokenB)
      : strikeQuestion(spec.tokenA, strike ?? 0, spec.metric ?? "marketCap"));
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

let ensuredAt = 0;
let ensuredKey = "";
const ENSURE_MS = 60_000;

export async function ensureDefaultMarkets() {
  const db = supabaseAdmin();
  if (!db) return;
  const key = `${nativeDefaultSpecs()
    .map((row) => row.slug)
    .join(",")}:long-ansem`;
  if (ensuredKey === key && Date.now() - ensuredAt < ENSURE_MS) return;
  const existing = await db.from("native_markets").select("slug");
  const slugs = new Set((existing.data ?? []).map((row) => String(row.slug)));
  const needed = rollingNativeSpecs().filter((row) => !slugs.has(row.slug));
  if (needed.length === 0) {
    ensuredKey = key;
    ensuredAt = Date.now();
    return;
  }
  const quotes = await fetchNativeQuotes();
  const rows = needed.map((row) =>
    marketPayload(
      row.spec,
      quotes,
      row.lockAt,
      row.expiryAt,
      row.openAt,
      row.slug,
    ),
  );
  const { error } = await db.from("native_markets").insert(rows);
  if (error) {
    if (error.code !== UNIQUE_VIOLATION) {
      console.error("[native] insert markets", error);
    }
    for (const row of rows) {
      const retry = await db.from("native_markets").insert(row);
      if (retry.error && retry.error.code !== UNIQUE_VIOLATION) {
        console.error("[native] insert market", retry.error);
      }
    }
  }
  ensuredKey = key;
  ensuredAt = Date.now();
  invalidateNativeDesk();
}

function fallbackMarkets(quotes: NativeQuote[]): NativePublicMarket[] {
  return rollingNativeSpecs()
    .filter((row) => !isDroppedNativeMarket(row.slug, row.spec.tokenA, row.spec.tokenB))
    .map((row) => {
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
      protocolBoost: protocolBoost(row.slug),
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

function winnerPayouts(
  stakes: NativeStakeRow[],
  outcome: NativeSide,
  boost = 0,
) {
  const poolA =
    stakes.filter((s) => s.side === "a").reduce((acc, s) => acc + toUsdgRaw(s.amount), 0n);
  const poolB =
    stakes.filter((s) => s.side === "b").reduce((acc, s) => acc + toUsdgRaw(s.amount), 0n);
  const pot = poolA + poolB + toUsdgRaw(Math.max(0, boost));
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
  const boost = protocolBoost(slug);
  const payouts = winnerPayouts(stakes, outcome, boost);
  for (const row of payouts) {
    if (row.stake.payout_tx) continue;
    if (!row.stake.wallet) continue;
    if (await onChainStake(slug, row.stake.wallet)) {
      if (row.stake.payout_amount != null || !(boost > 0)) continue;
      if (!nativePayoutConfigured()) {
        return { paid, error: "Pool is under maintenance." };
      }
      const sideUser = stakes
        .filter((s) => s.side === outcome)
        .reduce((acc, s) => acc + s.amount, 0);
      const overlay =
        sideUser > 0 ? (row.stake.amount * boost) / sideUser : 0;
      if (!(overlay > 0.004)) continue;
      const result = await payUsdg(row.stake.wallet, overlay);
      if ("error" in result) return { paid, error: result.error };
      await markStakePaid(row.stake.id, null, row.amount);
      paid += 1;
      continue;
    }
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
  const { data: stakeRows } = await db.from("native_stakes").select("market_id");
  const ids = [
    ...new Set((stakeRows ?? []).map((row) => String(row.market_id))),
  ];
  if (ids.length === 0) return;
  const { data } = await db.from("native_markets").select("*").in("id", ids);
  const now = Date.now();
  for (const raw of data ?? []) {
    const market = asMarket(raw as Record<string, unknown>);
    const expired = now >= Date.parse(market.expiry_at);
    if (!expired && nativePhase(market) !== "locked") continue;
    const outcome =
      market.resolved_side ??
      resolveNativeOutcome(
        market,
        quoteFor(quotes, market.token_a),
        quoteFor(quotes, market.token_b),
      );
    if (!outcome) continue;
    await settleNative(market.slug, outcome);
  }
}

type NativeDesk = {
  tracked: boolean;
  markets: NativePublicMarket[];
  quotes: NativeQuote[];
  deskUsed: number;
  deskCap: number;
  escrowWallet?: string | null;
  payoutLive?: boolean;
};

const LIST_CACHE_MS = 2_000;
let listCache: { at: number; value: NativeDesk } | null = null;
let listInflight: Promise<NativeDesk> | null = null;
let housekeepAt = 0;
let housekeepInflight: Promise<void> | null = null;

function invalidateNativeDesk() {
  listCache = null;
}

function runHousekeeping() {
  if (housekeepInflight) return;
  if (Date.now() - housekeepAt < 15_000) return;
  housekeepAt = Date.now();
  housekeepInflight = (async () => {
    try {
      await ensurePoolLimits();
    } catch (error) {
      console.error("[native] pool limits", error);
    }
    try {
      const quotes = await fetchNativeQuotes().catch(() => [] as NativeQuote[]);
      await settleExpiredMarkets(quotes);
    } catch (error) {
      console.error("[native] auto settle", error);
    }
  })().finally(() => {
    housekeepInflight = null;
  });
}

async function loadNativeDesk(): Promise<NativeDesk> {
  const quotesPromise = fetchNativeQuotes().catch(() => [] as NativeQuote[]);
  const db = supabaseAdmin();
  if (!db) {
    const quotes = await quotesPromise;
    return {
      tracked: false,
      markets: fallbackMarkets(quotes),
      quotes,
      deskUsed: 0,
      deskCap: NATIVE_USER_CAP,
    };
  }
  runHousekeeping();
  await ensureDefaultMarkets();
  const [{ data, error }, quotes] = await Promise.all([
    db
      .from("native_markets")
      .select("*")
      .is("resolved_side", null)
      .order("expiry_at", { ascending: true }),
    quotesPromise,
  ]);
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
  const pool = nativePoolAddress();
  return {
    tracked: true,
    quotes,
    markets: rows
      .map((row) => view(row, byMarket.get(row.id) ?? [], quotes))
      .filter((row) => !isDroppedNativeMarket(row.slug, row.token_a, row.token_b)),
    deskUsed: stakes.reduce((acc, row) => acc + row.amount, 0),
    deskCap: NATIVE_USER_CAP,
    escrowWallet: pool ?? nativeEscrowAddress(),
    payoutLive: nativePoolConfigured() || nativePayoutConfigured(),
  };
}

export async function listNativeMarkets() {
  if (listCache && Date.now() - listCache.at < LIST_CACHE_MS) return listCache.value;
  if (listInflight) return listInflight;
  listInflight = loadNativeDesk()
    .then((value) => {
      listCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      listInflight = null;
    });
  return listInflight;
}

export async function getNativeMarket(
  slug: string,
  userId?: string | null,
  wallets: string[] = [],
) {
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
  if (
    market &&
    isDroppedNativeMarket(market.slug, market.token_a, market.token_b)
  ) {
    market = null;
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
  if (nativePhase(market) === "open" && nativePoolConfigured()) {
    void ensurePoolListed({
      slug: market.slug,
      lockAt: market.lock_at,
      expiryAt: market.expiry_at,
    }).catch((error) => console.error("[native] listMarket", error));
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
  let row = data;
  if (!row && wallets.length > 0 && nativePoolConfigured()) {
    for (const wallet of wallets) {
      const synced = await syncOnchainStake({
        userId,
        slug: market.slug,
        wallet,
      });
      if ("error" in synced) continue;
      const again = await db
        .from("native_stakes")
        .select(
          "id, created_at, market_id, privy_user_id, wallet, side, amount, tx_hash, payout_tx, payout_amount",
        )
        .eq("market_id", market.id)
        .eq("privy_user_id", userId)
        .maybeSingle();
      row = again.data;
      break;
    }
  }
  if (!row) {
    return { tracked, market, mine: null, quotes, escrowWallet, payoutLive };
  }
  const wallet = row.wallet ? String(row.wallet) : "";
  const live = wallet ? await poolTicketLive(market.slug, wallet) : null;
  const onchain = wallet ? await poolTicket(market.slug, wallet) : null;
  const onLive = Boolean(live && (live.amount > 0 || live.claimed));
  const onAny = Boolean(onchain && (onchain.amount > 0 || onchain.claimed));
  if (nativePoolConfigured() && onAny && !onLive) {
    return { tracked, market, mine: null, quotes, escrowWallet, payoutLive };
  }
  const claimed = Boolean(row.payout_tx) || Boolean(onchain?.claimed);
  const mine = {
    id: String(row.id),
    side: row.side === "b" ? ("b" as const) : ("a" as const),
    amount: n(row.amount),
    payout: ticketPayout(
      market,
      row.side === "b" ? "b" : "a",
      n(row.amount),
      row.payout_amount != null ? n(row.payout_amount) : null,
    ),
    payoutTx: claimed
      ? String(row.payout_tx ?? "claimed")
      : null,
    txHash: row.tx_hash ? String(row.tx_hash) : null,
    created_at: String(row.created_at),
  };
  return { tracked, market, mine, quotes, escrowWallet, payoutLive };
}

export async function prepareNativeStake(slug: string) {
  if (!NATIVE_POOL_OPEN) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  const db = supabaseAdmin();
  if (!db) return { error: "Pool tracking is not connected.", status: 503 as const };
  const { row, error: readError } = await readMarketRow(slug.trim());
  if (readError) {
    console.error("[native] prepare read", readError);
    return { error: "Could not load that market.", status: 502 as const };
  }
  if (!row) return { error: "Market not found.", status: 404 as const };
  const market = asMarket(row as Record<string, unknown>);
  if (nativePhase(market) !== "open") {
    return { error: "This window is locked.", status: 409 as const };
  }
  if (!nativePoolConfigured()) return { ok: true as const, skipped: true };
  return ensurePoolListed({
    slug: market.slug,
    lockAt: market.lock_at,
    expiryAt: market.expiry_at,
  });
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
  if (!NATIVE_POOL_OPEN || (!nativePoolConfigured() && !nativeEscrowAddress())) {
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
    const onchain = nativePoolConfigured()
      ? await poolTicket(market.slug, wallet)
      : null;
    const sideMatch =
      onchain &&
      ((side === "a" && onchain.side === POOL_SIDE_A) ||
        (side === "b" && onchain.side === POOL_SIDE_B));
    if (!onchain || !sideMatch || Math.abs(onchain.amount - amount) > 0.02) {
      return { error: verified.error, status: verified.status };
    }
  }
  const txHash =
    "error" in verified ? null : verified.hash;
  const { error } = await db.from("native_stakes").insert({
    market_id: market.id,
    privy_user_id: input.userId,
    wallet,
    side,
    amount,
    tx_hash: txHash,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: "One ticket per wallet on this card.", status: 409 as const };
    }
    console.error("[native] stake", error);
    return { error: "Could not place that ticket.", status: 502 as const };
  }
  invalidateNativeDesk();
  return { ok: true as const, amount, side, txHash };
}

export async function refundNative(input: {
  userId: string;
  slug: string;
  wallet?: string | null;
  txHash?: string | null;
}) {
  const db = supabaseAdmin();
  if (!db) return { error: "Pool tracking is not connected.", status: 503 as const };
  if (!nativePoolConfigured()) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  const wallet = input.wallet?.trim() || null;
  if (!wallet) {
    return { error: "Connect the wallet that holds this ticket.", status: 400 as const };
  }
  const { row, error: readError } = await readMarketRow(input.slug.trim());
  if (readError) {
    console.error("[native] refund read", readError);
    return { error: "Could not load that market.", status: 502 as const };
  }
  if (!row) return { error: "Market not found.", status: 404 as const };
  const market = asMarket(row as Record<string, unknown>);
  if (nativePhase(market) !== "open") {
    return { error: "This window is locked.", status: 409 as const };
  }
  const { data: existing } = await db
    .from("native_stakes")
    .select("id, wallet, amount")
    .eq("market_id", market.id)
    .eq("privy_user_id", input.userId)
    .maybeSingle();
  if (!existing?.id) {
    return { error: "No ticket on this card.", status: 404 as const };
  }
  const hash = String(input.txHash ?? "");
  const onchain = await poolTicket(market.slug, wallet);
  if (hash) {
    const verified = await verifyPoolRefundTx({
      hash,
      from: wallet,
      slug: market.slug,
    });
    if ("error" in verified) {
      if (onchain && onchain.amount > 0) {
        return { error: verified.error, status: verified.status };
      }
    }
  } else if (onchain && onchain.amount > 0) {
    return { error: "Refund this ticket on chain first.", status: 409 as const };
  }
  const { error } = await db.from("native_stakes").delete().eq("id", existing.id);
  if (error) {
    console.error("[native] refund", error);
    return { error: "Could not clear that ticket.", status: 502 as const };
  }
  invalidateNativeDesk();
  return { ok: true as const };
}

export async function syncOnchainStake(input: {
  userId: string;
  slug: string;
  wallet: string;
}) {
  const db = supabaseAdmin();
  if (!db) return { error: "Pool tracking is not connected.", status: 503 as const };
  if (!NATIVE_POOL_OPEN || !nativePoolConfigured()) {
    return { error: "Pool is under maintenance.", status: 503 as const };
  }
  const wallet = input.wallet.trim();
  if (!wallet) {
    return { error: "Connect a wallet that holds USDG.", status: 400 as const };
  }
  await ensureDefaultMarkets();
  const { row, error: readError } = await readMarketRow(input.slug.trim());
  if (readError) {
    console.error("[native] sync read", readError);
    return { error: "Could not load that market.", status: 502 as const };
  }
  if (!row) return { error: "Market not found.", status: 404 as const };
  const market = asMarket(row as Record<string, unknown>);
  const { data: existing } = await db
    .from("native_stakes")
    .select("id, side, amount, tx_hash")
    .eq("market_id", market.id)
    .eq("privy_user_id", input.userId)
    .maybeSingle();
  if (existing?.id) {
    return {
      ok: true as const,
      amount: n(existing.amount),
      side: existing.side === "b" ? ("b" as const) : ("a" as const),
      txHash: existing.tx_hash ? String(existing.tx_hash) : null,
      synced: true as const,
    };
  }
  const ticket = await poolTicket(market.slug, wallet);
  if (!ticket || !(ticket.amount >= NATIVE_MIN_STAKE)) {
    return { error: "No on-chain ticket for this wallet.", status: 404 as const };
  }
  const side: NativeSide | null =
    ticket.side === POOL_SIDE_B ? "b" : ticket.side === POOL_SIDE_A ? "a" : null;
  if (!side) {
    return { error: "On-chain ticket has no side.", status: 409 as const };
  }
  const { error } = await db.from("native_stakes").insert({
    market_id: market.id,
    privy_user_id: input.userId,
    wallet,
    side,
    amount: ticket.amount,
    tx_hash: null,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: true as const,
        amount: ticket.amount,
        side,
        txHash: null,
        synced: true as const,
      };
    }
    console.error("[native] sync", error);
    return { error: "Could not record that ticket.", status: 502 as const };
  }
  invalidateNativeDesk();
  return {
    ok: true as const,
    amount: ticket.amount,
    side,
    txHash: null,
    synced: true as const,
  };
}

export async function settleNative(slug: string, rawSide: unknown) {
  const db = supabaseAdmin();
  if (!db) return { error: "Pool tracking is not connected.", status: 503 as const };
  const { row } = await readMarketRow(slug);
  if (!row) return { error: "Market not found.", status: 404 as const };
  const market = asMarket(row as Record<string, unknown>);
  if (market.resolved_side) {
    if (nativePoolConfigured()) {
      const resolved = await resolvePool(market.slug, market.resolved_side);
      if ("error" in resolved) {
        return { error: resolved.error, status: resolved.status };
      }
    }
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

const WALLET = /^0x[0-9a-fA-F]{40}$/;

/**
 * Holder-triggered release: settle an expired card they still hold, so
 * `claim` can return the stake on a one-sided pot (or winnings if they won).
 */
export async function releaseNativeTicket(input: {
  userId: string;
  wallets: string[];
  slug: string;
}) {
  const db = supabaseAdmin();
  if (!db) return { error: "Pool tracking is not connected.", status: 503 as const };
  const slug = input.slug.trim();
  if (!slug) return { error: "Missing market.", status: 400 as const };
  const { row } = await readMarketRow(slug);
  if (!row) return { error: "Market not found.", status: 404 as const };
  const market = asMarket(row as Record<string, unknown>);
  if (Date.now() < Date.parse(market.expiry_at)) {
    return { error: "This card is still open.", status: 409 as const };
  }
  const { data: stakes } = await db
    .from("native_stakes")
    .select("wallet")
    .eq("privy_user_id", input.userId)
    .eq("market_id", market.id);
  const candidates = [
    ...new Set(
      [...(stakes ?? []).map((s) => String(s.wallet ?? "")), ...input.wallets]
        .map((w) => w.trim())
        .filter((w) => WALLET.test(w)),
    ),
  ];
  let wallet: string | null = null;
  for (const addr of candidates) {
    const ticket = await poolTicket(slug, addr);
    if (ticket && ticket.amount > 0 && !ticket.claimed) {
      wallet = addr;
      break;
    }
  }
  if (!wallet) {
    return { error: "No open ticket in a linked wallet.", status: 404 as const };
  }

  const state = await poolMarketState(slug);
  if (!state) return { error: "This card is not on chain.", status: 404 as const };

  if (state.outcome === 0) {
    const oneSided = state.poolA <= 0 || state.poolB <= 0;
    if (!oneSided) {
      const quotes = await fetchNativeQuotes().catch(() => [] as NativeQuote[]);
      const tape = resolveNativeOutcome(
        market,
        quoteFor(quotes, market.token_a),
        quoteFor(quotes, market.token_b),
      );
      if (!tape) {
        return {
          error: "Live tape is not ready to settle this card.",
          status: 409 as const,
        };
      }
      const settled = await settleNative(slug, tape);
      if ("error" in settled) {
        return { error: settled.error, status: settled.status };
      }
    } else {
      const resolved = await resolvePool(slug, "void");
      if ("error" in resolved) {
        return { error: resolved.error, status: resolved.status };
      }
      await db
        .from("native_markets")
        .update({
          resolved_side: "void",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", market.id);
      invalidateNativeDesk();
    }
  }

  const payout = await poolPreviewPayout(slug, wallet);
  return { ok: true as const, payout, wallet };
}
