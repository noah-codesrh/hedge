import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/pool.token.$symbol";
import { ArrowLeftIcon } from "../components/icons";
import { NativeStake } from "../components/NativeStake";
import { NativeTickets } from "../components/NativeTickets";
import { PoolTicketGuide } from "../components/PoolTicketGuide";
import { PriceChart } from "../components/PriceChart";
import { RemoteImg } from "../components/RemoteImg";
import { VenueChat } from "../components/VenueChat";
import {
  formatMcap,
  nativePhase,
  parseNativeTimeframe,
  parseSide,
  poolChatId,
  poolChartCutoff,
  POOL_CHART_RANGES,
  type PoolChartRange,
  remainingWindow,
  sideLabel,
  displayImpliedP,
  tapeLine,
  previewRollingMarkets,
  STRIKE_WINDOWS,
  type NativeMarketView,
  type NativeTimeframe,
} from "../lib/native";
import { useNativeMarket } from "../lib/native-live";
import { listNativeMarkets } from "../lib/server/native-markets";
import { fetchNativeCandles } from "../lib/server/native-quotes";
import {
  NATIVE_TOKENS,
  dexscreenerTokenUrl,
  nativeToken,
  poolTokenPath,
} from "../lib/native-tokens";
import { fiat, pct, shorten, signedPct } from "../lib/format";
import { originFromMatches, siteMeta } from "../lib/seo";

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const symbol = loaderData?.token?.symbol ?? "Pool";
  return siteMeta({
    title: `${symbol} strike · Hedge`,
    description: `Live ${symbol} price on Robinhood Chain. USDG strike tickets. Tape odds. Pools pay.`,
    origin: originFromMatches(matches),
    url: loaderData?.token ? poolTokenPath(loaderData.token.symbol) : "/pool",
  });
}

export async function loader({ params }: Route.LoaderArgs) {
  const token = nativeToken(params.symbol ?? "");
  if (!token) throw new Response("Token not on the desk.", { status: 404 });
  const deskPromise = listNativeMarkets();
  const candlesPromise = fetchNativeCandles(token.address).catch(() => []);
  const desk = await deskPromise;
  const candles = await candlesPromise;
  const quote =
    desk.quotes.find((row) => row.symbol.toLowerCase() === token.symbol.toLowerCase()) ??
    null;
  const strikes = desk.markets.filter(
    (row) =>
      row.kind === "strike" &&
      row.token_a.toLowerCase() === token.symbol.toLowerCase(),
  );
  return {
    token,
    quote,
    strikes,
    candles,
    tracked: desk.tracked,
    escrowWallet: desk.escrowWallet,
    payoutLive: desk.payoutLive,
  };
}

function pickWindow(markets: NativeMarketView[], tf: NativeTimeframe) {
  const open = markets.filter((row) => nativePhase(row) === "open");
  return (
    open.find((row) => row.timeframe === tf) ??
    markets.find((row) => row.timeframe === tf) ??
    open[0] ??
    markets[0] ??
    null
  );
}

export default function PoolToken({ loaderData }: Route.ComponentProps) {
  const { token, tracked, escrowWallet, payoutLive, candles } = loaderData;
  const [params, setParams] = useSearchParams();
  const rawTf = parseNativeTimeframe(params.get("tf"));
  const timeframe = STRIKE_WINDOWS.includes(rawTf) ? rawTf : "12h";
  const initialSide = parseSide(params.get("s")) ?? "a";
  const [metric, setMetric] = useState<"price" | "mcap">("price");
  const [range, setRange] = useState<PoolChartRange>("7d");
  const [copied, setCopied] = useState(false);
  const quote = loaderData.quote;
  const strikes = useMemo(() => {
    const extras = previewRollingMarkets(quote ? [quote] : []).filter(
      (row) =>
        row.kind === "strike" &&
        row.token_a.toLowerCase() === token.symbol.toLowerCase(),
    );
    const have = new Set(loaderData.strikes.map((row) => row.slug));
    return loaderData.strikes.concat(
      extras.filter((row) => !have.has(row.slug)),
    );
  }, [loaderData.strikes, quote, token.symbol]);
  const market = pickWindow(strikes, timeframe);
  const live = useNativeMarket(market?.slug ?? "", market ?? {
    id: token.symbol,
    slug: "",
    kind: "strike",
    title: token.symbol,
    token_a: token.symbol,
    token_b: null,
    metric: "marketCap",
    strike: null,
    timeframe,
    open_at: new Date().toISOString(),
    lock_at: new Date().toISOString(),
    expiry_at: new Date().toISOString(),
    seed_a: 0,
    seed_b: 0,
    open_mcap_a: null,
    open_mcap_b: null,
    open_price_a: null,
    open_price_b: null,
    resolved_side: null,
    resolved_at: null,
    phase: "open",
    poolA: 0,
    poolB: 0,
    tickets: 0,
    protocolBoost: 0,
    quoteA: quote,
    quoteB: null,
  });
  const active = market ? { ...market, ...live, quoteA: live.quoteA ?? quote } : null;
  const pA = active ? displayImpliedP(active) : 0.5;
  const supply =
    quote?.marketCap && quote.priceUsd && quote.priceUsd > 0
      ? quote.marketCap / quote.priceUsd
      : null;
  const points = useMemo(() => {
    const cutoff = poolChartCutoff(range);
    const rows = candles.filter((row) => row.time >= cutoff);
    const series = rows.map((row) => ({
      time: row.time,
      value:
        metric === "mcap" && supply
          ? row.price * supply
          : row.price,
    }));
    if (quote?.priceUsd && quote.priceUsd > 0) {
      const now = Math.floor(Date.now() / 1000);
      const last = series[series.length - 1];
      if (!last || now - last.time > 60) {
        series.push({
          time: now,
          value: metric === "mcap" && supply ? quote.priceUsd * supply : quote.priceUsd,
        });
      }
    }
    return series;
  }, [candles, metric, range, supply, quote?.priceUsd]);
  const strikeValue =
    metric === "mcap" && active?.strike
      ? active.strike
      : metric === "price" && active?.strike && supply
        ? active.strike / supply
        : null;
  const others = NATIVE_TOKENS.filter(
    (row) =>
      row.symbol.toLowerCase() !== token.symbol.toLowerCase() &&
      (row.chain ?? "robinhood") === "robinhood",
  );

  const setTf = (tf: NativeTimeframe) => {
    const next = new URLSearchParams(params);
    next.set("tf", tf);
    setParams(next, { replace: true });
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="mx-auto min-w-0 max-w-7xl px-3 pt-4 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:pt-6 lg:pb-8">
      <Link
        to="/pool?kind=strike"
        prefetch="intent"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-white sm:mb-5"
      >
        <ArrowLeftIcon /> Strike desk
      </Link>

      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        {quote?.image ? (
          <RemoteImg
            src={quote.image}
            size={56}
            eager
            className="h-11 w-11 shrink-0 rounded-2xl object-cover ring-1 ring-white/10 sm:h-14 sm:w-14"
          />
        ) : (
          <div className="h-11 w-11 shrink-0 rounded-2xl bg-gold/15 sm:h-14 sm:w-14" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gold">
            Strike · {token.symbol}
          </p>
          <h1 className="mt-1 text-lg font-bold tracking-tight break-words sm:text-2xl md:text-3xl">
            Will {token.symbol} sit above the live strike?
          </h1>
          <p className="mt-1.5 text-[13px] text-muted sm:text-sm">
            {token.name}
            {quote?.priceUsd != null ? ` · $${quote.priceUsd.toPrecision(4)}` : ""}
            {quote?.marketCap ? ` · ${formatMcap(quote.marketCap)}` : ""}
            {quote?.change24h != null
              ? ` · ${signedPct(quote.change24h / 100)} 24h`
              : ""}
          </p>
        </div>
      </div>

      <NativeTickets />

      <div className="mt-5 grid min-w-0 items-start gap-5 lg:mt-6 lg:grid-cols-[1fr_360px] lg:gap-8">
        <div className="order-2 min-w-0 overflow-hidden rounded-3xl bg-card p-3 ring-1 ring-white/5 sm:p-4 lg:order-none lg:col-start-1 lg:row-start-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div>
              <p className="text-[13px] text-muted">
                {metric === "price" ? `${token.symbol} price` : `${token.symbol} market cap`}
              </p>
              <p className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl">
                {metric === "mcap"
                  ? quote?.marketCap
                    ? formatMcap(quote.marketCap)
                    : "-"
                  : quote?.priceUsd != null
                    ? `$${quote.priceUsd.toPrecision(4)}`
                    : "-"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[13px] text-muted">Yes chance</p>
              <p className="mt-0.5 text-2xl font-semibold tracking-tight text-up sm:text-3xl">
                {pct(pA)}
              </p>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5 px-1">
            <Chip active={metric === "price"} onClick={() => setMetric("price")} label="Price" />
            <Chip active={metric === "mcap"} onClick={() => setMetric("mcap")} label="Market cap" />
            {POOL_CHART_RANGES.map((row) => (
              <Chip
                key={row.id}
                active={range === row.id}
                onClick={() => setRange(row.id)}
                label={row.label}
              />
            ))}
          </div>
          <PriceChart
            key={`${metric}-${range}-${points.length}`}
            points={points}
            unit={metric === "mcap" ? "mcap" : "usd"}
            strike={strikeValue}
            interactive
          />
          {active ? (
            <p className="mt-3 px-1 text-[12px] text-muted">
              {tapeLine(active)} · {remainingWindow(active.expiry_at)}
            </p>
          ) : null}
        </div>

        <div className="order-1 min-w-0 lg:order-none lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <div className="lg:sticky lg:top-20">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {STRIKE_WINDOWS.map((id) => (
                <Chip
                  key={id}
                  active={timeframe === id}
                  onClick={() => setTf(id)}
                  label={id}
                />
              ))}
            </div>
            {active ? (
              <>
                <NativeStake
                  key={active.slug}
                  market={active}
                  tracked={tracked}
                  mine={null}
                  escrowWallet={escrowWallet}
                  payoutLive={payoutLive}
                  initialSide={initialSide}
                />
                <div className="mt-4">
                  <PoolTicketGuide compact />
                </div>
              </>
            ) : (
              <div className="rounded-3xl bg-card p-5 text-sm text-muted ring-1 ring-white/5">
                No open strike window on this name yet.
              </div>
            )}
          </div>
        </div>

        <section className="order-3 min-w-0 space-y-3 lg:order-none lg:col-start-1 lg:row-start-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Liquidity" value={quote?.liquidity ? formatMcap(quote.liquidity) : "-"} />
            <Stat label="24h volume" value={quote?.volume24h ? formatMcap(quote.volume24h) : "-"} />
            <Stat
              label="Strike"
              value={active?.strike ? formatMcap(active.strike) : "-"}
            />
            <Stat
              label={sideLabel("strike", "b", token.symbol)}
              value={pct(1 - pA)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyAddress()}
              className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-white"
            >
              {copied ? "Copied" : shorten(token.address)}
            </button>
            <a
              href={quote?.pairUrl ?? dexscreenerTokenUrl(token.address)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-gold hover:text-white"
            >
              Dexscreener
            </a>
            {active ? (
              <p className="self-center text-[12px] text-muted">
                {active.tickets} tickets · Yes {fiat(active.poolA)} · No {fiat(active.poolB)}
              </p>
            ) : null}
          </div>
        </section>

        <div className="order-4 min-w-0 lg:order-none lg:col-start-1 lg:row-start-3">
          <VenueChat
            eventId={poolChatId(`${token.symbol.toLowerCase()}-mcap`)}
            eventSlug={active?.slug ?? token.symbol}
            marketId={active?.id}
            variant="pool"
          />
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">More strike names</h2>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {others.map((row) => (
            <Link
              key={row.address}
              to={poolTokenPath(row.symbol, { tf: timeframe })}
              prefetch="intent"
              className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[13px] font-semibold text-muted hover:border-gold/40 hover:text-white"
            >
              {row.symbol}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
        active ? "bg-gold text-black" : "border border-white/10 text-muted hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3 ring-1 ring-white/5">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
