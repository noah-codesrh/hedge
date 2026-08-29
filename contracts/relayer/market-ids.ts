/**
 * Prints the on-chain marketId for every configured market, so the admin can
 * list them without hand-hashing anything.
 *
 * Run: pnpm tsx market-ids.ts
 */
import { loadMarkets } from "./config.ts";

for (const market of loadMarkets()) {
  console.log(`${market.marketId}  ${market.slug}  (${market.label})`);
}
