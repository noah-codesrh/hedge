import { useEffect, useState } from "react";
import {
  useAuthorizationSignature,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { Market, PolymarketEvent, Side } from "../lib/types";
import { cents, fiat, pct, signedPct } from "../lib/format";
import { fillBuy, fillSell, useOrderBooks } from "../lib/orderbook";
import { addPosition, notifyBalancesChanged } from "../lib/positions";
import { quoteConversion } from "../lib/convert";
import { isLiveMarket } from "../lib/polymarket";
import {
  isWithinBand,
  LEVERAGE_STEPS,
  leverageFor,
  leverageIsLive,
  PRICE_BAND,
  quoteLeverage,
} from "../lib/leverage";
import {
  limitOrdersLive,
  quoteOpenOnChain,
  readEngineState,
  type ChainQuote,
  type EngineState,
  type LeverageOrder,
} from "../lib/leverage-chain";
import { LeverageOrders } from "./LeverageOrders";
import type { TradeStage } from "../lib/leverage-actions";
import type { SignPrivyAuthorization } from "../lib/sponsored-send";
import { trackTrade } from "../lib/track";
import {
  findWallet,
  isEmbeddedWallet,
  useEnsureCashWallet,
  useEnsureTradingWallet,
} from "../lib/wallet";
import type { LivePosition } from "../lib/polymarket-portfolio";
import type { LeveragePosition } from "../lib/leverage-chain";
import {
  formatStockQty,
  openWithStock,
  quoteStockMarginLocal,
  readDeskState,
  readStockHoldings,
  stockToNumber,
  type DeskState,
  type StockHolding,
} from "../lib/stock-collateral";
import {
  STOCK_TOKENS,
  stockCollateralIsLive,
  type StockToken,
} from "../lib/stock-tokens";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { useBook } from "./Book";
import { useCloseFlow } from "./CloseFlow";
import { ConversionFlow, FlowSuccess, type ConvertStep } from "./ConversionFlow";
import {
  LeveragePositionCard,
  useLeveragePositions,
} from "./LeveragePositions";
import { LivePositionCard } from "./PositionPnl";

export function TradePanel(props: {
  event: PolymarketEvent;
  market: Market;
  initialSide?: Side;
}) {
  const privyMounted = usePrivyMounted();
  if (privyMounted) return <AuthedTradePanel {...props} />;
  return <TradePanelView {...props} authenticated={false} />;
}

function AuthedTradePanel(props: {
  event: PolymarketEvent;
  market: Market;
  initialSide?: Side;
}) {
  const { authenticated, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { cashAddress, ensureCashWallet } = useEnsureCashWallet();
  const cashWallet = findWallet(wallets, cashAddress);
  const { tradingWallet, ensureTradingWallet } = useEnsureTradingWallet();
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const closeFlow = useCloseFlow({ provisionWallet: false });
  const levered = useLeveragePositions();

  const signAuthorization: SignPrivyAuthorization = async (payload) => {
    const { signature } = await generateAuthorizationSignature(payload);
    if (!signature) throw new Error("Could not authorize this wallet.");
    return signature;
  };

  return (
    <>
      <TradePanelView
        {...props}
        authenticated={authenticated}
        getAccessToken={getAccessToken}
        signAuthorization={signAuthorization}
        cashAddress={cashAddress}
        cashWallet={cashWallet}
        tradingWallet={tradingWallet}
        ensureTradingWallet={ensureTradingWallet}
        ensureCashWallet={ensureCashWallet}
        onClosePosition={closeFlow.confirmClose}
        leveredPositions={levered.positions}
        leveredOrders={levered.orders}
        onCloseLeverage={(position, fractionBps) =>
          void levered.close(position, fractionBps)
        }
        onRestClose={(position, price, above) =>
          void levered.placeClose(position, price, above)
        }
        onCancelOrder={(order) => void levered.cancelOrder(order)}
        leverBusyId={levered.busyId}
        leverCloseStage={levered.stage}
      />
      {closeFlow.overlays}
    </>
  );
}

function TradePanelView({
  event,
  market,
  initialSide = "yes",
  authenticated,
  getAccessToken,
  cashAddress,
  cashWallet,
  tradingWallet,
  ensureTradingWallet,
  ensureCashWallet,
  onClosePosition,
  signAuthorization,
  leveredPositions = [],
  leveredOrders = [],
  onCloseLeverage,
  onRestClose,
  onCancelOrder,
  leverBusyId = null,
  leverCloseStage = null,
}: {
  event: PolymarketEvent;
  market: Market;
  initialSide?: Side;
  authenticated: boolean;
  getAccessToken?: () => Promise<string | null>;
  signAuthorization?: SignPrivyAuthorization;
  cashAddress?: string | null;
  cashWallet?: ConnectedWallet;
  tradingWallet?: ConnectedWallet;
  ensureTradingWallet?: () => Promise<ConnectedWallet>;
  ensureCashWallet?: () => Promise<ConnectedWallet>;
  onClosePosition?: (position: LivePosition) => void;
  leveredPositions?: LeveragePosition[];
  leveredOrders?: LeverageOrder[];
  onCloseLeverage?: (position: LeveragePosition, fractionBps: number) => void;
  onRestClose?: (
    position: LeveragePosition,
    limitPrice: number,
    triggerAbove: boolean,
  ) => void;
  onCancelOrder?: (order: LeverageOrder) => void;
  leverBusyId?: string | null;
  leverCloseStage?: TradeStage | null;
}) {
  const { openModal } = useAuthModal();
  const { cash, openDeposit, refresh, openPositions } = useBook();
  const [side, setSide] = useState<Side>(initialSide);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [convertStep, setConvertStep] = useState<ConvertStep | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    amount: number;
    pusd: number;
    shares: number;
    side: Side;
  } | null>(null);
  const [done, setDone] = useState<{
    title?: string;
    amountLabel?: string;
    shares: number;
    amount: number;
    pusd: number;
    side: Side;
  } | null>(null);

  useEffect(() => {
    setSide(initialSide);
  }, [initialSide]);

  const price = side === "yes" ? market.yes.price : market.no.price;
  const tradeable = isLiveMarket(market) && price > 0;

  // Leverage is offered on a small allowlist. Everywhere else this whole block
  // is inert and the panel behaves exactly as it always has.
  const leverageConfig = leverageFor(market);
  // The engine reads the YES price whichever way the trader is facing, so the
  // band check has to use YES rather than the selected side's price.
  const onBand = isWithinBand(market.yes.price);

  // What the pool will back right now. The registry cap is a per-market risk
  // limit; the engine's tier schedule is a liquidity limit that moves on its
  // own as LPs deposit. A trader gets whichever is lower.
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  useEffect(() => {
    if (!leverageConfig || !leverageIsLive) return;
    let alive = true;
    const load = () => {
      void readEngineState().then((s) => {
        if (alive) setEngineState(s);
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [leverageConfig]);

  useEffect(() => {
    if (!leverageConfig || !leverageIsLive) return;
    void limitOrdersLive().then(setLimitsOn);
  }, [leverageConfig]);

  const leverageOffered =
    Boolean(leverageConfig) &&
    tradeable &&
    onBand &&
    !(engineState?.openingPaused ?? false);
  const maxLeverage = Math.min(
    leverageConfig?.maxLeverage ?? 1,
    engineState?.maxLeverage ?? leverageConfig?.maxLeverage ?? 1,
  );
  const [ticketKind, setTicketKind] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState(0);
  const [limitsOn, setLimitsOn] = useState(false);
  const [leverage, setLeverage] = useState(1);
  const [collateral, setCollateral] = useState<StockToken | null>(null);
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [desk, setDesk] = useState<DeskState | null>(null);

  useEffect(() => {
    if (!leverageConfig || !cashAddress) return;
    let alive = true;
    const load = () => {
      void Promise.all([
        readStockHoldings(cashAddress),
        readDeskState(),
      ]).then(([next, state]) => {
        if (!alive) return;
        setHoldings(next);
        setDesk(state);
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [leverageConfig, cashAddress]);

  const stockRow = collateral
    ? holdings.find(
        (h) =>
          h.token.address.toLowerCase() === collateral.address.toLowerCase(),
      )
    : null;
  const stockAvail = stockRow
    ? stockToNumber(stockRow.wallet + stockRow.free, collateral!.decimals)
    : 0;
  const stockMark = stockRow ? Number(stockRow.markUsd6) / 1e6 : 0;
  const haircutBps = desk?.haircutBps ?? 3_000;
  const usingStock = collateral != null;
  const hasStock = holdings.some(
    (h) => stockToNumber(h.wallet + h.free, h.token.decimals) > 0,
  );

  const effectiveLeverage = leverageOffered ? Math.min(leverage, maxLeverage) : 1;
  const levered = effectiveLeverage > 1;
  const usingLimit =
    levered && limitsOn && ticketKind === "limit" && !usingStock;

  const [leverStage, setLeverStage] = useState<TradeStage | null>(null);

  // Falling out of the band or switching to a plain market must not strand a
  // leverage setting the trader can no longer act on.
  useEffect(() => {
    if (!leverageOffered) {
      setLeverage(1);
      setCollateral(null);
    }
  }, [leverageOffered]);

  const stockMargin =
    usingStock && amount > 0 && stockRow
      ? quoteStockMarginLocal(amount, stockRow.markUsd6, haircutBps)
      : null;
  const marginUsd = usingStock ? (stockMargin ?? 0) : amount;

  const leverageQuote = levered
    ? quoteLeverage(marginUsd, effectiveLeverage, market.yes.price, side === "yes")
    : null;

  /**
   * Vault capital this ticket would reserve, mirroring `_maxPayout`.
   *
   * Not the borrowed slice: a binary outcome can run to $1.00, so a long's
   * worst case for the vault is the shares above the position size and a
   * short's is the whole size.
   */
  const reserveNeeded = leverageQuote
    ? side === "yes"
      ? Math.max(0, leverageQuote.shares - leverageQuote.size)
      : leverageQuote.size
    : 0;

  /**
   * Why this levered ticket would be rejected, checked while the trader types.
   *
   * These are the same bounds the engine enforces. Catching them here turns a
   * failed simulation several seconds after tapping the button into a sentence
   * that appears as the number is entered.
   */
  const leverBlock = (() => {
    if (!levered || !engineState || marginUsd <= 0) return null;
    if (usingStock && !stockCollateralIsLive) {
      return "The stock desk is not live yet.";
    }
    if (usingStock && (desk?.openingPaused || engineState.openingPaused)) {
      return "Opening with stock is paused.";
    }
    if (usingStock && stockMark <= 0) {
      return `${collateral.symbol} does not have a mark yet.`;
    }
    if (usingStock && desk && stockMargin != null && stockMargin > desk.deskUsdg) {
      return "The stock desk is out of USDG float. Try a smaller size.";
    }
    if (marginUsd < engineState.minMargin) {
      return usingStock
        ? `${collateral.symbol} posts ${fiat(marginUsd)} after haircut. Leverage needs at least ${fiat(engineState.minMargin)}.`
        : `Leverage needs at least ${fiat(engineState.minMargin)} of margin.`;
    }
    if (marginUsd > engineState.maxMargin) {
      return `${fiat(engineState.maxMargin)} is the most you can put behind one leveraged position.`;
    }
    if (reserveNeeded > engineState.capacity.available) {
      return "The pool is filled up — more liquidity is on the way. Lower the size or the multiple.";
    }
    return null;
  })();
  const cashMax = Math.max(0, Math.floor(Math.max(0, cash) * 100) / 100);

  /**
   * Most the trader may put behind this ticket.
   *
   * A levered position is bounded by the engine's margin cap as well as by
   * cash, so the input clamps to whichever is lower. Reporting the breach after
   * the fact is worse than making it unreachable — the slider and the quick-add
   * buttons should not be able to produce a number the chain will refuse.
   */
  const marginCeiling = usingStock
    ? stockAvail
    : levered && engineState
      ? Math.min(cashMax, engineState.maxMargin)
      : cashMax;

  /**
   * The engine's own quote, which is the arithmetic the chain will run.
   *
   * Worth the round trip rather than trusting the local estimate: that one is
   * computed off the Polymarket price, while the engine prices off the oracle,
   * and the keeper only refreshes it every couple of minutes. Between ticks the
   * two genuinely differ, and the number that matters — the liquidation price —
   * is the one the trader is about to be held to.
   */
  const [chainQuote, setChainQuote] = useState<ChainQuote | null>(null);
  useEffect(() => {
    if (!levered || !leverageConfig || amount <= 0 || leverBlock) {
      setChainQuote(null);
      return;
    }
    let alive = true;
    // Debounced: the amount changes on every keystroke and every slider pixel.
    const timer = setTimeout(() => {
      void quoteOpenOnChain({
        marketSlug: leverageConfig.marketSlug,
        isLong: side === "yes",
        margin: marginUsd,
        leverage: effectiveLeverage,
      }).then((q) => {
        if (alive) setChainQuote(q);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [levered, leverageConfig, marginUsd, side, effectiveLeverage, leverBlock]);

  /**
   * What the ticket summary shows: the chain's numbers once they arrive, the
   * local estimate until then so the panel never goes blank mid-keystroke.
   */
  const shownQuote = (() => {
    if (!leverageQuote) return null;
    if (!chainQuote) return leverageQuote;
    return {
      ...leverageQuote,
      size: chainQuote.size,
      entryPrice: chainQuote.entryPrice,
      fee: chainQuote.fee,
      netMargin: chainQuote.netMargin,
      shares: chainQuote.shares,
      liquidationPrice: chainQuote.liquidationPrice,
      liquidationDistance: Math.abs(
        chainQuote.liquidationPrice - chainQuote.entryPrice,
      ),
    };
  })();

  /** Carry on the borrowed slice for a day, so the holding cost is visible. */
  const dailyCarry =
    shownQuote && engineState && effectiveLeverage > 1
      ? Math.max(0, shownQuote.size - marginUsd) *
        (engineState.borrowRateBps / 10_000) *
        24
      : 0;

  const held = heldPosition(openPositions, event, market, side);
  const heldLever = heldLeverage(leveredPositions, market, side);

  // A market buy lifts the asks, so the quoted market price is not the price
  // paid. Walk the real book instead of dividing by it.
  const books = useOrderBooks([market.yes.tokenId, market.no.tokenId]);
  const tokenId = side === "yes" ? market.yes.tokenId : market.no.tokenId;
  const book = tokenId ? books[tokenId] : undefined;
  const fill = book && amount > 0 ? fillBuy(book.asks, amount) : null;
  const quoted = fill && fill.shares > 0 ? fill : null;
  const shares = quoted ? quoted.shares : price > 0 ? amount / price : 0;
  const avgPrice = quoted ? quoted.avgPrice : price;
  // What closing straight back into the bids would return: the round-trip cost
  // of the spread, which is there even when the market has not moved.
  const exit = book && quoted ? fillSell(book.bids, quoted.shares) : null;
  const roundTrip =
    exit && quoted && quoted.spent > 0
      ? (exit.proceeds - quoted.spent) / quoted.spent
      : null;

  const setSized = (n: number) => {
    const step = usingStock ? 10_000 : 100;
    const next = Math.round(Math.max(0, n) * step) / step;
    setAmount(marginCeiling > 0 ? Math.min(next, marginCeiling) : 0);
  };

  const pickCollateral = (next: StockToken | null) => {
    setCollateral(next);
    setAmount(0);
    if (next) setTicketKind("market");
    if (next && leverage < 2) {
      setLeverage(Math.min(2, maxLeverage));
    }
  };

  // Also catches stepping up the multiple with an amount already typed, which
  // can put a previously fine number above the levered cap.
  useEffect(() => {
    setAmount((a) => (marginCeiling > 0 ? Math.min(a, marginCeiling) : 0));
  }, [marginCeiling]);

  /**
   * Opens a leveraged position against the Hedge engine on Robinhood Chain.
   *
   * Nothing here touches Polymarket. The trader's USDG stays on this chain as
   * margin, the vault takes the other side, and the Polymarket price only
   * arrives through the oracle the keeper feeds. That is why this is a
   * separate path rather than a flag on the normal buy.
   */
  const openLevered = () => {
    setBusy(true);
    setConvertError(null);
    void (async () => {
      try {
        if (!getAccessToken || !signAuthorization) {
          throw new Error("Your wallet isn't ready yet. Try again.");
        }
        const signerCash = (await ensureCashWallet?.()) ?? cashWallet;
        if (!signerCash) {
          throw new Error("Your wallet isn't ready yet. Try again.");
        }
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("Session expired. Sign in again.");
        if (!leverageConfig) throw new Error("Leverage isn't offered here.");

        const opened = { size: leverageQuote?.size ?? 0, leverage: effectiveLeverage };
        const ctx = {
          accessToken,
          from: signerCash.address,
          wallet: signerCash,
          signAuthorization,
        };

        if (usingLimit) {
          if (!(limitPrice > 0 && limitPrice < 1)) {
            throw new Error("Set a limit between 1¢ and 99¢.");
          }
          const { placeOpenLimit } = await import("../lib/leverage-actions");
          await placeOpenLimit(
            ctx,
            {
              marketSlug: leverageConfig.marketSlug,
              isLong: side === "yes",
              margin: amount,
              leverage: effectiveLeverage,
              limitPrice,
              mark: market.yes.price,
            },
            setLeverStage,
          );
        } else if (collateral) {
          await openWithStock(
            ctx,
            {
              token: collateral.address,
              stockAmount: amount,
              decimals: collateral.decimals,
              marketSlug: leverageConfig.marketSlug,
              isLong: side === "yes",
              leverage: effectiveLeverage,
              freeInBook: stockRow?.free ?? 0n,
            },
            setLeverStage,
          );
        } else {
          const { openLeveragePosition } = await import("../lib/leverage-actions");
          await openLeveragePosition(
            ctx,
            {
              marketSlug: leverageConfig.marketSlug,
              isLong: side === "yes",
              margin: amount,
              leverage: effectiveLeverage,
            },
            setLeverStage,
          );
        }

        setAmount(0);
        setLeverage(1);
        setCollateral(null);
        const through =
          usingLimit &&
          (side === "yes"
            ? market.yes.price <= limitPrice
            : market.yes.price >= limitPrice);
        setDone({
          title:
            usingLimit && !through
              ? `Limit resting at ${cents(limitPrice)}`
              : "Position opened",
          amountLabel: collateral
            ? `${formatStockQty(amount)} ${collateral.symbol} at ${opened.leverage}x`
            : `${fiat(opened.size)} at ${opened.leverage}x`,
          shares: leverageQuote?.shares ?? 0,
          amount: opened.size,
          pusd: 0,
          side,
        });
        notifyBalancesChanged();
        refresh();
        void readEngineState().then(setEngineState);
      } catch (e) {
        setConvertError(
          e instanceof Error ? e.message : "Could not open that position.",
        );
      } finally {
        setBusy(false);
        setLeverStage(null);
      }
    })();
  };

  const onTrade = () => {
    if (!authenticated) return openModal();
    if (usingStock && stockAvail <= 0) return;
    if (!usingStock && cashMax <= 0) return openDeposit();
    if (!tradeable || amount <= 0 || busy) return;
    // Never let a levered ticket fall through to the unlevered Polymarket
    // path: the trader would be filled at 1x on an order that says otherwise.
    if (levered && !leverageIsLive) return;
    if (usingStock && !levered) return;
    if (levered) return openLevered();
    const quote = quoteConversion(amount);
    const ticket = {
      amount,
      pusd: quote.pusd,
      shares,
      side,
      entryPrice: price,
    };
    setBusy(true);
    setConvertError(null);
    setPending(ticket);
    setConvertStep("setup");
    void (async () => {
      try {
        const tokenId =
          ticket.side === "yes" ? market.yes.tokenId : market.no.tokenId;
        if (!tokenId) throw new Error("This outcome is not tradeable yet.");
        if (!getAccessToken) {
          throw new Error("Your wallet isn't ready yet. Try Buy again.");
        }
        const signerCash = (await ensureCashWallet?.()) ?? cashWallet;
        if (!signerCash) {
          throw new Error("Your wallet isn't ready yet. Try Buy again.");
        }
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error("Session expired. Sign in again.");
        const signerWallet =
          (await ensureTradingWallet?.()) ?? tradingWallet;
        if (!signerWallet || !isEmbeddedWallet(signerWallet.walletClientType)) {
          throw new Error("Could not create a trading wallet.");
        }
        const { runLiveTrade } = await import("../lib/trade/live");
        const result = await runLiveTrade(
          {
            amountUsdg: ticket.amount,
            tokenId,
            side: ticket.side,
            marketPrice: ticket.entryPrice,
            cashAddress: signerCash.address,
            accessToken,
            cashWallet: signerCash,
            tradingWallet: signerWallet,
            signAuthorization,
          },
          {
            onStep: setConvertStep,
            onQuote: (pusd) =>
              setPending((p) => (p ? { ...p, pusd } : p)),
          },
        );
        trackTrade(accessToken, {
          wallet: signerCash.address,
          proxyWallet: result.depositWallet,
          direction: "buy",
          outcome: ticket.side,
          outcomeLabel: ticket.side === "yes" ? "Yes" : "No",
          eventSlug: event.slug,
          marketSlug: market.slug ?? null,
          tokenId,
          title: market.groupItemTitle || market.question || event.title,
          usdg: result.usdg,
          pusd: result.pusd,
          shares: result.shares,
          price: result.entryPrice,
          orderId: result.orderId,
          conversionId: result.conversionId,
          tags: event.tags,
        });
        addPosition({
          id: crypto.randomUUID(),
          eventId: event.id,
          eventSlug: event.slug,
          eventTitle: event.title,
          marketId: market.id,
          question: market.question,
          groupItemTitle: market.groupItemTitle,
          side: ticket.side,
          amountUsdg: result.usdg,
          amountPusd: result.pusd,
          conversionId: result.conversionId,
          entryPrice: result.entryPrice,
          shares: result.shares,
          createdAt: Date.now(),
          status: "open",
        });
        setConvertStep(null);
        setPending(null);
        setDone({
          shares: result.shares,
          amount: result.usdg,
          pusd: result.pusd,
          side: ticket.side,
        });
        setAmount(0);
        refresh();
      } catch (e) {
        notifyBalancesChanged();
        refresh();
        setConvertError(
          e instanceof Error ? e.message : "Conversion failed.",
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <div className="w-full min-w-0 rounded-3xl bg-card p-4 ring-1 ring-white/5 sm:p-5">
        {heldLever ? (
          <div className="mb-4">
            <LeveragePositionCard
              position={heldLever}
              title={event.title || market.question}
              busy={leverBusyId === `${heldLever.id}`}
              stage={leverBusyId === `${heldLever.id}` ? leverCloseStage : null}
              onClose={(fractionBps) => onCloseLeverage?.(heldLever, fractionBps)}
              onRestClose={
                heldLever.ticketId == null && onRestClose
                  ? (price, above) => onRestClose(heldLever, price, above)
                  : undefined
              }
            />
          </div>
        ) : held ? (
          <div className="mb-4">
            <LivePositionCard position={held} />
          </div>
        ) : (
          <div className="mb-4">
            <p className="text-[15px] font-semibold leading-snug break-words">
              {market.question}
            </p>
            <span className="mt-1 inline-block text-[13px] text-muted">
              {event.tags[0]?.label ?? "Prediction"}
            </span>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3">
          <button
            onClick={() => setSide("yes")}
            className={`min-w-0 truncate rounded-full py-3 text-[14px] font-bold transition sm:py-3.5 sm:text-[15px] ${
              side === "yes"
                ? "bg-[#1f6f43] text-white"
                : "bg-[#1b1b1b] text-white hover:bg-[#2c2c2c]"
            }`}
          >
            {market.yes.label} {cents(market.yes.price)}
          </button>
          <button
            onClick={() => setSide("no")}
            className={`min-w-0 truncate rounded-full py-3 text-[14px] font-bold transition sm:py-3.5 sm:text-[15px] ${
              side === "no"
                ? "bg-[#7a2b2b] text-white"
                : "bg-[#1b1b1b] text-white hover:bg-[#2c2c2c]"
            }`}
          >
            {market.no.label} {cents(market.no.price)}
          </button>
        </div>

        {leverageConfig && limitsOn && levered ? (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTicketKind("market")}
              className={`rounded-full py-2 text-[13px] font-semibold transition ${
                !usingLimit
                  ? "bg-white text-black"
                  : "bg-[#1b1b1b] text-muted hover:text-white"
              }`}
            >
              Market
            </button>
            <button
              type="button"
              onClick={() => {
                pickCollateral(null);
                setLimitPrice((p) => (p > 0 ? p : market.yes.price));
                setTicketKind("limit");
              }}
              className={`rounded-full py-2 text-[13px] font-semibold transition ${
                usingLimit
                  ? "bg-white text-black"
                  : "bg-[#1b1b1b] text-muted hover:text-white"
              }`}
            >
              Limit
            </button>
          </div>
        ) : null}

        {leverageConfig ? (
          <LeverageSelector
            value={effectiveLeverage}
            max={maxLeverage}
            onChange={(n) => {
              if (n === 1) pickCollateral(null);
              setLeverage(n);
            }}
            offered={leverageOffered}
            offBand={!onBand}
            engine={engineState}
            reserveNeeded={reserveNeeded}
            paused={engineState?.openingPaused ?? false}
          />
        ) : null}

        {leverageConfig ? (
          <CollateralPicker
            selected={collateral}
            holdings={holdings}
            onSelect={pickCollateral}
          />
        ) : null}

        <div className="rounded-2xl bg-[#252525] p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] text-muted">
              {usingStock ? collateral.symbol : levered ? "Margin" : "Amount"}
            </span>
            <div className="flex min-w-0 items-baseline gap-0.5 text-2xl font-bold sm:text-3xl">
              {usingStock ? null : (
                <span className="text-lg text-muted sm:text-xl">$</span>
              )}
              <input
                type="number"
                min={0}
                inputMode="decimal"
                value={amount || ""}
                onChange={(e) => setSized(Number(e.target.value))}
                placeholder="0"
                className="w-24 bg-transparent text-right outline-none placeholder-white sm:w-28"
              />
            </div>
          </div>
          <p className="mt-1 text-right text-[11px] text-muted">
            {usingStock
              ? stockAvail <= 0
                ? `No ${collateral.symbol}`
                : stockMargin != null
                  ? `${formatStockQty(stockAvail)} ${collateral.symbol} · ${fiat(stockMargin)} margin`
                  : `${formatStockQty(stockAvail)} ${collateral.symbol}`
              : cashMax <= 0
                ? "No USDG · use NVDA, SPCX, AAPL, GME, or TSLA"
                : marginCeiling < cashMax
                  ? `${fiat(marginCeiling)} max margin · ${fiat(cashMax)} cash`
                  : `${fiat(cashMax)} cash`}
          </p>
          <DottedSlider
            value={amount}
            max={marginCeiling}
            onChange={setSized}
          />
          <div className="mt-3.5 grid grid-cols-5 gap-1.5 sm:gap-2">
            {/* Steps past the ceiling are dead weight on a levered ticket
                capped at a few dollars, so the row rescales with it. */}
            {(usingStock
              ? [0.01, 0.1, 0.5, 1, 2]
              : marginCeiling <= 10
                ? [0.5, 1, 2, 5, 10]
                : [1, 5, 10, 25, 50]
            ).map((q) => (
              <button
                key={q}
                onClick={() => setSized(amount + q)}
                disabled={marginCeiling <= 0 || amount >= marginCeiling}
                className="rounded-full bg-[#1b1b1b] py-2 text-[12px] font-semibold transition hover:bg-[#2c2c2c] disabled:opacity-40 sm:text-[13px]"
              >
                +{q}
              </button>
            ))}
          </div>
        </div>

        {usingLimit ? (
          <div className="mt-3 rounded-2xl bg-[#252525] p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[15px] text-muted">Limit (Yes)</span>
              <div className="flex min-w-0 items-baseline gap-0.5 text-2xl font-bold sm:text-3xl">
                <input
                  type="number"
                  min={1}
                  max={99}
                  inputMode="decimal"
                  value={limitPrice > 0 ? Math.round(limitPrice * 100) : ""}
                  onChange={(e) => setLimitPrice(Number(e.target.value) / 100)}
                  placeholder={String(Math.round(market.yes.price * 100))}
                  className="w-20 bg-transparent text-right outline-none placeholder-white/40 sm:w-24"
                />
                <span className="text-lg text-muted sm:text-xl">¢</span>
              </div>
            </div>
            <p className="mt-2 text-[12px] leading-snug text-muted">
              {side === "yes"
                ? "Fills at or below this Yes price while you are signed in."
                : "Fills at or above this Yes price while you are signed in."}
            </p>
          </div>
        ) : null}

        {/* The conversion overlay carries errors for the Polymarket path, but
            a levered open never opens one, so it reports inline. */}
        {levered && convertError && !convertStep ? (
          <p className="mt-3 rounded-2xl bg-down/10 px-3 py-2.5 text-[13px] leading-snug text-down">
            {convertError}
          </p>
        ) : null}
        {leverBlock && !busy ? (
          <p className="mt-3 rounded-2xl bg-gold/10 px-3 py-2.5 text-[13px] leading-snug text-gold">
            {leverBlock}
          </p>
        ) : null}

        <button
          onClick={onTrade}
          disabled={
            authenticated &&
            (busy ||
              !tradeable ||
              (levered && !leverageIsLive) ||
              Boolean(leverBlock) ||
              (usingStock
                ? amount <= 0 || stockAvail <= 0
                : cashMax > 0 && amount <= 0))
          }
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-4 text-base font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {busy && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
          )}
          {!authenticated
            ? "Connect wallet"
            : !tradeable
              ? "This outcome isn’t tradeable"
            : levered && !leverageIsLive
              ? "Leverage isn’t live yet"
            : usingStock && stockAvail <= 0
              ? `Deposit ${collateral.symbol} on Earn`
            : !usingStock && cashMax <= 0
              ? hasStock
                ? "Pick a stock or deposit USDG"
                : "Deposit USDG or pick a stock"
              : busy
                ? levered
                  ? STAGE_LABEL[leverStage ?? "submitting"]
                  : "Buying…"
                : usingLimit
                  ? `Rest ${effectiveLeverage}x ${side === "yes" ? market.yes.label : market.no.label} at ${cents(limitPrice || market.yes.price)}`
                  : levered
                  ? `${effectiveLeverage}x ${side === "yes" ? market.yes.label : market.no.label}`
                  : `Buy ${side === "yes" ? market.yes.label : market.no.label}`}
        </button>

        {leveredOrders.length > 0 && onCancelOrder ? (
          <LeverageOrders
            orders={leveredOrders.filter((row) =>
              leverageConfig
                ? row.marketSlug === leverageConfig.marketSlug
                : true,
            )}
            busyId={leverBusyId}
            stage={leverCloseStage}
            onCancel={onCancelOrder}
          />
        ) : null}

        {authenticated && held && onClosePosition ? (
          <button
            type="button"
            onClick={() => onClosePosition(held)}
            disabled={busy}
            className="mt-2 w-full py-2 text-[13px] font-medium text-[#b8b8b8] underline decoration-white/20 underline-offset-4 transition hover:text-white hover:decoration-white/50 disabled:opacity-40"
          >
            Close {held.shares.toFixed(2)} {held.outcome}
          </button>
        ) : null}

        {amount > 0 && shownQuote ? (
          <div className="mt-4 space-y-1.5 text-[13px] text-muted">
            <div className="flex justify-between">
              <span>Position size</span>
              <span className="text-white">
                {fiat(shownQuote.size)}{" "}
                <span className="opacity-70">({effectiveLeverage}x)</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span>Entry price</span>
              <span className="text-white">
                {pct(shownQuote.entryPrice, 1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Liquidation</span>
              <span className="text-down">
                {pct(shownQuote.liquidationPrice, 1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Entry fee</span>
              <span className="text-white">{fiat(shownQuote.fee)}</span>
            </div>
            {dailyCarry > 0 ? (
              <div className="flex justify-between">
                <span>Carry</span>
                <span className="text-white">{fiat(dailyCarry)} a day</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span>Shares</span>
              <span className="text-white">
                {shownQuote.shares.toFixed(2)}
              </span>
            </div>
            <p className="pt-0.5 text-[12px] leading-snug">
              A {pct(shownQuote.liquidationDistance, 1)} move against you closes
              this position and you lose your{" "}
              {usingStock
                ? `${formatStockQty(amount)} ${collateral.symbol}`
                : fiat(amount)}{" "}
              {usingStock ? "" : "margin"}.
              {chainQuote ? null : " Prices confirm against the chain in a moment."}
            </p>
          </div>
        ) : amount > 0 ? (
          <div className="mt-4 space-y-1.5 text-[13px] text-muted">
            <div className="flex justify-between">
              <span>Avg price</span>
              <span className="text-white">{pct(avgPrice, 1)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shares</span>
              <span className="text-white">{shares.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>To win</span>
              <span className="text-up">${shares.toFixed(2)}</span>
            </div>
            {exit && roundTrip != null ? (
              <div className="flex justify-between">
                <span>Sell back now</span>
                <span
                  className={
                    roundTrip < -0.005 ? "text-down" : "text-white"
                  }
                >
                  {fiat(exit.proceeds)}{" "}
                  <span className="opacity-80">({signedPct(roundTrip)})</span>
                </span>
              </div>
            ) : null}
            {quoted && quoted.unfilled > 0.01 ? (
              <p className="pt-0.5 text-[12px] leading-snug text-down">
                Only {fiat(quoted.spent)} of this fits the book right now.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {convertStep && pending ? (
        <ConversionFlow
          mode="buy"
          amount={fiat(pending.amount)}
          step={convertStep}
          error={convertError}
          onDismiss={() => {
            setConvertStep(null);
            setPending(null);
            setConvertError(null);
          }}
        />
      ) : null}

      {done ? (
        <FlowSuccess
          title={done.title ?? "Order placed"}
          amount={done.amountLabel ?? fiat(done.amount)}
          onClose={() => setDone(null)}
        />
      ) : null}
    </>
  );
}

function norm(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function heldLeverage(
  positions: LeveragePosition[],
  market: Market,
  side: Side,
) {
  const wantLong = side === "yes";
  const listed = leverageFor(market)?.marketSlug.toLowerCase();
  const slug = market.slug.toLowerCase();
  return (
    positions.find((position) => {
      if (position.isLong !== wantLong) return false;
      const key = position.marketSlug.toLowerCase();
      if (listed && key === listed) return true;
      if (position.gammaMarketId && position.gammaMarketId === market.id) {
        return true;
      }
      return key === slug;
    }) ?? null
  );
}

function heldPosition(
  positions: LivePosition[],
  event: PolymarketEvent,
  market: Market,
  side: Side,
) {
  const yes = market.yes.tokenId?.toLowerCase() ?? "";
  const no = market.no.tokenId?.toLowerCase() ?? "";
  const wanted = (side === "yes" ? yes : no) || null;
  const eventSlug = event.slug.toLowerCase();
  const marketSlug = market.slug.toLowerCase();
  const titles = [norm(event.title), norm(market.question)].filter(Boolean);

  const onMarket = positions.filter((position) => {
    if (position.status !== "open" || position.shares <= 0) return false;
    const token = position.tokenId?.toLowerCase() ?? "";
    if (token && (token === yes || token === no)) return true;
    const slugs = [position.marketSlug, position.eventSlug]
      .filter(Boolean)
      .map((s) => s!.toLowerCase());
    if (slugs.includes(marketSlug) || slugs.includes(eventSlug)) return true;
    const title = norm(position.title);
    return Boolean(title && titles.some((t) => t === title || t.includes(title) || title.includes(t)));
  });
  if (onMarket.length === 0) return null;
  if (wanted) {
    const exact = onMarket.find(
      (position) => position.tokenId?.toLowerCase() === wanted,
    );
    if (exact) return exact;
  }
  return onMarket.find((position) => position.side === side) ?? onMarket[0];
}

/**
 * What the button says mid-flight. "Approving" only shows on a wallet's first
 * levered trade, which is the one that genuinely takes longer.
 */
const STAGE_LABEL: Record<TradeStage, string> = {
  approving: "Approving…",
  checking: "Checking the pool…",
  submitting: "Opening…",
};

function CollateralPicker({
  selected,
  holdings,
  onSelect,
}: {
  selected: StockToken | null;
  holdings: StockHolding[];
  onSelect: (token: StockToken | null) => void;
}) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[13px] text-muted">Margin</p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
            selected == null
              ? "bg-gold text-black"
              : "bg-[#1b1b1b] text-[#cfcfcf] hover:bg-[#2c2c2c] hover:text-white"
          }`}
        >
          USDG
        </button>
        {STOCK_TOKENS.map((token) => {
          const row = holdings.find(
            (h) => h.token.address.toLowerCase() === token.address.toLowerCase(),
          );
          const qty = row
            ? stockToNumber(row.wallet + row.free, token.decimals)
            : 0;
          const active =
            selected?.address.toLowerCase() === token.address.toLowerCase();
          return (
            <button
              key={token.address}
              type="button"
              onClick={() => onSelect(token)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
                active
                  ? "bg-gold text-black"
                  : "bg-[#1b1b1b] text-[#cfcfcf] hover:bg-[#2c2c2c] hover:text-white"
              }`}
            >
              {token.symbol}
              {qty > 0 ? (
                <span className="ml-1 font-medium opacity-70">
                  {formatStockQty(qty, 2)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {selected && !stockCollateralIsLive ? (
        <p className="mt-2 text-[11px] leading-snug text-gold">
          The stock desk is not live yet. You can size a ticket; opening waits
          on the contract.
        </p>
      ) : selected ? (
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Locks {selected.symbol} and posts USDG from the desk. Same shares
          come back on a win; a loss seizes stock at the mark.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-snug text-muted">
          1x is USDG on the book. 2x to 4x can lock listed stock instead of
          cash.
        </p>
      )}
    </div>
  );
}

function LeverageSelector({
  value,
  max,
  onChange,
  offered,
  offBand,
  engine,
  reserveNeeded,
  paused,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  offered: boolean;
  offBand: boolean;
  engine: EngineState | null;
  /** Vault capital this ticket would tie up, so a full pool is caught early. */
  reserveNeeded: number;
  paused: boolean;
}) {
  const poolFull =
    engine != null && reserveNeeded > 0 && reserveNeeded > engine.capacity.available;
  const nextTier =
    engine?.nextTier && engine.nextTier.leverage > max ? engine.nextTier : null;

  return (
    <div className="mb-4 rounded-2xl bg-[#252525] p-3 sm:p-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="text-[15px] text-muted">Leverage</span>
        <span className="text-[17px] font-bold text-gold">
          {offered ? `${value}x` : "Unavailable"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {LEVERAGE_STEPS.map((step) => {
          // Steps above this market's cap stay visible rather than hidden, so
          // the ceiling is legible instead of just absent.
          const allowed = offered && step <= max;
          const active = offered && step === value;
          return (
            <button
              key={step}
              type="button"
              disabled={!allowed}
              onClick={() => onChange(step)}
              className={`rounded-full py-2.5 text-[17px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${
                active
                  ? "bg-gold text-black"
                  : "bg-[#1b1b1b] text-white hover:bg-[#2c2c2c]"
              }`}
            >
              {step}x
            </button>
          );
        })}
      </div>

      {poolFull ? (
        <p className="mt-2.5 rounded-xl bg-gold/10 px-2.5 py-2 text-[11px] leading-snug text-gold">
          The pool is filled up — more liquidity is on the way. Lower the size
          or the multiple to open now.
        </p>
      ) : null}

      <p className="mt-2.5 text-[11px] leading-snug text-muted">
        {paused
          ? "New leveraged positions are paused while the pool is checked over. Open positions are unaffected."
          : offBand
            ? `Leverage opens only between ${pct(PRICE_BAND.min)} and ${pct(PRICE_BAND.max)}. This market has drifted outside that, so it trades unlevered for now.`
            : value > 1
              ? "Borrowed from the Hedge vault. Your margin is at risk before the vault's."
              : "1x is a normal unlevered buy."}
      </p>

      {nextTier && !paused ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          {nextTier.leverage}x unlocks once the vault reaches{" "}
          {fiat(nextTier.atTvl)}.
        </p>
      ) : null}
    </div>
  );
}

function DottedSlider({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (n: number) => void;
  max: number;
}) {
  const pctVal = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const marks = [0, 25, 50, 75, 100];
  return (
    <div className="mt-5">
      <div className="relative h-10">
        <div className="dot-grid absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-md" />
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          disabled={max <= 0}
          value={pctVal}
          onChange={(e) => onChange((Number(e.target.value) / 100) * max)}
          className="absolute inset-0 z-10 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <div
          className="pointer-events-none absolute top-1/2 z-20 h-10 w-5 -translate-y-1/2 rounded-md bg-gold shadow-[0_0_12px_rgba(241,214,90,0.45)]"
          style={{ left: `calc(${pctVal}% - 10px)` }}
        >
          <div className="flex h-full flex-col items-center justify-center gap-0.5">
            <span className="h-1 w-1 rounded-[1px] bg-black/50" />
            <span className="h-1 w-1 rounded-[1px] bg-black/50" />
            <span className="h-1 w-1 rounded-[1px] bg-black/50" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        {marks.map((m) => (
          <button
            key={m}
            type="button"
            disabled={max <= 0}
            onClick={() => onChange((m / 100) * max)}
            className={`transition hover:text-white disabled:opacity-40 ${
              Math.abs(pctVal - m) < 1 ? "text-gold" : ""
            }`}
          >
            {m}%
          </button>
        ))}
      </div>
    </div>
  );
}
