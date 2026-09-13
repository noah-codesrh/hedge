import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/market.$id";
import { ArrowLeftIcon } from "../components/icons";
import { ChanceBar } from "../components/OutrightCard";
import { MarketChart } from "../components/MarketChart";
import { TradePanel } from "../components/TradePanel";
import { VenueChat } from "../components/VenueChat";
import {
  getEvent,
  getPriceHistory,
  isLiveMarket,
  pickLiveMarket,
  type PricePoint,
} from "../lib/polymarket";
import { listedLeverageFor } from "../lib/leverage";
import { stockBySymbol } from "../lib/stock-tokens";
import { formatEnd } from "../lib/format";
import { parseSpotAmount } from "../lib/spot-ticket";
import type { Market, Side } from "../lib/types";
import { localeFromRequest } from "../lib/i18n";
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
  const event = await getEvent(params.id, localeFromRequest(request));
  if (!event) return { event: null, history: [] as PricePoint[], defaultMarketId: null };
  const url = new URL(request.url);
  const wanted = url.searchParams.get("m");
  const wantedSide = url.searchParams.get("s") === "no" ? "no" : "yes";
  const wantedMarket = wanted
    ? event.markets.find((m) => m.id === wanted)
    : undefined;
  const listed = event.markets.find((row) => listedLeverageFor(row));
  const market =
    wantedMarket ?? listed ?? pickLiveMarket(event) ?? event.markets[0];
  const tokenId =
    wantedSide === "no" ? market?.no.tokenId : market?.yes.tokenId;
  const history = tokenId ? await getPriceHistory(tokenId) : [];
  return { event, history, defaultMarketId: market?.id ?? null };
}

export default function MarketPage({ loaderData }: Route.ComponentProps) {
  const { event, defaultMarketId } = loaderData;
  const [params, setParams] = useSearchParams();
  const initialSide = (params.get("s") === "no" ? "no" : "yes") as Side;
  const lev = Number(params.get("lev"));
  const initialLeverage = lev === 2 || lev === 3 || lev === 4 ? lev : 1;
  const initialAmount =
    parseSpotAmount(params.get("amt") ?? params.get("amount")) ?? 0;
  const initialStock = stockBySymbol(params.get("stock"))?.symbol;
  const queriedMarket = params.get("m");
  const [activeId, setActiveId] = useState<string | undefined>(
    queriedMarket ?? defaultMarketId ?? undefined,
  );
  const [history, setHistory] = useState(loaderData.history);
  const [chartBusy, setChartBusy] = useState(false);
  const [outcomesOpen, setOutcomesOpen] = useState(false);
  const [side, setSide] = useState<Side>(initialSide);

  useEffect(() => {
    if (queriedMarket) setActiveId(queriedMarket);
  }, [queriedMarket]);

  useEffect(() => {
    if (!activeId) return;
    setParams(
      (current) => {
        if (current.get("m") === activeId) return current;
        const next = new URLSearchParams(current);
        next.set("m", activeId);
        return next;
      },
      { replace: true },
    );
  }, [activeId, setParams]);

  useEffect(() => {
    setSide(initialSide);
  }, [initialSide]);

  useEffect(() => {
    setOutcomesOpen(false);
  }, [event?.id]);

  const market =
    event?.markets.find((m) => m.id === activeId) ??
    (event ? pickLiveMarket(event) : undefined);

  useEffect(() => {
    if (!market) return;
    const tokenId = side === "no" ? market.no.tokenId : market.yes.tokenId;
    if (!tokenId) {
      setHistory([]);
      return;
    }
    if (market.id === defaultMarketId && side === initialSide) {
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
  }, [
    market?.id,
    market?.yes.tokenId,
    market?.no.tokenId,
    side,
    defaultMarketId,
    initialSide,
    loaderData.history,
  ]);

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
            {market.endDate
              ? formatEnd(market.endDate)
              : event.endDate
                ? formatEnd(event.endDate)
                : "Open"}
            {!live ? " · Not tradeable" : null}
          </p>
        </div>
      </div>

      <div className="mt-5 grid min-w-0 items-start gap-5 lg:mt-6 lg:grid-cols-[1fr_360px] lg:gap-8">
        <MarketChart
          market={market}
          history={history}
          busy={chartBusy}
          side={side}
        />

        <div className="order-1 min-w-0 lg:order-none lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="lg:sticky lg:top-20">
            <TradePanel
              event={event}
              market={market}
              initialSide={initialSide}
              initialLeverage={initialLeverage}
              initialAmount={initialAmount}
              initialStock={initialStock}
              onSideChange={setSide}
              onStockChange={(symbol) => {
                setParams(
                  (current) => {
                    const have = current.get("stock") ?? undefined;
                    if (have === symbol) return current;
                    const next = new URLSearchParams(current);
                    if (symbol) next.set("stock", symbol);
                    else next.delete("stock");
                    return next;
                  },
                  { replace: true },
                );
              }}
            />
          </div>
        </div>

        {event.markets.length > 1 ? (
          <OutcomeList
            markets={event.markets}
            activeId={market.id}
            expanded={outcomesOpen}
            onExpand={setOutcomesOpen}
            onSelect={(id) => {
              setActiveId(id);
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.set("m", id);
                  return next;
                },
                { replace: true },
              );
            }}
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
