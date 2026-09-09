import type { PricePoint } from "./polymarket";

export type CandleTf = "1h" | "4h" | "1D";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export const CANDLE_FRAMES = [
  { id: "1h", label: "1h", interval: "1w", fidelity: "5", bucketSec: 60 * 60 },
  { id: "4h", label: "4h", interval: "max", fidelity: "15", bucketSec: 4 * 60 * 60 },
  { id: "1D", label: "1D", interval: "max", fidelity: "60", bucketSec: 24 * 60 * 60 },
] as const;

export function candleFrame(id: CandleTf) {
  return CANDLE_FRAMES.find((row) => row.id === id) ?? CANDLE_FRAMES[0];
}

/** Fold CLOB ticks into OHLC buckets. Values stay in 0–1 probability. */
export function toCandles(points: PricePoint[], bucketSec: number): Candle[] {
  if (!(bucketSec > 0)) return [];
  const buckets = new Map<number, Candle>();
  for (const point of points) {
    if (!(point.time > 0) || !Number.isFinite(point.value)) continue;
    const time = Math.floor(point.time / bucketSec) * bucketSec;
    const value = point.value;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, {
        time,
        open: value,
        high: value,
        low: value,
        close: value,
      });
      continue;
    }
    existing.high = Math.max(existing.high, value);
    existing.low = Math.min(existing.low, value);
    existing.close = value;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
