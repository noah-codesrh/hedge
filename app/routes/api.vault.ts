import { readLeverageTiers, readVaultState } from "../lib/leverage-chain";

/**
 * Vault snapshot for the Earn page.
 *
 * Served from this origin on purpose: the browser talking to Robinhood's
 * official RPC gets Cloudflare-challenged on some profiles, and the page
 * sits on a skeleton forever. The server uses the fallback RPC first.
 */
export async function loader() {
  const [vault, tiers] = await Promise.all([
    readVaultState(),
    readLeverageTiers(),
  ]);
  return { vault, tiers };
}
