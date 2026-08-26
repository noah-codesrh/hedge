import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "./icons";
import type { ConvertStep } from "../lib/trade/live";
import type { CashOutStep, CloseStep } from "../lib/trade/close";

export type { ConvertStep };

export type FlowMode = "buy" | "close" | "cashout";

const STEP_PCT: Record<string, number> = {
  setup: 12,
  debit: 36,
  sell: 18,
  move: 34,
  convert: 64,
  fill: 86,
  arrive: 90,
};

const TITLES: Record<FlowMode, string> = {
  buy: "Buying",
  close: "Closing",
  cashout: "Cashing out",
};

function useFlowProgress(step: string, failed: boolean) {
  const target = STEP_PCT[step] ?? 10;
  const [value, setValue] = useState(6);
  const now = useRef(6);
  now.current = value;

  useEffect(() => {
    if (failed) return;
    let frame = 0;
    const tick = () => {
      const cur = now.current;
      const cap = Math.min(96, target + 9);
      let next = cur;
      if (cur < target) next = cur + Math.max(0.28, (target - cur) * 0.07);
      else if (cur < cap) next = cur + 0.035;
      if (Math.abs(next - cur) > 0.02) {
        now.current = next;
        setValue(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, failed]);

  return Math.min(99, Math.round(value));
}

function shortError(error: string) {
  const e = error.toLowerCase();
  // Only a dismissed wallet prompt. An order the venue rejected or cancelled
  // also contains these words, and it needs to keep its own explanation.
  if (
    /wallet request was cancell?ed|\buser (?:rejected|denied|cancell?ed|disapproved)/.test(e)
  ) {
    return "Cancelled.";
  }
  if (/sign in|session expired/.test(e)) return "Sign in again.";
  if (/proxy wallet|pUSD is still|pUSD is in|tap Buy again/i.test(error)) {
    const trimmed = error.replace(/\s+/g, " ").trim();
    return trimmed.length <= 220 ? trimmed : `${trimmed.slice(0, 217)}…`;
  }
  if (/not enough usdg|not enough pusd|insufficient (usdg|pusd|collateral)/i.test(error)) {
    return "Not enough balance.";
  }
  const trimmed = error.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Couldn't complete.";
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 157)}…`;
}

function ProgressRing({ value, failed }: { value: number; failed: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, value) / 100);
  const stroke = failed ? "#e85d5d" : "#F1D65A";
  return (
    <div className="relative mx-auto h-[148px] w-[148px]">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="7"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 180ms ease-out, stroke 180ms ease" }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[34px] font-bold tabular-nums tracking-tight">
        {failed ? "!" : `${value}%`}
      </span>
    </div>
  );
}

export function ConversionFlow({
  amount,
  step,
  error,
  onDismiss,
  mode = "buy",
}: {
  amount: string;
  step: ConvertStep | CloseStep | CashOutStep;
  error: string | null;
  onDismiss: () => void;
  mode?: FlowMode;
}) {
  const failed = Boolean(error);
  const pct = useFlowProgress(step, failed);

  const node = (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/80" onClick={failed ? onDismiss : undefined} />
      <div className="relative z-10 w-full max-w-[340px] rounded-t-[28px] bg-[#1a1a1a] px-6 pb-8 pt-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/10 animate-pop-in sm:rounded-[28px] sm:px-8">
        <ProgressRing value={pct} failed={failed} />
        <h3 className="mt-5 text-xl font-bold tracking-tight">
          {failed ? "Couldn't complete" : TITLES[mode]}
        </h3>
        <p className="mt-1 text-[15px] tabular-nums text-muted">{amount}</p>
        {failed ? (
          <p className="mt-3 text-left text-[13px] leading-snug text-[#cfcfcf]">
            {shortError(error ?? "")}
          </p>
        ) : null}
        {failed ? (
          <button
            type="button"
            onClick={onDismiss}
            className="mt-6 w-full rounded-full bg-gold py-3.5 text-sm font-semibold text-black transition hover:brightness-105"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}

export function FlowSuccess({
  title,
  amount,
  onClose,
}: {
  title: string;
  amount: string;
  onClose: () => void;
}) {
  const node = (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[340px] rounded-t-[28px] bg-[#1a1a1a] px-6 pb-8 pt-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/10 animate-pop-in sm:rounded-[28px] sm:px-8">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#1f6f43] text-white">
          <CheckIcon size={28} />
        </div>
        <h3 className="mt-4 text-xl font-bold tracking-tight">{title}</h3>
        <p className="mt-1 text-[15px] tabular-nums text-muted">{amount}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-full bg-gold py-3.5 text-sm font-semibold text-black transition hover:brightness-105"
        >
          Done
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
