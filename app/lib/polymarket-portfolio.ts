export type LivePosition = {
  id: string;
  wallet: string;
  tokenId: string | null;
  eventSlug: string | null;
  marketSlug: string | null;
  title: string;
  outcome: string;
  side: "yes" | "no";
  shares: number;
  entryPrice: number;
  currentPrice: number;
  initialValue: number;
  currentValue: number;
  pnl: number;
  pctChange: number;
  status: "open" | "closed";
};

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

function str(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asPct(value: unknown) {
  const n = num(value);
  return Math.abs(n) > 2 ? n / 100 : n;
}

function mapPosition(
  raw: Record<string, unknown>,
  status: "open" | "closed",
): LivePosition | null {
  const title = str(raw.title) ?? str(raw.slug) ?? "Position";
  const shares = num(raw.size ?? raw.shares);
  if (shares <= 0 && status === "open") return null;
  const outcome = str(raw.outcome) ?? "Yes";
  const outcomeIndex = num(raw.outcomeIndex);
  return {
    id: `${str(raw.asset) ?? str(raw.tokenId) ?? title}:${status}`,
    wallet: str(raw.proxyWallet) ?? str(raw.wallet) ?? "",
    tokenId: str(raw.asset) ?? str(raw.tokenId),
    eventSlug: str(raw.eventSlug),
    marketSlug: str(raw.slug),
    title,
    outcome,
    side: outcomeIndex === 1 || /^no$/i.test(outcome) ? "no" : "yes",
    shares,
    entryPrice: num(raw.avgPrice),
    currentPrice: num(raw.curPrice),
    initialValue: num(raw.initialValue),
    currentValue: num(raw.currentValue ?? raw.initialValue),
    pnl: num(raw.cashPnl ?? raw.realizedPnl),
    pctChange: asPct(raw.percentPnl ?? raw.percentRealizedPnl),
    status,
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
