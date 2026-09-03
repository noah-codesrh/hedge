import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/market.$id";
import { ArrowLeftIcon } from "../components/icons";
import { ChanceBar } from "../components/OutrightCard";
import { PriceChart } from "../components/PriceChart";
import { TradePanel } from "../components/TradePanel";
import { VenueChat } from "../components/VenueChat";
import {
  getEvent,
  getPriceHistory,
  isLiveMarket,
  pickLiveMarket,
  type PricePoint,
} from "../lib/polymarket";
import { formatEnd, pct, usd } from "../lib/format";
import type { Market, Side } from "../lib/types";
import { originFromMatches, siteMeta } from "../lib/seo";
import { RemoteImg } from "../components/RemoteImg";

const MARKET_PREVIEW = 6;

function previewMarkets(markets: Market[], activeId: string, limit: number) {
  if (markets.length <= limit) return markets;
  const head = markets.slice(0, limit);
  if (head.some((row) => row.id === activeId)) return head;
  const active = markets.find((row) => row.id === activeId);
  if (!active) return head;
  return [...head.slice(0, limit - 1), active];
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const title = loaderData?.event?.title ?? "Market";
  return siteMeta({ title: `${title} - Hedge`, origin: originFromMatches(matches) });
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const event = await getEvent(params.id);
  if (!event) return { event: null, history: [] as PricePoint[], defaultMarketId: null };
  const wanted = new URL(request.url).searchParams.get("m");
  const wantedMarket = wanted
    ? event.markets.find((m) => m.id === wanted)
    : undefined;
  const market =
    wantedMarket ?? pickLiveMarket(event) ?? event.markets[0];
  const tokenId = market?.yes.tokenId;
  const history = tokenId ? await getPriceHistory(tokenId) : [];
  return { event, history, defaultMarketId: market?.id ?? null };
}

export default function MarketPage({ loaderData }: Route.ComponentProps) {
  const { event, defaultMarketId } = loaderData;
  const [params] = useSearchParams();
  const initialSide = (params.get("s") === "no" ? "no" : "yes") as Side;
  const lev = Number(params.get("lev"));
  const initialLeverage = lev === 2 || lev === 3 || lev === 4 ? lev : 1;
  const queriedMarket = params.get("m");
  const [activeId, setActiveId] = useState<string | undefined>(
    queriedMarket ?? defaultMarketId ?? undefined,
  );
  const [history, setHistory] = useState(loaderData.history);
  const [chartBusy, setChartBusy] = useState(false);
  const [outcomesOpen, setOutcomesOpen] = useState(false);

  useEffect(() => {
    if (queriedMarket) setActiveId(queriedMarket);
  }, [queriedMarket]);

  useEffect(() => {
    setOutcomesOpen(false);
  }, [event?.id]);

  const market =
    event?.markets.find((m) => m.id === activeId) ??
    (event ? pickLiveMarket(event) : undefined);

  useEffect(() => {
    if (!market) return;
    const tokenId = market.yes.tokenId;
    if (!tokenId) {
      setHistory([]);
      return;
    }
    if (market.id === defaultMarketId) {
      setHistory(loaderData.history);
      setChartBusy(false);
      return;
    }
    let cancelled = false;
    setChartBusy(true);
    void getPriceHistory(tokenId).then((points) => {
      if (cancelled) return;
      setHistory(points);
      setChartBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [market?.id, market?.yes.tokenId, defaultMarketId, loaderData.history]);

  if (!event || !market) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-24 text-center">
        <p className="text-lg">Market not found.</p>
        <Link to="/" className="mt-3 inline-flex items-center gap-1.5 text-gold">
          <ArrowLeftIcon /> Back to markets
        </Link>
      </main>
    );
  }

  const headline = market.question || event.title;
  const live = isLiveMarket(market);

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-3 pt-4 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:pt-6 lg:pb-8">
      <Link
        to="/"
        prefetch="intent"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-white sm:mb-5"
      >
        <ArrowLeftIcon /> All markets
      </Link>

      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        {event.icon || event.image ? (
          <RemoteImg
            src={event.icon ?? event.image}
            size={56}
            eager
            className="h-11 w-11 shrink-0 rounded-2xl object-cover ring-1 ring-white/10 sm:h-14 sm:w-14"
          />
        ) : (
          <div className="h-11 w-11 shrink-0 rounded-2xl bg-gold/15 sm:h-14 sm:w-14" />
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-bold tracking-tight break-words sm:text-2xl md:text-3xl">
            {headline}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted sm:text-sm">
            {usd(event.volume24hr)} vol
            {market.endDate
              ? ` · ${formatEnd(market.endDate)}`
              : event.endDate
                ? ` · ${formatEnd(event.endDate)}`
                : " · Open"}
            {!live ? " · Not tradeable" : null}
          </p>
        </div>
      </div>

      <div className="mt-5 grid min-w-0 items-start gap-5 lg:mt-6 lg:grid-cols-[1fr_360px] lg:gap-8">
        <div className="order-2 min-w-0 overflow-hidden rounded-3xl bg-card p-3 ring-1 ring-white/5 sm:p-4 lg:order-none lg:col-start-1 lg:row-start-1">
          <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
            <p className="min-w-0 truncate text-[13px] text-muted">
              {market.groupItemTitle
                ? `${market.groupItemTitle} chance`
                : "Yes chance"}
            </p>
            <p className="shrink-0 text-2xl font-semibold tracking-tight sm:text-3xl">
              {pct(market.yes.price)}
            </p>
          </div>
          {chartBusy ? (
            <div className="grid h-52 place-items-center text-sm text-muted sm:h-72">
              Loading chart…
            </div>
          ) : (
            <PriceChart key={market.id} points={history} />
          )}
        </div>

        <div className="order-1 min-w-0 lg:order-none lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="lg:sticky lg:top-20">
            <TradePanel
              event={event}
              market={market}
              initialSide={initialSide}
              initialLeverage={initialLeverage}
            />
          </div>
        </div>

        {event.markets.length > 1 ? (
          <OutcomeList
            markets={event.markets}
            activeId={market.id}
            expanded={outcomesOpen}
            onExpand={setOutcomesOpen}
            onSelect={setActiveId}
          />
        ) : null}

        <div
          className={`order-4 min-w-0 lg:order-none lg:col-start-1 ${
            event.markets.length > 1 ? "lg:row-start-3" : "lg:row-start-2"
          }`}
        >
          <VenueChat
            eventId={event.id}
            eventSlug={event.slug}
            marketId={market.id}
          />
        </div>
      </div>
    </main>
  );
}

function OutcomeList({
  markets,
  activeId,
  expanded,
  onExpand,
  onSelect,
}: {
  markets: Market[];
  activeId: string;
  expanded: boolean;
  onExpand: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const hidden = Math.max(0, markets.length - MARKET_PREVIEW);
  const rows = useMemo(
    () => (expanded ? markets : previewMarkets(markets, activeId, MARKET_PREVIEW)),
    [activeId, expanded, markets],
  );
  const maxPrice = Math.max(...markets.map((row) => row.yes.price), 0.01);

  return (
    <div className="order-3 min-w-0 space-y-2 lg:order-none lg:col-start-1 lg:row-start-2">
      {rows.map((m) => {
        const rowLive = isLiveMarket(m);
        return (
          <div
            key={m.id}
            className={`rounded-2xl px-2 py-1.5 ring-1 transition sm:px-3 ${
              m.id === activeId
                ? "bg-white/8 ring-white/20"
                : "ring-transparent hover:bg-white/[0.03]"
            } ${rowLive ? "" : "opacity-50"}`}
          >
            <ChanceBar
              label={m.groupItemTitle ?? m.question}
              image={m.icon ?? m.image}
              price={m.yes.price}
              maxPrice={maxPrice}
              onClick={() => onSelect(m.id)}
            />
          </div>
        );
      })}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => onExpand(!expanded)}
          className="w-full rounded-2xl py-2.5 text-[13px] font-semibold text-muted ring-1 ring-white/10 transition hover:bg-white/[0.04] hover:text-white"
        >
          {expanded ? "Show less" : `See more · ${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}
