import { Link } from "react-router";
import { useMemo } from "react";
import type { Route } from "./+types/pool";
import { NativeCard } from "../components/NativeCard";
import { NativeTickets } from "../components/NativeTickets";
import { RemoteImg } from "../components/RemoteImg";
import { listNativeMarkets } from "../lib/server/native-markets";
import {
  formatMcap,
  parseNativeTimeframe,
  NATIVE_POOL_OPEN,
  NATIVE_TIMEFRAMES,
} from "../lib/native";
import { useNativeDesk } from "../lib/native-live";
import { dexscreenerTokenUrl } from "../lib/native-tokens";
import { originFromMatches, siteMeta } from "../lib/seo";
import { signedPct } from "../lib/format";

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({
    title: "Pool · Hedge",
    description:
      "USDG parimutuel on Robinhood Chain memes. Live tape odds. Pools pay winners.",
    origin: originFromMatches(matches),
    url: "/pool",
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "pvp" ? "pvp" : "strike";
  const timeframe = parseNativeTimeframe(url.searchParams.get("tf"));
  const data = await listNativeMarkets();
  return { ...data, kind, timeframe };
}

export default function Pool({ loaderData }: Route.ComponentProps) {
  const { tracked, kind, timeframe } = loaderData;
  const desk = useNativeDesk({
    markets: loaderData.markets,
    quotes: loaderData.quotes,
    deskUsed: loaderData.deskUsed,
    deskCap: loaderData.deskCap,
  });
  const markets = desk.markets ?? loaderData.markets;
  const quotes = desk.quotes ?? loaderData.quotes;
  const shown = useMemo(
    () =>
      markets.filter((market) => {
        if (market.kind !== kind) return false;
        if (market.timeframe) return market.timeframe === timeframe;
        return timeframe === "24h";
      }),
    [markets, kind, timeframe],
  );
  const kindHref = (tf: string) =>
    kind === "pvp" ? `/pool?kind=pvp&tf=${tf}` : `/pool?tf=${tf}`;
  const tfHref = (next: "strike" | "pvp") =>
    next === "pvp" ? `/pool?kind=pvp&tf=${timeframe}` : `/pool?tf=${timeframe}`;

  return (
    <main className="mx-auto min-w-0 max-w-5xl px-4 pb-24 pt-10 sm:px-6">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gold">
        Native desk
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-white sm:text-5xl">
        Pool
      </h1>
      {!NATIVE_POOL_OPEN ? (
        <p className="mt-4 text-sm text-gold">Pool is under maintenance.</p>
      ) : null}
      {!tracked ? (
        <p className="mt-4 text-sm text-gold">
          Tracking is not connected. Live Dexscreener still drives the tape.
          Run supabase/migrations/0008_native_markets.sql to take tickets.
        </p>
      ) : null}

      <NativeTickets />

      <div className="mt-8 inline-flex rounded-full border border-white/10 bg-[#1e1e1e] p-1">
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
        {NATIVE_TIMEFRAMES.map((row) => (
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
        ))}
      </div>

      <section className="mt-6">
        <h2 className="text-xl font-semibold text-white">
          {kind === "pvp" ? "Meme PvP" : "Strike"}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {kind === "pvp"
            ? `Robinhood memes only fight in the ${timeframe} window. Hedge puts USDG on which name actually prints from the open snapshot. Losers pay winners.`
            : `Will this name sit above a market-cap strike when the ${timeframe} window ends.`}
        </p>
        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No cards in this window.</p>
        ) : (
          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
            {shown.map((market, i) => (
              <NativeCard key={market.slug} market={market} delay={i * 40} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold text-white">Allowlist</h2>
        <p className="mt-2 text-sm text-muted">
          Trending names on Robinhood. Dexscreener first, CoinGecko if a pair is
          missing.
        </p>
        <ul className="mt-4 divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-[#141414]">
          {quotes.map((q) => (
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
                {q.marketCap ? formatMcap(q.marketCap) : "—"}
              </p>
              <p
                className={`w-16 text-right text-sm tabular-nums ${
                  (q.change24h ?? 0) >= 0 ? "text-up" : "text-down"
                }`}
              >
                {q.change24h != null ? signedPct(q.change24h / 100) : "—"}
              </p>
              <a
                href={q.pairUrl ?? dexscreenerTokenUrl(q.address)}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-gold hover:underline"
              >
                Chart
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-[13px] text-muted">
        At expiry the pools pay winners automatically.{" "}
        <Link to="/roadmap" className="font-semibold text-gold hover:underline">
          Roadmap
        </Link>
      </p>
    </main>
  );
}
