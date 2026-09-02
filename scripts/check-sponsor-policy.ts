/**
 * Checks the gas sponsorship allowlist.
 *
 * This endpoint pays for other people's transactions, and the existing spot
 * trading path routes its USDG and pUSD withdrawals through it, so the two
 * failure modes are opposite and both bad: too loose and anyone can drain the
 * gas budget with arbitrary calldata, too tight and withdrawals stop working.
 *
 *   pnpm check:sponsor
 *
 * Bundled with esbuild first because the app imports without file
 * extensions, which node's resolver will not follow on its own.
 */
import { encodeFunctionData, erc20Abi } from "viem";
import {
  refuseSponsoredCall,
  type HedgeContracts,
} from "../app/lib/server/sponsor-policy";
import { RELAY_NATIVE, RELAY_ROUTER, USDG, WETH } from "../app/lib/robinhood";
import { engineAbi, vaultAbi } from "../app/lib/leverage-abi";
import { STOCK_TOKENS } from "../app/lib/stock-tokens";

const stockAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "openWithStock",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "stockAmount", type: "uint256" },
      { name: "marketId", type: "bytes32" },
      { name: "isLong", type: "bool" },
      { name: "leverageBps", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "closeTicket",
    stateMutability: "nonpayable",
    inputs: [{ name: "ticketId", type: "uint256" }],
    outputs: [],
  },
] as const;

const ENGINE = "0x1111111111111111111111111111111111111111";
const VAULT = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const STOCK = "0x4444444444444444444444444444444444444444";
const NVDA = STOCK_TOKENS[0]!.address;
/** Some token a trader holds that Hedge has never heard of. */
const MEMECOIN = "0x8f86a15ec17cb3369d8b3e666dadbc11daa82b79";
const DEPLOYED: HedgeContracts = { engine: ENGINE, vault: VAULT };
const WITH_STOCK: HedgeContracts = {
  engine: ENGINE,
  vault: VAULT,
  stockCollateral: STOCK,
};
const UNDEPLOYED: HedgeContracts = { engine: null, vault: null };

let failures = 0;

function allows(
  label: string,
  target: string,
  data: `0x${string}`,
  contracts: HedgeContracts = DEPLOYED,
) {
  const reason = refuseSponsoredCall(target, data, contracts);
  if (reason === null) console.log(`  ✓ pays for ${label}`);
  else {
    failures++;
    console.log(`  ✗ should pay for ${label} — refused: ${reason}`);
  }
}

function refuses(
  label: string,
  target: string,
  data: `0x${string}`,
  contracts: HedgeContracts = DEPLOYED,
) {
  const reason = refuseSponsoredCall(target, data, contracts);
  if (reason !== null) console.log(`  ✓ refuses ${label}`);
  else {
    failures++;
    console.log(`  ✗ should refuse ${label}, but it was allowed`);
  }
}

const transfer = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [STRANGER, 1_000_000n],
});

const approve = (spender: string) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as `0x${string}`, 1_000_000n],
  });

console.log("\nGas sponsorship policy\n");

// The spot path. These worked before leverage existed and must still work.
allows("a USDG transfer", USDG, transfer);
allows("a WETH transfer", WETH, transfer);

// The leverage and Earn paths.
allows("approving the engine to pull USDG", USDG, approve(ENGINE));
allows("approving the vault to pull USDG", USDG, approve(VAULT));
allows(
  "opening a position",
  ENGINE,
  encodeFunctionData({
    abi: engineAbi,
    functionName: "openPosition",
    args: [`0x${"11".repeat(32)}`, true, 2_500_000n, 20_000n],
  }),
);
allows(
  "reducing a position",
  ENGINE,
  encodeFunctionData({
    abi: engineAbi,
    functionName: "reducePosition",
    args: [1n, 5_000n],
  }),
);
allows(
  "closing a position",
  ENGINE,
  encodeFunctionData({ abi: engineAbi, functionName: "closePosition", args: [1n] }),
);
allows(
  "an emergency close",
  ENGINE,
  encodeFunctionData({ abi: engineAbi, functionName: "emergencyClose", args: [1n] }),
);
allows(
  "depositing to the vault",
  VAULT,
  encodeFunctionData({
    abi: vaultAbi,
    functionName: "depositSenior",
    args: [1_000_000n],
  }),
);
allows(
  "withdrawing from the vault",
  VAULT,
  encodeFunctionData({
    abi: vaultAbi,
    functionName: "withdrawSenior",
    args: [1_000_000n],
  }),
);

// Swapping a held token into cash. The token is whatever the trader happens
// to own, so these are the only rules here not pinned to a known token.
allows(
  "approving Relay to pull a token being sold",
  MEMECOIN,
  approve(RELAY_ROUTER),
);
allows("approving Relay to pull WETH", WETH, approve(RELAY_ROUTER));
allows(
  "the swap itself, whose calldata is Relay's",
  RELAY_ROUTER,
  // Opaque on purpose: the router is the trust boundary, not the arguments.
  `0xf9e4bab4${"00".repeat(64)}`,
);
allows(
  "selling native ETH through Relay's ETH executor",
  RELAY_NATIVE,
  `0xcd6e13f7${"00".repeat(64)}`,
);
refuses(
  "approving a stranger on a token Hedge does not know",
  MEMECOIN,
  approve(STRANGER),
);
refuses(
  "sending a token Hedge does not know, which is not a swap",
  MEMECOIN,
  transfer,
);

// The ways this could leak.
refuses("approving a spender of the caller's choosing", USDG, approve(STRANGER));
refuses(
  "a WETH approval, which nothing needs",
  WETH,
  approve(ENGINE),
);
refuses("a call to an unrelated contract", STRANGER, transfer);
refuses(
  "an admin call aimed at the engine",
  ENGINE,
  // setRiskParams(uint256,uint256,uint256,uint256). Not in the sponsored ABI
  // at all, so it cannot be decoded, let alone paid for.
  `0x9f1b3d4c${"00".repeat(128)}`,
);
refuses("undecodable calldata aimed at the engine", ENGINE, "0xdeadbeef");
refuses("empty calldata aimed at the vault", VAULT, "0x");
refuses(
  "a vault method sent to the engine",
  ENGINE,
  encodeFunctionData({
    abi: vaultAbi,
    functionName: "depositSenior",
    args: [1_000_000n],
  }),
);
refuses(
  "an engine method sent to the vault",
  VAULT,
  encodeFunctionData({ abi: engineAbi, functionName: "closePosition", args: [1n] }),
);

// Before deployment the addresses are blank, which must fail closed.
refuses("engine calls before deployment", ENGINE, transfer, UNDEPLOYED);
refuses("approving a blank engine address", USDG, approve(ENGINE), UNDEPLOYED);
allows("plain transfers before deployment", USDG, transfer, UNDEPLOYED);

allows(
  "approving the stock desk to pull NVDA",
  NVDA,
  approve(STOCK),
  WITH_STOCK,
);
allows(
  "depositing stock",
  STOCK,
  encodeFunctionData({
    abi: stockAbi,
    functionName: "deposit",
    args: [NVDA as `0x${string}`, 1n],
  }),
  WITH_STOCK,
);
allows(
  "withdrawing stock",
  STOCK,
  encodeFunctionData({
    abi: stockAbi,
    functionName: "withdraw",
    args: [NVDA as `0x${string}`, 1n],
  }),
  WITH_STOCK,
);
allows(
  "opening with stock",
  STOCK,
  encodeFunctionData({
    abi: stockAbi,
    functionName: "openWithStock",
    args: [
      NVDA as `0x${string}`,
      1n,
      `0x${"11".repeat(32)}`,
      true,
      20_000n,
    ],
  }),
  WITH_STOCK,
);
allows(
  "closing a stock ticket",
  STOCK,
  encodeFunctionData({
    abi: stockAbi,
    functionName: "closeTicket",
    args: [1n],
  }),
  WITH_STOCK,
);
refuses(
  "stock calls before the desk is addressed",
  STOCK,
  encodeFunctionData({
    abi: stockAbi,
    functionName: "deposit",
    args: [NVDA as `0x${string}`, 1n],
  }),
  DEPLOYED,
);
refuses(
  "approving a stranger to pull NVDA",
  NVDA,
  approve(STRANGER),
  WITH_STOCK,
);

console.log(
  failures === 0
    ? "\n\x1b[1;32m✓ sponsorship policy holds\x1b[0m\n"
    : `\n\x1b[1;31m✗ ${failures} sponsorship policy failure(s)\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
