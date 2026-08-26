import { useState } from "react";
import { createPortal } from "react-dom";
import {
  useAuthorizationSignature,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { fiat } from "../lib/format";
import type { LivePosition } from "../lib/polymarket-portfolio";
import type { CashOutStep, CloseStep } from "../lib/trade/close";
import {
  isEmbeddedWallet,
  primaryWalletAddress,
  useEnsureTradingWallet,
} from "../lib/wallet";
import { notifyBalancesChanged } from "../lib/positions";
import { ConversionFlow, FlowSuccess } from "./ConversionFlow";
import { useBook } from "./Book";

type Confirm =
  | {
      kind: "close";
      position: LivePosition;
    }
  | {
      kind: "cashout";
      pusd: number;
    };

export function useCloseFlow(options?: { provisionWallet?: boolean }) {
  const provisionWallet = options?.provisionWallet !== false;
  const { getAccessToken, user, ready: privyReady } = usePrivy();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { wallets } = useWallets();
  const { ensureTradingWallet } = useEnsureTradingWallet({
    provision: provisionWallet,
  });
  const { refresh } = useBook();

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [mode, setMode] = useState<"close" | "cashout" | null>(null);
  const [step, setStep] = useState<CloseStep | CashOutStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    pusd: number;
    usdg: number;
    shares: number;
    title: string;
  } | null>(null);
  const [done, setDone] = useState<{
    kind: "close" | "cashout";
    pusd: number;
    usdg: number;
    shares: number;
    title: string;
  } | null>(null);

  const settled = () => {
    refresh();
    notifyBalancesChanged();
  };

  const run = async (next: Confirm) => {
    setConfirm(null);
    setError(null);
    setMode(next.kind);
    setStep(next.kind === "close" ? "sell" : "move");
    const pusd =
      next.kind === "close"
        ? Math.max(0, next.position.currentValue)
        : next.pusd;
    const shares = next.kind === "close" ? next.position.shares : 0;
    const title =
      next.kind === "close"
        ? `${next.position.title}${next.position.outcome ? ` · ${next.position.outcome}` : ""}`
        : "pUSD cash out";
    setPending({ pusd, usdg: pusd, shares, title });
    try {
      if (!privyReady) {
        throw new Error("Wallet is still connecting. Try again in a moment.");
      }
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Session expired. Sign in again.");
      const tradingWallet = await ensureTradingWallet();
      if (!tradingWallet || !isEmbeddedWallet(tradingWallet.walletClientType)) {
        throw new Error("Could not create a trading wallet.");
      }
      const dest =
        primaryWalletAddress(user, wallets) ?? tradingWallet.address;
      if (!dest) {
        throw new Error("Your wallet isn't ready yet. Try again in a moment.");
      }
      const onStep = (next: CloseStep | CashOutStep) => {
        setStep(next);
        if (next === "convert" || next === "arrive") notifyBalancesChanged();
      };
      const signAuthorization = async (payload: {
        version: 1;
        method: "POST";
        url: string;
        body: unknown;
        headers: { "privy-app-id": string; "privy-request-expiry"?: string };
      }) => {
        const { signature } = await generateAuthorizationSignature(payload);
        if (!signature) throw new Error("Could not authorize the trading wallet.");
        return signature;
      };
      if (next.kind === "close") {
        if (!next.position.tokenId) {
          throw new Error("This outcome is not tradeable yet.");
        }
        const { runClosePosition } = await import("../lib/trade/close");
        const result = await runClosePosition(
          {
            tokenId: next.position.tokenId,
            shares: next.position.shares,
            marketPrice: next.position.currentPrice,
            cashAddress: dest,
            accessToken,
            tradingWallet,
            signAuthorization,
          },
          {
            onStep,
          },
        );
        setPending((p) =>
          p
            ? {
                ...p,
                pusd: result.pusd,
                usdg: result.usdg,
                shares: result.sharesSold,
              }
            : p,
        );
        setStep(null);
        setMode(null);
        setDone({
          kind: "close",
          pusd: result.pusd,
          usdg: result.usdg,
          shares: result.sharesSold,
          title,
        });
      } else {
        const { runCashOut } = await import("../lib/trade/close");
        const result = await runCashOut(
          { cashAddress: dest, accessToken, tradingWallet, signAuthorization },
          { onStep },
        );
        setPending((p) =>
          p ? { ...p, pusd: result.pusd, usdg: result.usdg } : p,
        );
        setStep(null);
        setMode(null);
        setDone({
          kind: "cashout",
          pusd: result.pusd,
          usdg: result.usdg,
          shares: 0,
          title,
        });
      }
      settled();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cash out.");
    }
  };

  const overlays = (
    <>
      {confirm ? (
        <ConfirmSheet
          title={confirm.kind === "close" ? "Close position?" : "Cash out?"}
          body={
            confirm.kind === "close"
              ? fiat(Math.max(0, confirm.position.currentValue))
              : fiat(confirm.pusd)
          }
          confirmLabel={confirm.kind === "close" ? "Close" : "Cash out"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(confirm)}
        />
      ) : null}
      {mode && step && pending ? (
        <ConversionFlow
          mode={mode}
          amount={fiat(mode === "cashout" ? pending.pusd : pending.usdg)}
          step={step}
          error={error}
          onDismiss={() => {
            setMode(null);
            setStep(null);
            setPending(null);
            setError(null);
            settled();
          }}
        />
      ) : null}
      {done ? (
        <FlowSuccess
          title={done.kind === "close" ? "Closed" : "Cashed out"}
          amount={fiat(done.usdg)}
          onClose={() => setDone(null)}
        />
      ) : null}
    </>
  );

  return {
    confirmClose: (position: LivePosition) =>
      setConfirm({ kind: "close", position }),
    confirmCashOut: (pusd: number) => setConfirm({ kind: "cashout", pusd }),
    overlays,
  };
}

function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const node = (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-[340px] rounded-t-[28px] bg-[#1a1a1a] px-6 pb-7 pt-7 shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/10 animate-pop-in sm:rounded-[28px]">
        <h3 className="text-center text-xl font-bold tracking-tight">{title}</h3>
        <p className="mt-2 text-center text-2xl font-bold tabular-nums">{body}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full bg-white/5 py-3.5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-gold py-3.5 text-sm font-semibold text-black"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
