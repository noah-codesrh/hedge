import { cents } from "../format";
import {
  LEVERAGE_MARKETS,
  PRICE_BAND,
  leverageIsLive,
  type LeverageMarket,
} from "../leverage";
import { quoteOpenOnChain, readEngineState } from "../leverage-chain";
import {
  getEvent,
  getGammaMarket,
  isLiveMarket,
  listEvents,
  listLeverageMarkets,
  searchEvents,
  type LeverageListing,
} from "../polymarket";
import type { Market, PolymarketEvent } from "../types";
import { agentLimits } from "./agent-executor";

export type AgentDesk = "leverage" | "spot";

export type AgentMarket = {
  marketSlug: string;
  marketId: string;
  eventSlug: string;
  title: string;
  yes: number;
  no: number;
  yesCents: string;
  band: "in-band" | "off-band";
  desk: AgentDesk;
  maxLeverage: number;
  openable: boolean;
  ticketUrl: string;
};

function leverageConfigFor(market: Market): LeverageMarket | null {
  return (
    LEVERAGE_MARKETS.find(
      (m) =>
        (market.yes.tokenId && m.yesTokenId === market.yes.tokenId) ||
        m.marketId === market.id ||
        m.marketSlug === market.slug,
    ) ?? null
  );
}

function ticketUrl(eventSlug: string, marketId: string) {
  return `https://hedgeapp.trade/market/${encodeURIComponent(eventSlug)}?m=${encodeURIComponent(marketId)}`;
}

function toAgentMarket(
  event: PolymarketEvent,
  market: Market,
  config: LeverageMarket | null,
): AgentMarket {
  const yes = market.yes.price;
  const inBand = yes >= PRICE_BAND.min && yes <= PRICE_BAND.max;
  const desk: AgentDesk = config ? "leverage" : "spot";
  return {
    marketSlug: config?.marketSlug ?? market.slug,
    marketId: market.id,
    eventSlug: event.slug,
    title: config?.title ?? market.question,
    yes,
    no: market.no.price,
    yesCents: cents(yes),
    band: inBand ? "in-band" : "off-band",
    desk,
    maxLeverage: config && leverageIsLive ? config.maxLeverage : 1,
    openable: Boolean(config) && leverageIsLive,
    ticketUrl: ticketUrl(event.slug, market.id),
  };
}

function fromListing(row: LeverageListing): AgentMarket {
  return toAgentMarket(row.event, row.market, row.config);
}

function resolveListed(input: {
  marketSlug?: string;
  marketId?: string;
}): LeverageMarket | null {
  const slug = (input.marketSlug ?? "").trim();
  const id = (input.marketId ?? "").trim();
  return (
    LEVERAGE_MARKETS.find(
      (m) =>
        (slug && m.marketSlug === slug) ||
        (id && (m.marketId === id || m.yesTokenId === id)),
    ) ?? null
  );
}

export function listedMarket(input: {
  marketSlug?: string;
  marketId?: string;
}) {
  return resolveListed(input);
}

export async function resolveAgentMarket(input: {
  marketSlug?: string;
  marketId?: string;
}): Promise<AgentMarket | null> {
  const slug = (input.marketSlug ?? "").trim();
  const id = (input.marketId ?? "").trim();
  const listed = resolveListed(input);
  if (listed) {
    const event = await getEvent(listed.eventSlug).catch(() => null);
    const market = event?.markets.find(
      (m) => m.id === listed.marketId || m.yes.tokenId === listed.yesTokenId,
    );
    if (event && market) return toAgentMarket(event, market, listed);
    return {
      marketSlug: listed.marketSlug,
      marketId: listed.marketId,
      eventSlug: listed.eventSlug,
      title: listed.title,
      yes: 0,
      no: 0,
      yesCents: "-",
      band: "off-band",
      desk: "leverage",
      maxLeverage: listed.maxLeverage,
      openable: leverageIsLive,
      ticketUrl: ticketUrl(listed.eventSlug, listed.marketId),
    };
  }

  const key = id || slug;
  if (!key) return null;
  const found = await getGammaMarket(key).catch(() => null);
  if (!found) return null;
  return toAgentMarket(found.event, found.market, leverageConfigFor(found.market));
}

export async function listAgentMarkets(opts?: {
  q?: string;
  desk?: AgentDesk | "all";
  limit?: number;
  offset?: number;
}): Promise<{
  markets: AgentMarket[];
  total: number;
  leverageMarkets: number;
  hasMore: boolean;
}> {
  const desk = opts?.desk ?? "all";
  const limit = Math.min(Math.max(opts?.limit ?? 80, 1), 200);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const q = (opts?.q ?? "").trim();

  const [leverage, page] = await Promise.all([
    listLeverageMarkets().catch(() => [] as LeverageListing[]),
    q
      ? searchEvents(q).catch(() => ({ events: [] as PolymarketEvent[] }))
      : listEvents({ sort: "trending" }).catch(() => ({
          events: [] as PolymarketEvent[],
        })),
  ]);

  const seen = new Set<string>();
  const all: AgentMarket[] = [];

  for (const row of leverage) {
    const item = fromListing(row);
    if (seen.has(item.marketSlug)) continue;
    seen.add(item.marketSlug);
    all.push(item);
  }

  for (const event of page.events) {
    const live = event.markets.filter(isLiveMarket);
    const markets = live.length > 0 ? live : event.markets.slice(0, 1);
    for (const market of markets) {
      const item = toAgentMarket(event, market, leverageConfigFor(market));
      if (seen.has(item.marketSlug)) continue;
      seen.add(item.marketSlug);
      all.push(item);
    }
  }

  const filtered =
    desk === "all" ? all : all.filter((m) => m.desk === desk);
  const slice = filtered.slice(offset, offset + limit);
  return {
    markets: slice,
    total: filtered.length,
    leverageMarkets: all.filter((m) => m.desk === "leverage").length,
    hasMore: offset + slice.length < filtered.length,
  };
}

export async function agentStatus() {
  const [engine, catalog] = await Promise.all([
    readEngineState(),
    listAgentMarkets({ limit: 200 }),
  ]);
  const limits = agentLimits();
  return {
    live: leverageIsLive && !engine?.openingPaused,
    openingPaused: engine?.openingPaused ?? true,
    maxLeverage: engine?.maxLeverage ?? 1,
    minMargin: engine?.minMargin ?? limits.minMargin,
    maxMargin: Math.min(engine?.maxMargin ?? limits.maxMargin, limits.maxMargin),
    capacity: engine?.capacity ?? null,
    markets: catalog.total,
    leverageMarkets: catalog.leverageMarkets,
    betting: leverageIsLive && !engine?.openingPaused,
  };
}

export async function quoteAgentTicket(input: {
  marketSlug?: string;
  marketId?: string;
  side: "yes" | "no";
  margin: number;
  leverage: number;
}) {
  const listed = await resolveAgentMarket(input);
  if (!listed) {
    return { error: "No live market with that slug or id.", status: 404 as const };
  }

  if (listed.desk === "spot") {
    if (input.leverage > 1) {
      return {
        error:
          "Vault leverage is only on listed names. This market is 1x. Open it in the app or drop leverage to 1 to quote the book.",
        status: 409 as const,
        ticketUrl: listed.ticketUrl,
        desk: listed.desk,
      };
    }
    const entry = input.side === "yes" ? listed.yes : listed.no;
    return {
      desk: listed.desk,
      openable: false,
      marketSlug: listed.marketSlug,
      marketId: listed.marketId,
      title: listed.title,
      side: input.side,
      margin: input.margin,
      leverage: 1,
      notional: input.margin,
      yes: listed.yes,
      no: listed.no,
      ticketUrl: listed.ticketUrl,
      quote: {
        size: input.margin,
        entryPrice: entry,
        fee: 0,
        netMargin: input.margin,
        shares: entry > 0 ? input.margin / entry : 0,
        liquidationPrice: null,
        reserve: 0,
        hasCapacity: true,
        source: "book" as const,
      },
      next: "1x fills on the venue book in the app. POST /api/agent/bets opens vault tickets on desk=leverage only.",
    };
  }

  const quote = await quoteOpenOnChain({
    marketSlug: listed.marketSlug,
    isLong: input.side === "yes",
    margin: input.margin,
    leverage: input.leverage,
  });
  if (!quote) {
    return { error: "Could not quote that ticket.", status: 502 as const };
  }
  return {
    desk: listed.desk,
    openable: listed.openable,
    marketSlug: listed.marketSlug,
    marketId: listed.marketId,
    title: listed.title,
    side: input.side,
    margin: input.margin,
    leverage: input.leverage,
    notional: input.margin * input.leverage,
    ticketUrl: listed.ticketUrl,
    quote: { ...quote, source: "engine" as const },
  };
}
