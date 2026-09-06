import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/pool.$slug";
import { NativeStake } from "../components/NativeStake";
import { RemoteImg } from "../components/RemoteImg";
import { getNativeMarket } from "../lib/server/native-markets";
import {
  formatMcap,
  multipleIfWin,
  nativePhase,
  parseSide,
  sideLabel,
  tapeImpliedP,
  tapeLine,
} from "../lib/native";
import { useNativeMarket } from "../lib/native-live";
import { dexscreenerTokenUrl } from "../lib/native-tokens";
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

export async function loader({ params }: Route.LoaderArgs) {
  const slug = params.slug ?? "";
  const data = await getNativeMarket(slug);
  if (!data.market) {
    throw new Response("Market not found.", { status: 404 });
  }
  return data;
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
  const { tracked, mine, escrowWallet, payoutLive } = loaderData;
  const [params] = useSearchParams();
  const initialSide = parseSide(params.get("s")) ?? "a";
  const market = useNativeMarket(loaderData.market.slug, loaderData.market);
  const phase = nativePhase(market);
  const a = sideLabel(market.kind, "a", market.token_a, market.token_b);
  const b = sideLabel(market.kind, "b", market.token_a, market.token_b);
  const tokens = [market.quoteA, market.quoteB].filter(Boolean);
  const pA = tapeImpliedP(market);
  const pB = 1 - pA;

  return (
    <main className="mx-auto min-w-0 max-w-3xl px-4 pb-24 pt-8 sm:px-6">
      <Link
        to={market.kind === "pvp" ? "/pool?kind=pvp" : "/pool"}
        prefetch="intent"
        className="text-[13px] font-semibold text-muted hover:text-white"
      >
        ← Pool
      </Link>
      <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-gold">
        {market.kind === "pvp" ? "Meme PvP" : "Strike"} · {phase}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {market.title}
      </h1>
      <p className="mt-3 text-sm text-muted">
        {tapeLine(market)}. Lock {ends(market.lock_at)}. Expiry{" "}
        {ends(market.expiry_at)}. {market.tickets} tickets.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-3xl bg-card p-5 ring-1 ring-white/5">
          <p className="text-[11px] uppercase tracking-wide text-muted">{a}</p>
          <p className="mt-1 text-3xl font-semibold text-up">
            {pct(pA)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Live tape · {fiat(market.poolA)} pool · {multipleIfWin(market.poolA, market.poolB).toFixed(2)}x
          </p>
        </div>
        <div className="rounded-3xl bg-card p-5 ring-1 ring-white/5">
          <p className="text-[11px] uppercase tracking-wide text-muted">{b}</p>
          <p className="mt-1 text-3xl font-semibold text-down">
            {pct(pB)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Live tape · {fiat(market.poolB)} pool · {multipleIfWin(market.poolB, market.poolA).toFixed(2)}x
          </p>
        </div>
      </div>

      <div className="mt-4">
        <NativeStake
          market={market}
          tracked={tracked}
          mine={mine}
          escrowWallet={escrowWallet}
          payoutLive={payoutLive}
          initialSide={initialSide}
        />
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
                      {q.marketCap ? formatMcap(q.marketCap) : "—"}
                      {q.priceUsd != null ? ` · $${q.priceUsd.toPrecision(4)}` : ""}
                    </p>
                  </div>
                  <p
                    className={`text-sm ${(q.change24h ?? 0) >= 0 ? "text-up" : "text-down"}`}
                  >
                    {q.change24h != null ? signedPct(q.change24h / 100) : "—"}
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
          {market.open_mcap_a ? formatMcap(market.open_mcap_a) : "—"}. Live{" "}
          {market.quoteA?.marketCap ? formatMcap(market.quoteA.marketCap) : "—"}.
        </p>
      ) : null}
    </main>
  );
}
