export function fiat(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function signedFiat(n: number) {
  const abs = fiat(Math.abs(n));
  if (n > 0.004) return `+${abs}`;
  if (n < -0.004) return `-${abs}`;
  return abs;
}

/** Fraction (e.g. 0.125) → +12.5% */
export function signedPct(frac: number) {
  const p = frac * 100;
  const abs = `${Math.abs(p).toFixed(1)}%`;
  if (p > 0.05) return `+${abs}`;
  if (p < -0.05) return `-${abs}`;
  return abs;
}

export function usd(n: number, digits = 1) {
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toFixed(digits)}`;
}

/** Probability 0–1 → display percent. Keep tenths when rounding would hide a live price. */
export function pct(price: number, digits?: number) {
  const p = Math.max(0, price * 100);
  if (digits != null) return `${p.toFixed(digits)}%`;
  if (p > 0 && p < 1) return `${p.toFixed(1)}%`;
  if (p > 99 && p < 100) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

export function cents(price: number) {
  const c = Math.max(0, price * 100);
  if (c > 0 && c < 1) return `${c.toFixed(1)}¢`;
  return `${Math.round(c)}¢`;
}

export function shorten(addr?: string | null) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatEnd(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
