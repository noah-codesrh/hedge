import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
  type Hex,
} from "viem";
import { engineAbi } from "../leverage-abi";
import { ENGINE_ADDRESS, LEVERAGE_MARKETS, PRICE_BAND } from "../leverage";
import {
  marketIdFor,
  quoteOpenOnChain,
  readAllowance,
  readEngineState,
  readPositionsFor,
  readUsdgBalance,
  toUsdgRaw,
} from "../leverage-chain";
import { RH_CHAIN_ID, RH_RPC, RH_RPC_FALLBACK, USDG } from "../robinhood";
import { refreshOracleFor, reporterConfigured } from "./oracle-refresh";
import { serverSecrets } from "./secrets";

const ADDR = /^0x[a-fA-F0-9]{40}$/;

const chain = defineChain({
  id: RH_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RH_RPC_FALLBACK, RH_RPC] } },
});

const publicClient = createPublicClient({
  chain,
  transport: fallback([
    http(RH_RPC_FALLBACK, { retryCount: 2, timeout: 12_000 }),
    http(RH_RPC, { retryCount: 2, timeout: 12_000 }),
  ]),
});

const REVERTS: Record<string, string> = {
  PoolCapacityReached: "The pool is full. Try a smaller size.",
  MarketCapacityReached: "This market has taken all the leverage it will back.",
  MarketNotEnabled: "Leverage is not open on this market.",
  PriceOutOfBand: "Yes is outside the $0.35–$0.65 band.",
  PriceConverging: "The price feed is catching up. Retry in a few seconds.",
  StalePrice: "The price feed is stale. Retry in a moment.",
  OpeningIsPaused: "New leveraged positions are paused.",
  MarginTooLarge: "Above the deposit cap for a leveraged position.",
  MarginTooSmall: "Below the minimum for a leveraged position.",
  PositionTooLarge: "That position would be larger than the current cap.",
  LeverageTooHigh: "More leverage than the pool can back right now.",
  NotPositionOwner: "That position belongs to another wallet.",
  PositionNotOpen: "That position is already closed.",
};

function readableRevert(err: unknown) {
  const text = err instanceof Error ? err.message : String(err);
  for (const [name, message] of Object.entries(REVERTS)) {
    if (text.includes(name)) return message;
  }
  if (/insufficient funds|exceeds balance|transfer amount/i.test(text)) {
    return "That wallet does not have enough USDG.";
  }
  return "That ticket would revert on-chain.";
}

export function agentLimits() {
  const { agentMaxMargin, agentMaxLeverage, agentDailyNotional } = serverSecrets();
  return {
    minMargin: 1,
    maxMargin: Number(agentMaxMargin ?? "25") || 25,
    maxLeverage: Number(agentMaxLeverage ?? "4") || 4,
    dailyNotional: Number(agentDailyNotional ?? "250") || 250,
  };
}

export function parseAgentWallet(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!ADDR.test(raw)) return null;
  return raw as Hex;
}

export type AgentCall = {
  to: string;
  data: Hex;
  value: "0x0";
  description: string;
};

async function simulate(
  from: Hex,
  functionName: "openPosition" | "reducePosition",
  args: readonly unknown[],
) {
  try {
    await publicClient.simulateContract({
      account: from,
      address: ENGINE_ADDRESS as Hex,
      abi: engineAbi,
      functionName,
      args: args as never,
    });
  } catch (err) {
    throw new Error(readableRevert(err));
  }
}

export async function buildOpenTicket(input: {
  from: Hex;
  marketSlug: string;
  isLong: boolean;
  margin: number;
  leverage: number;
}) {
  const listed = LEVERAGE_MARKETS.find((m) => m.marketSlug === input.marketSlug);
  if (!listed) {
    return { error: "That market is not on the agent wall.", status: 404 as const };
  }

  const engine = await readEngineState();
  if (!engine) return { error: "The engine is not reachable.", status: 502 as const };
  if (engine.openingPaused) {
    return { error: "New leveraged positions are paused.", status: 503 as const };
  }

  const limits = agentLimits();
  if (input.margin < Math.max(limits.minMargin, engine.minMargin)) {
    return {
      error: `Margin must be at least ${Math.max(limits.minMargin, engine.minMargin)} USDG.`,
      status: 400 as const,
    };
  }
  const cap = Math.min(limits.maxMargin, engine.maxMargin);
  if (input.margin > cap) {
    return { error: `Margin cannot exceed ${cap} USDG.`, status: 400 as const };
  }
  const maxLev = Math.min(listed.maxLeverage, engine.maxLeverage, limits.maxLeverage);
  if (input.leverage < 1 || input.leverage > maxLev) {
    return {
      error: `Leverage must be between 1x and ${maxLev}x on this market.`,
      status: 400 as const,
    };
  }

  const quote = await quoteOpenOnChain({
    marketSlug: listed.marketSlug,
    isLong: input.isLong,
    margin: input.margin,
    leverage: input.leverage,
  });
  if (!quote) return { error: "Could not quote that ticket.", status: 502 as const };
  if (!quote.hasCapacity) {
    return { error: "The pool cannot back that size right now.", status: 409 as const };
  }
  if (
    input.leverage > 1 &&
    (quote.entryPrice < PRICE_BAND.min || quote.entryPrice > PRICE_BAND.max)
  ) {
    return { error: "Yes is outside the $0.35–$0.65 band.", status: 409 as const };
  }

  const cash = await readUsdgBalance(input.from);
  if (cash + 1e-6 < input.margin) {
    return {
      error: `Wallet has ${cash.toFixed(2)} USDG. Need ${input.margin}. Fund this address on Robinhood Chain.`,
      status: 400 as const,
    };
  }

  if (reporterConfigured()) {
    await refreshOracleFor([listed.marketSlug]).catch(() => {});
  }

  const marginRaw = toUsdgRaw(input.margin);
  const openArgs = [
    marketIdFor(listed.marketSlug),
    input.isLong,
    marginRaw,
    BigInt(Math.round(input.leverage * 10_000)),
  ] as const;

  const calls: AgentCall[] = [];
  const allowance = await readAllowance(input.from, ENGINE_ADDRESS);
  if (allowance < marginRaw) {
    calls.push({
      to: USDG,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [ENGINE_ADDRESS as Hex, toUsdgRaw(250)],
      }),
      value: "0x0",
      description: "Approve USDG for HedgeLeverageEngine",
    });
  }

  try {
    await simulate(input.from, "openPosition", openArgs);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "That ticket would revert.",
      status: 409 as const,
    };
  }

  calls.push({
    to: ENGINE_ADDRESS,
    data: encodeFunctionData({
      abi: engineAbi,
      functionName: "openPosition",
      args: openArgs,
    }),
    value: "0x0",
    description: "openPosition",
  });

  return {
    ok: true as const,
    from: input.from,
    chainId: RH_CHAIN_ID,
    token: USDG,
    calls,
    quote,
    title: listed.title,
    marketSlug: listed.marketSlug,
    marketId: listed.marketId,
  };
}

export async function buildCloseTicket(input: { from: Hex; positionId: string }) {
  let id: bigint;
  try {
    id = BigInt(input.positionId);
  } catch {
    return { error: "Invalid position id.", status: 400 as const };
  }

  const mine = await readPositionsFor(input.from);
  const row = mine.find((p) => p.id === id);
  if (!row) {
    return { error: "That position is not open on this wallet.", status: 404 as const };
  }

  if (reporterConfigured() && row.marketSlug) {
    await refreshOracleFor([row.marketSlug]).catch(() => {});
  }

  const args = [id, 10_000n] as const;
  try {
    await simulate(input.from, "reducePosition", args);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "That close would revert.",
      status: 409 as const,
    };
  }

  return {
    ok: true as const,
    from: input.from,
    chainId: RH_CHAIN_ID,
    calls: [
      {
        to: ENGINE_ADDRESS,
        data: encodeFunctionData({
          abi: engineAbi,
          functionName: "reducePosition",
          args,
        }),
        value: "0x0" as const,
        description: "reducePosition (close all)",
      },
    ] satisfies AgentCall[],
    positionId: id.toString(),
    marketSlug: row.marketSlug,
    title: row.label,
    side: row.isLong ? ("yes" as const) : ("no" as const),
  };
}

export async function confirmAgentTx(input: { from: Hex; hash: Hex }) {
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash: input.hash, timeout: 60_000 })
    .catch(async () =>
      publicClient.getTransactionReceipt({ hash: input.hash }),
    );
  if (!receipt) {
    return { error: "Transaction not found yet.", status: 404 as const };
  }
  if (receipt.status !== "success") {
    return { error: "That transaction reverted.", status: 409 as const };
  }
  if (receipt.from.toLowerCase() !== input.from.toLowerCase()) {
    return { error: "That hash was not sent from this wallet.", status: 403 as const };
  }
  const toEngine = receipt.to?.toLowerCase() === ENGINE_ADDRESS.toLowerCase();
  const toUsdg = receipt.to?.toLowerCase() === USDG.toLowerCase();
  if (!toEngine && !toUsdg) {
    return { error: "That hash is not a Hedge engine or USDG approval.", status: 400 as const };
  }

  const positions = await readPositionsFor(input.from);
  const opened = [...positions].sort((a, b) => b.openedAt - a.openedAt)[0];
  return {
    ok: true as const,
    hash: input.hash,
    positionId: toEngine && opened ? opened.id.toString() : null,
  };
}
