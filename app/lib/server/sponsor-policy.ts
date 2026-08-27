import { decodeFunctionData, erc20Abi } from "viem";
import { USDG, WETH } from "../robinhood";

/**
 * Decides which Robinhood Chain calls Hedge will pay gas for.
 *
 * Traders here hold USDG and not ETH, so leverage and LP deposits are unusable
 * without sponsorship. That makes this the one place where the app pays for
 * someone else's calldata, and an open relay would let anyone drain the gas
 * budget. So the rule is narrow: decode the call, match it against a fixed
 * list, refuse everything else.
 *
 * Kept apart from the route so it can be checked on its own — the spot
 * trading path depends on it too, and a mistake here would break withdrawals
 * as surely as it would leak gas.
 */

/**
 * Tokens Hedge will pay to move. Native ETH is deliberately absent: it is the
 * gas, so a wallet that can hold it does not need sponsoring.
 */
const SPONSORED_TOKENS = new Set([USDG.toLowerCase(), WETH.toLowerCase()]);

const ENGINE_METHODS = new Set([
  "openPosition",
  "closePosition",
  "reducePosition",
  "emergencyClose",
]);

const VAULT_METHODS = new Set(["depositSenior", "withdrawSenior"]);

const hedgeAbi = [
  {
    type: "function",
    name: "openPosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "isLong", type: "bool" },
      { name: "margin", type: "uint256" },
      { name: "leverageBps", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "closePosition",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "reducePosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "fractionBps", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "emergencyClose",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "depositSenior",
    stateMutability: "nonpayable",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawSenior",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type HedgeContracts = {
  /** HedgeLeverageEngine, or null before it is deployed. */
  engine: string | null;
  /** HedgeVault, or null before it is deployed. */
  vault: string | null;
};

/**
 * Returns null when Hedge will pay for this call, or the reason it will not.
 *
 * Undeployed contracts are passed as null, which refuses everything aimed at
 * them rather than defaulting open.
 */
export function refuseSponsoredCall(
  target: string,
  data: `0x${string}`,
  contracts: HedgeContracts,
): string | null {
  const to = target.toLowerCase();
  const engine = contracts.engine?.toLowerCase() || null;
  const vault = contracts.vault?.toLowerCase() || null;

  if (SPONSORED_TOKENS.has(to)) {
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: erc20Abi, data });
    } catch {
      return "Invalid sponsored send.";
    }
    if (decoded.functionName === "transfer") return null;

    // Leverage and LP deposits both need the contract to pull USDG, so the
    // approval has to be sponsored too — but only ever to Hedge's own
    // contracts, never to a spender the caller chose.
    if (decoded.functionName === "approve" && to === USDG.toLowerCase()) {
      const spender = String(decoded.args?.[0] ?? "").toLowerCase();
      if (spender && (spender === engine || spender === vault)) return null;
      return "That approval is not sponsored.";
    }
    return "Invalid sponsored send.";
  }

  if (!engine && !vault) return "That contract is not sponsored.";
  if (to !== engine && to !== vault) return "That contract is not sponsored.";

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: hedgeAbi, data });
  } catch {
    return "Invalid sponsored call.";
  }

  const allowed = to === engine ? ENGINE_METHODS : VAULT_METHODS;
  return allowed.has(decoded.functionName) ? null : "That call is not sponsored.";
}
