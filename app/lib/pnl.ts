import type { HedgePosition, Side } from "./types";

export type MarketQuote = { yes: number; no: number };

export type PositionMark = {
  current: number;
  mark: number;
  pnl: number;
  pctChange: number;
};

export function quoteForSide(side: Side, quote: MarketQuote) {
  return side === "yes" ? quote.yes : quote.no;
}

export function markPosition(
  position: Pick<HedgePosition, "side" | "shares" | "amountUsdg">,
  quote: MarketQuote | undefined,
): PositionMark | null {
  if (!quote) return null;
  const current = quoteForSide(position.side, quote);
  if (!Number.isFinite(current) || current < 0) return null;
  const mark = position.shares * current;
  const pnl = mark - position.amountUsdg;
  const pctChange = position.amountUsdg > 0 ? pnl / position.amountUsdg : 0;
  return { current, mark, pnl, pctChange };
}

export function pnlTone(pnl: number) {
  if (pnl > 0.004) return "up" as const;
  if (pnl < -0.004) return "down" as const;
  return "flat" as const;
}

export function pnlLabel(pnl: number) {
  const tone = pnlTone(pnl);
  if (tone === "up") return "Winning";
  if (tone === "down") return "Losing";
  return "Even";
}
