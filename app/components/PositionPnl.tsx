import { Link } from "react-router";
import { pct, signedFiat, signedPct } from "../lib/format";
import { pnlLabel, pnlTone, type PositionMark } from "../lib/pnl";
import type { LivePosition } from "../lib/polymarket-portfolio";
import type { HedgePosition } from "../lib/types";

export function PositionPnl({
  mark,
  entryPrice,
  compact = false,
  loading = false,
}: {
  mark: PositionMark | null;
  entryPrice?: number;
  compact?: boolean;
  loading?: boolean;
}) {
  if (!mark) {
    return (
      <span className="shrink-0 text-[13px] text-muted tabular-nums">
        {loading ? "…" : compact ? "—" : "Price unavailable"}
      </span>
    );
  }

  const tone = pnlTone(mark.pnl);
  const color =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-muted";

  if (compact) {
    return (
      <span className={`tabular-nums font-semibold ${color}`}>
        {signedFiat(mark.pnl)}
      </span>
    );
  }

  return (
    <div className={`shrink-0 text-right tabular-nums ${color}`}>
      <p className="text-[13px] font-semibold leading-none">{pnlLabel(mark.pnl)}</p>
      <p className="mt-1 text-sm font-bold leading-none">
        {signedFiat(mark.pnl)}{" "}
        <span className="font-semibold opacity-80">
          ({signedPct(mark.pctChange)})
        </span>
      </p>
      {entryPrice != null ? (
        <p className="mt-1 text-[11px] font-medium opacity-80">
          Now {pct(mark.current, 1)} · entry {pct(entryPrice, 1)}
        </p>
      ) : null}
    </div>
  );
}

export function LivePositionCard({
  position,
  onClose,
}: {
  position: LivePosition;
  onClose?: () => void;
}) {
  const href = position.eventSlug
    ? `/market/${position.eventSlug}`
    : position.marketSlug
      ? `/market/${position.marketSlug}`
      : "/";
  const mark: PositionMark | null =
    position.status === "open"
      ? {
          current: position.currentPrice,
          mark: position.currentValue,
          pnl: position.pnl,
          pctChange: position.pctChange,
        }
      : null;
  const canClose =
    position.status === "open" && Boolean(position.tokenId) && onClose;
  return (
    <div className="overflow-hidden rounded-2xl bg-[#1b1b1b] ring-1 ring-white/5">
      <Link
        to={href}
        className="flex items-start justify-between gap-3 px-3.5 py-3 transition hover:bg-[#222]"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Your position
          </p>
          <p className="mt-0.5 truncate text-[14px] font-semibold">
            {position.title}
            {position.outcome ? ` · ${position.outcome}` : ""}
            {position.shares > 0 ? ` · ${position.shares.toFixed(2)}` : ""}
          </p>
          <p className="mt-0.5 text-[13px]">USDG</p>
        </div>
        {position.status === "open" ? (
          <PositionPnl mark={mark} entryPrice={position.entryPrice} />
        ) : (
          <span className="shrink-0 text-[13px] text-muted">Closed</span>
        )}
      </Link>
      {canClose ? (
        <div className="border-t border-white/5 px-3.5 py-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full bg-white/5 py-2 text-[13px] font-semibold text-white transition hover:bg-white/10"
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PositionCard({
  position,
  mark,
  loading = false,
}: {
  position: HedgePosition;
  mark: PositionMark | null;
  loading?: boolean;
}) {
  const title = position.groupItemTitle || position.question;
  return (
    <Link
      to={`/market/${position.eventSlug || position.eventId}?m=${position.marketId}`}
      className="flex items-start justify-between gap-3 rounded-2xl bg-[#1b1b1b] px-3.5 py-3 ring-1 ring-white/5 transition hover:bg-[#222]"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Your position
        </p>
        <p className="mt-0.5 truncate text-[14px] font-semibold">
          {title} · {position.shares.toFixed(2)}
        </p>
        <p className="mt-0.5 text-[13px]">USDG</p>
      </div>
      {position.status === "open" ? (
        <PositionPnl
          mark={mark}
          entryPrice={position.entryPrice}
          loading={loading}
        />
      ) : (
        <span className="shrink-0 text-[13px] text-muted">Closed</span>
      )}
    </Link>
  );
}
