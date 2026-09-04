import { Link } from "react-router";
import type { LeverageListing } from "../lib/polymarket";
import { formatEnd, pct } from "../lib/format";
import { isWithinBand, PRICE_BAND } from "../lib/leverage";
import { LayersIcon } from "./icons";
import { RemoteImg } from "./RemoteImg";

/**
 * A single leverage-enabled market.
 *
 * Unlike MarketCard this is pinned to one specific market rather than picking
 * the busiest in an event — several leverage listings live inside large
 * multi-outcome events, and the whole point is to surface that one outcome.
 */
export function LeverageCard({
  listing,
  delay = 0,
}: {
  listing: LeverageListing;
  delay?: number;
}) {
  const { event, market, config } = listing;
  const href = `/market/${event.slug}?m=${market.id}`;
  const price = market.yes.price;
  const openable = isWithinBand(price);

  return (
    <article
      className="market-card animate-card-in relative flex h-full min-w-0 cursor-pointer flex-col gap-3 rounded-3xl bg-card px-4 py-3.5 ring-1 ring-white/5 hover:ring-white/15 sm:gap-3.5 sm:px-5 sm:py-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Link
        to={href}
        prefetch="intent"
        className="absolute inset-0 z-[1] rounded-3xl"
        aria-label={market.question}
      />

      <div className="relative z-[2] flex min-w-0 items-start gap-2.5 sm:gap-3">
        {market.icon || market.image || event.icon ? (
          <RemoteImg
            src={market.icon ?? market.image ?? event.icon}
            size={36}
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/10 sm:h-9 sm:w-9"
          />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded-full bg-gold/20 sm:h-9 sm:w-9" />
        )}
        <div className="min-w-0 flex-1">
          <p className="min-w-0 line-clamp-2 text-[13px] leading-snug text-[#d8d8d8]">
            {market.groupItemTitle
              ? `${event.title} — ${market.groupItemTitle}`
              : market.question}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-1 text-[15px] font-bold text-gold">
          <LayersIcon size={14} />
          {config.maxLeverage}x
        </span>
      </div>

      <div className="relative z-[2] text-[28px] font-semibold leading-none tracking-tight sm:text-[40px]">
        {pct(price)}
      </div>

      <div className="relative z-[2] mt-auto flex min-w-0 items-center gap-2">
        <Link
          to={`${href}&s=yes`}
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-full border border-up/40 px-2 py-2 text-center text-[12px] font-semibold text-up transition hover:bg-up/10 sm:px-3 sm:text-sm"
        >
          {market.yes.label}
        </Link>
        <Link
          to={`${href}&s=no`}
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-full border border-down/40 px-2 py-2 text-center text-[12px] font-semibold text-down transition hover:bg-down/10 sm:px-3 sm:text-sm"
        >
          {market.no.label}
        </Link>
      </div>

      <div
        className={`relative z-[2] flex items-center gap-2 border-t border-white/5 pt-2.5 text-[12px] text-muted sm:pt-3 sm:text-[13px] ${
          openable ? "justify-end" : "justify-between"
        }`}
      >
        {openable ? null : (
          <span
            className="truncate text-gold/80"
            title={`Leverage opens between ${pct(PRICE_BAND.min)} and ${pct(PRICE_BAND.max)}`}
          >
            Leverage paused · off band
          </span>
        )}
        <span className="shrink-0">
          {formatEnd(market.endDate ?? event.endDate) ?? "Open"}
        </span>
      </div>
    </article>
  );
}
