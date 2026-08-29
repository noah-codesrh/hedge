import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuthorizationSignature, usePrivy } from "@privy-io/react-auth";
import { cents, fiat, signedFiat } from "../lib/format";
import { leverageIsLive } from "../lib/leverage";
import {
  readPositionsFor,
  type LeveragePosition,
} from "../lib/leverage-chain";
import type { TradeStage } from "../lib/leverage-actions";
import { notifyBalancesChanged } from "../lib/positions";
import { useEnsureCashWallet } from "../lib/wallet";
import { LayersIcon } from "./icons";

/**
 * Open leveraged positions, read straight from the engine.
 *
 * These are not Polymarket positions and never appear in the Polymarket
 * portfolio, so they need their own list. Everything shown here is derived
 * on-chain rather than remembered locally: a position can be liquidated or
 * settled by the keeper without the browser being involved, so local state
 * would go stale silently.
 */
export function LeveragePositions({ compact = false }: { compact?: boolean }) {
  const { authenticated, getAccessToken } = usePrivy();
  const { cashAddress, ensureCashWallet } = useEnsureCashWallet();
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const [positions, setPositions] = useState<LeveragePosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stage, setStage] = useState<TradeStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cashAddress) {
      setPositions([]);
      setLoading(false);
      return;
    }
    const next = await readPositionsFor(cashAddress);
    setPositions(next);
    setLoading(false);
  }, [cashAddress]);

  useEffect(() => {
    if (!leverageIsLive || !authenticated) {
      setLoading(false);
      return;
    }
    void load();
    // Marks move with the oracle and a position can be liquidated between
    // renders, so this polls rather than waiting for a user action. Kept a
    // little under the keeper's tick so a new price shows up promptly.
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [authenticated, load]);

  const close = async (position: LeveragePosition, fractionBps: number) => {
    setBusyId(`${position.id}`);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Session expired. Sign in again.");
      const cashWallet = await ensureCashWallet();
      if (!cashWallet?.address) throw new Error("Your wallet isn't ready yet.");

      const { closeLeveragePosition } = await import("../lib/leverage-actions");
      await closeLeveragePosition(
        {
          accessToken,
          from: cashWallet.address,
          wallet: cashWallet,
          signAuthorization: async (payload) => {
            const { signature } = await generateAuthorizationSignature(payload);
            if (!signature) throw new Error("Could not authorize this wallet.");
            return signature;
          },
        },
        position.id,
        fractionBps,
        setStage,
      );

      // Drop it locally before refetching. The close is already mined by this
      // point, but the list read is several round trips and leaving a closed
      // position on screen for that long reads as a failed tap.
      if (fractionBps === 10_000) {
        setPositions((all) => all.filter((p) => p.id !== position.id));
      }
      notifyBalancesChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close that position.");
    } finally {
      setBusyId(null);
      setStage(null);
    }
  };

  // Nothing to show and nothing to say: the spot portfolio below is the whole
  // story for anyone who has never opened a levered position.
  if (!leverageIsLive || !authenticated || positions.length === 0) return null;

  return (
    <section className={compact ? "mb-6" : "mt-6"}>
      <div className="mb-3 flex items-center gap-2">
        <LayersIcon size={15} />
        <h2 className="text-[15px] font-semibold">Leveraged positions</h2>
        <span className="text-[13px] text-muted">{positions.length}</span>
      </div>

      {error ? (
        <p className="mb-3 rounded-2xl bg-down/10 px-3 py-2.5 text-[13px] leading-snug text-down">
          {error}
        </p>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {positions.map((position) => (
          <li key={String(position.id)} className="min-w-0">
            <LeveragePositionCard
              position={position}
              busy={busyId === `${position.id}`}
              stage={busyId === `${position.id}` ? stage : null}
              onClose={(fractionBps) => void close(position, fractionBps)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

const STAGE_LABEL: Record<TradeStage, string> = {
  approving: "Approving…",
  checking: "Checking…",
  submitting: "Closing…",
};

function LeveragePositionCard({
  position,
  busy,
  stage,
  onClose,
}: {
  position: LeveragePosition;
  busy: boolean;
  stage: TradeStage | null;
  onClose: (fractionBps: number) => void;
}) {
  const net = position.pnl - position.funding;
  const tone = net > 0 ? "text-up" : net < 0 ? "text-down" : "text-muted";
  const pnlPct = position.margin > 0 ? (net / position.margin) * 100 : 0;

  // Below the engine's $1 floor there is no valid partial close left, so the
  // card stops offering one rather than letting the call revert.
  const canHalve = position.margin / 2 >= 1;

  /**
   * How much of the buffer to liquidation has been used up.
   *
   * The entry-to-liquidation gap is the whole runway, so measuring the mark
   * against it turns two prices into the thing a trader actually wants to
   * know: how close this is to being closed for them.
   */
  const runway = Math.abs(position.entryPrice - position.liquidationPrice);
  const markPrice =
    position.isLong
      ? position.entryPrice + position.pnl / Math.max(position.shares, 1e-9)
      : position.entryPrice - position.pnl / Math.max(position.shares, 1e-9);
  const used =
    runway > 0
      ? Math.min(1, Math.max(0, Math.abs(markPrice - position.entryPrice) / runway))
      : 0;
  const losing = net < 0;

  const href = position.eventSlug
    ? `/market/${position.eventSlug}${position.gammaMarketId ? `?m=${position.gammaMarketId}` : ""}`
    : null;

  const title = position.label ?? "Leveraged position";

  return (
    <div className="flex h-full flex-col rounded-2xl bg-card-2 p-4 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        {href ? (
          <Link to={href} className="min-w-0 transition hover:opacity-80">
            <p className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">
              {title}
            </p>
          </Link>
        ) : (
          <p className="line-clamp-2 min-w-0 text-[15px] font-semibold leading-snug tracking-tight">
            {title}
          </p>
        )}
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-1 text-[13px] font-bold text-gold">
          {position.leverage.toFixed(position.leverage % 1 === 0 ? 0 : 1)}x
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-1 text-[12px] font-medium text-white/80">
          {position.isLong ? "Yes" : "No"}
        </span>
        {position.resolved ? (
          <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/80">
            Resolved — settling
          </span>
        ) : position.atRisk ? (
          <span className="inline-flex items-center rounded-full bg-down/15 px-2.5 py-1 text-[12px] font-semibold text-down">
            At liquidation
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted">Worth now</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">
            {fiat(position.value)}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-[15px] font-bold tabular-nums ${tone}`}>
            {signedFiat(net)}
          </p>
          <p className={`text-[12px] tabular-nums ${tone}`}>
            {pnlPct >= 0 ? "+" : ""}
            {pnlPct.toFixed(1)}%
          </p>
        </div>
      </div>

      {!position.resolved && runway > 0 ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>Entry {cents(position.entryPrice)}</span>
            <span className="text-down">
              Liq {cents(position.liquidationPrice)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full transition-all ${
                used > 0.75 ? "bg-down" : used > 0.4 ? "bg-gold" : "bg-up"
              }`}
              style={{ width: `${Math.max(2, (losing ? used : 0) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {losing
              ? `${Math.round((1 - used) * 100)}% of your margin buffer left`
              : "Moving your way"}
          </p>
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-white/5 pt-3 text-[12px]">
        <div className="min-w-0">
          <dt className="text-muted">Margin</dt>
          <dd className="mt-0.5 tabular-nums">{fiat(position.margin)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Size</dt>
          <dd className="mt-0.5 tabular-nums">{fiat(position.size)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Carry</dt>
          <dd className="mt-0.5 tabular-nums">
            {position.funding > 0 ? `-${fiat(position.funding)}` : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex gap-2 pt-4">
        {canHalve ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onClose(5_000)}
            className="flex-1 rounded-full bg-white/5 py-2 text-[13px] font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
          >
            Close half
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => onClose(10_000)}
          className="flex-1 rounded-full bg-white/5 py-2 text-[13px] font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
        >
          {busy ? STAGE_LABEL[stage ?? "submitting"] : "Close"}
        </button>
      </div>
    </div>
  );
}
