import { Link, useNavigate } from "react-router";
import type { PolymarketEvent } from "../lib/types";
import { formatEnd, pct, usd } from "../lib/format";
import { pickLiveMarket } from "../lib/polymarket";

export function MarketCard({
  event,
  dark = false,
  delay = 0,
  compact = false,
}: {
  event: PolymarketEvent;
  dark?: boolean;
  delay?: number;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const market = pickLiveMarket(event);
  if (!market) return null;

  const title =
    event.markets.length > 1 ? event.title : market.question;
  const href = `/market/${event.slug}`;

  return (
    <article
      onClick={() => navigate(href)}
      className={`market-card animate-card-in relative flex h-full min-w-0 cursor-pointer flex-col rounded-3xl ring-1 ring-white/5 hover:ring-white/15 ${
        dark ? "bg-[#141414]" : "bg-card"
      } ${compact ? "gap-2.5 px-4 py-3" : "gap-3 px-4 py-3.5 sm:gap-3.5 sm:px-5 sm:py-4"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
        {event.image ? (
          <img
            src={event.image}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/10 sm:h-9 sm:w-9"
          />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded-full bg-gold/20 sm:h-9 sm:w-9" />
        )}
        <p className="min-w-0 line-clamp-2 text-[13px] leading-snug text-[#d8d8d8]">
          {title}
        </p>
      </div>

      <div
        className={`font-semibold leading-none tracking-tight ${
          compact ? "text-[26px] sm:text-[28px]" : "text-[28px] sm:text-[40px]"
        }`}
      >
        {pct(market.yes.price)}
      </div>

      <div className="mt-auto flex min-w-0 items-center gap-2">
        <Link
          to={`${href}?s=yes`}
          onClick={(e) => e.stopPropagation()}
          className={`min-w-0 flex-1 truncate rounded-full border border-up/40 text-center font-semibold text-up transition hover:bg-up/10 ${
            compact ? "px-2 py-1.5 text-[12px] sm:px-2.5 sm:text-[13px]" : "px-2 py-2 text-[12px] sm:px-3 sm:text-sm"
          }`}
        >
          {market.yes.label}
        </Link>
        <Link
          to={`${href}?s=no`}
          onClick={(e) => e.stopPropagation()}
          className={`min-w-0 flex-1 truncate rounded-full border border-down/40 text-center font-semibold text-down transition hover:bg-down/10 ${
            compact ? "px-2 py-1.5 text-[12px] sm:px-2.5 sm:text-[13px]" : "px-2 py-2 text-[12px] sm:px-3 sm:text-sm"
          }`}
        >
          {market.no.label}
        </Link>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2.5 text-[12px] text-muted sm:pt-3 sm:text-[13px]">
        <span className="truncate">{usd(event.volume24hr)} Vol.</span>
        <span className="shrink-0">{formatEnd(event.endDate) ?? "Open"}</span>
      </div>
    </article>
  );
}
