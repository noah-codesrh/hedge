import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { Market, PolymarketEvent, Side } from "../lib/types";
import { cents, fiat, pct } from "../lib/format";
import { addPosition, notifyBalancesChanged } from "../lib/positions";
import { quoteConversion } from "../lib/convert";
import { isLiveMarket } from "../lib/polymarket";
import { trackTrade } from "../lib/track";
import {
  findWallet,
  isEmbeddedWallet,
  useEnsureCashWallet,
  useEnsureTradingWallet,
} from "../lib/wallet";
import type { LivePosition } from "../lib/polymarket-portfolio";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { useBook } from "./Book";
import { useCloseFlow } from "./CloseFlow";
import { ConversionFlow, FlowSuccess, type ConvertStep } from "./ConversionFlow";
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

  const closeFlow = useCloseFlow({ provisionWallet: false });

  return (
    <>
      <TradePanelView
        {...props}
        authenticated={authenticated}
        getAccessToken={getAccessToken}
        cashAddress={cashAddress}
        cashWallet={cashWallet}
        tradingWallet={tradingWallet}
        ensureTradingWallet={ensureTradingWallet}
        ensureCashWallet={ensureCashWallet}
        onClosePosition={closeFlow.confirmClose}
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
  cashWallet,
  tradingWallet,
  ensureTradingWallet,
  ensureCashWallet,
  onClosePosition,
}: {
  event: PolymarketEvent;
  market: Market;
  initialSide?: Side;
  authenticated: boolean;
  getAccessToken?: () => Promise<string | null>;
  cashAddress?: string | null;
  cashWallet?: ConnectedWallet;
  tradingWallet?: ConnectedWallet;
  ensureTradingWallet?: () => Promise<ConnectedWallet>;
  ensureCashWallet?: () => Promise<ConnectedWallet>;
  onClosePosition?: (position: LivePosition) => void;
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
    shares: number;
    amount: number;
    pusd: number;
    side: Side;
  } | null>(null);

  useEffect(() => {
    setSide(initialSide);
  }, [initialSide]);

  const price = side === "yes" ? market.yes.price : market.no.price;
  const shares = price > 0 ? amount / price : 0;
  const tradeable = isLiveMarket(market) && price > 0;
  const cashMax = Math.max(0, Math.floor(Math.max(0, cash) * 100) / 100);
  const held = heldPosition(openPositions, event, market, side);

  const setSized = (n: number) => {
    const next = Math.round(Math.max(0, n) * 100) / 100;
    setAmount(cashMax > 0 ? Math.min(next, cashMax) : 0);
  };

  useEffect(() => {
    setAmount((a) => (cashMax > 0 ? Math.min(a, cashMax) : 0));
  }, [cashMax]);

  const onTrade = () => {
    if (!authenticated) return openModal();
    if (cashMax <= 0) return openDeposit();
    if (!tradeable || amount <= 0 || busy) return;
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
        {held ? (
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

        <div className="rounded-2xl bg-[#252525] p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] text-muted">Amount</span>
            <div className="flex min-w-0 items-baseline gap-0.5 text-2xl font-bold sm:text-3xl">
              <span className="text-lg text-muted sm:text-xl">$</span>
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
            {cashMax > 0 ? `${fiat(cashMax)} cash` : "No USDG cash"}
          </p>
          <DottedSlider
            value={amount}
            max={cashMax}
            onChange={setSized}
          />
          <div className="mt-3.5 grid grid-cols-5 gap-1.5 sm:gap-2">
            {[1, 5, 10, 25, 50].map((q) => (
              <button
                key={q}
                onClick={() => setSized(amount + q)}
                disabled={cashMax <= 0}
                className="rounded-full bg-[#1b1b1b] py-2 text-[12px] font-semibold transition hover:bg-[#2c2c2c] disabled:opacity-40 sm:text-[13px]"
              >
                +{q}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onTrade}
          disabled={
            authenticated &&
            (busy || !tradeable || (cashMax > 0 && amount <= 0))
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
            : cashMax <= 0
              ? "Deposit USDG to trade"
              : busy
                ? "Buying…"
                : `Buy ${side === "yes" ? market.yes.label : market.no.label}`}
        </button>

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

        {amount > 0 && (
          <div className="mt-4 space-y-1.5 text-[13px] text-muted">
            <div className="flex justify-between">
              <span>Avg price</span>
              <span className="text-white">{pct(price)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shares</span>
              <span className="text-white">{shares.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>To win</span>
              <span className="text-up">${shares.toFixed(2)}</span>
            </div>
          </div>
        )}
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
          title="Order placed"
          amount={fiat(done.amount)}
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
