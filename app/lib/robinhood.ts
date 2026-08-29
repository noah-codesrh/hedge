export const RH_CHAIN_ID = 4663;
export const RH_CHAIN_HEX = "0x1237";
export const RH_RPC = "https://rpc.mainnet.chain.robinhood.com";
/** Official RPC Cloudflare-challenges some IPs; reads fall through here. */
export const RH_RPC_FALLBACK = "https://rpc-robinhood.blockmachine.io";
export const RH_EXPLORER = "https://robinhoodchain.blockscout.com";

export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

/**
 * Relay's ERC-20 router on Robinhood Chain. Token swaps call this; native ETH
 * calls `RELAY_NATIVE` instead.
 *
 * Hedge sponsors gas for calls to this address, so it is an allowlist of one
 * and has to stay pinned rather than read from a quote — trusting the quote
 * for the target would let anything Relay returned spend the gas budget. Every
 * swap quote is checked against it, and a mismatch fails the swap loudly
 * instead of quietly sponsoring an unknown contract.
 */
export const RELAY_ROUTER = "0xCcC88a9d1B4ED6b0EABA998850414b24f1c315bE";

/**
 * Relay's native-ETH executor on Robinhood Chain.
 *
 * ERC-20 swaps call `RELAY_ROUTER`. Selling ETH itself does not — Relay sends
 * the ETH to this contract instead (selector `0xcd6e13f7` in every quote we
 * have seen). Treating only the ERC-20 router as valid made every ETH→USDG
 * quote look like an unknown route, which is why embedded wallets sitting on
 * leftover ETH could not convert it while token swaps from external wallets
 * went through.
 */
export const RELAY_NATIVE = "0xb92fe925DC43a0ECdE6c8b1a2709c170Ec4fFf4f";

const RELAY_SWAP_TARGETS = new Set([
  RELAY_ROUTER.toLowerCase(),
  RELAY_NATIVE.toLowerCase(),
  WETH.toLowerCase(),
]);

export function isRelaySwapTarget(address: string) {
  return RELAY_SWAP_TARGETS.has(address.toLowerCase());
}

export type ChainAsset = {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  address: string | null;
  logoUrl: string | null;
  balance: number;
  balanceRaw: string;
  priceUsd: number | null;
  valueUsd: number | null;
  kind: "native" | "stable" | "wrapped";
};

function parseUnits(raw: string, decimals: number) {
  try {
    const n = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    return Number(n) / Number(base);
  } catch {
    return 0;
  }
}

export function formatTokenAmount(raw: string, decimals: number, maxFrac = 6) {
  try {
    const n = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const frac = n % base;
    if (frac === 0n) return whole.toString();
    const fracStr = frac
      .toString()
      .padStart(decimals, "0")
      .replace(/0+$/, "")
      .slice(0, maxFrac);
    return `${whole}.${fracStr}`;
  } catch {
    return "0";
  }
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const cleaned = value.trim();
  if (!cleaned) return 0n;
  const [w, f = ""] = cleaned.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function encodeErc20Transfer(to: string, amount: bigint) {
  const addr = to.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const amt = amount.toString(16).padStart(64, "0");
  return `0xa9059cbb${addr}${amt}` as `0x${string}`;
}

export function toHexQuantity(n: bigint) {
  return `0x${n.toString(16)}` as `0x${string}`;
}

const RH_RPCS = [RH_RPC_FALLBACK, RH_RPC];

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let last: Error | null = null;
  for (const url of RH_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await res.text();
      if (text.trimStart().startsWith("<")) {
        throw new Error("rpc returned html");
      }
      const data: unknown = JSON.parse(text);
      const err = (data as { error?: { message?: string } }).error;
      if (err) throw new Error(err.message ?? "RPC failed");
      return (data as { result: T }).result;
    } catch (e) {
      last = e instanceof Error ? e : new Error("RPC failed");
    }
  }
  throw last ?? new Error("RPC failed");
}

function encodeBalanceOf(owner: string) {
  return `0x70a08231${owner.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}

let ethPriceCache: { at: number; usd: number } | null = null;

async function ethUsdPrice(): Promise<number | null> {
  if (ethPriceCache && Date.now() - ethPriceCache.at < 30_000) {
    return ethPriceCache.usd;
  }
  const sources = [
    async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error("coingecko");
      const data: unknown = await res.json();
      const usd = (data as { ethereum?: { usd?: number } }).ethereum?.usd;
      if (typeof usd !== "number" || !Number.isFinite(usd)) throw new Error("coingecko");
      return usd;
    },
    async () => {
      const res = await fetch(
        "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error("binance");
      const data: unknown = await res.json();
      const usd = Number((data as { price?: string }).price);
      if (!Number.isFinite(usd)) throw new Error("binance");
      return usd;
    },
  ];
  for (const source of sources) {
    try {
      const usd = await source();
      ethPriceCache = { at: Date.now(), usd };
      return usd;
    } catch {
      /* try next */
    }
  }
  return ethPriceCache?.usd ?? null;
}

/** Everything an address holds, not just the three tokens Hedge names itself. */
export type OwnedToken = {
  /** null for native ETH, which has no contract. */
  address: string | null;
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: string;
  balance: number;
  priceUsd: number | null;
  valueUsd: number | null;
  logoUrl: string | null;
  /** Blockscout's grading. Anything other than "ok" is worth flagging. */
  reputation: string | null;
};

type BlockscoutBalance = {
  value?: string;
  token?: {
    address_hash?: string;
    decimals?: string;
    exchange_rate?: string | null;
    icon_url?: string | null;
    name?: string;
    reputation?: string | null;
    symbol?: string;
    type?: string;
  };
};

function toNumber(value: string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Every ERC-20 an address holds on Robinhood Chain, richest first.
 *
 * `listRobinhoodAssets` only knows USDG, ETH and WETH because those are the
 * ones Hedge itself moves. Swapping has to work against whatever the trader
 * actually has — the chain carries memecoins and tokenised equities that no
 * hardcoded list would ever cover — so this reads the explorer's index
 * instead. It also carries prices, which spares us a second lookup.
 *
 * The explorer is not part of the trading path, so a failure here degrades to
 * the three known tokens rather than taking the page down with it.
 */
export async function listOwnedTokens(owner: string): Promise<OwnedToken[]> {
  const native = async (): Promise<OwnedToken> => {
    const [hex, usd] = await Promise.all([
      rpc<string>("eth_getBalance", [owner, "latest"]),
      ethUsdPrice(),
    ]);
    const raw = BigInt(hex || "0x0").toString();
    const balance = parseUnits(raw, 18);
    return {
      address: null,
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      balanceRaw: raw,
      balance,
      priceUsd: usd,
      valueUsd: usd == null ? null : balance * usd,
      logoUrl: "/tokens/eth.png",
      reputation: "ok",
    };
  };

  const erc20s = async (): Promise<OwnedToken[]> => {
    const res = await fetch(
      `${RH_EXPLORER}/api/v2/addresses/${owner}/token-balances`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`explorer ${res.status}`);
    const rows = (await res.json()) as BlockscoutBalance[];
    if (!Array.isArray(rows)) throw new Error("explorer shape");
    return rows.flatMap((row) => {
      const token = row.token;
      // NFTs share this endpoint and cannot be swapped for cash.
      if (!token || token.type !== "ERC-20") return [];
      const address = token.address_hash;
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return [];
      const decimals = Number(token.decimals);
      if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) return [];
      let raw: bigint;
      try {
        raw = BigInt(row.value ?? "0");
      } catch {
        return [];
      }
      if (raw <= 0n) return [];
      const balance = parseUnits(raw.toString(), decimals);
      const priceUsd = toNumber(token.exchange_rate);
      return [
        {
          address,
          symbol: token.symbol || "Token",
          name: token.name || token.symbol || "Token",
          decimals,
          balanceRaw: raw.toString(),
          balance,
          priceUsd,
          valueUsd: priceUsd == null ? null : balance * priceUsd,
          logoUrl: token.icon_url || null,
          reputation: token.reputation ?? null,
        },
      ];
    });
  };

  const [nativeRow, tokenRows] = await Promise.all([
    native().catch(() => null),
    erc20s().catch(async (err) => {
      console.warn("[hedge] explorer token list unavailable", err);
      const known = await listRobinhoodAssets(owner).catch(() => []);
      return known
        .filter((a) => a.address && a.balance > 0)
        .map<OwnedToken>((a) => ({
          address: a.address,
          symbol: a.symbol,
          name: a.name,
          decimals: a.decimals,
          balanceRaw: a.balanceRaw,
          balance: a.balance,
          priceUsd: a.priceUsd,
          valueUsd: a.valueUsd,
          logoUrl: a.logoUrl,
          reputation: "ok",
        }));
    }),
  ]);

  const all = nativeRow && nativeRow.balance > 0 ? [nativeRow, ...tokenRows] : tokenRows;
  return all.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
}

export async function listRobinhoodAssets(owner: string): Promise<ChainAsset[]> {
  const data = encodeBalanceOf(owner);
  const [ethHex, usdgHex, wethHex, ethUsd] = await Promise.all([
    rpc<string>("eth_getBalance", [owner, "latest"]),
    rpc<string>("eth_call", [{ to: USDG, data }, "latest"]),
    rpc<string>("eth_call", [{ to: WETH, data }, "latest"]),
    ethUsdPrice(),
  ]);

  const ethRaw = BigInt(ethHex || "0x0").toString();
  const usdgRaw = BigInt(usdgHex || "0x0").toString();
  const wethRaw = BigInt(wethHex || "0x0").toString();
  const ethBal = parseUnits(ethRaw, 18);
  const usdgBal = parseUnits(usdgRaw, 6);
  const wethBal = parseUnits(wethRaw, 18);

  return [
    {
      id: "usdg",
      symbol: "USDG",
      name: "Global Dollar",
      decimals: 6,
      address: USDG,
      logoUrl: "/tokens/usdg.png",
      balanceRaw: usdgRaw,
      balance: usdgBal,
      priceUsd: 1,
      valueUsd: usdgBal,
      kind: "stable",
    },
    {
      id: "eth",
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      address: null,
      logoUrl: "/tokens/eth.png",
      balanceRaw: ethRaw,
      balance: ethBal,
      priceUsd: ethUsd,
      valueUsd: ethUsd == null ? null : ethBal * ethUsd,
      kind: "native",
    },
    {
      id: "weth",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      address: WETH,
      logoUrl: "/tokens/weth.png",
      balanceRaw: wethRaw,
      balance: wethBal,
      priceUsd: ethUsd,
      valueUsd: ethUsd == null ? null : wethBal * ethUsd,
      kind: "wrapped",
    },
  ];
}
