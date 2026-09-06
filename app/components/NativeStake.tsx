import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  useAuthorizationSignature,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { CheckIcon } from "./icons";
import { ModalShell } from "./ModalShell";
import { CollateralPicker } from "./CollateralPicker";
import {
  NATIVE_MAX_STAKE,
  NATIVE_MIN_STAKE,
  NATIVE_USER_CAP,
  multipleIfWin,
  nativePhase,
  payoutIfWin,
  sideLabel,
  tapeImpliedP,
  type NativeMarketView,
  type NativeSide,
} from "../lib/native";
import { fiat, pct } from "../lib/format";
import { waitForTx, toUsdgRaw } from "../lib/leverage-chain";
import { RH_EXPLORER, USDG, encodeErc20Transfer } from "../lib/robinhood";
import { sponsoredTokenSend } from "../lib/sponsored-send";
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
  side: NativeSide;
  amount: number;
  payout: number;
  payoutTx?: string | null;
  txHash?: string | null;
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

function readPending(slug: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pending;
    if (!parsed?.hash || !parsed.wallet) return null;
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
  const pA = tapeImpliedP(market);
  return (
    <div className="rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-gold">
        {phase === "open" ? "Place a ticket" : phase}
      </p>
      <p className="mt-2 text-sm text-muted">
        $1–${NATIVE_MAX_STAKE} USDG, or listed stock sold into USDG. One ticket.
        Live tape {a} {pct(pA)} · {b} {pct(1 - pA)}. Pools pay USDG.
      </p>
      {mine ? (
        <p className="mt-3 text-sm text-white">
          You are on {sideLabel(market.kind, mine.side, market.token_a, market.token_b)}{" "}
          for {fiat(mine.amount)}.
        </p>
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
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(initialMine);
  const [pending, setPending] = useState<Pending | null>(null);
  const [receipt, setReceipt] = useState<Mine>(null);
  const [recoverHash, setRecoverHash] = useState("");
  const phase = nativePhase(market);

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
    void (async () => {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
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
  }, [authenticated, getAccessToken, market.slug]);
  const a = sideLabel(market.kind, "a", market.token_a, market.token_b);
  const b = sideLabel(market.kind, "b", market.token_a, market.token_b);
  const pA = tapeImpliedP(market);
  const preview = payoutIfWin(
    stakePreview,
    side === "a" ? market.poolA + stakePreview : market.poolA,
    side === "b" ? market.poolB + stakePreview : market.poolB,
  );

  const booked = (
    result: { amount: number; side: NativeSide; txHash?: string },
  ) => {
    const next: NonNullable<Mine> = {
      side: result.side,
      amount: result.amount,
      payout: payoutIfWin(
        result.amount,
        result.side === "a" ? market.poolA + result.amount : market.poolA,
        result.side === "b" ? market.poolB + result.amount : market.poolB,
      ),
      txHash: result.txHash ?? null,
    };
    setMine(next);
    setReceipt(next);
    writePending(market.slug, null);
    setPending(null);
    window.dispatchEvent(new Event("native-ticket"));
  };

  const record = async (ticket: Pending) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in again.");
    const result = await authed<{
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
        txHash: ticket.hash,
      }),
    });
    booked(result);
  };

  const place = async () => {
    setError(null);
    setSaving(true);
    try {
      if (!escrowWallet) {
        throw new Error("Pool is under maintenance.");
      }
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again.");
      const signer = (await ensureCashWallet()) ?? cashWallet;
      const from = signer?.address ?? primaryWalletAddress(user, wallets);
      if (!from || !signer) throw new Error("Connect a wallet that holds USDG.");
      let qty = Number(amount);
      if (collateral) {
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
      }
      const raw = toUsdgRaw(qty);
      if (raw <= 0n) throw new Error("Enter a stake.");
      const data = encodeErc20Transfer(escrowWallet, raw);
      const wallet = signer;
      let hash: string | null = null;
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
          signAuthorization: async (payload) => {
            const { signature } = await generateAuthorizationSignature(payload);
            if (!signature) throw new Error("Could not authorize this wallet.");
            return signature;
          },
        });
      }
      if (!hash) throw new Error("Stake transaction did not return a hash.");
      await waitForTx(hash);
      const saved: Pending = { hash, side, amount: qty, wallet: from };
      writePending(market.slug, saved);
      setPending(saved);
      await record(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place that ticket.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-gold">
        {phase === "open" ? "Place a ticket" : phase}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        USDG in, USDG out. You can sell NVDA, SPCX, AAPL, GME, or TSLA into
        the ticket. Odds are the live Dexscreener tape. The pools still pay.
        Desk cap {fiat(NATIVE_USER_CAP)}. Ticket cap {fiat(NATIVE_MAX_STAKE)}.
        One ticket per wallet. At expiry the tape settles and winners are paid
        USDG.
      </p>
      {!escrowWallet || !payoutLive ? (
        <p className="mt-3 text-sm text-gold">Pool is under maintenance.</p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("a")}
          disabled={Boolean(mine) || phase !== "open"}
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
            {multipleIfWin(market.poolA, market.poolB).toFixed(2)}x ·{" "}
            {fiat(market.poolA)}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setSide("b")}
          disabled={Boolean(mine) || phase !== "open"}
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
            {multipleIfWin(market.poolB, market.poolA).toFixed(2)}x ·{" "}
            {fiat(market.poolB)}
          </p>
        </button>
      </div>

      {mine ? (
        <p className="mt-4 rounded-2xl bg-[#0f0f0f] px-4 py-3 text-sm">
          You are on{" "}
          <span className="font-semibold">
            {sideLabel(market.kind, mine.side, market.token_a, market.token_b)}
          </span>{" "}
          for {fiat(mine.amount)}. If this side hits, about {fiat(mine.payout)}.
          {mine.txHash ? (
            <>
              {" "}
              <a
                href={`${RH_EXPLORER}/tx/${mine.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-gold hover:underline"
              >
                View tx
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <>
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
              {saving ? "Recording ticket" : "Record ticket (USDG already sent)"}
            </button>
          ) : !authenticated ? (
            <button
              type="button"
              onClick={openModal}
              className="mt-4 w-full rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black"
            >
              Sign in to stake
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void place()}
              disabled={
                saving ||
                phase !== "open" ||
                !tracked ||
                !escrowWallet ||
                (usingStock && (qty <= 0 || stockAvail < qty))
              }
              className="mt-4 w-full rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
            >
              {saving
                ? usingStock
                  ? `Selling ${collateral.symbol}`
                  : "Sending USDG"
                : usingStock
                  ? `Stake ${side === "a" ? a : b} with ${collateral.symbol}`
                  : `Stake ${side === "a" ? a : b}`}
            </button>
          )}
        </>
      )}
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      {!mine ? (
        <div className="mt-4 rounded-2xl bg-[#0f0f0f] px-4 py-3">
          <p className="text-[12px] text-muted">
            USDG already sent? Paste the tx hash to record the ticket without
            sending again.
          </p>
          <input
            value={recoverHash}
            onChange={(e) => setRecoverHash(e.target.value)}
            placeholder="0x…"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#161616] px-3 py-2 font-mono text-[12px] outline-none focus:border-gold/60"
          />
          <button
            type="button"
            onClick={() => {
              const from = primaryWalletAddress(user, wallets);
              const hash = recoverHash.trim();
              const qty = Number(amount);
              if (collateral) {
                setError("Switch to USDG to record a cash ticket.");
                return;
              }
              if (!from || !hash) {
                setError("Paste the stake transaction hash.");
                return;
              }
              setError(null);
              setSaving(true);
              const saved: Pending = { hash, side, amount: qty, wallet: from };
              writePending(market.slug, saved);
              setPending(saved);
              void record(saved)
                .catch((err) =>
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Could not record that ticket.",
                  ),
                )
                .finally(() => setSaving(false));
            }}
            disabled={saving || !recoverHash.trim()}
            className="mt-2 w-full rounded-full border border-white/15 px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
          >
            Record existing tx
          </button>
        </div>
      ) : null}
      {receipt ? (
        <ModalShell onClose={() => setReceipt(null)}>
          <div className="text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#1f6f43] text-white">
              <CheckIcon size={28} />
            </div>
            <h2 className="mt-4 text-xl font-bold tracking-tight">Ticket in</h2>
            <p className="mt-1 text-[15px] tabular-nums text-muted">
              {fiat(receipt.amount)} on{" "}
              {sideLabel(
                market.kind,
                receipt.side,
                market.token_a,
                market.token_b,
              )}
            </p>
            <p className="mt-3 text-sm text-muted">
              If this side hits, about {fiat(receipt.payout)}. Paid at expiry.
            </p>
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
              to="/pool#tickets"
              className="rounded-full bg-white/5 py-3 text-center text-sm font-semibold"
              onClick={() => setReceipt(null)}
            >
              View tickets
            </Link>
            <button
              type="button"
              onClick={() => setReceipt(null)}
              className="rounded-full bg-gold py-3.5 text-sm font-semibold text-black"
            >
              Done
            </button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
