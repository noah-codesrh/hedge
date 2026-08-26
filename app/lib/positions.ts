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
  notifyBalancesChanged();
}

/** Book, Profile, and Polymarket pUSD listen for this after buys / cash-outs. */
export function notifyBalancesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("hedge:positions"));
}

const BURST_MS = [0, 800, 2000, 4500, 8000, 14000, 24000, 36000];

/** Reload now, again after a cash-out (RPC lag), and while the tab is open. */
export function watchBalanceReloads(load: () => void) {
  let burst: number[] = [];
  const clearBurst = () => {
    burst.forEach((id) => window.clearTimeout(id));
    burst = [];
  };
  const kick = () => {
    clearBurst();
    burst = BURST_MS.map((ms) => window.setTimeout(load, ms));
  };
  kick();
  window.addEventListener("hedge:positions", kick);
  window.addEventListener("storage", kick);
  const idle = window.setInterval(load, 10_000);
  const onVis = () => {
    if (document.visibilityState === "visible") load();
  };
  document.addEventListener("visibilitychange", onVis);
  return () => {
    clearBurst();
    window.removeEventListener("hedge:positions", kick);
    window.removeEventListener("storage", kick);
    window.clearInterval(idle);
    document.removeEventListener("visibilitychange", onVis);
  };
}
