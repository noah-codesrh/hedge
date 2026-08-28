import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { useAuthorizationSignature, usePrivy } from "@privy-io/react-auth";
import { ModalShell } from "./ModalShell";
import { formatTokenAmount, parseTokenAmount, type OwnedToken } from "../lib/robinhood";
import { fiat } from "../lib/format";
import { notifyBalancesChanged } from "../lib/positions";
import {
  quoteSwapToCash,
  runSwapToCash,
  SwapError,
  type SwapQuote,
  type SwapStep,
} from "../lib/trade/swap";

/**
 * Turning whatever a trader holds into cash they can bet with.
 *
 * Robinhood Chain carries a lot besides USDG — memecoins, tokenised equities —
 * and none of it is usable here until it becomes USDG. The list is driven by
 * what the wallet actually holds rather than a search box, because the chain
 * has several contracts sharing a name and letting someone type "USDG" and
 * pick the wrong one is a trap worth designing out.
 */

/** Native ETH pays for its own gas, so Max leaves enough behind to swap. */
const GAS_RESERVE = 500_000_000_000_000n;

function TokenMark({ token, size = 36 }: { token: OwnedToken; size?: number }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size };
  if (token.logoUrl && !broken) {
    return (
      <img
        src={token.logoUrl}
        alt=""
        style={box}
        loading="lazy"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full bg-[#0f0f0f] object-cover"
      />
    );
  }
  return (
    <span
      style={box}
      className="grid shrink-0 place-items-center rounded-full bg-white/[0.06] text-[12px] font-semibold text-[#cfcfcf]"
    >
      {token.symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

function tokenKey(token: OwnedToken) {
  return token.address ?? "native";
}

export function SwapToCash({
  address,
  wallet,
  ensureCashWallet,
  onDone,
}: {
  address: string;
  wallet?: ConnectedWallet;
  ensureCashWallet?: () => Promise<ConnectedWallet>;
  onDone: () => void;
}) {
  const [tokens, setTokens] = useState<OwnedToken[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<OwnedToken | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rh/tokens?address=${encodeURIComponent(address)}`);
      const data = (await res.json()) as { tokens?: OwnedToken[] };
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch {
      setTokens([]);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  const empty = tokens !== null && tokens.length === 0;
  const shown = expanded ? tokens : tokens?.slice(0, 4);

  return (
    <>
      <div className="rounded-2xl bg-card p-3 ring-1 ring-white/5 sm:p-4">
        {tokens === null ? (
          <div className="space-y-2">
            <div className="h-[60px] animate-pulse rounded-2xl bg-[#141414]" />
            <div className="h-[60px] animate-pulse rounded-2xl bg-[#141414] opacity-60" />
          </div>
        ) : empty ? (
          <div className="px-2 py-7 text-center">
            <p className="text-[14px] font-medium">Nothing to convert yet</p>
            <p className="mx-auto mt-1 max-w-xs text-[12px] leading-relaxed text-muted">
              Any token you hold on Robinhood Chain shows up here, ready to turn
              into USDG you can bet with.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {shown?.map((token) => (
                <button
                  key={tokenKey(token)}
                  type="button"
                  onClick={() => setActive(token)}
                  className="group flex w-full items-center gap-3 rounded-2xl bg-[#141414] px-3 py-3 text-left ring-1 ring-white/5 transition hover:bg-[#181818] hover:ring-white/10 active:scale-[0.995]"
                >
                  <TokenMark token={token} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold">
                        {token.symbol}
                      </span>
                      {token.reputation && token.reputation !== "ok" ? (
                        <span className="shrink-0 rounded-full bg-down/15 px-1.5 py-0.5 text-[10px] font-semibold text-down">
                          unverified
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[12px] text-muted">
                      {formatTokenAmount(token.balanceRaw, token.decimals, 4)}{" "}
                      {token.symbol}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {token.valueUsd != null ? (
                      <div className="text-[14px] font-semibold tabular-nums">
                        {fiat(token.valueUsd)}
                      </div>
                    ) : null}
                    <div className="text-[11px] font-medium text-gold opacity-0 transition group-hover:opacity-100">
                      Swap →
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {tokens.length > 4 ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2.5 w-full rounded-xl py-2 text-center text-[12px] font-medium text-muted transition hover:text-white"
              >
                {expanded ? "Show less" : `Show ${tokens.length - 4} more`}
              </button>
            ) : null}
          </>
        )}
      </div>

      {active ? (
        <SwapModal
          token={active}
          address={address}
          wallet={wallet}
          ensureCashWallet={ensureCashWallet}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            void load();
            notifyBalancesChanged();
            onDone();
          }}
        />
      ) : null}
    </>
  );
}

function SwapModal({
  token,
  address,
  wallet,
  ensureCashWallet,
  onClose,
  onDone,
}: {
  token: OwnedToken;
  address: string;
  wallet?: ConnectedWallet;
  ensureCashWallet?: () => Promise<ConnectedWallet>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { getAccessToken } = usePrivy();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [step, setStep] = useState<SwapStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  /** Only the newest quote may write state; a slow one must not overwrite it. */
  const quoteRun = useRef(0);

  const max = useMemo(() => {
    let raw = 0n;
    try {
      raw = BigInt(token.balanceRaw);
    } catch {
      raw = 0n;
    }
    if (token.address === null) {
      raw = raw > GAS_RESERVE ? raw - GAS_RESERVE : 0n;
    }
    return raw;
  }, [token]);

  const amountRaw = useMemo(() => {
    try {
      return parseTokenAmount(amount, token.decimals);
    } catch {
      return 0n;
    }
  }, [amount, token.decimals]);

  const overBalance = amountRaw > max;
  const busy = step !== null;

  const payUsd =
    token.priceUsd != null && amountRaw > 0n
      ? (Number(amountRaw) / 10 ** token.decimals) * token.priceUsd
      : null;

  const setFraction = (pct: number) => {
    const part = pct === 100 ? max : (max * BigInt(pct)) / 100n;
    setAmount(formatTokenAmount(part.toString(), token.decimals, 8));
  };

  useEffect(() => {
    if (amountRaw <= 0n || overBalance) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    const run = ++quoteRun.current;
    setQuoting(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new SwapError("Session expired. Sign in again.");
        const next = await quoteSwapToCash({
          accessToken,
          address,
          token: {
            address: token.address,
            symbol: token.symbol,
            decimals: token.decimals,
          },
          amountRaw,
        });
        if (run !== quoteRun.current) return;
        setQuote(next);
      } catch (e) {
        if (run !== quoteRun.current) return;
        setQuote(null);
        setError(e instanceof Error ? e.message : "Could not quote this swap.");
      } finally {
        if (run === quoteRun.current) setQuoting(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [amountRaw, overBalance, address, token, getAccessToken]);

  const convert = async () => {
    if (!quote) return;
    setError(null);
    setStep("swap");
    try {
      const signer = wallet ?? (await ensureCashWallet?.());
      if (!signer) throw new SwapError("Your wallet isn't ready yet.");
      const accessToken = await getAccessToken();
      if (!accessToken) throw new SwapError("Session expired. Sign in again.");
      const result = await runSwapToCash(
        {
          accessToken,
          wallet: signer,
          address,
          token: {
            address: token.address,
            symbol: token.symbol,
            decimals: token.decimals,
          },
          amountRaw,
          quote,
          signAuthorization: async (payload) => {
            const { signature } = await generateAuthorizationSignature(payload);
            if (!signature) throw new Error("Could not authorize this wallet.");
            return signature;
          },
        },
        { onStep: setStep },
      );
      setDone(result.usdg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete this swap.");
    } finally {
      setStep(null);
    }
  };

  if (done != null) {
    return (
      <ModalShell onClose={onDone}>
        <div className="py-2 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-up/15 text-3xl text-up">
            ✓
          </div>
          <h2 className="mt-4 text-xl font-semibold">Converted to cash</h2>
          <p className="mt-1.5 text-sm text-muted">
            <span className="font-semibold text-white">{fiat(done)}</span> of USDG
            is in your wallet, ready to bet with.
          </p>
          <button
            type="button"
            onClick={onDone}
            className="mt-6 w-full rounded-full bg-gold py-3.5 text-sm font-semibold text-black transition hover:brightness-105"
          >
            Done
          </button>
        </div>
      </ModalShell>
    );
  }

  const impact = quote?.impactPercent ?? null;
  const costly = impact != null && impact <= -2;

  return (
    <ModalShell onClose={busy ? () => {} : onClose}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Swap to cash</h2>
        {!busy ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-muted transition hover:text-white"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl bg-[#0f0f0f] p-4 ring-1 ring-white/5 transition focus-within:ring-white/15">
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span>You pay</span>
          <span className="tabular-nums">
            {formatTokenAmount(max.toString(), token.decimals, 6)} available
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            inputMode="decimal"
            disabled={busy}
            className="min-w-0 flex-1 bg-transparent text-[28px] font-semibold tabular-nums outline-none placeholder:text-[#3a3a3a] disabled:opacity-60"
          />
          <span className="flex shrink-0 items-center gap-2 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-3">
            <TokenMark token={token} size={24} />
            <span className="max-w-[7rem] truncate text-[13px] font-semibold">
              {token.symbol}
            </span>
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted">
            {payUsd != null ? fiat(payUsd) : "\u00a0"}
          </span>
          <span className="flex gap-1">
            {[25, 50, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={busy}
                onClick={() => setFraction(pct)}
                className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-[#cfcfcf] transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                {pct === 100 ? "Max" : `${pct}%`}
              </button>
            ))}
          </span>
        </div>
      </div>

      <div className="relative h-3">
        <span className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-[#161616] bg-[#242424] text-[13px] text-[#cfcfcf]">
          ↓
        </span>
      </div>

      <div className="rounded-2xl bg-[#0f0f0f] p-4 ring-1 ring-white/5">
        <span className="text-[12px] text-muted">You get</span>
        <div className="mt-2 flex items-center gap-3">
          <span
            className={`min-w-0 flex-1 truncate text-[28px] font-semibold tabular-nums ${
              quote ? "" : "text-[#3a3a3a]"
            }`}
          >
            {overBalance ? "0" : quoting ? "…" : quote ? quote.usdgOut.toFixed(2) : "0"}
          </span>
          <span className="flex shrink-0 items-center gap-2 rounded-full bg-gold/15 py-1.5 pl-2.5 pr-3 text-gold">
            <span className="text-[13px] font-semibold">USDG</span>
          </span>
        </div>
        {impact != null && !quoting ? (
          <div className="mt-2 flex items-center justify-between text-[12px]">
            <span className="text-muted">Price impact</span>
            <span className={`tabular-nums ${costly ? "text-down" : "text-muted"}`}>
              {impact.toFixed(2)}%
            </span>
          </div>
        ) : null}
      </div>

      {costly ? (
        <p className="mt-2.5 rounded-xl bg-down/10 px-3 py-2 text-[12px] leading-relaxed text-down">
          Thin liquidity — you would lose a noticeable slice of this token's value
          converting this much.
        </p>
      ) : null}
      {overBalance ? (
        <p className="mt-2.5 text-[13px] text-down">
          That is more {token.symbol} than this wallet holds.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2.5 rounded-xl bg-down/10 px-3 py-2 text-[13px] leading-relaxed text-down">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!quote || quoting || busy || overBalance}
        onClick={() => void convert()}
        className="mt-4 w-full rounded-full bg-gold py-4 text-[15px] font-semibold text-black transition hover:brightness-105 active:scale-[0.99] disabled:opacity-40"
      >
        {step === "approve"
          ? `Approving ${token.symbol}…`
          : step === "swap"
            ? "Swapping…"
            : step === "settle"
              ? "Waiting for cash…"
              : amountRaw <= 0n
                ? "Enter an amount"
                : "Swap to cash"}
      </button>
      <p className="mt-2.5 text-center text-[11px] text-muted">
        Routed through Relay on Robinhood Chain
      </p>
    </ModalShell>
  );
}
