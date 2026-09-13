import { Link, redirect, useSearchParams } from "react-router";
import { useMemo, useState } from "react";
import type { Route } from "./+types/pool.$slug";
import { NativeStake } from "../components/NativeStake";
import { PoolTicketGuide } from "../components/PoolTicketGuide";
import { PriceChart } from "../components/PriceChart";
import { RemoteImg } from "../components/RemoteImg";
import { VenueChat } from "../components/VenueChat";
import { getNativeMarket } from "../lib/server/native-markets";
import {
  fetchNativeCandles,
  oddsPointsFromCandles,
} from "../lib/server/native-quotes";
import {
  formatMcap,
  isCommunityMarket,
  isLongRace,
  multipleIfWin,
  nativeBaseSlug,
  nativePhase,
  parseSide,
  poolChatId,
  poolChartCutoff,
  POOL_CHART_RANGES,
  type PoolChartRange,
  poolImpliedP,
  remainingWindow,
  sideLabel,
  displayImpliedP,
  tapeImpliedP,
  tapeLine,
} from "../lib/native";
import { useNativeMarket } from "../lib/native-live";
import {
  dexscreenerTokenUrl,
  nativeChainOf,
  nativeToken,
  poolTokenPath,
} from "../lib/native-tokens";
import { fiat, pct, signedPct } from "../lib/format";
import { originFromMatches, siteMeta } from "../lib/seo";

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const title = loaderData?.market?.title ?? "Pool";
  return siteMeta({
    title: `${title} · Hedge`,
    description:
      "USDG parimutuel on a Robinhood Chain meme. Live tape odds. Pools pay.",
    origin: originFromMatches(matches),
    url: loaderData?.market ? `/pool/${loaderData.market.slug}` : "/pool",
  });
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug ?? "";
  const data = await getNativeMarket(slug);
  if (!data.market) {
    throw new Response("Market not found.", { status: 404 });
  }
  if (data.market.kind === "strike") {
    const side = new URL(request.url).searchParams.get("s");
    throw redirect(
      poolTokenPath(data.market.token_a, {
        tf: data.market.timeframe ?? "12h",
        ...(side ? { s: side } : {}),
      }),
    );
  }
  const tokenA = nativeToken(data.market.token_a);
  const tokenB = data.market.token_b
    ? nativeToken(data.market.token_b)
    : null;
  const [candlesA, candlesB] = await Promise.all([
    tokenA
      ? fetchNativeCandles(tokenA.address, nativeChainOf(tokenA)).catch(() => [])
      : Promise.resolve([]),
    tokenB
      ? fetchNativeCandles(tokenB.address, nativeChainOf(tokenB)).catch(() => [])
      : Promise.resolve([]),
  ]);
  return { ...data, candlesA, candlesB };
}

function ends(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export default function PoolMarket({ loaderData }: Route.ComponentProps) {
  const { tracked, mine, escrowWallet, payoutLive, candlesA, candlesB } =
    loaderData;
  const [params] = useSearchParams();
  const initialSide = parseSide(params.get("s")) ?? "a";
  const market = useNativeMarket(loaderData.market.slug, loaderData.market);
  const phase = nativePhase(market);
  const a = sideLabel(market.kind, "a", market.token_a, market.token_b);
  const b = sideLabel(market.kind, "b", market.token_a, market.token_b);
  const tokens = [market.quoteA, market.quoteB].filter(Boolean);
  const tape = tapeImpliedP(market);
  const book = poolImpliedP(market.poolA, market.poolB);
  const pA = displayImpliedP(market);
  const pB = 1 - pA;
  const community = isCommunityMarket(market.slug, market.title);
  const longRace = isLongRace(market.slug);
  const boost = market.protocolBoost ?? 0;
  const depth = market.poolA + market.poolB;
  const backTo = community
    ? `/pool?kind=community&tf=${market.timeframe ?? "3d"}`
    : market.kind === "pvp"
      ? `/pool?kind=pvp&tf=${market.timeframe ?? "12h"}`
      : `/pool?kind=strike&tf=${market.timeframe ?? "12h"}`;
  const [range, setRange] = useState<PoolChartRange>("7d");
  const supplyA =
    market.quoteA?.marketCap &&
    market.quoteA.priceUsd &&
    market.quoteA.priceUsd > 0
      ? market.quoteA.marketCap / market.quoteA.priceUsd
      : null;
  const supplyB =
    market.quoteB?.marketCap &&
    market.quoteB.priceUsd &&
    market.quoteB.priceUsd > 0
      ? market.quoteB.marketCap / market.quoteB.priceUsd
      : null;
  const points = useMemo(() => {
    if (!supplyA || !supplyB) return [];
    const cutoff = poolChartCutoff(range);
    const rows = oddsPointsFromCandles(candlesA, candlesB, supplyA, supplyB).filter(
      (row) => row.time >= cutoff,
    );
    const liveA = market.quoteA?.marketCap;
    const liveB = market.quoteB?.marketCap;
    if (liveA && liveB && liveA + liveB > 0) {
      const now = Math.floor(Date.now() / 1000);
      const last = rows[rows.length - 1];
      const value = liveA / (liveA + liveB);
      if (!last || now - last.time > 60) rows.push({ time: now, value });
      else last.value = value;
    }
    if (rows.length === 1) {
      rows.unshift({ time: rows[0]!.time - 3600, value: rows[0]!.value });
    }
    return rows;
  }, [
    candlesA,
    candlesB,
    supplyA,
    supplyB,
    range,
    market.quoteA?.marketCap,
    market.quoteB?.marketCap,
  ]);

  return (
    <main className="mx-auto min-w-0 max-w-3xl px-4 pb-24 pt-8 sm:px-6">
      <Link
        to={backTo}
        prefetch="intent"
        className="text-[13px] font-semibold text-muted hover:text-white"
      >
        ← Pool
      </Link>
      <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-gold">
        {community ? "Community" : market.kind === "pvp" ? "Meme PvP" : "Strike"}
        {longRace
          ? nativeBaseSlug(market.slug) === "zcat-ansem"
            ? " · ZCAT vs ANSEM"
            : " · ANSEM"
          : ""}
        {market.timeframe ? ` · ${market.timeframe}` : ""} · {phase}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {market.title}
      </h1>
      <p className="mt-3 text-sm text-muted">
        {tapeLine(market)}. {remainingWindow(market.expiry_at)}. Lock{" "}
        {ends(market.lock_at)}. {market.tickets} tickets.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-3xl bg-card p-5 ring-1 ring-white/5">
          <p className="text-[11px] uppercase tracking-wide text-muted">{a}</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-up sm:text-5xl">
            {pct(pA)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Tape {pct(tape)}
            {depth > 0
              ? ` · pool ${pct(book)} · ${fiat(market.poolA)} · ${multipleIfWin(market.poolA, market.poolB, boost).toFixed(2)}x`
              : ` · ${fiat(market.poolA)} in the pool`}
          </p>
        </div>
        <div className="rounded-3xl bg-card p-5 ring-1 ring-white/5">
          <p className="text-[11px] uppercase tracking-wide text-muted">{b}</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-down sm:text-5xl">
            {pct(pB)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Tape {pct(1 - tape)}
            {depth > 0
              ? ` · pool ${pct(1 - book)} · ${fiat(market.poolB)} · ${multipleIfWin(market.poolB, market.poolA, boost).toFixed(2)}x`
              : ` · ${fiat(market.poolB)} in the pool`}
          </p>
        </div>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10">
        <div className="bg-up" style={{ width: `${Math.round(pA * 1000) / 10}%` }} />
        <div className="flex-1 bg-down" />
      </div>

      <section className="mt-6 overflow-hidden rounded-3xl bg-card p-3 ring-1 ring-white/5 sm:p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
          <p className="min-w-0 truncate text-[13px] text-muted">{a} chance</p>
          <p className="shrink-0 text-2xl font-semibold tracking-tight sm:text-3xl">
            {pct(pA)}
          </p>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5 px-1">
          {POOL_CHART_RANGES.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setRange(row.id)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                range === row.id
                  ? "bg-gold text-black"
                  : "border border-white/10 text-muted hover:text-white"
              }`}
            >
              {row.label}
            </button>
          ))}
        </div>
        <PriceChart
          key={`${market.slug}-${range}-${points.length}`}
          points={points}
          mark={{ value: pA, title: a }}
          interactive
        />
        <p className="mt-3 px-1 text-[12px] text-muted">
          {tapeLine(market)} · {remainingWindow(market.expiry_at)}
        </p>
      </section>

      <div className="mt-4">
        <NativeStake
          market={market}
          tracked={tracked}
          mine={mine}
          escrowWallet={escrowWallet}
          payoutLive={payoutLive}
          initialSide={initialSide}
        />
        <div className="mt-4">
          <PoolTicketGuide compact />
        </div>
      </div>

      {tokens.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Underlying</h2>
          <ul className="mt-3 space-y-2">
            {tokens.map((q) =>
              q ? (
                <li
                  key={q.address}
                  className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-white/5"
                >
                  {q.image ? (
                    <RemoteImg
                      src={q.image}
                      size={36}
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{q.symbol}</p>
                    <p className="text-[12px] text-muted">
                      {q.marketCap ? formatMcap(q.marketCap) : "-"}
                      {q.priceUsd != null ? ` · $${q.priceUsd.toPrecision(4)}` : ""}
                    </p>
                  </div>
                  <p
                    className={`text-sm ${(q.change24h ?? 0) >= 0 ? "text-up" : "text-down"}`}
                  >
                    {q.change24h != null ? signedPct(q.change24h / 100) : "-"}
                  </p>
                  <a
                    href={q.pairUrl ?? dexscreenerTokenUrl(q.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] font-semibold text-gold"
                  >
                    Dexscreener
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}

      {market.kind === "strike" && market.strike ? (
        <p className="mt-6 text-[13px] text-muted">
          Strike {formatMcap(market.strike)}. Open mcap{" "}
          {market.open_mcap_a ? formatMcap(market.open_mcap_a) : "-"}. Live{" "}
          {market.quoteA?.marketCap ? formatMcap(market.quoteA.marketCap) : "-"}.
        </p>
      ) : null}

      <div className="mt-8">
        <VenueChat
          eventId={poolChatId(market.slug)}
          eventSlug={market.slug}
          marketId={market.id}
          variant="pool"
        />
      </div>
    </main>
  );
}
