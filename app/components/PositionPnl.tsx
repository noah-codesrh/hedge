import { useState } from "react";
import { Link } from "react-router";
import { fiat, signedFiat, signedPct } from "../lib/format";
import { leverageFromEntry, pnlTone, type PositionMark } from "../lib/pnl";
import {
  isSettledPosition,
  outcomeLabel,
  type LivePosition,
} from "../lib/polymarket-portfolio";
import type { HedgePosition } from "../lib/types";
import { liveHref, PnlShareCard } from "./PnlShareCard";
import { PnlShareModal, shareFromLive } from "./PnlShareModal";

export function PositionPnl({
  mark,
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

  return (
    <span className={`tabular-nums font-semibold ${color}`}>
      {signedPct(mark.pctChange, 2)}
    </span>
  );
}

export function LivePositionCard({
  position,
  onClose,
}: {
  position: LivePosition;
  onClose?: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const open = position.status === "open";
  const canClose = open && Boolean(position.tokenId) && onClose;
  const outcome = outcomeLabel(position);
  const leverage = leverageFromEntry(position.entryPrice);
  const tone = pnlTone(position.pnl);
  const pctColor =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-muted";

  return (
    <div className="flex h-full flex-col rounded-2xl bg-card-2 p-4 ring-1 ring-white/5">
      <Link
        to={liveHref(position)}
        className="min-w-0 transition hover:opacity-80"
      >
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">
          {position.title}
        </p>
      </Link>

      <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[12px] font-medium text-white/80">
        <span className="max-w-[10rem] truncate">{outcome}</span>
        {leverage != null ? (
          <span className="text-muted">{leverage}x</span>
        ) : null}
      </span>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
        <div className="min-w-0">
          <dt className="text-muted">Amount</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {fiat(position.initialValue)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">
            {open ? "Worth now" : "Final value"}
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {fiat(position.currentValue)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">P&L</dt>
          <dd className={`mt-0.5 font-semibold tabular-nums ${pctColor}`}>
            {signedPct(position.pctChange, 2)}
            <span className="block text-[12px] font-medium">
              {signedFiat(position.pnl)}
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex gap-2 pt-4">
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="flex-1 rounded-full bg-white/5 py-2 text-[13px] font-semibold text-white transition hover:bg-white/10"
        >
          PnL card
        </button>
        {canClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full bg-white/5 py-2 text-[13px] font-semibold text-white transition hover:bg-white/10"
          >
            {position.redeemable
              ? "Redeem"
              : isSettledPosition(position) && position.currentPrice <= 0.01
                ? "Clear"
                : "Close"}
          </button>
        ) : null}
      </div>

      {shareOpen ? (
        <PnlShareModal
          share={shareFromLive(position)}
          onClose={() => setShareOpen(false)}
        />
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
  const outcome = position.side === "no" ? "No" : "Yes";
  return (
    <PnlShareCard
      title={title}
      href={`/market/${position.eventSlug || position.eventId}?m=${position.marketId}`}
      outcome={outcome}
      entryPrice={position.entryPrice}
      markPrice={mark?.current ?? null}
      pnl={mark?.pnl ?? null}
      pctChange={mark?.pctChange ?? null}
      status={position.status}
      loading={loading}
    />
  );
}
