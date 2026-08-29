/**
 * Find Polymarket markets that are safe to offer leverage on.
 *
 * The brief blacklists three kinds of market, and each one has a measurable
 * proxy here:
 *
 *   - High-odds markets ("Apple keeps its name", YES at $0.98) never liquidate,
 *     so capital sits earning nothing. Screened out by the price band.
 *   - Long-horizon markets ("2028 election") lock capital for years at near-zero
 *     turnover. Screened out by the end date window.
 *   - Thin niche markets can't be priced reliably, and an unreliable price is
 *     the one input that decides who gets liquidated. Screened out by CLOB
 *     liquidity, 24h volume and quoted spread.
 *
 * Short-horizon markets resolve constantly, so this is not a one-time job — the
 * shortlist goes stale within weeks. Re-run it, replace the resolved entries,
 * and list the new ids on-chain.
 *
 *   pnpm screen              # human-readable table
 *   pnpm screen --json       # markets.json-shaped, ready to paste
 */
const GAMMA = process.env.GAMMA_BASE ?? "https://gamma-api.polymarket.com";

/** The engine's tradeable band. Opening reverts outside it. */
const BAND_MIN = 0.35;
const BAND_MAX = 0.65;

/**
 * Prefer markets nearer a coin flip. One sitting at $0.36 is a single tick from
 * falling out of the band and blocking opens, which looks like a broken venue.
 */
const CORE_MIN = 0.42;
const CORE_MAX = 0.58;

const MIN_DAYS_OUT = 3;
const MAX_DAYS_OUT = 60;

const MIN_CLOB_LIQUIDITY = 25_000;
const MIN_24H_VOLUME = 20_000;
/** Wider than this and the midpoint is a guess, not a price. */
const MAX_SPREAD = 0.03;

type GammaMarket = {
  question: string;
  slug: string;
  conditionId: string;
  endDate: string;
  outcomes: string;
  outcomePrices: string;
  clobTokenIds: string;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  enableOrderBook: boolean;
  negRisk?: boolean;
  spread?: number;
  liquidityClob?: number;
  volume24hrClob?: number;
  /** Total 24h volume. This is the field results are sorted by. */
  volume24hr?: number;
  oneDayPriceChange?: number;
};

type Candidate = {
  label: string;
  slug: string;
  yesTokenId: string;
  price: number;
  spread: number;
  liquidity: number;
  volume24h: number;
  daysOut: number;
  dailyMove: number;
  score: number;
};

/** Gamma returns these as JSON-encoded strings rather than arrays. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Gamma silently caps page size at 100 however large a limit you ask for. */
const PAGE_SIZE = 100;

async function fetchPage(offset: number): Promise<GammaMarket[]> {
  const url =
    `${GAMMA}/markets?closed=false&active=true&limit=${PAGE_SIZE}&offset=${offset}` +
    `&order=volume24hr&ascending=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`gamma responded ${res.status}`);
  return (await res.json()) as GammaMarket[];
}

function evaluate(m: GammaMarket, now: number): Candidate | null {
  if (!m.active || m.closed || !m.acceptingOrders || !m.enableOrderBook) return null;

  // Binary only. Multi-outcome markets have no single YES price to relay.
  const outcomes = parseList(m.outcomes);
  if (outcomes.length !== 2) return null;
  if (outcomes[0]?.toLowerCase() !== "yes") return null;

  const tokenIds = parseList(m.clobTokenIds);
  const yesTokenId = tokenIds[0];
  if (!yesTokenId) return null;

  const price = Number(parseList(m.outcomePrices)[0]);
  if (!Number.isFinite(price) || price < BAND_MIN || price > BAND_MAX) return null;

  const endMs = Date.parse(m.endDate);
  if (!Number.isFinite(endMs)) return null;
  const daysOut = (endMs - now) / 86_400_000;
  if (daysOut < MIN_DAYS_OUT || daysOut > MAX_DAYS_OUT) return null;

  const liquidity = Number(m.liquidityClob ?? 0);
  const volume24h = Number(m.volume24hrClob ?? 0);
  const spread = Number(m.spread ?? 1);
  if (liquidity < MIN_CLOB_LIQUIDITY) return null;
  if (volume24h < MIN_24H_VOLUME) return null;
  if (spread > MAX_SPREAD) return null;

  // Rank on the things that make a market profitable to offer: it trades, it
  // moves, it is priced tightly, and it sits near the middle of the band.
  const centrality = 1 - Math.abs(price - 0.5) / 0.15;
  const dailyMove = Math.abs(Number(m.oneDayPriceChange ?? 0));
  const score =
    Math.log10(1 + volume24h) * 2 +
    Math.log10(1 + liquidity) +
    centrality * 3 +
    Math.min(dailyMove, 0.15) * 20 -
    spread * 40;

  return {
    label: m.question,
    slug: m.slug,
    yesTokenId,
    price,
    spread,
    liquidity,
    volume24h,
    daysOut,
    dailyMove,
    score,
  };
}

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

async function main() {
  const now = Date.now();
  const seen = new Map<string, Candidate>();

  // Results come back sorted by 24h volume descending, so once a whole page
  // sits under the volume floor nothing after it can qualify either.
  for (let offset = 0; offset < 3_000; offset += PAGE_SIZE) {
    let page: GammaMarket[];
    try {
      page = await fetchPage(offset);
    } catch (err) {
      console.warn(`[screen] page at offset ${offset} failed:`, err);
      break;
    }
    if (page.length === 0) break;

    for (const market of page) {
      const candidate = evaluate(market, now);
      if (candidate) seen.set(candidate.slug, candidate);
    }

    const pageBest = Math.max(...page.map((m) => Number(m.volume24hr ?? 0)));
    if (pageBest < MIN_24H_VOLUME) break;
  }

  const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
  const core = ranked.filter((c) => c.price >= CORE_MIN && c.price <= CORE_MAX);
  const edge = ranked.filter((c) => c.price < CORE_MIN || c.price > CORE_MAX);

  if (process.argv.includes("--json")) {
    const take = Number(process.env.TAKE ?? 6);
    const picks = [...core, ...edge].slice(0, take);
    console.log(
      JSON.stringify(
        picks.map((c) => ({ label: c.label, slug: c.slug, yesTokenId: c.yesTokenId })),
        null,
        2,
      ),
    );
    return;
  }

  const show = (title: string, list: Candidate[]) => {
    console.log(`\n${title} (${list.length})`);
    if (list.length === 0) {
      console.log("  none");
      return;
    }
    for (const c of list.slice(0, 15)) {
      console.log(
        `  $${c.price.toFixed(2)}  ${money(c.volume24h).padStart(6)}/24h  ` +
          `${money(c.liquidity).padStart(6)} liq  ` +
          `spread ${(c.spread * 100).toFixed(1)}%  ` +
          `${c.daysOut.toFixed(0)}d  ` +
          `move ${(c.dailyMove * 100).toFixed(1)}%`,
      );
      console.log(`         ${c.label}`);
      console.log(`         ${c.slug}`);
    }
  };

  console.log(
    `Screened for: $${BAND_MIN}-$${BAND_MAX}, ${MIN_DAYS_OUT}-${MAX_DAYS_OUT} days out, ` +
      `>${money(MIN_CLOB_LIQUIDITY)} liquidity, >${money(MIN_24H_VOLUME)} daily volume, ` +
      `<${MAX_SPREAD * 100}% spread.`,
  );
  show(`Core band $${CORE_MIN}-$${CORE_MAX} — pick from here first`, core);
  show("Inside the band but near an edge — usable, will block sooner", edge);
  console.log("\nRe-run with --json to emit markets.json entries.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
