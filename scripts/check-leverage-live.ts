/**
 * Exercises the app's own read layer against the live deployment.
 *
 * The unit checks prove the shapes line up; this proves the addresses in .env
 * point at contracts that answer, which is the failure the typechecker cannot
 * see. Read-only — it never sends a transaction and needs no key.
 *
 *   node scripts/run.mjs scripts/check-leverage-live.ts
 */
import { ENGINE_ADDRESS, VAULT_ADDRESS, LEVERAGE_MARKETS } from "../app/lib/leverage";
import {
  leverageAtTvl,
  quoteOpenOnChain,
  readEngineState,
  readLeverageTiers,
  readVaultState,
} from "../app/lib/leverage-chain";
import { ACTIVITY_LEVELS, projectSeniorYield } from "../app/lib/leverage-yield";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ${green("✓")} ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.log(`  ${red("✗")} ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`engine ${ENGINE_ADDRESS}`);
console.log(`vault  ${VAULT_ADDRESS}\n`);

const engine = await readEngineState();
check("engine state reads", engine != null);
if (engine) {
  check("leverage on offer", engine.maxLeverage >= 1, `${engine.maxLeverage}x`);
  check(
    "margin bounds",
    engine.minMargin > 0 && engine.maxMargin >= engine.minMargin,
    `${engine.minMargin}–${engine.maxMargin} USDG`,
  );
  check("opening not paused", !engine.openingPaused);
  check(
    "capacity is ordered used <= ceiling",
    engine.capacity.used <= engine.capacity.ceiling + 1e-9,
    `used ${engine.capacity.used}, ceiling ${engine.capacity.ceiling}, free ${engine.capacity.available}`,
  );
}

const vault = await readVaultState();
check("vault state reads", vault != null);
if (vault) {
  check(
    "tranches sum to TVL",
    Math.abs(vault.senior + vault.junior - vault.tvl) < 0.01,
    `senior ${vault.senior} + junior ${vault.junior} = ${vault.tvl}`,
  );
  check(
    "locked plus free is TVL",
    Math.abs(vault.locked + vault.free - vault.tvl) < 0.01,
  );
}

const tiers = await readLeverageTiers();
check("tier schedule reads", tiers.length > 0, `${tiers.length} tiers`);
if (tiers.length > 0 && engine && vault) {
  check(
    "schedule agrees with the engine at live TVL",
    leverageAtTvl(tiers, vault.tvl) === engine.maxLeverage,
    `${leverageAtTvl(tiers, vault.tvl)}x vs ${engine.maxLeverage}x`,
  );
}

// A quote against a real market is the end-to-end proof: it needs the market
// listed, the oracle fresh and the price inside the band.
let quoted = 0;
for (const market of LEVERAGE_MARKETS) {
  const q = await quoteOpenOnChain({
    marketSlug: market.marketSlug,
    isLong: true,
    margin: engine?.minMargin ?? 1,
    leverage: Math.min(2, engine?.maxLeverage ?? 2),
  });
  if (q) {
    quoted += 1;
    const sane =
      q.entryPrice > 0 &&
      q.entryPrice < 1 &&
      q.liquidationPrice >= 0 &&
      q.liquidationPrice < q.entryPrice &&
      q.size > 0;
    check(
      `quote · ${market.marketSlug.slice(0, 38)}`,
      sane,
      `entry ${q.entryPrice.toFixed(4)}, liq ${q.liquidationPrice.toFixed(4)}, cap ${q.hasCapacity}`,
    );
  } else {
    check(`quote · ${market.marketSlug.slice(0, 38)}`, false, "reverted");
  }
}
check("every listed market quotes", quoted === LEVERAGE_MARKETS.length);

// The projection is pure arithmetic, but it drives the headline number on
// Earn, so a nonsense result there is a visible bug.
if (vault) {
  for (const level of ACTIVITY_LEVELS) {
    const p = projectSeniorYield({
      senior: 5_000,
      junior: vault.junior,
      tradesPerDay: level.tradesPerDay,
      avgPositionSize: 6,
      avgHoldHours: level.avgHoldHours,
      borrowRateBps: engine?.borrowRateBps ?? 1,
      avgLeverage: leverageAtTvl(tiers, 5_000 + vault.junior),
    });
    check(
      `projection · ${level.label}`,
      Number.isFinite(p.apy) && p.apy >= 0 && p.apr >= 0,
      `${p.apr.toFixed(0)}% APR, ${fmt(p.dailyVolume)}/day backed${p.capacityBound ? " (capacity bound)" : ""}`,
    );
  }
}

function fmt(n: number) {
  return `$${n.toFixed(0)}`;
}

console.log(
  failed === 0
    ? `\n${green("✓ the app reads the live deployment correctly")}`
    : `\n${red(`✗ ${failed} check(s) failed`)}`,
);
process.exit(failed === 0 ? 0 : 1);
