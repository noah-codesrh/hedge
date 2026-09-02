import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
  parseUnits,
  type Hex,
} from "viem";
import { robinhoodChain } from "./chains";
import type { SendContext } from "./leverage-actions";
import type { TradeStage } from "./leverage-actions";
import {
  marketIdFor,
  readPositionById,
  toUsd,
  waitForTx,
  type LeveragePosition,
} from "./leverage-chain";
import { RH_RPC, RH_RPC_FALLBACK, USDG } from "./robinhood";
import {
  STOCK_COLLATERAL_ADDRESS,
  STOCK_TOKENS,
  stockByAddress,
  stockCollateralIsLive,
  type StockToken,
} from "./stock-tokens";
import { ensureOracleFresh } from "./leverage-refresh";
import { sponsoredTokenSend } from "./sponsored-send";
import { isEmbeddedWallet, robinhoodProvider } from "./wallet";

const client = createPublicClient({
  chain: robinhoodChain,
  transport: fallback([
    http(RH_RPC_FALLBACK, { timeout: 6_000 }),
    http(RH_RPC, { timeout: 6_000 }),
  ]),
});

export const stockCollateralAbi = [
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
    name: "deposited",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "locked",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "freeOf",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "listed",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "markUsd6",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "haircutBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "openingPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "depositsPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "quoteMargin",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "stockAmount", type: "uint256" },
    ],
    outputs: [{ name: "marginUsdg", type: "uint256" }],
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
    outputs: [{ name: "ticketId", type: "uint256" }],
  },
  {
    type: "function",
    name: "closeTicket",
    stateMutability: "nonpayable",
    inputs: [{ name: "ticketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "ticketCount",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ticketIdAt",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tickets",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "stockAmount", type: "uint128" },
      { name: "marginUsdg", type: "uint128" },
      { name: "engineId", type: "uint64" },
      { name: "open", type: "bool" },
    ],
  },
] as const;

const REVERTS: Record<string, string> = {
  TokenNotListed: "That stock is not accepted as collateral.",
  ZeroAmount: "Enter an amount first.",
  InsufficientFree: "That much is locked against an open ticket.",
  DepositsArePaused: "Stock deposits are paused.",
  OpeningIsPaused: "Opening with stock is paused.",
  MarkNotSet: "This name does not have a mark yet.",
  EngineNotSet: "The stock desk is not pointed at the engine yet.",
  NotTicketOwner: "That ticket belongs to another wallet.",
  TicketNotOpen: "That ticket is already closed.",
  DeskDry: "The stock desk is out of USDG float. Try again later.",
  PoolCapacityReached:
    "The pool is full right now — more liquidity is on the way. Try a smaller size.",
  MarketCapacityReached:
    "This market has taken all the leverage the pool will back for now.",
  MarketNotEnabled: "Leverage isn't open on this market.",
  PriceOutOfBand:
    "This market has drifted outside the $0.35–$0.65 band where leverage is offered.",
  PriceConverging:
    "The price feed is catching up after a jump. Opening reopens in a few seconds.",
  StalePrice: "The price feed is stale. Give it a moment and try again.",
  MarginTooLarge: "That's above the deposit cap for a leveraged position.",
  MarginTooSmall: "That's below the minimum for a leveraged position.",
  LeverageTooHigh: "That's more leverage than the pool can back right now.",
};

function readableRevert(err: unknown): string {
  const text =
    err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  for (const [name, message] of Object.entries(REVERTS)) {
    if (text.includes(name)) return message;
  }
  if (/insufficient funds|exceeds balance|transfer amount/i.test(text)) {
    return "Not enough of that stock in your wallet.";
  }
  return "That didn't go through. Try again in a moment.";
}

async function simulate(
  account: string,
  functionName: "deposit" | "withdraw" | "openWithStock" | "closeTicket",
  args: readonly unknown[],
) {
  try {
    await client.simulateContract({
      account: account as Hex,
      address: STOCK_COLLATERAL_ADDRESS as Hex,
      abi: stockCollateralAbi,
      functionName,
      args: args as never,
    });
  } catch (err) {
    throw new Error(readableRevert(err));
  }
}

async function send(ctx: SendContext, to: string, data: Hex) {
  const wallet = ctx.wallet;
  if (wallet && !isEmbeddedWallet(wallet.walletClientType)) {
    const provider = await robinhoodProvider(wallet);
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: ctx.from, to, data }],
    })) as Hex;
    await waitForTx(hash);
    return hash;
  }
  const hash = await sponsoredTokenSend({
    accessToken: ctx.accessToken,
    from: ctx.from,
    token: to,
    data,
    signAuthorization: ctx.signAuthorization,
  });
  if (hash) await waitForTx(hash);
  return hash;
}

export function stockToNumber(raw: bigint, decimals = 18): number {
  if (raw === 0n) return 0;
  return Number(raw) / 10 ** decimals;
}

export function toStockRaw(amount: number, decimals: number): bigint {
  if (!(amount > 0) || !Number.isFinite(amount)) return 0n;
  const digits = Math.min(decimals, 8);
  return parseUnits(amount.toFixed(digits), decimals);
}

export function formatStockQty(n: number, digits = 4): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export type StockHolding = {
  token: StockToken;
  wallet: bigint;
  deposited: bigint;
  locked: bigint;
  free: bigint;
  markUsd6: bigint;
  listed: boolean;
};

export type DeskState = {
  haircutBps: number;
  openingPaused: boolean;
  depositsPaused: boolean;
  deskUsdg: number;
};

const box = {
  address: STOCK_COLLATERAL_ADDRESS as Hex,
  abi: stockCollateralAbi,
} as const;

export async function readDeskState(): Promise<DeskState | null> {
  if (!stockCollateralIsLive) return null;
  try {
    const [haircutBps, openingPaused, depositsPaused, deskRaw] =
      await Promise.all([
        client.readContract({ ...box, functionName: "haircutBps" }),
        client.readContract({ ...box, functionName: "openingPaused" }),
        client.readContract({ ...box, functionName: "depositsPaused" }),
        client.readContract({
          address: USDG as Hex,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [STOCK_COLLATERAL_ADDRESS as Hex],
        }),
      ]);
    return {
      haircutBps: Number(haircutBps),
      openingPaused,
      depositsPaused,
      deskUsdg: toUsd(deskRaw),
    };
  } catch {
    return null;
  }
}

export async function readStockHoldings(
  user: string,
): Promise<StockHolding[]> {
  if (!user) return [];

  const rows = await Promise.all(
    STOCK_TOKENS.map(async (token) => {
      const wallet = await client
        .readContract({
          address: token.address as Hex,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [user as Hex],
        })
        .catch(() => 0n);

      if (!stockCollateralIsLive) {
        return {
          token,
          wallet,
          deposited: 0n,
          locked: 0n,
          free: 0n,
          markUsd6: 0n,
          listed: false,
        };
      }

      const [deposited, locked, free, markUsd6, listed] = await Promise.all([
        client
          .readContract({
            ...box,
            functionName: "deposited",
            args: [user as Hex, token.address as Hex],
          })
          .catch(() => 0n),
        client
          .readContract({
            ...box,
            functionName: "locked",
            args: [user as Hex, token.address as Hex],
          })
          .catch(() => 0n),
        client
          .readContract({
            ...box,
            functionName: "freeOf",
            args: [user as Hex, token.address as Hex],
          })
          .catch(() => 0n),
        client
          .readContract({
            ...box,
            functionName: "markUsd6",
            args: [token.address as Hex],
          })
          .catch(() => 0n),
        client
          .readContract({
            ...box,
            functionName: "listed",
            args: [token.address as Hex],
          })
          .catch(() => false),
      ]);

      return { token, wallet, deposited, locked, free, markUsd6, listed };
    }),
  );

  return rows;
}

export async function readDeposited(user: string, token: string) {
  if (!STOCK_COLLATERAL_ADDRESS) return 0n;
  return client.readContract({
    address: STOCK_COLLATERAL_ADDRESS as Hex,
    abi: stockCollateralAbi,
    functionName: "deposited",
    args: [user as Hex, token as Hex],
  });
}

export async function quoteStockMargin(
  token: string,
  stockAmount: bigint,
): Promise<number | null> {
  if (!stockCollateralIsLive || stockAmount <= 0n) return null;
  try {
    const raw = await client.readContract({
      ...box,
      functionName: "quoteMargin",
      args: [token as Hex, stockAmount],
    });
    return toUsd(raw);
  } catch {
    return null;
  }
}

/**
 * Posted USDG margin for `amount` shares at the current mark and haircut.
 *
 * Local so the trade panel can update while typing without waiting on RPC.
 * The open still uses the chain's `quoteMargin`.
 */
export function quoteStockMarginLocal(
  amount: number,
  markUsd6: bigint,
  haircutBps: number,
): number | null {
  if (!(amount > 0) || markUsd6 === 0n) return null;
  const notional = amount * toUsd(markUsd6);
  return (notional * (10_000 - haircutBps)) / 10_000;
}

export async function readStockTicketsFor(
  user: string,
): Promise<LeveragePosition[]> {
  if (!stockCollateralIsLive || !user) return [];

  try {
    const count = await client.readContract({
      ...box,
      functionName: "ticketCount",
      args: [user as Hex],
    });
    if (count === 0n) return [];

    const ids = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        client.readContract({
          ...box,
          functionName: "ticketIdAt",
          args: [user as Hex, BigInt(i)],
        }),
      ),
    );

    const tickets = await Promise.all(
      ids.map((id) =>
        client.readContract({ ...box, functionName: "tickets", args: [id] }),
      ),
    );

    const open = ids
      .map((id, i) => ({ id, t: tickets[i]! }))
      .filter(({ t }) => t[5]);

    const positions = await Promise.all(
      open.map(async ({ id, t }) => {
        const engine = await readPositionById(BigInt(t[4]));
        const token = stockByAddress(t[1]);
        const stock = {
          symbol: token?.symbol ?? t[1].slice(0, 6),
          name: token?.name ?? "Stock",
          address: t[1],
          amount: stockToNumber(t[2], token?.decimals ?? 18),
        };
        if (engine) {
          return { ...engine, ticketId: id, stock };
        }
        return {
          id: BigInt(t[4]),
          ticketId: id,
          marketId: "0x" as Hex,
          marketSlug: "",
          label: `${stock.symbol} ticket`,
          eventSlug: null,
          gammaMarketId: null,
          isLong: true,
          entryPrice: 0,
          size: toUsd(t[3]),
          margin: toUsd(t[3]),
          netMargin: toUsd(t[3]),
          shares: 0,
          leverage: 1,
          liquidationPrice: 0,
          liquidationPriceAtOpen: 0,
          funding: 0,
          pnl: 0,
          value: toUsd(t[3]),
          openedAt: 0,
          atRisk: false,
          resolved: false,
          stock,
        } satisfies LeveragePosition;
      }),
    );

    return positions;
  } catch {
    return [];
  }
}

async function ensureStockAllowance(
  ctx: SendContext,
  token: string,
  amount: bigint,
) {
  const allowance = await client.readContract({
    address: token as Hex,
    abi: erc20Abi,
    functionName: "allowance",
    args: [ctx.from as Hex, STOCK_COLLATERAL_ADDRESS as Hex],
  });
  if (allowance >= amount) return false;
  await send(
    ctx,
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [STOCK_COLLATERAL_ADDRESS as Hex, amount],
    }),
  );
  return true;
}

export async function depositStock(
  ctx: SendContext,
  token: string,
  amount: string,
  decimals: number,
) {
  const raw = parseUnits(amount, decimals);
  await ensureStockAllowance(ctx, token, raw);
  await simulate(ctx.from, "deposit", [token as Hex, raw]);
  return send(
    ctx,
    STOCK_COLLATERAL_ADDRESS,
    encodeFunctionData({
      abi: stockCollateralAbi,
      functionName: "deposit",
      args: [token as Hex, raw],
    }),
  );
}

export async function withdrawStock(
  ctx: SendContext,
  token: string,
  amount: string,
  decimals: number,
) {
  const raw = parseUnits(amount, decimals);
  await simulate(ctx.from, "withdraw", [token as Hex, raw]);
  return send(
    ctx,
    STOCK_COLLATERAL_ADDRESS,
    encodeFunctionData({
      abi: stockCollateralAbi,
      functionName: "withdraw",
      args: [token as Hex, raw],
    }),
  );
}

export async function openWithStock(
  ctx: SendContext,
  input: {
    token: string;
    stockAmount: number;
    decimals: number;
    marketSlug: string;
    isLong: boolean;
    leverage: number;
    /** Extra shares already sitting free in the book. Skip approving those. */
    freeInBook?: bigint;
  },
  onStage?: (stage: TradeStage) => void,
) {
  const raw = toStockRaw(input.stockAmount, input.decimals);
  if (raw <= 0n) throw new Error("Enter an amount first.");
  const need = raw > (input.freeInBook ?? 0n) ? raw - (input.freeInBook ?? 0n) : 0n;

  onStage?.("approving");
  if (need > 0n) await ensureStockAllowance(ctx, input.token, need);

  const args = [
    input.token as Hex,
    raw,
    marketIdFor(input.marketSlug),
    input.isLong,
    BigInt(Math.round(input.leverage * 10_000)),
  ] as const;

  onStage?.("checking");
  await ensureOracleFresh(ctx.accessToken, [input.marketSlug]);
  await simulate(ctx.from, "openWithStock", args);

  onStage?.("submitting");
  return send(
    ctx,
    STOCK_COLLATERAL_ADDRESS,
    encodeFunctionData({
      abi: stockCollateralAbi,
      functionName: "openWithStock",
      args,
    }),
  );
}

export async function closeStockTicket(
  ctx: SendContext,
  ticketId: bigint,
  onStage?: (stage: TradeStage) => void,
) {
  onStage?.("checking");
  try {
    const ticket = await client.readContract({
      ...box,
      functionName: "tickets",
      args: [ticketId],
    });
    const engine = await readPositionById(BigInt(ticket[4]));
    if (engine?.marketSlug) {
      await ensureOracleFresh(ctx.accessToken, [engine.marketSlug]);
    }
  } catch {
    /* close still runs; a stale feed will revert with a readable error */
  }
  await simulate(ctx.from, "closeTicket", [ticketId]);
  onStage?.("submitting");
  return send(
    ctx,
    STOCK_COLLATERAL_ADDRESS,
    encodeFunctionData({
      abi: stockCollateralAbi,
      functionName: "closeTicket",
      args: [ticketId],
    }),
  );
}
