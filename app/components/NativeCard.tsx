import { Link } from "react-router";
import {
  nativePhase,
  sideLabel,
  tapeImpliedP,
  tapeLine,
  type NativeMarketView,
} from "../lib/native";
import { fiat, pct } from "../lib/format";
import { RemoteImg } from "./RemoteImg";

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

export function NativeCard({
  market,
  delay = 0,
}: {
  market: NativeMarketView;
  delay?: number;
}) {
  const phase = nativePhase(market);
  const pYes = tapeImpliedP(market);
  const a = sideLabel(market.kind, "a", market.token_a, market.token_b);
  const b = sideLabel(market.kind, "b", market.token_a, market.token_b);
  const img = market.quoteA?.image ?? market.quoteB?.image;

  return (
    <article
      className="market-card animate-card-in relative flex h-full min-w-0 cursor-pointer flex-col gap-3 rounded-3xl bg-card px-4 py-3.5 ring-1 ring-white/5 hover:ring-white/15 sm:gap-3.5 sm:px-5 sm:py-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Link
        to={`/pool/${market.slug}`}
        prefetch="intent"
        className="absolute inset-0 z-[1] rounded-3xl"
        aria-label={market.title}
      />
      <div className="relative z-[2] flex min-w-0 items-start gap-3">
        {img ? (
          <RemoteImg
            src={img}
            size={36}
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-full bg-gold/20" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gold">
            {market.kind === "pvp" ? "Meme PvP" : "Strike"} · {phase}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-[#d8d8d8]">
            {market.title}
          </p>
        </div>
      </div>

      <div className="relative z-[2] font-semibold leading-none tracking-tight text-[28px] sm:text-[40px]">
        {pct(pYes)}
      </div>
      <p className="relative z-[2] text-[12px] text-muted">
        Live tape · {b} {pct(1 - pYes)}
      </p>

      <div className="relative z-[2] mt-auto flex gap-2">
        <Link
          to={`/pool/${market.slug}?s=a`}
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-full border border-up/40 px-3 py-2 text-center text-[12px] font-semibold text-up transition hover:bg-up/10 sm:text-sm"
        >
          {a} {fiat(market.poolA)}
        </Link>
        <Link
          to={`/pool/${market.slug}?s=b`}
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-full border border-down/40 px-3 py-2 text-center text-[12px] font-semibold text-down transition hover:bg-down/10 sm:text-sm"
        >
          {b} {fiat(market.poolB)}
        </Link>
      </div>
      <p className="relative z-[2] text-[11px] text-muted">
        {tapeLine(market)} · lock {ends(market.lock_at)}
      </p>
    </article>
  );
}
