import { decodeFunctionData, erc20Abi } from "viem";
import { RELAY_ROUTER, USDG, WETH } from "../robinhood";

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
 * True when this call is an ERC-20 approval naming exactly `spender`.
 *
 * Selling a token means approving a contract Hedge has never heard of, so the
 * token address cannot be the gate the way it is everywhere else here. The
 * spender is: an allowance granted to Relay's router is only ever spendable by
 * Relay, whichever token it sits on.
 */
function isApproveTo(data: `0x${string}`, spender: string) {
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data });
    return (
      decoded.functionName === "approve" &&
      String(decoded.args?.[0] ?? "").toLowerCase() === spender
    );
  } catch {
    return false;
  }
}

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
  const router = RELAY_ROUTER.toLowerCase();

  // Selling a token for cash is the one flow where the trader picks the
  // contract, because the token is whatever they happen to hold. Both halves
  // stay pinned to Relay's router: the approval may name no other spender, and
  // the swap may call nowhere else. The calldata itself is Relay's and is not
  // decoded here — the router is the trust boundary, not the arguments.
  if (to === router) return null;

  if (SPONSORED_TOKENS.has(to) || isApproveTo(data, router)) {
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: erc20Abi, data });
    } catch {
      return "Invalid sponsored send.";
    }
    // A transfer is only sponsored for the tokens Hedge itself moves. Letting
    // it cover any token would turn this into a free send for the whole chain.
    if (decoded.functionName === "transfer") {
      return SPONSORED_TOKENS.has(to) ? null : "That token is not sponsored.";
    }

    // Leverage and LP deposits both need the contract to pull USDG, so the
    // approval has to be sponsored too — but only ever to Hedge's own
    // contracts or Relay's router, never to a spender the caller invented.
    if (decoded.functionName === "approve") {
      const spender = String(decoded.args?.[0] ?? "").toLowerCase();
      if (spender === router) return null;
      if (to !== USDG.toLowerCase()) return "That approval is not sponsored.";
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
