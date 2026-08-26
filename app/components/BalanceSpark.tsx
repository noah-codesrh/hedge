import { useEffect, useId, useMemo, useState } from "react";
import type { LivePosition } from "../lib/polymarket-portfolio";
import { getPriceHistory, type PricePoint } from "../lib/polymarket";
import { pnlTone } from "../lib/pnl";

export type SparkPoint = { time: number; value: number };

function priceAt(history: PricePoint[], time: number) {
  if (history.length === 0) return null;
  let price = history[0]!.value;
  for (const point of history) {
    if (point.time > time) break;
    price = point.value;
  }
  return price;
}

function downsample(times: number[], max = 48) {
  if (times.length <= max) return times;
  const step = Math.ceil(times.length / max);
  const out: number[] = [];
  for (let i = 0; i < times.length; i += step) out.push(times[i]!);
  const last = times[times.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function usePortfolioSpark(
  positions: LivePosition[],
  cash: number,
  total: number,
) {
  const key = positions
    .map((p) => `${p.tokenId}:${p.shares.toFixed(4)}`)
    .join("|");
  const [points, setPoints] = useState<SparkPoint[]>([]);

  useEffect(() => {
    const open = positions
      .filter((p) => p.status === "open" && p.tokenId && p.shares > 0)
      .slice(0, 4);
    if (open.length === 0) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      open.map(async (position) => ({
        shares: position.shares,
        history: await getPriceHistory(position.tokenId!, {
          interval: "1d",
          fidelity: "15",
        }),
      })),
    ).then((series) => {
      if (cancelled) return;
      const times = new Set<number>();
      for (const row of series) {
        for (const point of row.history) times.add(point.time);
      }
      const sorted = downsample([...times].sort((a, b) => a - b));
      if (sorted.length < 2) {
        setPoints([]);
        return;
      }
      const next = sorted.map((time) => {
        let marked = cash;
        for (const row of series) {
          const price = priceAt(row.history, time);
          if (price != null) marked += row.shares * price;
        }
        return { time, value: marked };
      });
      const last = next[next.length - 1];
      if (last && Math.abs(last.value - total) > 0.05) {
        next.push({ time: Math.floor(Date.now() / 1000), value: total });
      }
      setPoints(next);
    });
    return () => {
      cancelled = true;
    };
    // cash/total pinned to displayed headline; key covers position set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cash, total]);

  return points;
}

export function BalanceSpark({
  points,
  pnl = 0,
}: {
  points: SparkPoint[];
  pnl?: number;
}) {
  const tone = pnlTone(pnl);
  const color =
    tone === "up" ? "#34d399" : tone === "down" ? "#f26d5b" : "#F1D65A";
  const fillId = useId().replace(/:/g, "");
  const path = useMemo(() => {
    if (points.length >= 2) {
      const min = Math.min(...points.map((p) => p.value));
      const max = Math.max(...points.map((p) => p.value));
      const span = Math.max(0.01, max - min);
      const coords = points.map((p, i) => {
        const x = (i / (points.length - 1)) * 216;
        const y = 34 - ((p.value - min) / span) * 28;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return coords.join(" ");
    }
    return tone === "down"
      ? "0,10 24,12 48,9 72,16 96,14 120,20 144,18 168,26 192,24 216,32"
      : "0,34 24,30 48,31 72,24 96,26 120,18 144,20 168,10 192,12 216,6";
  }, [points, tone]);

  return (
    <svg
      viewBox="0 0 216 40"
      preserveAspectRatio="none"
      className="my-3 h-16 w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${path} 216,40`} fill={`url(#${fillId})`} />
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
