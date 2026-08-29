import { useEffect, useRef, useState } from "react";
import { useDepositAddress } from "@privy-io/react-auth/hooks";
import type { DepositConfig } from "@privy-io/react-auth/hooks";
import { CheckIcon, CopyIcon } from "./icons";
import {
  DEPOSIT_CHAINS,
  DEPOSIT_DEST_CHAIN,
  DEPOSIT_DEST_TOKEN,
  DEPOSIT_MIN_USD,
  FEATURED_DEPOSIT_CHAINS,
  MORE_DEPOSIT_CHAINS,
  depositChainById,
  type DepositChain,
} from "../lib/deposit-chains";
import { fiat } from "../lib/format";
import { notifyBalancesChanged } from "../lib/positions";

const USDC_LOGO = "/tokens/usdc.svg";

type Quote = {
  depositAddress: string;
  id: string;
  createdAt: string;
  minutes: number;
  rate: number | null;
};

function privyMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Could not create a deposit address.";
}

function tokenOnChain(
  config: DepositConfig,
  symbol: string,
  caip2: string,
) {
  return (
    config.currencies
      .find((row) => row.symbol.toUpperCase() === symbol.toUpperCase())
      ?.chains.find((row) => row.caip2 === caip2)?.address ?? null
  );
}

function ChainMark({
  chain,
  size = 22,
}: {
  chain: DepositChain;
  size?: number;
}) {
  return (
    <img
      src={chain.logo}
      alt=""
      width={size}
      height={size}
      decoding="async"
      className="rounded-full object-cover ring-1 ring-white/10"
      style={{ width: size, height: size }}
    />
  );
}

function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`shrink-0 text-muted transition ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChainIcons({
  onPick,
  disabled = false,
}: {
  onPick: (chain: DepositChain) => void;
  disabled?: boolean;
}) {
  const [more, setMore] = useState(false);
  return (
    <div
      className={`relative flex shrink-0 items-center -space-x-1.5 ${
        disabled ? "pointer-events-none opacity-40" : ""
      }`}
    >
      {FEATURED_DEPOSIT_CHAINS.map((chain) => (
        <button
          key={chain.id}
          type="button"
          title={chain.name}
          onClick={(e) => {
            e.stopPropagation();
            onPick(chain);
          }}
          className="relative rounded-full ring-2 ring-[#1b1b1b] transition hover:z-10 hover:ring-white/30"
        >
          <ChainMark chain={chain} size={26} />
        </button>
      ))}
      <button
        type="button"
        title="More chains"
        onClick={(e) => {
          e.stopPropagation();
          setMore((v) => !v);
        }}
        className="relative grid h-[26px] w-[26px] place-items-center rounded-full bg-[#2a2a2a] text-[13px] font-semibold text-[#cfcfcf] ring-2 ring-[#1b1b1b] transition hover:bg-[#333] hover:text-white"
      >
        +
      </button>
      {more ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-[11.5rem] rounded-2xl bg-[#111] p-2 ring-1 ring-white/10">
          {MORE_DEPOSIT_CHAINS.map((chain) => (
            <button
              key={chain.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMore(false);
                onPick(chain);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[13px] font-medium transition hover:bg-white/5"
            >
              <ChainMark chain={chain} size={22} />
              {chain.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TransferCryptoModal({
  address,
  cash,
  initialChain,
  onBack,
  onClose,
  onArrived,
}: {
  address: string;
  cash: number;
  initialChain?: DepositChain;
  onBack: () => void;
  onClose: () => void;
  onArrived: () => void;
}) {
  const deposit = useDepositAddress();
  const depositRef = useRef(deposit);
  depositRef.current = deposit;
  const onArrivedRef = useRef(onArrived);
  onArrivedRef.current = onArrived;
  const recipient = useRef(address);
  const quotes = useRef(new Map<string, Quote>());
  const [chain, setChain] = useState<DepositChain>(
    initialChain ?? DEPOSIT_CHAINS[0]!,
  );
  const [menu, setMenu] = useState<null | "token" | "chain">(null);
  const [details, setDetails] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"wait" | "done">("wait");
  const [delivered, setDelivered] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const cached = quotes.current.get(chain.id);
    if (cached) {
      setQuote(cached);
      setBusy(false);
      setError(null);
      setStatus("wait");
      setDelivered(null);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);
    setQuote(null);
    setStatus("wait");
    setDelivered(null);

    const { getConfig, generateDepositAddress } = depositRef.current;
    const source = chain;
    const dest = recipient.current;

    const run = async () => {
      try {
        const config = await getConfig();
        if (cancelled) return;
        if (!config.chains[source.caip2]) {
          throw new Error(
            `Deposits from ${source.name} are not enabled yet.`,
          );
        }
        const sourceCurrency =
          tokenOnChain(config, source.token.symbol, source.caip2) ??
          source.token.address;
        const destinationCurrency =
          tokenOnChain(config, "USDG", DEPOSIT_DEST_CHAIN) ?? DEPOSIT_DEST_TOKEN;
        const next = await generateDepositAddress({
          sourceChain: source.caip2,
          sourceCurrency,
          destinationChain: DEPOSIT_DEST_CHAIN,
          destinationCurrency,
          destinationAddress: dest,
        });
        if (cancelled) return;
        if (!next.deposit_address) {
          throw new Error("Privy did not return a deposit address.");
        }
        const rate = Number(next.indicative_rate);
        const row: Quote = {
          depositAddress: next.deposit_address,
          id: next.id,
          createdAt: next.created_at,
          minutes: Math.max(1, Math.round(next.time_estimate_seconds / 60)),
          rate: Number.isFinite(rate) && rate > 0 ? rate : null,
        };
        quotes.current.set(source.id, row);
        setQuote(row);
      } catch (e) {
        if (!cancelled) {
          setQuote(null);
          setError(privyMessage(e));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [chain.id, chain.caip2, chain.name, chain.token.address, chain.token.symbol]);

  useEffect(() => {
    if (!quote || status === "done") return;
    const ac = new AbortController();
    let alive = true;
    let landed = false;
    let baseline: number | null = null;
    const dest = recipient.current;

    const markArrived = (amountOut?: number | null) => {
      if (!alive || landed) return;
      landed = true;
      if (amountOut != null && Number.isFinite(amountOut) && amountOut > 0) {
        setDelivered(amountOut);
      }
      setStatus("done");
      notifyBalancesChanged();
      onArrivedRef.current();
    };

    const watchPrivy = async () => {
      try {
        const { waitForDeposit, waitForCompletion } = depositRef.current;
        const detected = await waitForDeposit({
          depositAddressId: quote.id,
          quoteCreatedAt: quote.createdAt,
          signal: ac.signal,
        });
        if (!alive || detected.status !== "success") return;
        if (detected.order.status === "refunded") {
          setError(
            "This deposit was refunded. Funds should return on the origin chain.",
          );
          return;
        }
        if (detected.order.status === "failed") {
          setError("This deposit could not be completed.");
          return;
        }
        const final = await waitForCompletion({
          orderId: detected.order.id,
          signal: ac.signal,
        });
        if (!alive || final.status !== "success") return;
        if (final.order.status === "completed") {
          const out = Number(final.order.destination_amount);
          if (baseline != null && Number.isFinite(out) && out > 0.4) {
            markArrived(out);
          }
          return;
        }
        if (final.order.status === "refunded") {
          setError(
            "This deposit was refunded. Funds should return on the origin chain.",
          );
        }
      } catch {
        /* cash balance below is the source of truth */
      }
    };

    const watchBalance = async () => {
      try {
        const res = await fetch(
          `/api/assets?address=${encodeURIComponent(dest)}`,
        );
        const data = (await res.json()) as {
          assets?: { symbol?: string; balance?: number }[];
        };
        const next = data.assets?.find((a) => a.symbol === "USDG")?.balance ?? 0;
        if (!alive) return;
        if (baseline == null) {
          baseline = next;
          return;
        }
        if (next > baseline + 0.4) markArrived(next - baseline);
      } catch {
        /* ignore */
      }
    };

    void watchPrivy();
    const id = window.setInterval(() => void watchBalance(), 4_000);
    void watchBalance();
    return () => {
      alive = false;
      ac.abort();
      window.clearInterval(id);
    };
  }, [quote, status]);

  const copy = async () => {
    if (!quote) return;
    await navigator.clipboard?.writeText(quote.depositAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const impact =
    quote?.rate != null ? Math.max(0, (1 - quote.rate) * 100) : 0;
  const qr = quote
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&bgcolor=111111&color=ffffff&qzone=2&format=png&data=${encodeURIComponent(quote.depositAddress)}`
    : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 animate-fade-in sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={root}
        className="relative z-10 flex max-h-[92dvh] w-full max-w-[420px] flex-col overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#161616] shadow-2xl animate-pop-in sm:rounded-[28px]"
      >
        <div className="flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-6">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18 9 12l6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="text-center">
            <h2 className="text-[17px] font-semibold">Transfer Crypto</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Cash: {fiat(cash)} USDG
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-7 pt-6 sm:px-8 sm:pb-8 sm:pt-7">
          {status === "done" ? (
            <div className="rounded-2xl bg-[#1b1b1b] px-5 py-10 text-center ring-1 ring-white/5">
              <p className="text-lg font-semibold">Cash arrived</p>
              <p className="mt-2 text-sm text-muted">
                {fiat(delivered ?? 0)} USDG is in your wallet.
              </p>
              <button
                type="button"
                onClick={onBack}
                className="mt-6 rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-black"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-2 text-[13px] font-semibold">Tokens</p>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenu(menu === "token" ? null : "token")}
                      className="flex h-12 w-full items-center gap-2.5 rounded-2xl bg-[#1b1b1b] px-3 ring-1 ring-white/10 transition hover:ring-white/20"
                    >
                      <img
                        src={USDC_LOGO}
                        alt=""
                        width={22}
                        height={22}
                        className="h-[22px] w-[22px] rounded-full"
                      />
                      <span className="min-w-0 flex-1 text-left text-sm font-semibold">
                        USDC
                      </span>
                      <Chevron open={menu === "token"} />
                    </button>
                    {menu === "token" ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-2xl bg-[#111] p-1.5 ring-1 ring-white/10">
                        <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
                          <img
                            src={USDC_LOGO}
                            alt=""
                            width={22}
                            height={22}
                            className="h-[22px] w-[22px] rounded-full"
                          />
                          <span className="text-sm font-semibold">USDC</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold">Chains</p>
                    <p className="text-[11px] text-muted">Min ${DEPOSIT_MIN_USD}</p>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenu(menu === "chain" ? null : "chain")}
                      className="flex h-12 w-full items-center gap-2.5 rounded-2xl bg-[#1b1b1b] px-3 ring-1 ring-white/10 transition hover:ring-white/20"
                    >
                      <ChainMark chain={chain} size={22} />
                      <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                        {chain.name}
                      </span>
                      <Chevron open={menu === "chain"} />
                    </button>
                    {menu === "chain" ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-56 overflow-y-auto rounded-2xl bg-[#111] p-1.5 ring-1 ring-white/10">
                        {DEPOSIT_CHAINS.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => {
                              setChain(row);
                              setMenu(null);
                            }}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition hover:bg-white/5 ${
                              row.id === chain.id ? "bg-white/5" : ""
                            }`}
                          >
                            <ChainMark chain={row} size={22} />
                            {row.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-center">
                <div className="relative rounded-[22px] bg-[#111] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/8">
                  {qr ? (
                    <>
                      <img
                        src={qr}
                        alt=""
                        width={200}
                        height={200}
                        className="h-[200px] w-[200px] rounded-xl"
                      />
                      <span className="pointer-events-none absolute inset-0 grid place-items-center">
                        <span className="grid h-11 w-11 place-items-center rounded-full bg-[#111] shadow-lg ring-4 ring-[#111]">
                          <ChainMark chain={chain} size={28} />
                        </span>
                      </span>
                    </>
                  ) : (
                    <div className="grid h-[200px] w-[200px] place-items-center rounded-xl bg-[#0c0c0c] text-sm text-muted">
                      {busy ? "Getting address…" : "No address yet"}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-8">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[13px] font-medium text-[#cfcfcf]">
                    Your deposit address
                  </p>
                  <a
                    href="/terms"
                    className="text-[12px] text-muted underline decoration-white/20 underline-offset-2 transition hover:text-white"
                  >
                    Terms apply
                  </a>
                </div>
                <div className="rounded-2xl bg-[#1b1b1b] px-4 py-3.5 ring-1 ring-white/10">
                  <p className="break-all font-mono text-[13px] leading-relaxed text-white/90">
                    {quote?.depositAddress ??
                      (busy ? "Generating…" : "Unavailable")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!quote}
                  onClick={() => void copy()}
                  className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#2a2a2a] text-sm font-semibold transition hover:bg-[#333] disabled:opacity-40"
                >
                  {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                  {copied ? "Copied" : "Copy address"}
                </button>
              </div>

              {error ? (
                <p className="mt-4 rounded-2xl bg-down/10 px-4 py-3 text-[13px] text-down">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => setDetails((v) => !v)}
                className="mt-6 flex w-full items-center gap-3 rounded-2xl bg-[#1b1b1b] px-4 py-3.5 text-left ring-1 ring-white/5"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white/5 text-[13px] font-semibold text-gold">
                  $
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-medium">
                  Price impact: {impact.toFixed(2)}%
                </span>
                <Chevron open={details} />
              </button>
              {details ? (
                <div className="mt-2 space-y-1.5 rounded-2xl bg-[#1b1b1b] px-4 py-3 text-[13px] text-muted ring-1 ring-white/5">
                  <p>Send USDC on {chain.name}.</p>
                  <p>You receive USDG on Robinhood Chain.</p>
                  {quote ? <p>Usually about {quote.minutes} min.</p> : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function resolveDepositChain(id: string) {
  return depositChainById(id);
}
