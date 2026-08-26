import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PricePoint } from "../lib/polymarket";

export function PriceChart({ points }: { points: PricePoint[] }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8a8a",
        fontFamily: "Onest, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#F1D65A",
      topColor: "rgba(241, 214, 90, 0.28)",
      bottomColor: "rgba(241, 214, 90, 0.02)",
      lineWidth: 2,
      priceFormat: {
        type: "custom",
        minMove: 0.1,
        formatter: (p: number) => `${p.toFixed(1)}%`,
      },
    });

    const data = points.map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value * 100,
    }));
    if (data.length > 0) series.setData(data);
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [points]);

  if (points.length < 2) {
    return (
      <div className="grid h-52 place-items-center rounded-2xl bg-card text-sm text-muted sm:h-72">
        No chart data yet for this market.
      </div>
    );
  }

  return (
    <div
      ref={host}
      className="relative z-0 h-52 w-full min-w-0 isolate overflow-hidden sm:h-72"
    />
  );
}
