import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";

export type ChartPoint = {
  time: number;
  value: number;
};

export type ChartUnit = "pct" | "usd" | "mcap";
export type ChartTone = "gold" | "up" | "down";

const TONE: Record<
  ChartTone,
  { line: string; top: string; bottom: string }
> = {
  gold: {
    line: "#F1D65A",
    top: "rgba(241, 214, 90, 0.28)",
    bottom: "rgba(241, 214, 90, 0.02)",
  },
  up: {
    line: "#34d399",
    top: "rgba(52, 211, 153, 0.28)",
    bottom: "rgba(52, 211, 153, 0.03)",
  },
  down: {
    line: "#f26d5b",
    top: "rgba(242, 109, 91, 0.22)",
    bottom: "rgba(242, 109, 91, 0.02)",
  },
};

function formatAxis(unit: ChartUnit, p: number) {
  if (unit === "pct") return `${p.toFixed(1)}%`;
  if (unit === "mcap") {
    if (p >= 1_000_000_000) return `$${(p / 1_000_000_000).toFixed(2)}b`;
    if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}m`;
    if (p >= 1_000) return `$${(p / 1_000).toFixed(0)}k`;
    return `$${p.toFixed(0)}`;
  }
  if (p >= 1) return `$${p.toPrecision(4)}`;
  if (p >= 0.0001) return `$${p.toPrecision(3)}`;
  return `$${p.toExponential(1)}`;
}

function toSeriesData(points: ChartPoint[], scale: number) {
  const byTime = new Map<number, number>();
  for (const point of points) {
    if (!(point.time > 0) || !Number.isFinite(point.value)) continue;
    byTime.set(point.time, point.value * scale);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

export function PriceChart({
  points,
  overlay,
  unit = "pct",
  tone = "gold",
  overlayTone = "down",
  strike,
  mark,
  interactive = false,
}: {
  points: ChartPoint[];
  overlay?: ChartPoint[] | null;
  unit?: ChartUnit;
  tone?: ChartTone;
  overlayTone?: ChartTone;
  strike?: number | null;
  mark?: { value: number; title: string } | null;
  interactive?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const overlayPoints = overlay ?? [];
  const hasPrimary = points.length >= 2;
  const hasOverlay = overlayPoints.length >= 2;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const overlayRows = overlay ?? [];
    const showPrimary = points.length >= 2;
    const showOverlay = overlayRows.length >= 2;
    if (!showPrimary && !showOverlay) return;

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
      handleScroll: interactive,
      handleScale: interactive,
    });

    const scale = unit === "pct" ? 100 : 1;
    const format = {
      type: "custom" as const,
      minMove: unit === "pct" ? 0.1 : 0.00000001,
      formatter: (p: number) => formatAxis(unit, p),
    };

    const paint = (data: ChartPoint[], paintTone: ChartTone, lineWidth: 2 | 3) => {
      const colors = TONE[paintTone];
      const series = chart.addSeries(AreaSeries, {
        lineColor: colors.line,
        topColor: colors.top,
        bottomColor: colors.bottom,
        lineWidth,
        priceFormat: format,
      });
      const rows = toSeriesData(data, scale);
      if (rows.length > 0) series.setData(rows);
      return series;
    };

    if (showOverlay) paint(overlayRows, overlayTone, 2);
    const series = showPrimary ? paint(points, tone, showOverlay ? 3 : 2) : null;

    let line: IPriceLine | null = null;
    if (series && mark != null && Number.isFinite(mark.value)) {
      const price = unit === "pct" ? mark.value * 100 : mark.value;
      line = series.createPriceLine({
        price,
        color: "#8a8a8a",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: mark.title,
      });
    } else if (series && strike != null && strike > 0 && unit !== "pct") {
      line = series.createPriceLine({
        price: strike,
        color: TONE[tone].line,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Strike",
      });
    }

    chart.timeScale().fitContent();

    return () => {
      if (line && series) series.removePriceLine(line);
      chart.remove();
    };
  }, [points, overlay, unit, tone, overlayTone, strike, mark, interactive]);

  if (!hasPrimary && !hasOverlay) {
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
