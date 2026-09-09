import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { toCandles, type CandleTf, candleFrame } from "../lib/candles";
import type { PricePoint } from "../lib/polymarket";

function formatPct(p: number) {
  return `${p.toFixed(1)}%`;
}

export function CandleChart({
  points,
  timeframe,
}: {
  points: PricePoint[];
  timeframe: CandleTf;
}) {
  const host = useRef<HTMLDivElement>(null);
  const frame = candleFrame(timeframe);
  const candles = useMemo(
    () => toCandles(points, frame.bucketSec),
    [points, frame.bucketSec],
  );
  const ready = candles.length >= 2;

  useEffect(() => {
    const el = host.current;
    if (!el || candles.length < 2) return;

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8a8a",
        fontFamily: "Onest, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        barSpacing: 6,
        minBarSpacing: 3,
        rightOffset: 4,
      },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScroll: true,
      handleScale: true,
    });

    const pctFormat = {
      type: "custom" as const,
      minMove: 0.1,
      formatter: formatPct,
    };

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#f26d5b",
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#f26d5b",
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      priceFormat: pctFormat,
    });
    candleSeries.setData(
      candles.map((row) => ({
        time: row.time as UTCTimestamp,
        open: row.open * 100,
        high: row.high * 100,
        low: row.low * 100,
        close: row.close * 100,
      })),
    );

    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, candles.length - 96),
      to: candles.length + 3,
    });
    return () => {
      chart.remove();
    };
  }, [candles, timeframe]);

  if (!ready) {
    return (
      <div className="grid h-72 place-items-center rounded-2xl bg-card text-sm text-muted sm:h-[28rem]">
        Not enough ticks yet for this timeframe.
      </div>
    );
  }

  return (
    <div
      ref={host}
      className="relative z-0 h-72 w-full min-w-0 isolate overflow-hidden sm:h-[28rem]"
    />
  );
}
