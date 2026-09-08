import { Link } from "react-router";
import { useMemo } from "react";
import type { Route } from "./+types/pool";
import { NativeCard, NativeLongRace } from "../components/NativeCard";
import { NativeTickets } from "../components/NativeTickets";
import { RemoteImg } from "../components/RemoteImg";
import { listNativeMarkets } from "../lib/server/native-markets";
import {
  COMMUNITY_WINDOWS,
  FEATURED_LONG_BASES,
  formatMcap,
  isCommunityMarket,
  isLongRace,
  LONG_WINDOWS,
  nativeBaseSlug,
  parseLongTimeframe,
  parseNativeTimeframe,
  NATIVE_POOL_OPEN,
  NATIVE_TIMEFRAMES,
  NATIVE_USER_CAP,
  type NativeTimeframe,
} from "../lib/native";
import { useNativeDesk } from "../lib/native-live";
import { dexscreenerTokenUrl, poolTokenPath, robinhoodTokens } from "../lib/native-tokens";
import { originFromMatches, siteMeta } from "../lib/seo";
import { signedPct } from "../lib/format";

type PoolKind = "community" | "strike" | "pvp";

function parsePoolKind(raw: string | null): PoolKind {
  if (raw === "pvp") return "pvp";
  if (raw === "strike") return "strike";
  return "community";
}

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({
    title: "Pool · Hedge",
    description:
      "Hedge-native USDG parimutuel on Robinhood Chain memes. Live tape odds. Community chat. Pools pay winners.",
    origin: originFromMatches(matches),
    url: "/pool",
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const kind = parsePoolKind(url.searchParams.get("kind"));
  const timeframe = url.searchParams.has("tf")
    ? parseNativeTimeframe(url.searchParams.get("tf"))
    : kind === "community"
      ? "24h"
      : parseNativeTimeframe(null);
  const longTf = parseLongTimeframe(
    url.searchParams.get("long") ??
      (LONG_WINDOWS.includes(timeframe) ? timeframe : "7d"),
  );
  const data = await listNativeMarkets();
  return { ...data, kind, timeframe, longTf };
}

export default function Pool({ loaderData }: Route.ComponentProps) {
  const { tracked, kind, timeframe, longTf } = loaderData;
  const desk = useNativeDesk({
    markets: loaderData.markets,
    quotes: loaderData.quotes,
    deskUsed: loaderData.deskUsed,
    deskCap: loaderData.deskCap,
  });
  const markets = desk.markets ?? loaderData.markets;
  const quotes = desk.quotes ?? loaderData.quotes;
  const windows =
    kind === "community"
      ? COMMUNITY_WINDOWS
      : NATIVE_TIMEFRAMES.filter((row) => !LONG_WINDOWS.includes(row.id)).map(
          (row) => row.id,
        );
  const shortTf = COMMUNITY_WINDOWS.includes(timeframe) ? timeframe : "24h";
  const longRaces = useMemo(() => {
    const rows = markets.filter(
      (market) =>
        isLongRace(market.slug) && (market.timeframe ?? "7d") === longTf,
    );
    const rank = (market: (typeof markets)[number]) => {
      const i = FEATURED_LONG_BASES.indexOf(nativeBaseSlug(market.slug));
      return i < 0 ? 99 : i;
    };
    return [...rows].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.quoteA?.marketCap ?? 0) + (b.quoteB?.marketCap ?? 0) -
          ((a.quoteA?.marketCap ?? 0) + (a.quoteB?.marketCap ?? 0)),
    );
  }, [markets, longTf]);
  const longRace = longRaces[0] ?? null;
  const shown = useMemo(() => {
    const rows = markets.filter((market) => {
      const community = isCommunityMarket(market.slug, market.title);
      if (kind === "community") {
        if (!community || isLongRace(market.slug)) return false;
      } else if (kind === "pvp") {
        if (market.kind !== "pvp" || community) return false;
      } else if (market.kind !== "strike") {
        return false;
      }
      const tf = kind === "community" ? shortTf : timeframe;
      if (market.timeframe) return market.timeframe === tf;
      return tf === "24h";
    });
    if (kind === "strike") {
      const seen = new Set<string>();
      return rows.filter((market) => {
        const key = market.token_a.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (kind === "community") {
      const seen = new Set<string>();
      return rows.filter((market) => {
        const key = nativeBaseSlug(market.slug);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return rows;
  }, [markets, kind, timeframe, shortTf]);
  const kindHref = (tf: NativeTimeframe | string) =>
    kind === "community"
      ? `/pool?kind=community&tf=${tf}&long=${longTf}`
      : kind === "pvp"
        ? `/pool?kind=pvp&tf=${tf}`
        : `/pool?kind=strike&tf=${tf}`;
  const longHref = (tf: NativeTimeframe) =>
    `/pool?kind=community&tf=${shortTf}&long=${tf}`;
  const tfHref = (next: PoolKind) => {
    const tf =
      next === "community" && !COMMUNITY_WINDOWS.includes(timeframe)
        ? "24h"
        : timeframe;
    return next === "community"
      ? `/pool?kind=${next}&tf=${tf}&long=${longTf}`
      : `/pool?kind=${next}&tf=${tf}`;
  };

  return (
    <main className="mx-auto min-w-0 max-w-5xl px-4 pb-24 pt-10 sm:px-6">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gold">
        Native desk
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-white sm:text-5xl">
        Pool
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        Hedge layer on Robinhood memes, plus ZCAT vs ANSEM, ZCAT vs MEME, and
        ANSEM vs the top names. Live tape odds. Community chat. USDG in, USDG
        out. Desk cap $
        {NATIVE_USER_CAP.toLocaleString()}.
      </p>
      {!NATIVE_POOL_OPEN ? (
        <p className="mt-4 text-sm text-gold">Pool is under maintenance.</p>
      ) : null}
      {!tracked ? (
        <p className="mt-4 text-sm text-gold">
          Tracking is not connected. Live Dexscreener still drives the tape.
          Run supabase/migrations/0008_native_markets.sql to take tickets.
        </p>
      ) : null}

      <div className="mt-6 inline-flex rounded-full border border-white/10 bg-[#1e1e1e] p-1">
        <Link
          to={tfHref("community")}
          prefetch="intent"
          className={`rounded-full px-4 py-2 text-[13px] font-semibold sm:px-5 sm:text-sm ${
            kind === "community"
              ? "bg-white/12 text-white ring-1 ring-gold/50"
              : "text-[#b8b8b8] hover:text-white"
          }`}
        >
          Community
        </Link>
        <Link
          to={tfHref("strike")}
          prefetch="intent"
          className={`rounded-full px-4 py-2 text-[13px] font-semibold sm:px-5 sm:text-sm ${
            kind === "strike"
              ? "bg-white/12 text-white ring-1 ring-gold/50"
              : "text-[#b8b8b8] hover:text-white"
          }`}
        >
          Strike
        </Link>
        <Link
          to={tfHref("pvp")}
          prefetch="intent"
          className={`rounded-full px-4 py-2 text-[13px] font-semibold sm:px-5 sm:text-sm ${
            kind === "pvp"
              ? "bg-white/12 text-white ring-1 ring-gold/50"
              : "text-[#b8b8b8] hover:text-white"
          }`}
        >
          PvP
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {NATIVE_TIMEFRAMES.filter((row) => windows.includes(row.id)).map(
          (row) => (
            <Link
              key={row.id}
              to={kindHref(row.id)}
              prefetch="intent"
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                timeframe === row.id
                  ? "bg-gold text-black"
                  : "border border-white/10 text-[#b8b8b8] hover:text-white"
              }`}
            >
              {row.label}
            </Link>
          ),
        )}
      </div>

      <NativeTickets />

      {kind === "community" && longRaces.length > 0 ? (
        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">
                ZCAT vs ANSEM
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                Anonymous Cat vs The Black Bull, ZCAT vs MEME, then ANSEM
                against the top Robinhood names. Longer windows. Winners take
                the other side.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LONG_WINDOWS.map((id) => (
                <Link
                  key={id}
                  to={longHref(id)}
                  prefetch="intent"
                  className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                    longTf === id
                      ? "bg-gold text-black"
                      : "border border-white/10 text-[#b8b8b8] hover:text-white"
                  }`}
                >
                  {id}
                </Link>
              ))}
            </div>
          </div>
          <div className="mt-4">
            {longRace ? <NativeLongRace market={longRace} /> : null}
          </div>
          {longRaces.length > 1 ? (
            <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {longRaces.slice(1).map((market, i) => (
                <NativeCard key={market.slug} market={market} delay={i * 40} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-xl font-semibold text-white">
          {kind === "community"
            ? "Robinhood races"
            : kind === "pvp"
              ? "Meme PvP"
              : "Strike names"}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {kind === "community"
            ? `Robinhood races. ${shortTf} window. Live market cap is the line. Chat stays on Hedge.`
            : kind === "pvp"
              ? `Robinhood memes fight in the ${timeframe} window. Hedge puts USDG on which name actually prints from the open snapshot.`
              : `One page per token. Live price chart, strike tickets, chat. Showing the ${timeframe} window.`}
        </p>
        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No cards in this window.</p>
        ) : (
          <div
            className={`mt-4 grid min-w-0 gap-3 ${
              kind === "community"
                ? "lg:grid-cols-3"
                : "sm:grid-cols-2"
            }`}
          >
            {shown.map((market, i) => (
              <NativeCard key={market.slug} market={market} delay={i * 40} />
            ))}
          </div>
        )}
      </section>

      {kind !== "community" ? (
      <section className="mt-14">
        <h2 className="text-xl font-semibold text-white">Allowlist</h2>
        <p className="mt-2 text-sm text-muted">
          Trending names on Robinhood. Open a strike page for the chart and
          ticket panel.
        </p>
        <ul className="mt-4 divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-[#141414]">
          {quotes
            .filter((q) =>
              robinhoodTokens().some(
                (token) => token.address.toLowerCase() === q.address.toLowerCase(),
              ),
            )
            .map((q) => (
            <li
              key={q.address}
              className="flex flex-wrap items-center gap-3 px-4 py-3.5"
            >
              {q.image ? (
                <RemoteImg
                  src={q.image}
                  size={32}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-gold/20" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{q.symbol}</p>
                <p className="truncate text-[12px] text-muted">{q.name}</p>
              </div>
              <p className="text-sm tabular-nums text-white">
                {q.marketCap ? formatMcap(q.marketCap) : "-"}
              </p>
              <p
                className={`w-16 text-right text-sm tabular-nums ${
                  (q.change24h ?? 0) >= 0 ? "text-up" : "text-down"
                }`}
              >
                {q.change24h != null ? signedPct(q.change24h / 100) : "-"}
              </p>
              <Link
                to={poolTokenPath(q.symbol)}
                prefetch="intent"
                className="text-[12px] font-semibold text-gold hover:underline"
              >
                Open
              </Link>
              <a
                href={q.pairUrl ?? dexscreenerTokenUrl(q.address)}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-muted hover:text-white"
              >
                Chart
              </a>
            </li>
          ))}
        </ul>
      </section>
      ) : null}

      <p className="mt-10 text-[13px] text-muted">
        At expiry the pools pay winners automatically.{" "}
        <Link to="/roadmap" className="font-semibold text-gold hover:underline">
          Roadmap
        </Link>
      </p>
    </main>
  );
}
