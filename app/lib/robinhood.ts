export const RH_CHAIN_ID = 4663;
export const RH_CHAIN_HEX = "0x1237";
export const RH_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const RH_EXPLORER = "https://robinhoodchain.blockscout.com";

export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

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

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RH_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data: unknown = await res.json();
  const err = (data as { error?: { message?: string } }).error;
  if (err) throw new Error(err.message ?? "RPC failed");
  return (data as { result: T }).result;
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
