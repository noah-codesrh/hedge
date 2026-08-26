import type { HedgePosition } from "./types";

const KEY = "hedge:positions";

function read(): HedgePosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HedgePosition[]) : [];
  } catch {
    return [];
  }
}

function write(rows: HedgePosition[]) {
  window.localStorage.setItem(KEY, JSON.stringify(rows));
}

export function listPositions(): HedgePosition[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function addPosition(position: HedgePosition) {
  write([position, ...read()]);
  window.dispatchEvent(new Event("hedge:positions"));
}
