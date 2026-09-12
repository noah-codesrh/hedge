import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import {
  useAuthorizationSignature,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { requireAccessToken } from "../lib/privy-session";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { CheckIcon } from "./icons";
import { ConversionFlow } from "./ConversionFlow";
import { CollateralPicker } from "./CollateralPicker";
import {
  NATIVE_MAX_STAKE,
  NATIVE_MIN_STAKE,
  NATIVE_POOL_OPEN,
  NATIVE_TIMEFRAMES,
  POOL_REFUND_COPY,
  multipleIfWin,
  nativeBaseSlug,
  nativePhase,
  nativeTicketFromMarket,
  openNativeSlug,
  parseStake,
  payoutIfWin,
  displayImpliedP,
  sideLabel,
  stakeTimeframes,
  ticketCanRefund,
  timeframeFromSlug,
  type NativeMarketView,
  type NativeSide,
  type NativeTimeframe,
} from "../lib/native";
import { fiat, pct } from "../lib/format";
import { toUsdgRaw } from "../lib/leverage-chain";
import { poolIsLive } from "../lib/hedge-pool";
import {
  claimPool,
  refundPool,
  stakeOnPool,
  waitForPoolTicket,
  type PoolSendContext,
} from "../lib/pool-actions";
import { RH_EXPLORER, USDG, encodeErc20Transfer } from "../lib/robinhood";
import { sponsoredTokenSend } from "../lib/sponsored-send";
import { NativeTicketCard } from "./NativeTickets";
import { poolTokenPath } from "../lib/native-tokens";
import {
  findWallet,
  isEmbeddedWallet,
  primaryWalletAddress,
  robinhoodProvider,
  useEnsureCashWallet,
} from "../lib/wallet";
import {
  formatStockQty,
  readStockHoldings,
  stockToNumber,
  type StockHolding,
} from "../lib/stock-collateral";
import type { StockToken } from "../lib/stock-tokens";

type Mine = {
  id?: string;
  side: NativeSide;
  amount: number;
  payout: number;
  payoutTx?: string | null;
  txHash?: string | null;
  created_at?: string | null;
} | null;

type Pending = {
  hash: string;
  side: NativeSide;
  amount: number;
  wallet: string;
};

function pendingKey(slug: string) {
  return `hedge-native-pending:${slug}`;
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function readPending(slug: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pending;
    if (!parsed?.wallet || !(parsed.amount > 0)) return null;
    if (!parsed.hash) parsed.hash = "onchain";
    return parsed;
  } catch {
    return null;
  }
}

function writePending(slug: string, pending: Pending | null) {
  try {
    if (!pending) sessionStorage.removeItem(pendingKey(slug));
    else sessionStorage.setItem(pendingKey(slug), JSON.stringify(pending));
  } catch {
    /* private mode */
  }
}

function TicketInOverlay({
  market,
  receipt,
  onClose,
}: {
  market: NativeMarketView;
  receipt: NonNullable<Mine>;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"check" | "card">("check");
  useEffect(() => {
    const timer = window.setTimeout(() => setStage("card"), 750);
    return () => window.clearTimeout(timer);
  }, []);
  const side = sideLabel(
    market.kind,
    receipt.side,
    market.token_a,
    market.token_b,
  );
  const ticket = nativeTicketFromMarket(market, {
    ...receipt,
    created_at: receipt.created_at ?? new Date().toISOString(),
  });
  const node = (
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[440px] overflow-hidden rounded-t-[28px] bg-[#1a1a1a] shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/10 sm:rounded-[28px]">
        {stage === "check" ? (
          <div className="px-6 pb-8 pt-8 text-center animate-pop-in">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#1f6f43] text-white">
              <CheckIcon size={28} />
            </div>
            <h2 className="mt-4 text-xl font-bold tracking-tight">Ticket in</h2>
            <p className="mt-1 text-[15px] tabular-nums text-muted">
              {fiat(receipt.amount)} on {side}
            </p>
          </div>
        ) : (
          <div className="px-5 pb-7 pt-5 animate-card-in">
            <h2 className="text-xl font-bold tracking-tight">Ticket in</h2>
            <div className="mt-4">
              <NativeTicketCard ticket={ticket} />
            </div>
            <div className="mt-5 grid gap-2">
              {receipt.txHash ? (
                <a
                  href={`${RH_EXPLORER}/tx/${receipt.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-white/5 py-3 text-center text-sm font-semibold"
                >
                  View on explorer
                </a>
              ) : null}
              <Link
                to="/pool"
                className="rounded-full bg-white/5 py-3 text-center text-sm font-semibold"
                onClick={onClose}
              >
                Take another race
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-gold py-3.5 text-sm font-semibold text-black"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}

function windowHref(market: NativeMarketView, timeframe: NativeTimeframe) {
  if (market.kind === "strike") {
    return poolTokenPath(market.token_a, { tf: timeframe });
  }
  const slug = openNativeSlug(nativeBaseSlug(market.slug), timeframe);
  return slug ? `/pool/${slug}` : null;
}

async function authed<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) throw new Error(data?.error ?? "Request failed.");
  return data as T;
}

export function NativeStake({
  market,
  tracked,
  mine,
  escrowWallet,
  payoutLive,
  initialSide = "a",
}: {
  market: NativeMarketView;
  tracked: boolean;
  mine: Mine;
  escrowWallet?: string | null;
  payoutLive?: boolean;
  initialSide?: NativeSide;
}) {
  const privyMounted = usePrivyMounted();
  if (!privyMounted) {
    return <StakeCopy market={market} mine={mine} />;
  }
  return (
    <NativeStakeInner
      market={market}
      tracked={tracked}
      mine={mine}
      escrowWallet={escrowWallet}
      payoutLive={payoutLive}
      initialSide={initialSide}
    />
  );
}

function StakeCopy({
  market,
  mine,
}: {
  market: NativeMarketView;
  mine: Mine;
}) {
  const a = sideLabel(market.kind, "a", market.token_a, market.token_b);
  const b = sideLabel(market.kind, "b", market.token_a, market.token_b);
  const phase = nativePhase(market);
  const pA = displayImpliedP(market);
  return (
    <div className="rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-gold">
        {phase === "open" ? "Place a ticket" : phase}
      </p>
      <p className="mt-2 text-sm text-muted">
        $1–${NATIVE_MAX_STAKE} USDG, or listed stock sold into USDG. One ticket.
        Odds {a} {pct(pA)} · {b} {pct(1 - pA)}. The desk takes the other side.
        Win and the treasury pays. Lose and the ticket is liquidated.
      </p>
      <p className="mt-2 text-sm text-muted">{POOL_REFUND_COPY}</p>
      {mine ? (
        <div className="mt-4">
          <NativeTicketCard
            ticket={nativeTicketFromMarket(market, mine)}
          />
        </div>
      ) : null}
    </div>
  );
}

function NativeStakeInner({
  market,
  tracked,
  mine: initialMine,
  escrowWallet,
  payoutLive,
  initialSide,
}: {
  market: NativeMarketView;
  tracked: boolean;
  mine: Mine;
  escrowWallet?: string | null;
  payoutLive?: boolean;
  initialSide: NativeSide;
}) {
  const { authenticated, getAccessToken, user } = usePrivy();
  const { wallets } = useWallets();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { openModal } = useAuthModal();
  const { cashAddress, ensureCashWallet } = useEnsureCashWallet();
  const cashWallet = findWallet(wallets, cashAddress);
  const [side, setSide] = useState<NativeSide>(initialSide);
  const [amount, setAmount] = useState(String(NATIVE_MAX_STAKE));
  const [collateral, setCollateral] = useState<StockToken | null>(null);
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refunded, setRefunded] = useState<string | null>(null);
  const [mine, setMine] = useState(initialMine);
  const [pending, setPending] = useState<Pending | null>(null);
  const [receipt, setReceipt] = useState<Mine>(null);
  const pendingTried = useRef<string | null>(null);
  const syncTried = useRef(false);
  const phase = nativePhase(market);

  async function poolSend(): Promise<PoolSendContext> {
    const token = await requireAccessToken(getAccessToken);
    if (!token) throw new Error("Sign in again.");
    const signer = (await ensureCashWallet()) ?? cashWallet;
    const from = signer?.address ?? primaryWalletAddress(user, wallets);
    if (!from || !signer) {
      throw new Error("Connect the wallet that holds this ticket.");
    }
    return {
      accessToken: token,
      from,
      wallet: signer,
      signAuthorization: async (payload) => {
        const { signature } = await generateAuthorizationSignature(payload);
        if (!signature) throw new Error("Could not authorize this wallet.");
        return signature;
      },
    };
  }

  useEffect(() => {
    if (!cashAddress) return;
    let alive = true;
    const load = () => {
      void readStockHoldings(cashAddress).then((next) => {
        if (alive) setHoldings(next);
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    window.addEventListener("hedge:positions", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("hedge:positions", load);
    };
  }, [cashAddress]);

  const stockRow = collateral
    ? holdings.find(
        (h) =>
          h.token.address.toLowerCase() === collateral.address.toLowerCase(),
      )
    : null;
  const stockAvail = stockRow
    ? stockToNumber(stockRow.wallet + stockRow.free, stockRow.token.decimals)
    : 0;
  const stockMark = stockRow ? Number(stockRow.markUsd6) / 1e6 : 0;
  const usingStock = collateral != null;
  const qty = Number(amount) || 0;
  const stakePreview = usingStock
    ? Math.min(
        NATIVE_MAX_STAKE,
        Math.max(0, stockMark > 0 ? qty * stockMark : 0),
      )
    : qty;

  useEffect(() => {
    setPending(readPending(market.slug));
  }, [market.slug]);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    void (async () => {
      const token = await requireAccessToken(getAccessToken);
      if (!token || cancelled) return;
      const data = await authed<{ mine: Mine }>(
        token,
        `/api/native/${market.slug}`,
      );
      if (data.mine) {
        setMine(data.mine);
        writePending(market.slug, null);
        setPending(null);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authenticated, getAccessToken, market.slug]);
  const a = sideLabel(market.kind, "a", market.token_a, market.token_b);
  const b = sideLabel(market.kind, "b", market.token_a, market.token_b);
  const pA = displayImpliedP(market);
  const extra = market.protocolBoost ?? 0;
  const preview = payoutIfWin(
    stakePreview,
    side === "a" ? market.poolA + stakePreview : market.poolA,
    side === "b" ? market.poolB + stakePreview : market.poolB,
    extra,
  );

  const booked = (
    result: { amount: number; side: NativeSide; txHash?: string | null },
    opts?: { silent?: boolean },
  ) => {
    const next: NonNullable<Mine> = {
      side: result.side,
      amount: result.amount,
      payout: payoutIfWin(
        result.amount,
        result.side === "a" ? market.poolA + result.amount : market.poolA,
        result.side === "b" ? market.poolB + result.amount : market.poolB,
        extra,
      ),
      txHash: result.txHash ?? null,
      created_at: new Date().toISOString(),
    };
    setMine(next);
    setError(null);
    if (!opts?.silent) setReceipt(next);
    writePending(market.slug, null);
    setPending(null);
    window.dispatchEvent(new Event("native-ticket"));
  };

  const record = async (ticket: Pending, opts?: { silent?: boolean }) => {
    const token = await requireAccessToken(getAccessToken);
    if (!token) throw new Error("Sign in again.");
    const hash = TX_HASH.test(ticket.hash) ? ticket.hash : "";
    const result = hash
      ? await authed<{
          amount: number;
          side: NativeSide;
          txHash?: string;
        }>(token, "/api/native/stake", {
          method: "POST",
          body: JSON.stringify({
            slug: market.slug,
            side: ticket.side,
            amount: ticket.amount,
            wallet: ticket.wallet,
            txHash: hash,
          }),
        })
      : await authed<{
          amount: number;
          side: NativeSide;
          txHash?: string | null;
        }>(token, "/api/native/sync", {
          method: "POST",
          body: JSON.stringify({
            slug: market.slug,
            wallet: ticket.wallet,
          }),
        });
    booked(result, { silent: opts?.silent });
  };

  useEffect(() => {
    pendingTried.current = null;
    syncTried.current = false;
  }, [market.slug]);

  useEffect(() => {
    if (!authenticated || mine || !pending) return;
    if (pendingTried.current === pending.hash) return;
    pendingTried.current = pending.hash;
    void record(pending).catch(() => {});
  }, [authenticated, mine, pending]);

  useEffect(() => {
    if (!authenticated || mine || !poolIsLive || !NATIVE_POOL_OPEN) return;
    if (syncTried.current) return;
    const wallet =
      cashAddress ?? primaryWalletAddress(user, wallets);
    if (!wallet) return;
    syncTried.current = true;
    let alive = true;
    void (async () => {
      const token = await requireAccessToken(getAccessToken);
      if (!token || !alive) return;
      try {
        const result = await authed<{
          amount: number;
          side: NativeSide;
          txHash?: string | null;
        }>(token, "/api/native/sync", {
          method: "POST",
          body: JSON.stringify({ slug: market.slug, wallet }),
        });
        if (!alive) return;
        booked(result, { silent: true });
      } catch {
        /* no ticket on chain */
      }
    })();
    return () => {
      alive = false;
    };
  }, [authenticated, mine, cashAddress, user, wallets, market.slug]);

  const place = async () => {
    setError(null);
    setSaving(true);
    setStatus("Opening the card");
    const timeout = window.setTimeout(() => {
      setError("That took too long. Check your wallet prompt and try again.");
      setSaving(false);
      setStatus(null);
    }, 60_000);
    let from = "";
    let qty = 0;
    try {
      if (!NATIVE_POOL_OPEN || !escrowWallet) {
        throw new Error("Pool is under maintenance.");
      }
      const token = await requireAccessToken(getAccessToken);
      if (!token) throw new Error("Sign in again.");
      const signer = cashWallet ?? (await ensureCashWallet());
      from = signer?.address ?? primaryWalletAddress(user, wallets) ?? "";
      if (!from || !signer) throw new Error("Connect a wallet that holds USDG.");
      qty = Number(amount);
      if (collateral) {
        setStatus(`Selling ${collateral.symbol}`);
        if (qty <= 0) throw new Error("Enter an amount first.");
        const { convertStockToCash } = await import("../lib/stock-to-cash");
        const swapped = await convertStockToCash({
          accessToken: token,
          wallet: signer,
          address: from,
          token: collateral,
          amount: qty,
          holding: stockRow,
          signAuthorization: async (payload) => {
            const { signature } = await generateAuthorizationSignature(payload);
            if (!signature) throw new Error("Could not authorize this wallet.");
            return signature;
          },
        });
        qty = Math.min(NATIVE_MAX_STAKE, swapped.usdg);
        if (qty < NATIVE_MIN_STAKE) {
          throw new Error(
            `That swap left ${fiat(swapped.usdg)} USDG. Tickets are ${fiat(NATIVE_MIN_STAKE)}–${fiat(NATIVE_MAX_STAKE)}.`,
          );
        }
      } else {
        const parsed = parseStake(qty);
        if (!parsed) {
          throw new Error(
            `Tickets are ${fiat(NATIVE_MIN_STAKE)}–${fiat(NATIVE_MAX_STAKE)}.`,
          );
        }
        qty = parsed;
      }
      const raw = toUsdgRaw(qty);
      if (raw <= 0n) throw new Error("Enter a stake.");
      if (poolIsLive) {
        setStatus("Opening the card");
        try {
          await authed(token, "/api/native/prepare", {
            method: "POST",
            body: JSON.stringify({ slug: market.slug }),
            signal: AbortSignal.timeout(20_000),
          });
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          if (/aborted|timed out|timeout/i.test(text)) {
            throw new Error("Could not open this card on chain. Try again.");
          }
          throw err;
        }
      }
      const signAuthorization = async (
        payload: Parameters<typeof generateAuthorizationSignature>[0],
      ) => {
        setStatus("Confirm in your wallet");
        const { signature } = await generateAuthorizationSignature(payload);
        if (!signature) throw new Error("Could not authorize this wallet.");
        return signature;
      };
      let hash: string | null = null;
      if (poolIsLive) {
        setStatus("Staking on chain");
        hash = await stakeOnPool(
          {
            accessToken: token,
            from,
            wallet: signer,
            signAuthorization,
          },
          { slug: market.slug, side, amount: qty },
        );
      } else {
        setStatus("Sending USDG");
        const data = encodeErc20Transfer(escrowWallet, raw);
        const wallet = signer;
        if (wallet && !isEmbeddedWallet(wallet.walletClientType)) {
          const provider = await robinhoodProvider(wallet);
          hash = (await provider.request({
            method: "eth_sendTransaction",
            params: [{ from, to: USDG, data }],
          })) as string;
        } else {
          hash = await sponsoredTokenSend({
            accessToken: token,
            from,
            token: USDG,
            data,
            signAuthorization,
          });
        }
      }
      if (!hash && poolIsLive) {
        setStatus("Confirming ticket");
        const landed = await waitForPoolTicket({
          wallet: from,
          slug: market.slug,
          side,
          amount: qty,
        });
        if (!landed) {
          throw new Error(
            "Could not confirm that ticket. Check Your tickets in a moment.",
          );
        }
      } else if (!hash) {
        throw new Error("Stake transaction did not return a hash.");
      }
      const saved: Pending = {
        hash: hash || "onchain",
        side,
        amount: qty,
        wallet: from,
      };
      writePending(market.slug, saved);
      booked({ amount: qty, side, txHash: hash || null });
      void record(saved, { silent: true }).catch(() => {});
    } catch (err) {
      const text =
        err instanceof Error ? err.message : "Could not place that ticket.";
      if (poolIsLive && from && qty > 0 && /One ticket per wallet/i.test(text)) {
        try {
          const saved: Pending = {
            hash: "onchain",
            side,
            amount: qty,
            wallet: from,
          };
          await record(saved, { silent: true });
          return;
        } catch {
          /* still missing on chain */
        }
      }
      setError(text);
    } finally {
      window.clearTimeout(timeout);
      setSaving(false);
      setStatus(null);
    }
  };

  return (
    <div className="rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-gold">
        {phase === "open" ? "Place a ticket" : phase}
      </p>
      {!NATIVE_POOL_OPEN || !escrowWallet || !payoutLive ? (
        <p className="mt-3 text-sm text-gold">Pool is under maintenance.</p>
      ) : null}
      <p className="mt-3 text-sm text-muted">{POOL_REFUND_COPY}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {stakeTimeframes(market).map((id) => {
          const href = windowHref(market, id);
          const active =
            (market.timeframe ?? timeframeFromSlug(market.slug)) === id;
          const label =
            NATIVE_TIMEFRAMES.find((row) => row.id === id)?.label ?? id;
          if (!href) return null;
          return (
            <Link
              key={id}
              to={href}
              prefetch="intent"
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                active
                  ? "bg-gold text-black"
                  : "border border-white/10 text-muted hover:text-white"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("a")}
          disabled={phase !== "open"}
          className={`rounded-2xl border px-3 py-3 text-left ${
            side === "a"
              ? "border-up/60 bg-up/10"
              : "border-white/10 bg-[#0f0f0f]"
          }`}
        >
          <p className="text-[11px] uppercase tracking-wide text-muted">{a}</p>
          <p className="mt-1 text-lg font-semibold text-up">
            {pct(pA)}
          </p>
          <p className="text-[12px] text-muted">
            {multipleIfWin(market.poolA, market.poolB, extra).toFixed(2)}x ·{" "}
            {fiat(market.poolA)}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setSide("b")}
          disabled={phase !== "open"}
          className={`rounded-2xl border px-3 py-3 text-left ${
            side === "b"
              ? "border-down/60 bg-down/10"
              : "border-white/10 bg-[#0f0f0f]"
          }`}
        >
          <p className="text-[11px] uppercase tracking-wide text-muted">{b}</p>
          <p className="mt-1 text-lg font-semibold text-down">
            {pct(1 - pA)}
          </p>
          <p className="text-[12px] text-muted">
            {multipleIfWin(market.poolB, market.poolA, extra).toFixed(2)}x ·{" "}
            {fiat(market.poolB)}
          </p>
        </button>
      </div>

      {mine ? (
        <div className="mt-4">
          <NativeTicketCard
            ticket={nativeTicketFromMarket(market, mine)}
            onClaim={
              poolIsLive &&
              !mine.payoutTx &&
              (market.resolved_side === "void" ||
                market.resolved_side === mine.side)
                ? () => {
                    setError(null);
                    setSaving(true);
                    void (async () => {
                      const ctx = await poolSend();
                      await claimPool(ctx, market.slug);
                      setMine({ ...mine, payoutTx: "claimed" });
                    })()
                      .catch((err) =>
                        setError(
                          err instanceof Error ? err.message : "Could not claim.",
                        ),
                      )
                      .finally(() => setSaving(false));
                  }
                : undefined
            }
            onRefund={
              poolIsLive &&
              ticketCanRefund(nativeTicketFromMarket(market, mine))
                ? () => {
                    setError(null);
                    setRefunded(null);
                    setSaving(true);
                    const refundedAmount = mine.amount;
                    void (async () => {
                      const ctx = await poolSend();
                      let hash = "";
                      try {
                        hash = await refundPool(ctx, market.slug);
                      } catch (err) {
                        const text = err instanceof Error ? err.message : "";
                        if (!/No ticket/i.test(text)) throw err;
                      }
                      const token = await requireAccessToken(getAccessToken);
                      if (!token) throw new Error("Sign in again.");
                      const res = await fetch("/api/native/refund", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                          slug: market.slug,
                          wallet: ctx.from,
                          txHash: hash,
                        }),
                      });
                      const data = (await res.json().catch(() => null)) as {
                        error?: string;
                      } | null;
                      if (!res.ok) {
                        throw new Error(data?.error ?? "Could not record that refund.");
                      }
                      setMine(null);
                      setRefunded(
                        `Refunded ${fiat(refundedAmount)}. The stake is back in your cash wallet.`,
                      );
                      window.dispatchEvent(new Event("native-ticket"));
                    })()
                      .catch((err) =>
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Could not refund.",
                        ),
                      )
                      .finally(() => setSaving(false));
                  }
                : undefined
            }
          />
        </div>
      ) : null}

      <CollateralPicker
        selected={collateral}
        holdings={holdings}
        onSelect={(next) => {
          setCollateral(next);
          setAmount(next ? "" : String(NATIVE_MAX_STAKE));
        }}
        kind="pool"
      />
      <label className="mt-4 block text-[12px] font-medium text-muted">
        {usingStock ? `Stake (${collateral.symbol})` : "Stake (USDG)"}
      </label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        className="mt-1.5 w-full rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3 outline-none focus:border-gold/60"
      />
      <p className="mt-2 text-[12px] text-muted">
        {usingStock
          ? stockAvail <= 0
            ? `No ${collateral.symbol} in this wallet.`
            : `Up to ${formatStockQty(stockAvail)} ${collateral.symbol}${
                stakePreview > 0
                  ? ` · ~${fiat(stakePreview)} USDG ticket`
                  : ""
              }. `
          : ""}
        If {side === "a" ? a : b} hits, this ticket pays about {fiat(preview)}.
        Winnings pay USDG.
      </p>
      {pending ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSaving(true);
            void record(pending)
              .catch((err) =>
                setError(
                  err instanceof Error
                    ? err.message
                    : "Could not record that ticket.",
                ),
              )
              .finally(() => setSaving(false));
          }}
          disabled={saving}
          className="mt-4 w-full rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {saving ? "Confirming on chain" : "Confirm on-chain ticket"}
        </button>
      ) : !authenticated ? (
        <button
          type="button"
          onClick={openModal}
          className="mt-4 w-full rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black"
        >
          Sign in to stake
        </button>
      ) : mine ? (
        <Link
          to="/pool"
          className="mt-4 block w-full rounded-full bg-gold px-5 py-2.5 text-center text-sm font-semibold text-black"
        >
          Take another race
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => void place()}
          disabled={
            saving ||
            !NATIVE_POOL_OPEN ||
            phase !== "open" ||
            !tracked ||
            !escrowWallet ||
            (usingStock
              ? qty <= 0 || stockAvail < qty
              : parseStake(qty) == null)
          }
          className="mt-4 w-full rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {saving
            ? status ?? "Staking on chain"
            : usingStock
              ? `Stake ${side === "a" ? a : b} with ${collateral.symbol}`
              : `Stake ${side === "a" ? a : b}`}
        </button>
      )}
      {refunded ? <p className="mt-2 text-sm text-up">{refunded}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      {saving && !receipt ? (
        <ConversionFlow
          mode="stake"
          amount={`${fiat(stakePreview || Number(amount) || 0)} on ${side === "a" ? a : b}`}
          step={
            status?.startsWith("Selling")
              ? "swap"
              : status === "Staking on chain"
                ? "fill"
                : "setup"
          }
          error={null}
          onDismiss={() => {}}
        />
      ) : null}
      {receipt ? (
        <TicketInOverlay
          market={market}
          receipt={receipt}
          onClose={() => setReceipt(null)}
        />
      ) : null}
    </div>
  );
}
