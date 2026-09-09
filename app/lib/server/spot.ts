import { cents } from "../format";
import { EMPTY_BOOK, fillBuy, getOrderBook } from "../orderbook";
import {
  getGammaMarket,
  isLiveMarket,
  listEvents,
  searchEvents,
} from "../polymarket";
import { parseReferralCode } from "../referral";
import {
  buildSpotTicketUrl,
  parseSpotAmount,
  type SpotSide,
} from "../spot-ticket";
import type { Market, PolymarketEvent } from "../types";

export type SpotMarket = {
  marketSlug: string;
  marketId: string;
  eventSlug: string;
  title: string;
  yes: number;
  no: number;
  yesCents: string;
  yesTokenId: string | null;
  noTokenId: string | null;
  live: boolean;
  ticketUrl: string;
};

function toSpotMarket(
  event: PolymarketEvent,
  market: Market,
  origin: string,
): SpotMarket {
  return {
    marketSlug: market.slug,
    marketId: market.id,
    eventSlug: event.slug,
    title: market.question || event.title,
    yes: market.yes.price,
    no: market.no.price,
    yesCents: cents(market.yes.price),
    yesTokenId: market.yes.tokenId,
    noTokenId: market.no.tokenId,
    live: isLiveMarket(market),
    ticketUrl: buildSpotTicketUrl({
      origin,
      eventSlug: event.slug,
      marketId: market.id,
    }),
  };
}

export async function listSpotMarkets(opts: {
  origin: string;
  q?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = (opts.q ?? "").trim();
  const page = q
    ? await searchEvents(q).catch(() => ({ events: [] as PolymarketEvent[] }))
    : await listEvents({ sort: "trending" }).catch(() => ({
        events: [] as PolymarketEvent[],
      }));

  const seen = new Set<string>();
  const all: SpotMarket[] = [];
  for (const event of page.events) {
    const live = event.markets.filter(isLiveMarket);
    const markets = live.length > 0 ? live : event.markets.slice(0, 1);
    for (const market of markets) {
      if (seen.has(market.id)) continue;
      seen.add(market.id);
      all.push(toSpotMarket(event, market, opts.origin));
    }
  }

  const slice = all.slice(offset, offset + limit);
  return {
    markets: slice,
    total: all.length,
    hasMore: offset + slice.length < all.length,
  };
}

export async function quoteSpotTicket(input: {
  origin: string;
  marketSlug?: string;
  marketId?: string;
  side: SpotSide;
  amount: number;
  ref?: string;
}) {
  const amount = parseSpotAmount(input.amount);
  if (amount == null) {
    return {
      error: "Set amount to at least $1.",
      status: 400 as const,
    };
  }

  const key = (input.marketId ?? input.marketSlug ?? "").trim();
  if (!key) {
    return { error: "Set marketId or marketSlug.", status: 400 as const };
  }

  const found = await getGammaMarket(key).catch(() => null);
  if (!found) {
    return {
      error: "No live market with that slug or id.",
      status: 404 as const,
    };
  }

  const { event, market } = found;
  if (!isLiveMarket(market)) {
    return { error: "That market is not accepting orders.", status: 409 as const };
  }

  const tokenId = input.side === "yes" ? market.yes.tokenId : market.no.tokenId;
  const book = tokenId ? await getOrderBook(tokenId) : EMPTY_BOOK;
  const fill = fillBuy(book.asks, amount);
  const mid = input.side === "yes" ? market.yes.price : market.no.price;
  const ticketUrl = buildSpotTicketUrl({
    origin: input.origin,
    eventSlug: event.slug,
    marketId: market.id,
    side: input.side,
    amount,
    ref: parseReferralCode(input.ref) ?? undefined,
  });

  return {
    desk: "spot" as const,
    marketSlug: market.slug,
    marketId: market.id,
    eventSlug: event.slug,
    title: market.question || event.title,
    side: input.side,
    amount,
    live: true,
    yes: market.yes.price,
    no: market.no.price,
    yesTokenId: market.yes.tokenId,
    noTokenId: market.no.tokenId,
    ticketUrl,
    quote: {
      size: amount,
      spent: Number(fill.spent.toFixed(2)),
      shares: Number(fill.shares.toFixed(4)),
      entryPrice: fill.avgPrice > 0 ? Number(fill.avgPrice.toFixed(4)) : mid,
      unfilled: Number(fill.unfilled.toFixed(2)),
      fillable: fill.unfilled < amount * 0.05,
      source: "book" as const,
    },
    next: "Open ticketUrl. The user signs in on Hedge and confirms the 1x fill.",
  };
}
