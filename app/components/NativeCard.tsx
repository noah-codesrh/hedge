import { Link } from "react-router";
import {
  formatMcap,
  isCommunityMarket,
  isLongRace,
  nativeBaseSlug,
  nativePhase,
  NATIVE_MAX_STAKE,
  remainingWindow,
  sideLabel,
  displayImpliedP,
  tapeLine,
  winBreakdown,
  type NativeMarketView,
} from "../lib/native";
import { fiat, pct } from "../lib/format";
import { poolTokenPath } from "../lib/native-tokens";
import { RemoteImg } from "./RemoteImg";

function estimateFor(
  market: NativeMarketView,
  side: "a" | "b",
  stake = NATIVE_MAX_STAKE,
) {
  const pool = side === "a" ? market.poolA : market.poolB;
  const other = side === "a" ? market.poolB : market.poolA;
  return winBreakdown(stake, pool + stake, other, market.protocolBoost ?? 0);
}

export function NativeCard({
  market,
  delay = 0,
}: {
  market: NativeMarketView;
  delay?: number;
}) {
  const phase = nativePhase(market);
  const pA = displayImpliedP(market);
  const pB = 1 - pA;
  const a = sideLabel(market.kind, "a", market.token_a, market.token_b);
  const b = sideLabel(market.kind, "b", market.token_a, market.token_b);
  const community = isCommunityMarket(market.slug, market.title);
  const imgA = market.quoteA?.image;
  const imgB = market.quoteB?.image;
  const kindLabel = community
    ? "Community"
    : market.kind === "pvp"
      ? "Meme PvP"
      : "Strike";

  return (
    <article
      className="market-card animate-card-in relative flex h-full min-w-0 cursor-pointer flex-col gap-3 rounded-3xl bg-card px-4 py-3.5 ring-1 ring-white/5 hover:ring-white/15 sm:gap-3.5 sm:px-5 sm:py-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Link
        to={
          market.kind === "strike"
            ? poolTokenPath(market.token_a, {
                tf: market.timeframe ?? "1h",
              })
            : `/pool/${market.slug}`
        }
        prefetch="intent"
        className="absolute inset-0 z-[1] rounded-3xl"
        aria-label={market.title}
      />
      <div className="relative z-[2] flex min-w-0 items-start gap-3">
        <div className="flex shrink-0 items-center">
          {imgA ? (
            <RemoteImg
              src={imgA}
              size={36}
              className="h-9 w-9 rounded-full object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-gold/20" />
          )}
          {imgB ? (
            <RemoteImg
              src={imgB}
              size={36}
              className="-ml-2 h-9 w-9 rounded-full object-cover ring-2 ring-[#141414]"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gold">
            {kindLabel}
            {market.timeframe ? ` · ${market.timeframe}` : ""} · {phase}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-[#d8d8d8]">
            {market.title}
          </p>
        </div>
      </div>

      {market.kind === "pvp" ? (
        <>
          <div className="relative z-[2] flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {a}
              </p>
              <p className="mt-1 font-semibold leading-none tracking-tight text-up text-[28px] sm:text-[40px]">
                {pct(pA)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {b}
              </p>
              <p className="mt-1 font-semibold leading-none tracking-tight text-down text-[28px] sm:text-[40px]">
                {pct(pB)}
              </p>
            </div>
          </div>
          <div className="relative z-[2] flex h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="bg-up" style={{ width: `${Math.round(pA * 1000) / 10}%` }} />
            <div className="flex-1 bg-down" />
          </div>
        </>
      ) : (
        <>
          <div className="relative z-[2] font-semibold leading-none tracking-tight text-[28px] sm:text-[40px]">
            {pct(pA)}
          </div>
          <p className="relative z-[2] text-[12px] text-muted">
            Live tape · {b} {pct(pB)}
          </p>
        </>
      )}

      <div className="relative z-[2] mt-auto flex gap-2">
        <Link
          to={
            market.kind === "strike"
              ? poolTokenPath(market.token_a, {
                  tf: market.timeframe ?? "1h",
                  s: "a",
                })
              : `/pool/${market.slug}?s=a`
          }
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-full border border-up/40 px-3 py-2 text-center text-[12px] font-semibold text-up transition hover:bg-up/10 sm:text-sm"
        >
          {a} {fiat(market.poolA)}
        </Link>
        <Link
          to={
            market.kind === "strike"
              ? poolTokenPath(market.token_a, {
                  tf: market.timeframe ?? "1h",
                  s: "b",
                })
              : `/pool/${market.slug}?s=b`
          }
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-full border border-down/40 px-3 py-2 text-center text-[12px] font-semibold text-down transition hover:bg-down/10 sm:text-sm"
        >
          {b} {fiat(market.poolB)}
        </Link>
      </div>
      <p className="relative z-[2] text-[11px] text-muted">
        {tapeLine(market)} · {remainingWindow(market.expiry_at)}
      </p>
      {isLongRace(market.slug) ? (
        <div className="relative z-[2] grid grid-cols-2 gap-2 text-[11px] text-muted">
          <p>
            If {a} wins, a {fiat(NATIVE_MAX_STAKE)} ticket pays about{" "}
            <span className="font-semibold text-up">
              {fiat(estimateFor(market, "a").payout)}
            </span>
          </p>
          <p className="text-right">
            If {b} wins, a {fiat(NATIVE_MAX_STAKE)} ticket pays about{" "}
            <span className="font-semibold text-down">
              {fiat(estimateFor(market, "b").payout)}
            </span>
          </p>
        </div>
      ) : null}
    </article>
  );
}

export function NativeLongRace({ market }: { market: NativeMarketView }) {
  const phase = nativePhase(market);
  const pA = displayImpliedP(market);
  const pB = 1 - pA;
  const a = sideLabel(market.kind, "a", market.token_a, market.token_b);
  const b = sideLabel(market.kind, "b", market.token_a, market.token_b);
  const estA = estimateFor(market, "a");
  const estB = estimateFor(market, "b");
  const imgA = market.quoteA?.image;
  const imgB = market.quoteB?.image;
  const boost = market.protocolBoost ?? 0;

  return (
    <article className="relative overflow-hidden rounded-3xl bg-card px-5 py-5 ring-1 ring-gold/30 sm:px-6 sm:py-6">
      <Link
        to={`/pool/${market.slug}`}
        prefetch="intent"
        className="absolute inset-0 z-[1] rounded-3xl"
        aria-label={market.title}
      />
      <div className="relative z-[2] flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {imgA ? (
            <RemoteImg
              src={imgA}
              size={44}
              className="h-11 w-11 rounded-full object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="h-11 w-11 rounded-full bg-gold/20" />
          )}
          {imgB ? (
            <RemoteImg
              src={imgB}
              size={44}
              className="-ml-3 h-11 w-11 rounded-full object-cover ring-2 ring-[#141414]"
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gold">
              {nativeBaseSlug(market.slug) === "zcat-ansem"
                ? "ZCAT vs ANSEM"
                : "ANSEM vs Robinhood"}{" "}
              · {market.timeframe ?? "7d"} · {phase}
            </p>
            <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {a} vs {b}
            </h2>
          </div>
        </div>
        <p className="text-[12px] text-muted">{remainingWindow(market.expiry_at)}</p>
      </div>
      <p className="relative z-[2] mt-3 max-w-2xl text-sm text-muted">
        {nativeBaseSlug(market.slug) === "zcat-ansem"
          ? "Anonymous Cat vs The Black Bull. Live Solana mcap."
          : `The Black Bull vs ${b}. Live mcap.`}{" "}
        If one side wins, that side takes the other pool.
      </p>

      <div className="relative z-[2] mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {a}
            {market.quoteA?.marketCap
              ? ` · ${formatMcap(market.quoteA.marketCap)}`
              : ""}
          </p>
          <p className="mt-1 font-semibold leading-none tracking-tight text-up text-[36px] sm:text-[48px]">
            {pct(pA)}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {b}
            {market.quoteB?.marketCap
              ? ` · ${formatMcap(market.quoteB.marketCap)}`
              : ""}
          </p>
          <p className="mt-1 font-semibold leading-none tracking-tight text-down text-[36px] sm:text-[48px]">
            {pct(pB)}
          </p>
        </div>
      </div>
      <div className="relative z-[2] mt-3 flex h-2 overflow-hidden rounded-full bg-white/10">
        <div className="bg-up" style={{ width: `${Math.round(pA * 1000) / 10}%` }} />
        <div className="flex-1 bg-down" />
      </div>

      <div className="relative z-[2] mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-[#0f0f0f] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-up">
            If {a} wins
          </p>
          <p className="mt-1 text-lg font-semibold text-white">
            {fiat(estA.payout)} on a {fiat(NATIVE_MAX_STAKE)} ticket
          </p>
          <p className="mt-1 text-[12px] text-muted">
            Takes {fiat(market.poolB)} from {b} tickets
            {boost > 0 ? `, plus ${fiat(boost)} from Hedge,` : ","} split with {a}.
          </p>
        </div>
        <div className="rounded-2xl bg-[#0f0f0f] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-down">
            If {b} wins
          </p>
          <p className="mt-1 text-lg font-semibold text-white">
            {fiat(estB.payout)} on a {fiat(NATIVE_MAX_STAKE)} ticket
          </p>
          <p className="mt-1 text-[12px] text-muted">
            Takes {fiat(market.poolA)} from {a} tickets
            {boost > 0 ? `, plus ${fiat(boost)} from Hedge,` : ","} split with {b}.
          </p>
        </div>
      </div>

      <div className="relative z-[2] mt-4 flex gap-2">
        <Link
          to={`/pool/${market.slug}?s=a`}
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-full border border-up/40 px-3 py-2.5 text-center text-[13px] font-semibold text-up transition hover:bg-up/10"
        >
          Stake {a} · {fiat(market.poolA)}
        </Link>
        <Link
          to={`/pool/${market.slug}?s=b`}
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-full border border-down/40 px-3 py-2.5 text-center text-[13px] font-semibold text-down transition hover:bg-down/10"
        >
          Stake {b} · {fiat(market.poolB)}
        </Link>
      </div>
      <p className="relative z-[2] mt-3 text-[11px] text-muted">
        {tapeLine(market)}
      </p>
    </article>
  );
}
