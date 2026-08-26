import { POLYGON_RPC, PUSD } from "./chains";

export type PolymarketPublicProfile = {
  name: string | null;
  pseudonym: string | null;
  bio: string | null;
  profileImage: string | null;
  proxyWallet: string | null;
  xUsername: string | null;
  verifiedBadge: boolean;
  displayUsernamePublic: boolean;
  createdAt: string | null;
};

export type PolymarketAccountSnapshot = {
  address: string;
  pusd: number;
  deployed: boolean | null;
  positionsValue: number;
  profile: PolymarketPublicProfile | null;
};

const ADDR = /^0x[a-fA-F0-9]{40}$/;

function str(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function encodeBalanceOf(owner: string) {
  return `0x70a08231${owner.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}

async function polygonBatch(
  calls: Array<{ method: string; params: unknown[] }>,
) {
  if (calls.length === 0) return [];
  const body = calls.map((call, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: call.method,
    params: call.params,
  }));
  const res = await fetch(POLYGON_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  const rows = Array.isArray(data) ? data : [];
  return calls.map((_, i) => {
    const row = rows.find(
      (item) =>
        item &&
        typeof item === "object" &&
        "id" in item &&
        Number((item as { id: unknown }).id) === i + 1,
    );
    return row && typeof row === "object" && "result" in row
      ? (row as { result: unknown }).result
      : null;
  });
}

function parsePusd(hex: unknown) {
  try {
    const raw = BigInt(typeof hex === "string" && hex ? hex : "0x0");
    const n = Number(raw) / 1e6;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function isDeployed(code: unknown) {
  return typeof code === "string" && code !== "0x" && code.length > 2;
}

function mapProfile(raw: Record<string, unknown>): PolymarketPublicProfile {
  return {
    name: str(raw.name),
    pseudonym: str(raw.pseudonym),
    bio: str(raw.bio),
    profileImage: str(raw.profileImage),
    proxyWallet: str(raw.proxyWallet),
    xUsername: str(raw.xUsername),
    verifiedBadge: raw.verifiedBadge === true,
    displayUsernamePublic: raw.displayUsernamePublic !== false,
    createdAt: str(raw.createdAt),
  };
}

async function fetchPublicProfile(address: string) {
  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/public-profile?address=${encodeURIComponent(address)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return null;
    return mapProfile(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function fetchPositionsValue(address: string) {
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/value?user=${encodeURIComponent(address)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return 0;
    const data: unknown = await res.json().catch(() => null);
    if (typeof data === "number") return data;
    if (Array.isArray(data)) {
      return data.reduce((sum, row) => {
        if (row && typeof row === "object" && "value" in row) {
          return sum + num((row as { value: unknown }).value);
        }
        return sum;
      }, 0);
    }
    if (data && typeof data === "object" && "value" in data) {
      return num((data as { value: unknown }).value);
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function loadPolymarketAccounts(addresses: string[]) {
  const unique = [
    ...new Set(
      addresses
        .map((a) => a.trim())
        .filter((a) => ADDR.test(a))
        .map((a) => a.toLowerCase()),
    ),
  ].slice(0, 8);

  if (unique.length === 0) return [] as PolymarketAccountSnapshot[];

  const rpcCalls = unique.flatMap((address) => [
    {
      method: "eth_call",
      params: [{ to: PUSD, data: encodeBalanceOf(address) }, "latest"],
    },
    { method: "eth_getCode", params: [address, "latest"] },
  ]);

  const [rpc, profiles, values] = await Promise.all([
    polygonBatch(rpcCalls),
    Promise.all(unique.map((address) => fetchPublicProfile(address))),
    Promise.all(unique.map((address) => fetchPositionsValue(address))),
  ]);

  return unique.map((address, i) => {
    const pusd = parsePusd(rpc[i * 2] ?? null);
    const code = rpc[i * 2 + 1] ?? null;
    return {
      address,
      pusd,
      deployed: code == null ? null : isDeployed(code),
      positionsValue: values[i] ?? 0,
      profile: profiles[i],
    };
  });
}
