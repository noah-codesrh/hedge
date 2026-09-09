import { useEffect, useState } from "react";
import { CandleChart } from "./CandleChart";
import { PriceChart } from "./PriceChart";
import {
  CANDLE_FRAMES,
  type CandleTf,
} from "../lib/candles";
import { getPriceHistory, type PricePoint } from "../lib/polymarket";
import { listedLeverageFor } from "../lib/leverage";
import { pct } from "../lib/format";
import type { Market, Side } from "../lib/types";

type ChartMode = "chance" | "candles";

const MODE_KEY = "hedge.leverageChart";
const TF_KEY = "hedge.leverageChartTf";

function readMode(): ChartMode {
  try {
    return localStorage.getItem(MODE_KEY) === "candles" ? "candles" : "chance";
  } catch {
    return "chance";
  }
}

function readTf(): CandleTf {
  try {
    const raw = localStorage.getItem(TF_KEY);
    return CANDLE_FRAMES.some((row) => row.id === raw)
      ? (raw as CandleTf)
      : "1D";
  } catch {
    return "1D";
  }
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
        active
          ? "bg-gold text-black"
          : "border border-white/10 text-muted hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

export function MarketChart({
  market,
  history,
  busy,
  side = "yes",
}: {
  market: Market;
  history: PricePoint[];
  busy: boolean;
  side?: Side;
}) {
  const listed = Boolean(listedLeverageFor(market));
  const [mode, setMode] = useState<ChartMode>("chance");
  const [timeframe, setTimeframe] = useState<CandleTf>("1D");
  const [candleHistory, setCandleHistory] = useState<PricePoint[]>([]);
  const [candleBusy, setCandleBusy] = useState(false);
  const tokenId = side === "no" ? market.no.tokenId : market.yes.tokenId;
  const outcome = side === "yes" ? market.yes : market.no;
  const label = market.groupItemTitle
    ? `${market.groupItemTitle} · ${outcome.label}`
    : `${outcome.label} chance`;

  useEffect(() => {
    if (!listed) return;
    setMode(readMode());
    setTimeframe(readTf());
  }, [listed]);

  useEffect(() => {
    if (!listed || mode !== "candles") return;
    if (!tokenId) {
      setCandleHistory([]);
      return;
    }
    const frame = CANDLE_FRAMES.find((row) => row.id === timeframe) ?? CANDLE_FRAMES[0];
    let cancelled = false;
    setCandleBusy(true);
    void getPriceHistory(tokenId, {
      interval: frame.interval,
      fidelity: frame.fidelity,
    }).then((points) => {
      if (cancelled) return;
      setCandleHistory(points);
      setCandleBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [listed, mode, timeframe, market.id, tokenId]);

  const chooseMode = (next: ChartMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const chooseTf = (next: CandleTf) => {
    setTimeframe(next);
    try {
      localStorage.setItem(TF_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const candlesOn = listed && mode === "candles";

  return (
    <div className="order-2 min-w-0 overflow-hidden rounded-3xl bg-card p-3 ring-1 ring-white/5 sm:p-4 lg:order-none lg:col-start-1 lg:row-start-1">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="min-w-0 truncate text-[13px] text-muted">{label}</p>
          <p className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {pct(outcome.price)}
          </p>
        </div>
        {listed ? (
          <div
            role="tablist"
            aria-label="Chart type"
            className="flex shrink-0 rounded-full border border-white/10 bg-white/[0.03] p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!candlesOn}
              onClick={() => chooseMode("chance")}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                !candlesOn ? "bg-gold text-black" : "text-muted hover:text-white"
              }`}
            >
              Chance
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={candlesOn}
              onClick={() => chooseMode("candles")}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                candlesOn ? "bg-gold text-black" : "text-muted hover:text-white"
              }`}
            >
              Candles
            </button>
          </div>
        ) : null}
      </div>

      {candlesOn ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5 px-1">
            {CANDLE_FRAMES.map((row) => (
              <Chip
                key={row.id}
                label={row.label}
                active={timeframe === row.id}
                onClick={() => chooseTf(row.id)}
              />
            ))}
          </div>
          {candleBusy ? (
            <div className="grid h-72 place-items-center text-sm text-muted sm:h-[28rem]">
              Loading chart…
            </div>
          ) : (
            <CandleChart
              key={`${market.id}-${side}-${timeframe}`}
              points={candleHistory}
              timeframe={timeframe}
            />
          )}
        </>
      ) : busy ? (
        <div className="grid h-52 place-items-center text-sm text-muted sm:h-72">
          Loading chart…
        </div>
      ) : (
        <PriceChart
          key={`${market.id}-${side}`}
          points={history}
          tone={side === "no" ? "down" : "gold"}
        />
      )}
    </div>
  );
}
