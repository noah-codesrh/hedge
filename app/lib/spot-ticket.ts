/** Public 1x ticket: another product quotes, then the user fills in Hedge. */

export const SPOT_ORIGIN = "https://hedgeapp.trade";
export const SPOT_MIN_AMOUNT = 1;
export const SPOT_MAX_AMOUNT = 10_000;

export type SpotSide = "yes" | "no";

export function parseSpotSide(raw: string | null | undefined): SpotSide | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "yes" || value === "long") return "yes";
  if (value === "no" || value === "short") return "no";
  return null;
}

export function parseSpotAmount(raw: string | number | null | undefined) {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < SPOT_MIN_AMOUNT) return null;
  return Math.min(Math.round(n * 100) / 100, SPOT_MAX_AMOUNT);
}

export function buildSpotTicketUrl(input: {
  origin?: string;
  eventSlug: string;
  marketId: string;
  side?: SpotSide;
  amount?: number;
  ref?: string;
}) {
  const origin = (input.origin ?? SPOT_ORIGIN).replace(/\/$/, "");
  const q = new URLSearchParams({ m: input.marketId });
  if (input.side) q.set("s", input.side);
  if (input.amount != null && input.amount >= SPOT_MIN_AMOUNT) {
    q.set("amt", String(input.amount));
  }
  if (input.ref) q.set("ref", input.ref);
  return `${origin}/market/${encodeURIComponent(input.eventSlug)}?${q}`;
}
