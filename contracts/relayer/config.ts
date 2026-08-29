import { keccak256, stringToBytes, type Hex } from "viem";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RH_CHAIN_ID = 4663;

/**
 * Official public RPC, plus a second endpoint that is not behind Cloudflare's
 * browser challenge. Railway (and most datacenter IPs) get a 403 HTML page
 * from rpc.mainnet.chain.robinhood.com; the process then exits on boot.
 *
 * `RH_RPC` may be a single URL or a comma-separated list. First entry that
 * answers is used; viem's fallback transport tries the rest on failure.
 */
const DEFAULT_RPCS = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://rpc-robinhood.blockmachine.io",
] as const;

const fromEnv = (process.env.RH_RPC ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

export const RH_RPCS: string[] = [...fromEnv];
for (const url of DEFAULT_RPCS) {
  if (!RH_RPCS.includes(url)) RH_RPCS.push(url);
}

export const RH_RPC = RH_RPCS[0] ?? DEFAULT_RPCS[0];
export const RH_EXPLORER = "https://robinhoodchain.blockscout.com";

/** Polymarket's CLOB, read-only endpoints. No key needed for prices. */
export const CLOB_BASE = process.env.CLOB_BASE ?? "https://clob.polymarket.com";

/** Polymarket's metadata API. Used to spot markets that have resolved. */
export const GAMMA_BASE = process.env.GAMMA_BASE ?? "https://gamma-api.polymarket.com";

export type LeverageMarket = {
  /** Human label for logs. */
  label: string;
  /** Slug hashed into the on-chain marketId. Must match what admin listed. */
  slug: string;
  /** Polymarket CLOB token id for the YES outcome. */
  yesTokenId: string;
};

export type ResolvedMarket = LeverageMarket & { marketId: Hex };

/**
 * The on-chain id is `keccak256(utf8(slug))`. Deriving it in both places keeps
 * the config readable and means listing a market on-chain never needs a hash
 * pasted by hand.
 */
export function marketIdFor(slug: string): Hex {
  return keccak256(stringToBytes(slug));
}

export function loadMarkets(path?: string): ResolvedMarket[] {
  const file =
    path ??
    process.env.MARKETS_FILE ??
    fileURLToPath(new URL("./markets.json", import.meta.url));
  const raw = JSON.parse(readFileSync(file, "utf8")) as LeverageMarket[];

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`No markets configured in ${file}`);
  }
  // The whole design assumes a small, hand-picked set; a long list here almost
  // certainly means the blacklist rules were skipped.
  if (raw.length > 10) {
    throw new Error(
      `${raw.length} markets configured. Leverage is meant for 3-10 hand-picked markets.`,
    );
  }

  return raw.map((m) => ({ ...m, marketId: marketIdFor(m.slug) }));
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}
