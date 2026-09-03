import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
  waitForTx,
} from "../leverage-chain";
import { RH_CHAIN_ID, RH_RPC, RH_RPC_FALLBACK, USDG } from "../robinhood";
import { refreshOracleFor, reporterConfigured } from "./oracle-refresh";
import { serverSecrets } from "./secrets";

const chain = defineChain({
  id: RH_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RH_RPC_FALLBACK, RH_RPC] } },
});

const transport = fallback([
  http(RH_RPC_FALLBACK, { retryCount: 2, timeout: 12_000 }),
  http(RH_RPC, { retryCount: 2, timeout: 12_000 }),
]);

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
    return "The agent wallet does not have enough USDG.";
  }
  return "That ticket did not go through.";
}

function executorAccount() {
  const { agentWalletKey } = serverSecrets();
  if (!agentWalletKey) return null;
  const key = agentWalletKey.startsWith("0x")
    ? (agentWalletKey as Hex)
    : (`0x${agentWalletKey}` as Hex);
  return privateKeyToAccount(key);
}

export function agentExecutorAddress() {
  return executorAccount()?.address ?? null;
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

function clients() {
  const account = executorAccount();
  if (!account) return null;
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ account, chain, transport }),
  };
}

async function sendCall(to: Hex, data: Hex) {
  const ctx = clients();
  if (!ctx) throw new Error("Agent execution is not configured.");
  const hash = await ctx.wallet.sendTransaction({
    account: ctx.account,
    to,
    data,
  });
  await waitForTx(hash);
  return hash;
}

async function simulate(
  functionName: "openPosition" | "reducePosition",
  args: readonly unknown[],
) {
  const ctx = clients();
  if (!ctx) throw new Error("Agent execution is not configured.");
  try {
    await ctx.publicClient.simulateContract({
      account: ctx.account,
      address: ENGINE_ADDRESS as Hex,
      abi: engineAbi,
      functionName,
      args: args as never,
    });
  } catch (err) {
    throw new Error(readableRevert(err));
  }
}

const APPROVAL_BUDGET = 250;

async function ensureAllowance(amount: bigint) {
  const from = agentExecutorAddress();
  if (!from) throw new Error("Agent execution is not configured.");
  const current = await readAllowance(from, ENGINE_ADDRESS);
  if (current >= amount) return;
  const grant =
    toUsdgRaw(APPROVAL_BUDGET) > amount ? toUsdgRaw(APPROVAL_BUDGET) : amount;
  await sendCall(
    USDG,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [ENGINE_ADDRESS as Hex, grant],
    }),
  );
}

export async function openAgentPosition(input: {
  marketSlug: string;
  isLong: boolean;
  margin: number;
  leverage: number;
}) {
  const account = executorAccount();
  if (!account) {
    return { error: "Agent execution is not configured.", status: 503 as const };
  }

  const listed = LEVERAGE_MARKETS.find((m) => m.marketSlug === input.marketSlug);
  if (!listed) {
    return { error: "That market is not on the agent wall.", status: 404 as const };
  }

  const engine = await readEngineState();
  if (!engine) {
    return { error: "The engine is not reachable.", status: 502 as const };
  }
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
  if (!quote) {
    return { error: "Could not quote that ticket.", status: 502 as const };
  }
  if (!quote.hasCapacity) {
    return { error: "The pool cannot back that size right now.", status: 409 as const };
  }
  if (
    input.leverage > 1 &&
    (quote.entryPrice < PRICE_BAND.min || quote.entryPrice > PRICE_BAND.max)
  ) {
    return { error: "Yes is outside the $0.35–$0.65 band.", status: 409 as const };
  }

  const cash = await readUsdgBalance(account.address);
  if (cash + 1e-6 < input.margin) {
    return {
      error: `Agent wallet has ${cash.toFixed(2)} USDG. Need ${input.margin}.`,
      status: 402 as const,
    };
  }

  if (reporterConfigured()) {
    await refreshOracleFor([listed.marketSlug]);
  }

  const marginRaw = toUsdgRaw(input.margin);
  const args = [
    marketIdFor(listed.marketSlug),
    input.isLong,
    marginRaw,
    BigInt(Math.round(input.leverage * 10_000)),
  ] as const;

  try {
    await ensureAllowance(marginRaw);
    await simulate("openPosition", args);
    const hash = await sendCall(
      ENGINE_ADDRESS as Hex,
      encodeFunctionData({ abi: engineAbi, functionName: "openPosition", args }),
    );
    const positions = await readPositionsFor(account.address);
    const opened = [...positions]
      .filter((p) => p.marketSlug === listed.marketSlug && p.isLong === input.isLong)
      .sort((a, b) => b.openedAt - a.openedAt)[0];
    return {
      ok: true as const,
      hash,
      positionId: opened ? opened.id.toString() : null,
      quote,
      wallet: account.address,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "That ticket did not go through.",
      status: 502 as const,
    };
  }
}

export async function closeAgentPosition(positionId: string) {
  const account = executorAccount();
  if (!account) {
    return { error: "Agent execution is not configured.", status: 503 as const };
  }
  let id: bigint;
  try {
    id = BigInt(positionId);
  } catch {
    return { error: "Invalid position id.", status: 400 as const };
  }

  const mine = await readPositionsFor(account.address);
  const row = mine.find((p) => p.id === id);
  if (!row) {
    return { error: "That position is not open on the agent wallet.", status: 404 as const };
  }

  if (reporterConfigured() && row.marketSlug) {
    await refreshOracleFor([row.marketSlug]).catch(() => {});
  }

  const args = [id, 10_000n] as const;
  try {
    await simulate("reducePosition", args);
    const hash = await sendCall(
      ENGINE_ADDRESS as Hex,
      encodeFunctionData({
        abi: engineAbi,
        functionName: "reducePosition",
        args,
      }),
    );
    return {
      ok: true as const,
      hash,
      positionId: id.toString(),
      marketSlug: row.marketSlug,
      title: row.label,
      side: row.isLong ? ("yes" as const) : ("no" as const),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not close that position.",
      status: 502 as const,
    };
  }
}
