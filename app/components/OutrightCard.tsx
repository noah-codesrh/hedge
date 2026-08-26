import { useNavigate } from "react-router";
import type { Market, PolymarketEvent } from "../lib/types";
import { pct, usd } from "../lib/format";
import { isLiveMarket } from "../lib/polymarket";

function rowLabel(market: Market) {
  const titled = market.groupItemTitle?.trim();
  if (titled) return titled;
  const yes = market.yes.label?.trim();
  if (yes && !/^yes$/i.test(yes)) return yes;
  return null;
}

function barWidth(price: number, maxPrice: number) {
  const rel = maxPrice > 0 ? Math.max(0, price) / maxPrice : 0;
  return `${Math.round(30 + rel * 70)}%`;
}

export function ChanceBar({
  label,
  image,
  price,
  maxPrice,
  onClick,
}: {
  label: string;
  image?: string | null;
  price: number;
  maxPrice: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="flex w-full min-w-0 items-center gap-2 text-left"
    >
      <span className="min-w-0 flex-1">
        <span
          className="flex h-9 items-center gap-2 overflow-hidden rounded-xl bg-white/10 px-2.5 text-sm text-white transition hover:bg-white/15"
          style={{ width: barWidth(price, maxPrice) }}
        >
          {image ? (
            <img
              src={image}
              alt=""
              className="h-4 w-5 shrink-0 rounded-[3px] object-cover"
            />
          ) : null}
          <span className="min-w-0 truncate">{label}</span>
        </span>
      </span>
      <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-muted">
        {pct(price)}
      </span>
    </button>
  );
}

export function OutrightCard({
  event,
  delay = 0,
}: {
  event: PolymarketEvent;
  delay?: number;
}) {
  const navigate = useNavigate();
  const href = `/market/${event.slug}`;
  const rows = [...event.markets]
    .filter(isLiveMarket)
    .flatMap((m) => {
      const label = rowLabel(m);
      return label ? [{ market: m, label }] : [];
    })
    .sort((a, b) => b.market.yes.price - a.market.yes.price)
    .slice(0, 12);
  if (rows.length === 0) return null;
  const preview = rows.slice(0, 3);
  const scrolling = rows.length >= 3;
  const maxPrice = Math.max(...rows.map((r) => r.market.yes.price), 0.01);

  const renderRow = (row: (typeof rows)[number], key: string) => (
    <ChanceBar
      key={key}
      label={row.label}
      image={row.market.image}
      price={row.market.yes.price}
      maxPrice={maxPrice}
      onClick={() => navigate(`${href}?m=${row.market.id}`)}
    />
  );

  return (
    <article
      onClick={() => navigate(href)}
      className="market-card animate-card-in relative flex h-full min-w-0 cursor-pointer flex-col gap-3 rounded-3xl bg-card px-4 py-3.5 ring-1 ring-white/5 hover:ring-white/15 sm:gap-3.5 sm:px-5 sm:py-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {event.image ? (
          <img
            src={event.image}
            alt=""
            className="h-9 w-9 shrink-0 rounded-2xl bg-black/30 object-cover ring-1 ring-white/10 sm:h-12 sm:w-12"
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-2xl bg-gold/15 sm:h-12 sm:w-12" />
        )}
        <h3 className="min-w-0 line-clamp-2 text-[15px] font-semibold leading-snug text-white sm:text-base sm:leading-tight">
          {event.title}
        </h3>
      </div>

      <div
        className="space-y-1.5 md:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {preview.map((row) => renderRow(row, row.market.id))}
      </div>

      <div
        className="relative hidden h-[120px] overflow-hidden md:block"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`space-y-1.5 ${scrolling ? "animate-outright-scroll" : ""}`}
          style={
            scrolling
              ? { animationDuration: `${Math.max(14, rows.length * 2.4)}s` }
              : undefined
          }
        >
          {rows.map((row) => renderRow(row, row.market.id))}
          {scrolling
            ? rows.map((row) => renderRow(row, `dup-${row.market.id}`))
            : null}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/5 pt-3 text-[12px] text-muted sm:text-[13px]">
        <span className="truncate">{usd(event.volume24hr)} Vol.</span>
        <span className="shrink-0 rounded-md bg-white/5 px-2 py-0.5 font-semibold text-white">
          {event.markets.length} outcomes
        </span>
      </div>
    </article>
  );
}
