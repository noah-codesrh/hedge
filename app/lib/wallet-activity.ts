import { notifyBalancesChanged } from "./positions";
import {
  RH_EXPLORER,
  isRelaySwapTarget,
} from "./robinhood";
import type { LiveActivity } from "./polymarket-portfolio";

const KEY = "hedge:wallet-activity";
const ADDR = /^0x[a-fA-F0-9]{40}$/;

const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

type LocalWalletTx = {
  id: string;
  type: "SEND" | "RECEIVE";
  symbol: string;
  amount: number;
  counterparty?: string;
  hash?: string | null;
  timestamp: number;
};

function readLocal(): LocalWalletTx[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalWalletTx[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(rows: LocalWalletTx[]) {
  window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 80)));
}

function asActivity(row: {
  id: string;
  type: "SEND" | "RECEIVE";
  symbol: string;
  amount: number;
  counterparty?: string;
  hash?: string | null;
  timestamp: number;
}): LiveActivity {
  const peer = row.counterparty
    ? `${row.counterparty.slice(0, 6)}…${row.counterparty.slice(-4)}`
    : null;
  const verb = row.type === "SEND" ? "Sent" : "Received";
  return {
    id: row.hash || row.id,
    type: row.type,
    title: peer ? `${verb} ${row.symbol} · ${peer}` : `${verb} ${row.symbol}`,
    amount: row.amount,
    eventSlug: null,
    marketSlug: null,
    timestamp: row.timestamp,
    href: row.hash ? `${RH_EXPLORER}/tx/${row.hash}` : null,
    symbol: row.symbol,
  };
}

/** Instant history for a send or deposit the app just finished. */
export function recordWalletTx(input: {
  type: "SEND" | "RECEIVE";
  symbol: string;
  amount: number;
  counterparty?: string;
  hash?: string | null;
}) {
  if (typeof window === "undefined") return;
  if (!(input.amount > 0)) return;
  const id = (input.hash || `${input.type}:${Date.now()}`).toLowerCase();
  const next: LocalWalletTx = {
    id,
    type: input.type,
    symbol: input.symbol,
    amount: input.amount,
    counterparty: input.counterparty,
    hash: input.hash ?? null,
    timestamp: Date.now(),
  };
  writeLocal([next, ...readLocal().filter((row) => row.id !== id)]);
  notifyBalancesChanged();
}

export function listLocalWalletActivity(): LiveActivity[] {
  return readLocal().map(asActivity);
}

type TokenTransfer = {
  from?: { hash?: string };
  to?: { hash?: string };
  token?: { symbol?: string; decimals?: string; address_hash?: string };
  total?: { value?: string; decimals?: string };
  timestamp?: string;
  transaction_hash?: string;
};

type NativeTx = {
  hash?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  value?: string;
  timestamp?: string;
  result?: string;
  status?: string;
};

function parseAmount(raw: string | undefined, decimals: number) {
  try {
    const n = BigInt(raw ?? "0");
    if (n <= 0n) return 0;
    return Number(n) / 10 ** decimals;
  } catch {
    return 0;
  }
}

function ts(iso?: string) {
  if (!iso) return Date.now();
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : Date.now();
}

function ownSet(addresses: string[]) {
  return new Set(addresses.map((a) => a.toLowerCase()).filter((a) => ADDR.test(a)));
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function tokenTransfers(owner: string, mine: Set<string>): Promise<LiveActivity[]> {
  const data = await json<{ items?: TokenTransfer[] }>(
    `${RH_EXPLORER}/api/v2/addresses/${owner}/token-transfers?limit=50`,
  );
  const out: LiveActivity[] = [];
  for (const row of data?.items ?? []) {
    const from = row.from?.hash?.toLowerCase() ?? "";
    const to = row.to?.hash?.toLowerCase() ?? "";
    if (!from || !to) continue;
    if (mine.has(from) && mine.has(to)) continue;
    if (isRelaySwapTarget(from) || isRelaySwapTarget(to)) continue;
    const incoming = to === owner.toLowerCase();
    const outgoing = from === owner.toLowerCase();
    if (!incoming && !outgoing) continue;
    const decimals = Number(row.total?.decimals ?? row.token?.decimals ?? 18);
    const amount = parseAmount(
      row.total?.value,
      Number.isFinite(decimals) ? decimals : 18,
    );
    if (!(amount > 0)) continue;
    const hash = row.transaction_hash;
    if (!hash) continue;
    const symbol = row.token?.symbol || "Token";
    out.push(
      asActivity({
        id: hash,
        type: incoming ? "RECEIVE" : "SEND",
        symbol,
        amount,
        counterparty: incoming ? from : to,
        hash,
        timestamp: ts(row.timestamp),
      }),
    );
  }
  return out;
}

async function nativeTransfers(owner: string, mine: Set<string>): Promise<LiveActivity[]> {
  const data = await json<{ items?: NativeTx[] }>(
    `${RH_EXPLORER}/api/v2/addresses/${owner}/transactions?filter=to%20%7C%20from&limit=30`,
  );
  const out: LiveActivity[] = [];
  for (const row of data?.items ?? []) {
    if (row.result === "error" || row.status === "error") continue;
    const from = row.from?.hash?.toLowerCase() ?? "";
    const to = row.to?.hash?.toLowerCase() ?? "";
    if (!from || !to || !row.hash) continue;
    if (mine.has(from) && mine.has(to)) continue;
    if (isRelaySwapTarget(from) || isRelaySwapTarget(to)) continue;
    const incoming = to === owner.toLowerCase();
    const outgoing = from === owner.toLowerCase();
    if (!incoming && !outgoing) continue;
    const amount = parseAmount(row.value, 18);
    if (!(amount > 0)) continue;
    out.push(
      asActivity({
        id: row.hash,
        type: incoming ? "RECEIVE" : "SEND",
        symbol: "ETH",
        amount,
        counterparty: incoming ? from : to,
        hash: row.hash,
        timestamp: ts(row.timestamp),
      }),
    );
  }
  return out;
}

/** Confirmed Robinhood Chain sends and receives for the trader's wallets. */
export async function listWalletTransfers(addresses: string[]): Promise<LiveActivity[]> {
  const owners = [...ownSet(addresses)];
  if (owners.length === 0) return [];
  const mine = new Set(owners);
  const pages = await Promise.all(
    owners.slice(0, 6).flatMap((owner) => [
      tokenTransfers(owner, mine),
      nativeTransfers(owner, mine),
    ]),
  );
  const byId = new Map<string, LiveActivity>();
  for (const page of pages) {
    for (const item of page) {
      byId.set(item.id.toLowerCase(), item);
    }
  }
  return [...byId.values()];
}
