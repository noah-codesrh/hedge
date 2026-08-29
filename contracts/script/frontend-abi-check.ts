/**
 * Exercises the frontend's contract interface against a live deployment.
 *
 * The app talks to the engine through a hand-written ABI in
 * `app/lib/leverage-abi.ts` and encodes its own calldata, none of which the
 * Solidity tests or the keeper cover. A renamed function or a changed struct
 * would compile, typecheck and build cleanly, then fail in the browser. This
 * imports that exact ABI and drives every call the UI makes.
 *
 * Run from `contracts/` with the addresses of a deployed stack:
 *
 *   RPC=... USDG=... VAULT=... ENGINE=... MARKET_ID=... PK=... \
 *     node script/frontend-abi-check.ts
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { engineAbi, vaultAbi } from "../../app/lib/leverage-abi.ts";

const RPC = process.env.RPC!;
const USDG = process.env.USDG! as Hex;
const VAULT = process.env.VAULT! as Hex;
const ENGINE = process.env.ENGINE! as Hex;
const MARKET_ID = process.env.MARKET_ID! as Hex;
const PK = process.env.PK! as Hex;

const account = privateKeyToAccount(PK);
const chain = {
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const engine = { address: ENGINE, abi: engineAbi } as const;
const vault = { address: VAULT, abi: vaultAbi } as const;

let failures = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

/** Sends the exact calldata the browser would build, then waits for the receipt. */
async function sendAs(to: Hex, data: Hex) {
  const hash = await wallet.sendTransaction({ to, data });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return receipt;
}

async function main() {
  console.log("\nFrontend ABI check\n");

  // --- reads the trade panel makes on every render --------------------------
  // Parallel reads rather than multicall, matching the app: Robinhood Chain
  // has no Multicall3 configured, so viem refuses to batch there.
  const [maxLev, nextTier, capacity, minMargin, maxMargin, paused, rate] =
    await Promise.all([
      pub.readContract({ ...engine, functionName: "effectiveMaxLeverageBps" }),
      pub.readContract({ ...engine, functionName: "nextLeverageTier" }),
      pub.readContract({ ...engine, functionName: "capacity" }),
      pub.readContract({ ...engine, functionName: "minMargin" }),
      pub.readContract({ ...engine, functionName: "maxMargin" }),
      pub.readContract({ ...engine, functionName: "openingPaused" }),
      pub.readContract({ ...engine, functionName: "borrowRateBps" }),
    ]);

  check("effectiveMaxLeverageBps decodes", maxLev >= 10_000n, maxLev);
  check("nextLeverageTier decodes as a pair", nextTier.length === 2);
  check("capacity decodes as a triple", capacity.length === 3);
  check("minMargin / maxMargin decode", minMargin > 0n && maxMargin > minMargin);
  check("openingPaused decodes", paused === false);
  check("borrowRateBps decodes", rate >= 0n);

  const quote = await pub.readContract({
    ...engine,
    functionName: "quoteOpen",
    args: [MARKET_ID, true, 2_500_000n, 20_000n],
  });
  check("quoteOpen returns the Quote struct", typeof quote.hasCapacity === "boolean");
  check("quoteOpen sizes the position", quote.size === 5_000_000n, quote.size);
  check(
    "quoteOpen applies the 1% spread",
    quote.entryPrice === 505_000_000_000_000_000n,
    quote.entryPrice,
  );

  // --- the open path --------------------------------------------------------
  await sendAs(
    USDG,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [ENGINE, 2_500_000n],
    }),
  );
  check("sponsored approve calldata is accepted", true);

  await sendAs(
    ENGINE,
    encodeFunctionData({
      abi: engineAbi,
      functionName: "openPosition",
      args: [MARKET_ID, true, 2_500_000n, 20_000n],
    }),
  );

  const ids = await pub.readContract({
    ...engine,
    functionName: "openPositionIds",
    args: [0n, 500n],
  });
  check("openPositionIds lists the open set", ids.length > 0, ids.length);

  const mine: bigint[] = [];
  for (const id of ids) {
    const p = await pub.readContract({ ...engine, functionName: "positions", args: [id] });
    check(`positions(${id}) decodes 13 fields`, p.length === 13, p.length);
    if (p[3] && p[0].toLowerCase() === account.address.toLowerCase()) mine.push(id);
  }
  check("the trader's position is discoverable by scanning", mine.length > 0);

  const id = mine[mine.length - 1]!;

  const detail = await Promise.all([
    pub.readContract({ ...engine, functionName: "pnlOf", args: [id] }),
    pub.readContract({ ...engine, functionName: "fundingOwed", args: [id] }),
    pub.readContract({ ...engine, functionName: "liquidationPriceNow", args: [id] }),
    pub.readContract({ ...engine, functionName: "isLiquidatable", args: [id] }),
  ]);
  check("pnlOf decodes as a signed int", typeof detail[0] === "bigint");
  check("fundingOwed decodes", detail[1] === 0n, detail[1]);
  check("liquidationPriceNow decodes", (detail[2] as bigint) > 0n, detail[2]);
  check("isLiquidatable decodes", detail[3] === false);

  const market = await pub.readContract({
    ...engine,
    functionName: "markets",
    args: [MARKET_ID],
  });
  check("markets() decodes 7 fields", market.length === 7, market.length);
  check("market reads back as enabled and unresolved", market[0] && !market[1]);

  // --- partial then full close, the two buttons on the position card --------
  await sendAs(
    ENGINE,
    encodeFunctionData({
      abi: engineAbi,
      functionName: "reducePosition",
      args: [id, 5_000n],
    }),
  );
  const halved = await pub.readContract({ ...engine, functionName: "positions", args: [id] });
  check("close-half leaves the position open", halved[3]);
  check("close-half halves the size", halved[5] === 2_500_000n, halved[5]);

  await sendAs(
    ENGINE,
    encodeFunctionData({
      abi: engineAbi,
      functionName: "reducePosition",
      args: [id, 10_000n],
    }),
  );
  const closed = await pub.readContract({ ...engine, functionName: "positions", args: [id] });
  check("close-all closes the position", !closed[3]);

  // --- the Earn page --------------------------------------------------------
  const [tvl, senior, junior, locked, free, depositsPaused, cap] =
    await Promise.all([
      pub.readContract({ ...vault, functionName: "totalAssets" }),
      pub.readContract({ ...vault, functionName: "seniorAssets" }),
      pub.readContract({ ...vault, functionName: "juniorAssets" }),
      pub.readContract({ ...vault, functionName: "lockedAssets" }),
      pub.readContract({ ...vault, functionName: "freeAssets" }),
      pub.readContract({ ...vault, functionName: "depositsPaused" }),
      pub.readContract({ ...vault, functionName: "seniorCap" }),
    ]);
  check("vault totals decode", tvl > 0n && senior > 0n && junior > 0n);
  // A position is open at this point in the dry run, so some capital is
  // reserved. The invariant the Earn page draws its utilisation bar from is
  // that free and locked account for the whole vault.
  check("locked + free reconcile to TVL", free + locked === tvl, {
    locked,
    free,
    tvl,
  });
  check("depositsPaused decodes", depositsPaused === false);
  check("seniorCap decodes as uncapped", cap > 2n ** 200n);

  const before = await pub.readContract({
    ...vault,
    functionName: "seniorSharesOf",
    args: [account.address],
  });

  await sendAs(
    USDG,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [VAULT, 10_000_000n],
    }),
  );
  await sendAs(
    VAULT,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "depositSenior",
      args: [10_000_000n],
    }),
  );

  const after = await pub.readContract({
    ...vault,
    functionName: "seniorSharesOf",
    args: [account.address],
  });
  check("depositSenior mints shares", after > before, { before, after });

  const assets = await pub.readContract({
    ...vault,
    functionName: "seniorAssetsOf",
    args: [account.address],
  });
  // Shares round down on the way in, so a deposit values back a hair under
  // what went in. The Earn page shows this number as the withdrawable balance,
  // so it has to be at or below the deposit, never above it.
  check(
    "seniorAssetsOf values the shares, rounding the vault's way",
    assets <= 10_000_000n && assets >= 9_999_000n,
    assets,
  );

  await sendAs(
    VAULT,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawSenior",
      args: [after - before],
    }),
  );
  const settled = await pub.readContract({
    ...vault,
    functionName: "seniorSharesOf",
    args: [account.address],
  });
  check("withdrawSenior burns them again", settled === before, { settled, before });

  // The Earn page derives APR from these two events, so their shape matters as
  // much as the function ABIs do.
  const feeLogs = await pub.getLogs({
    address: VAULT,
    event: vaultAbi.find((e) => e.name === "FeeCollected") as never,
    fromBlock: 0n,
    toBlock: "latest",
  });
  check("FeeCollected logs decode for the APR maths", feeLogs.length > 0, feeLogs.length);
  check(
    "FeeCollected carries toSenior",
    typeof (feeLogs[0] as { args?: { toSenior?: bigint } })?.args?.toSenior === "bigint",
  );

  console.log(
    failures === 0
      ? "\n\x1b[1;32m✓ frontend ABI matches the deployed contracts\x1b[0m\n"
      : `\n\x1b[1;31m✗ ${failures} frontend ABI mismatch(es)\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n\x1b[1;31m✗ frontend ABI check crashed\x1b[0m");
  console.error(err);
  process.exit(1);
});
