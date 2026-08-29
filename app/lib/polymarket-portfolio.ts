export type LivePosition = {
  id: string;
  wallet: string;
  tokenId: string | null;
  conditionId: string | null;
  eventSlug: string | null;
  marketSlug: string | null;
  title: string;
  outcome: string;
  side: "yes" | "no";
  shares: number;
  entryPrice: number;
  currentPrice: number;
  /** Average price a closed position actually sold at. Null while open. */
  exitPrice: number | null;
  initialValue: number;
  currentValue: number;
  pnl: number;
  pctChange: number;
  status: "open" | "closed";
  redeemable: boolean;
  endDate: string | null;
};

/**
 * What the position is on, in the market's own terms.
 *
 * A position is always bought, and always long the outcome token held, so
 * "Yes"/"No" only describes a direction on binary markets. A named outcome (a
 * team, a candidate) is shown as-is: on "Cubs vs. Diamondbacks" both sides are
 * longs, and calling the second one a short would be wrong.
 */
export function outcomeLabel(position: Pick<LivePosition, "outcome" | "side">) {
  const name = position.outcome?.trim();
  if (!name || /^(yes|no)$/i.test(name)) {
    return position.side === "no" ? "No" : "Yes";
  }
  return name;
}

export type LiveActivity = {
  id: string;
  type: string;
  title: string;
  amount: number;
  eventSlug: string | null;
  marketSlug: string | null;
  timestamp: number;
};

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Present numeric field, including 0. `||` would treat a resolved loser as missing. */
function money(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A resolved Polymarket market: either the API says it can be redeemed, or
 * the event is over and the mark has gone to 0 or 1. Live longshots can sit
 * near 0.01 before expiry, so price alone is not enough.
 */
export function isSettledPosition(position: LivePosition) {
  if (position.status !== "open") return false;
  if (position.redeemable) return true;
  if (position.currentPrice === 0 || position.currentPrice === 1) return true;
  const ended =
    Boolean(position.endDate) &&
    new Date(position.endDate!).getTime() < Date.now();
  if (!ended) return false;
  return position.currentPrice <= 0.01 || position.currentPrice >= 0.99;
}

function asPrice(value: unknown) {
  const n = num(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 && n <= 100 ? n / 100 : n;
}

function mapPosition(
  raw: Record<string, unknown>,
  status: "open" | "closed",
): LivePosition | null {
  const title = str(raw.title) ?? str(raw.slug) ?? "Position";
  const outcome = str(raw.outcome) ?? "Yes";
  const outcomeIndex = num(raw.outcomeIndex);
  const entryPrice = asPrice(raw.avgPrice);
  const currentPrice = asPrice(raw.curPrice);

  // /closed-positions describes a settled trade rather than a holding: it has
  // no size, initialValue or currentValue, only what was paid (totalBought)
  // and what the round trip returned (realizedPnl). Reading the open-position
  // fields off it leaves every number at zero. realizedPnl is also the only
  // honest source here — it reflects the prices actually sold at, so it cannot
  // be recomputed from avgPrice and curPrice.
  const cost = num(raw.totalBought);
  const realized = num(raw.realizedPnl);
  const settled = status === "closed" && cost > 0;

  const shares = settled
    ? entryPrice > 0
      ? cost / entryPrice
      : 0
    : num(raw.size ?? raw.shares);
  if (shares <= 0 && status === "open") return null;

  const initialValue = settled
    ? cost
    : (money(raw.initialValue) ??
      (shares > 0 && entryPrice > 0 ? shares * entryPrice : 0));
  const marked =
    shares > 0 && Number.isFinite(currentPrice)
      ? shares * currentPrice
      : null;
  const currentValue = settled
    ? cost + realized
    : (money(raw.currentValue) ?? marked ?? initialValue);
  const pnl = settled
    ? realized
    : (money(raw.cashPnl) ?? currentValue - initialValue);
  const pctChange = initialValue > 0 ? pnl / initialValue : 0;

  // What the round trip returned per share. curPrice is the market's price
  // today, which says nothing about what a seller got: a position sold on the
  // way down still reports curPrice 0 alongside a positive realizedPnl.
  // Re-entering a position can push this past $1, so only trust a real price.
  const impliedExit = settled && shares > 0 ? currentValue / shares : 0;
  const exitPrice = impliedExit > 0 && impliedExit <= 1 ? impliedExit : null;
  return {
    id: `${str(raw.asset) ?? str(raw.tokenId) ?? title}:${status}`,
    wallet: str(raw.proxyWallet) ?? str(raw.wallet) ?? "",
    tokenId: str(raw.asset) ?? str(raw.tokenId),
    conditionId: str(raw.conditionId),
    eventSlug: str(raw.eventSlug),
    marketSlug: str(raw.slug),
    title,
    outcome,
    side: outcomeIndex === 1 || /^no$/i.test(outcome) ? "no" : "yes",
    shares,
    entryPrice,
    currentPrice,
    exitPrice,
    initialValue,
    currentValue,
    pnl,
    pctChange,
    status,
    redeemable: raw.redeemable === true,
    endDate: str(raw.endDate),
  };
}

async function dataGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://data-api.polymarket.com${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function listForUser(user: string) {
  const qs = `user=${encodeURIComponent(user)}&limit=100`;
  const [open, closed, activity, value] = await Promise.all([
    dataGet<unknown[]>(`/positions?${qs}&sizeThreshold=0&sortBy=CURRENT`),
    dataGet<unknown[]>(`/closed-positions?${qs}`),
    dataGet<unknown[]>(`/activity?${qs}`),
    dataGet<unknown>(`/value?user=${encodeURIComponent(user)}`),
  ]);
  return { open, closed, activity, value };
}

function parseValue(raw: unknown) {
  if (typeof raw === "number") return raw;
  if (Array.isArray(raw)) {
    return raw.reduce((s, row) => {
      if (row && typeof row === "object" && "value" in row) {
        return s + num((row as { value: unknown }).value);
      }
      return s;
    }, 0);
  }
  if (raw && typeof raw === "object" && "value" in raw) {
    return num((raw as { value: unknown }).value);
  }
  return 0;
}

function mapActivity(raw: Record<string, unknown>, i: number): LiveActivity {
  const type = str(raw.type) ?? "TRADE";
  const title =
    str(raw.title) ??
    (type === "TRADE"
      ? `${str(raw.side) ?? "Trade"} ${str(raw.outcome) ?? ""}`.trim()
      : type);
  return {
    id: str(raw.transactionHash) ?? `${type}:${raw.timestamp ?? i}`,
    type,
    title,
    amount: num(raw.amount ?? raw.usdcSize ?? raw.size),
    eventSlug: str(raw.eventSlug),
    marketSlug: str(raw.slug),
    timestamp: num(raw.timestamp),
  };
}

export async function loadPolymarketPortfolio(addresses: string[]) {
  const unique = [
    ...new Set(addresses.map((a) => a.toLowerCase()).filter(Boolean)),
  ].slice(0, 6);

  const pages = await Promise.all(unique.map((user) => listForUser(user)));
  const openById = new Map<string, LivePosition>();
  const closedById = new Map<string, LivePosition>();
  const activityById = new Map<string, LiveActivity>();
  let reportedValue = 0;

  for (const page of pages) {
    reportedValue += parseValue(page.value);
    for (const row of page.open ?? []) {
      if (!row || typeof row !== "object") continue;
      const pos = mapPosition(row as Record<string, unknown>, "open");
      if (pos) openById.set(pos.id, pos);
    }
    for (const row of page.closed ?? []) {
      if (!row || typeof row !== "object") continue;
      const pos = mapPosition(row as Record<string, unknown>, "closed");
      if (pos) closedById.set(pos.id, pos);
    }
    (page.activity ?? []).forEach((row, i) => {
      if (!row || typeof row !== "object") return;
      const item = mapActivity(row as Record<string, unknown>, i);
      activityById.set(item.id, item);
    });
  }

  const open = [...openById.values()].sort(
    (a, b) => b.currentValue - a.currentValue,
  );
  const closed = [...closedById.values()];
  const activity = [...activityById.values()].sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  const positionsValue = open.reduce((s, p) => s + p.currentValue, 0);
  const positionsPnl = open.reduce((s, p) => s + p.pnl, 0);

  return {
    open,
    closed,
    activity: activity.slice(0, 50),
    positionsValue: reportedValue > 0 ? reportedValue : positionsValue,
    positionsPnl: open.length > 0 ? positionsPnl : null,
  };
}
