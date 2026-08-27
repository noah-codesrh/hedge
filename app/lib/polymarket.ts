import { LEVERAGE_MARKETS, type LeverageMarket } from "./leverage";
import type { EventTag, Market, Outcome, PolymarketEvent } from "./types";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function outcome(labels: string[], prices: string[], tokens: string[], i: number): Outcome {
  return {
    label: labels[i] ?? (i === 0 ? "Yes" : "No"),
    price: num(prices[i]),
    tokenId: tokens[i] ?? null,
  };
}

export function isDustPrice(price: number) {
  return price <= 0.01 || price >= 0.99;
}

export function isLiveMarket(market: Market) {
  if (!market.acceptingOrders) return false;
  if (market.endDate && new Date(market.endDate).getTime() < Date.now()) return false;
  if (isDustPrice(market.yes.price)) return false;
  return true;
}

export function isTradeableEvent(event: PolymarketEvent) {
  return event.markets.some(isLiveMarket);
}

export function pickLiveMarket(event: PolymarketEvent): Market | undefined {
  const live = event.markets.filter(isLiveMarket);
  if (live.length === 0) return undefined;
  return [...live].sort((a, b) => b.volume24hr - a.volume24hr)[0];
}

function rankMarkets(markets: Market[]) {
  return [...markets].sort((a, b) => {
    const live = Number(isLiveMarket(b)) - Number(isLiveMarket(a));
    if (live !== 0) return live;
    return b.volume24hr - a.volume24hr;
  });
}

function mapMarket(raw: Record<string, unknown>, eventId: string): Market | null {
  if (raw.closed === true || raw.enableOrderBook === false) return null;
  const labels = parseJson<string[]>(raw.outcomes, ["Yes", "No"]);
  const prices = parseJson<string[]>(raw.outcomePrices, ["0.5", "0.5"]);
  const tokens = parseJson<string[]>(raw.clobTokenIds, []);
  return {
    id: String(raw.id),
    eventId,
    slug: String(raw.slug ?? raw.id),
    question: String(raw.question ?? ""),
    image: str(raw.image) ?? str(raw.icon),
    icon: str(raw.icon) ?? str(raw.image),
    yes: outcome(labels, prices, tokens, 0),
    no: outcome(labels, prices, tokens, 1),
    volume24hr: num(raw.volume24hr),
    liquidity: num(raw.liquidityNum ?? raw.liquidity),
    spread: raw.spread == null ? null : num(raw.spread),
    endDate: str(raw.endDateIso) ?? str(raw.endDate),
    enableOrderBook: raw.enableOrderBook !== false,
    acceptingOrders: raw.acceptingOrders !== false,
    groupItemTitle: str(raw.groupItemTitle),
  };
}

function mapEvent(raw: Record<string, unknown>): PolymarketEvent | null {
  if (raw.closed === true) return null;
  const id = String(raw.id);
  const markets = rankMarkets(
    (Array.isArray(raw.markets) ? raw.markets : [])
      .map((m) => mapMarket(m as Record<string, unknown>, id))
      .filter((m): m is Market => !!m && m.question.length > 0),
  );
  if (markets.length === 0) return null;
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => {
      const tag = t as Record<string, unknown>;
      return {
        id: String(tag.id ?? tag.slug ?? ""),
        slug: String(tag.slug ?? ""),
        label: String(tag.label ?? tag.slug ?? ""),
      } satisfies EventTag;
    })
    .filter((t) => t.slug);
  return {
    id,
    slug: String(raw.slug ?? id),
    title: String(raw.title ?? ""),
    image: str(raw.image) ?? str(raw.icon),
    icon: str(raw.icon) ?? str(raw.image),
    volume24hr: num(raw.volume24hr),
    liquidity: num(raw.liquidity),
    endDate: str(raw.endDate),
    tags,
    markets,
    marketCount: markets.length,
  };
}

export const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "politics", label: "Politics" },
  { id: "sports", label: "Sports" },
  { id: "crypto", label: "Crypto" },
  { id: "finance", label: "Finance" },
  { id: "tech", label: "Tech" },
  { id: "pop-culture", label: "Culture" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export type SubTag = {
  id: string;
  slug: string;
  label: string;
  count: number;
  image: string | null;
};

export type BrowseSection = {
  section: string | null;
  children: SubTag[];
};

const PARENT_IDS = CATEGORIES.filter((c) => c.id !== "all").map((c) => c.id);

const HIDDEN_RELATED = new Set([
  "games",
  "featured",
  "other",
  "1h",
  "today",
  "weekly-tuesday",
  "may30",
  "hit-price",
]);

type Cache<T> = { at: number; value: T };
const relatedCache = new Map<string, Cache<SubTag[]>>();
let sportIconCache: Cache<Map<string, string>> | null = null;
const CACHE_MS = 10 * 60_000;

function gammaJson(path: string) {
  return fetch(`${GAMMA}${path}`, { headers: { Accept: "application/json" } });
}

async function sportIcons(): Promise<Map<string, string>> {
  if (sportIconCache && Date.now() - sportIconCache.at < CACHE_MS) {
    return sportIconCache.value;
  }
  const map = new Map<string, string>();
  try {
    const res = await gammaJson("/sports");
    if (res.ok) {
      const rows: unknown = await res.json();
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const rec = row as {
            sport?: string;
            image?: string;
            primaryTagId?: number;
          };
          if (!rec.image) continue;
          if (rec.sport) map.set(rec.sport.toLowerCase(), rec.image);
          if (rec.primaryTagId != null) {
            map.set(String(rec.primaryTagId), rec.image);
          }
        }
      }
    }
  } catch {
    /* icons are optional */
  }
  sportIconCache = { at: Date.now(), value: map };
  return map;
}

export async function listRelatedTags(slug: string): Promise<SubTag[]> {
  const key = slug.toLowerCase();
  const hit = relatedCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const res = await gammaJson(
    `/tags/slug/${encodeURIComponent(key)}/related-tags/tags?omit_empty=true&status=active`,
  );
  if (!res.ok) {
    relatedCache.set(key, { at: Date.now(), value: [] });
    return [];
  }
  const data: unknown = await res.json();
  const icons = key === "sports" ? await sportIcons() : new Map<string, string>();
  const tags: SubTag[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(data) ? data : []) {
    const rec = row as {
      id?: string;
      slug?: string;
      label?: string;
      activeEventsCount?: number;
    };
    const childSlug = String(rec.slug ?? "").toLowerCase();
    if (!childSlug || HIDDEN_RELATED.has(childSlug) || seen.has(childSlug)) continue;
    seen.add(childSlug);
    tags.push({
      id: String(rec.id ?? childSlug),
      slug: childSlug,
      label: String(rec.label ?? rec.slug ?? childSlug),
      count: Number(rec.activeEventsCount ?? 0) || 0,
      image: icons.get(childSlug) ?? icons.get(String(rec.id ?? "")) ?? null,
    });
  }
  relatedCache.set(key, { at: Date.now(), value: tags });
  return tags;
}

export async function resolveBrowse(
  tag: string,
  sectionHint?: string | null,
): Promise<BrowseSection> {
  const current = (tag || "all").toLowerCase();
  const hint = sectionHint?.toLowerCase();
  const parent =
    hint && PARENT_IDS.includes(hint as (typeof PARENT_IDS)[number])
      ? hint
      : PARENT_IDS.includes(current as (typeof PARENT_IDS)[number])
        ? current
        : null;

  if (parent) {
    const children = await listRelatedTags(parent);
    return { section: children.length ? parent : null, children };
  }

  if (current === "all") return { section: null, children: [] };

  for (const id of PARENT_IDS) {
    const children = await listRelatedTags(id);
    if (children.some((c) => c.slug === current)) {
      return { section: id, children };
    }
  }
  return { section: null, children: [] };
}

export function browseHref(opts: {
  tag: string;
  sort?: string;
  q?: string;
  section?: string | null;
}) {
  const p = new URLSearchParams();
  if (opts.tag && opts.tag !== "all") p.set("tag", opts.tag);
  if (opts.sort && opts.sort !== "trending") p.set("sort", opts.sort);
  if (opts.q) p.set("q", opts.q);
  if (
    opts.section &&
    opts.section !== "all" &&
    opts.section !== opts.tag
  ) {
    p.set("section", opts.section);
  }
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

export function categoryLabel(id: string) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** Gamma caps /events at 100 per request. */
export const EVENT_PAGE_SIZE = 100;
/**
 * Pages rendered on the server for the first paint. Every event here is
 * serialised twice into the HTML, once as markup and once as hydration state,
 * so this is the main lever on document size — link preview crawlers refuse to
 * fetch a response past a few megabytes. The rest arrives through the scroll
 * fetcher.
 */
const INITIAL_PAGES = 1;

export type EventPage = {
  events: PolymarketEvent[];
  nextOffset: number;
  hasMore: boolean;
};

function sortParams(sort: string) {
  if (sort === "new") return { order: "id", ascending: "false" };
  if (sort === "ending") return { order: "endDate", ascending: "true" };
  return { order: "volume24hr", ascending: "false" };
}

/**
 * Markets a list response keeps per event. An outright card renders 12 rows
 * and every other card uses a single market, but events routinely carry
 * twenty or more outcomes. Each one is serialised twice into the document, as
 * markup and again as hydration state, and Twitterbot abandons a response over
 * 2 MB, so the surplus costs a link preview. The market page loads its event
 * through getEvent and is unaffected.
 */
const LIST_MARKETS_PER_EVENT = 16;

function trimForList(event: PolymarketEvent): PolymarketEvent {
  if (event.markets.length <= LIST_MARKETS_PER_EVENT) return event;
  const ranked = [...event.markets]
    .filter(isLiveMarket)
    .sort((a, b) => b.yes.price - a.yes.price)
    .slice(0, LIST_MARKETS_PER_EVENT);
  return { ...event, markets: ranked };
}

function mapRows(data: unknown, liveOnly = false) {
  const rows = Array.isArray(data)
    ? data
    : ((data as { events?: unknown[] }).events ?? []);
  const events = rows
    .map((row) => mapEvent(row as Record<string, unknown>))
    .filter((e): e is PolymarketEvent => !!e)
    .filter((e) => !liveOnly || isTradeableEvent(e))
    .map(trimForList);
  return { rows: rows.length, events };
}

export async function listEventPage(opts: {
  tag?: string;
  sort?: string;
  offset?: number;
}): Promise<EventPage> {
  const offset = Math.max(0, opts.offset ?? 0);
  const { order, ascending } = sortParams(opts.sort ?? "trending");
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: String(EVENT_PAGE_SIZE),
    offset: String(offset),
    order,
    ascending,
  });
  if (opts.tag && opts.tag !== "all") params.set("tag_slug", opts.tag);

  const res = await fetch(`${GAMMA}/events?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Gamma events failed (${res.status})`);
  const { rows, events } = mapRows(await res.json(), true);
  return {
    events,
    nextOffset: offset + rows,
    hasMore: rows >= EVENT_PAGE_SIZE,
  };
}

export async function listEvents(opts?: {
  tag?: string;
  sort?: string;
}): Promise<EventPage> {
  const tag = opts?.tag;
  const sort = opts?.sort;
  const pages = await Promise.all(
    Array.from({ length: INITIAL_PAGES }, (_, i) =>
      listEventPage({ tag, sort, offset: i * EVENT_PAGE_SIZE }),
    ),
  );

  const seen = new Set<string>();
  const events: PolymarketEvent[] = [];
  for (const page of pages) {
    for (const event of page.events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
  }

  const last = pages[pages.length - 1];
  return {
    events,
    nextOffset: INITIAL_PAGES * EVENT_PAGE_SIZE,
    hasMore: last?.hasMore ?? false,
  };
}

export async function searchEvents(q: string): Promise<EventPage> {
  const params = new URLSearchParams({
    q,
    limit_per_type: "80",
  });
  const res = await fetch(`${GAMMA}/public-search?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Gamma search failed (${res.status})`);
  const data: unknown = await res.json();
  const { events } = mapRows(data, true);
  const pagination = (data as { pagination?: { hasMore?: boolean } }).pagination;
  return {
    events,
    nextOffset: events.length,
    hasMore: pagination?.hasMore === true,
  };
}

export async function getEvent(idOrSlug: string): Promise<PolymarketEvent | null> {
  const byId = /^\d+$/.test(idOrSlug);
  const url = byId
    ? `${GAMMA}/events/${idOrSlug}`
    : `${GAMMA}/events/slug/${idOrSlug}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gamma event failed (${res.status})`);
  return mapEvent((await res.json()) as Record<string, unknown>);
}

/**
 * A leverage-listed market paired with the event it belongs to.
 *
 * Both are needed downstream: the market carries the prices and token ids, the
 * event carries the artwork, the title and the link target.
 */
export type LeverageListing = {
  event: PolymarketEvent;
  market: Market;
  config: LeverageMarket;
};

/**
 * Load every leverage-listed market.
 *
 * Fetched by event rather than through the normal list endpoint because these
 * are a fixed allowlist, and several of them are single outcomes buried inside
 * large multi-outcome events ("What price will Bitcoin hit in August?") that
 * would never surface as their own card. Events are de-duplicated so a shared
 * parent is only fetched once.
 *
 * A market that has resolved or been pulled from the allowlist simply drops
 * out; one bad entry must not empty the whole tab.
 */
export async function listLeverageMarkets(): Promise<LeverageListing[]> {
  const slugs = [...new Set(LEVERAGE_MARKETS.map((m) => m.eventSlug))];

  const events = await Promise.all(
    slugs.map(async (slug) => {
      try {
        return await getEvent(slug);
      } catch {
        return null;
      }
    }),
  );

  const bySlug = new Map(
    events.filter((e): e is PolymarketEvent => e !== null).map((e) => [e.slug, e]),
  );

  const listings: LeverageListing[] = [];
  for (const config of LEVERAGE_MARKETS) {
    const event = bySlug.get(config.eventSlug);
    if (!event) continue;
    const market = event.markets.find(
      (m) => m.id === config.marketId || m.yes.tokenId === config.yesTokenId,
    );
    if (!market || !isLiveMarket(market)) continue;
    listings.push({ event, market, config });
  }
  return listings;
}

export async function getMarketQuotes(ids: string[]) {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const quotes: Record<string, { yes: number; no: number }> = {};

  const ingest = (raw: Record<string, unknown>) => {
    const id = String(raw.id ?? "");
    if (!id) return;
    const prices = parseJson<unknown[]>(raw.outcomePrices, []);
    if (prices.length === 0) return;
    const yes = num(prices[0]);
    const no = prices[1] != null ? num(prices[1]) : 1 - yes;
    quotes[id] = { yes, no };
  };

  await Promise.all(
    unique.map(async (id) => {
      const byPath = await fetch(`${GAMMA}/markets/${id}`, {
        headers: { Accept: "application/json" },
      });
      if (byPath.ok) {
        const data: unknown = await byPath.json();
        if (data && typeof data === "object" && !Array.isArray(data)) {
          ingest(data as Record<string, unknown>);
          return;
        }
        if (Array.isArray(data) && data[0]) {
          ingest(data[0] as Record<string, unknown>);
          return;
        }
      }
      const byQuery = await fetch(`${GAMMA}/markets?id=${encodeURIComponent(id)}`, {
        headers: { Accept: "application/json" },
      });
      if (!byQuery.ok) return;
      const data: unknown = await byQuery.json();
      const row = Array.isArray(data) ? data[0] : data;
      if (row && typeof row === "object") ingest(row as Record<string, unknown>);
    }),
  );
  return quotes;
}

export interface PricePoint {
  time: number;
  value: number;
}

export async function getPriceHistory(
  tokenId: string,
  opts?: { interval?: string; fidelity?: string },
): Promise<PricePoint[]> {
  const params = new URLSearchParams({
    market: tokenId,
    interval: opts?.interval ?? "1w",
    fidelity: opts?.fidelity ?? "30",
  });
  const res = await fetch(`${CLOB}/prices-history?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data: unknown = await res.json();
  const rows = Array.isArray(data)
    ? data
    : ((data as { history?: unknown[] }).history ?? []);
  return rows
    .map((row) => {
      const p = row as { t?: number; p?: number };
      return { time: num(p.t), value: num(p.p) };
    })
    .filter((p) => p.time > 0);
}
