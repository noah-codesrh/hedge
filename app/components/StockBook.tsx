import { useCallback, useEffect, useState } from "react";
import { useAuthorizationSignature, usePrivy } from "@privy-io/react-auth";
import { fiat } from "../lib/format";
import { notifyBalancesChanged, watchBalanceReloads } from "../lib/positions";
import {
  depositStock,
  formatStockQty,
  quoteStockMarginLocal,
  readDeskState,
  readStockHoldings,
  stockToNumber,
  withdrawStock,
  type DeskState,
  type StockHolding,
} from "../lib/stock-collateral";
import {
  STOCK_TOKENS,
  stockCollateralIsLive,
  type StockToken,
} from "../lib/stock-tokens";
import { useEnsureCashWallet } from "../lib/wallet";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { DiamondIcon } from "./icons";

function markUsd(holding: StockHolding) {
  return Number(holding.markUsd6) / 1e6;
}

export function StockBook() {
  const privyReady = usePrivyMounted();
  return (
    <section className="rounded-[1.75rem] bg-card ring-1 ring-white/5">
      <div className="px-5 pt-6 pb-4 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold">
            <DiamondIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Stock liquidity</p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">
              Deposit NVDA, SPCX, AAPL, GME, or TSLA. Same token out. Use it as
              margin on leveraged trades without selling the name.
            </p>
          </div>
        </div>
      </div>
      {privyReady ? <StockBookInner /> : <StockBookGuest />}
    </section>
  );
}

function StockBookGuest() {
  const { openModal } = useAuthModal();
  return (
    <div className="border-t border-white/5 px-5 py-5 sm:px-6">
      <TokenRow holdings={STOCK_TOKENS.map((token) => ({ token }))} />
      <p className="mt-4 text-[13px] text-muted">
        {stockCollateralIsLive
          ? "Connect to deposit stock into the book."
          : "Holdings show once you connect. Deposits open when the desk is live."}
      </p>
      <button
        type="button"
        onClick={openModal}
        className="mt-4 w-full rounded-full bg-gold py-3.5 text-[15px] font-semibold text-black transition hover:bg-gold/90"
      >
        Connect
      </button>
    </div>
  );
}

function StockBookInner() {
  const { authenticated, getAccessToken } = usePrivy();
  const { openModal } = useAuthModal();
  const { cashAddress, ensureCashWallet } = useEnsureCashWallet();
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [desk, setDesk] = useState<DeskState | null>(null);
  const [picked, setPicked] = useState<StockToken>(STOCK_TOKENS[0]!);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [next, state] = await Promise.all([
      cashAddress ? readStockHoldings(cashAddress) : Promise.resolve([]),
      readDeskState(),
    ]);
    setHoldings(next);
    setDesk(state);
  }, [cashAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return watchBalanceReloads(() => void load());
  }, [load]);

  const row = holdings.find(
    (h) => h.token.address.toLowerCase() === picked.address.toLowerCase(),
  );
  const wallet = row ? stockToNumber(row.wallet, picked.decimals) : 0;
  const free = row ? stockToNumber(row.free, picked.decimals) : 0;
  const locked = row ? stockToNumber(row.locked, picked.decimals) : 0;
  const deposited = row ? stockToNumber(row.deposited, picked.decimals) : 0;
  const mark = row ? markUsd(row) : 0;
  const haircut = desk?.haircutBps ?? 3_000;
  const value = Number(amount);
  const max = mode === "deposit" ? wallet : free;
  const valid = Number.isFinite(value) && value > 0 && value <= max + 1e-12;
  const quote =
    mode === "deposit" && row && value > 0
      ? quoteStockMarginLocal(value, row.markUsd6, haircut)
      : null;

  const submit = async () => {
    if (!authenticated) return openModal();
    if (!stockCollateralIsLive) return;
    if (!valid || busy) return;

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Session expired. Sign in again.");
      const cashWallet = await ensureCashWallet();
      if (!cashWallet?.address) throw new Error("Your wallet isn't ready yet.");

      const ctx = {
        accessToken,
        from: cashWallet.address,
        wallet: cashWallet,
        signAuthorization: async (
          payload: Parameters<typeof generateAuthorizationSignature>[0],
        ) => {
          const { signature } = await generateAuthorizationSignature(payload);
          if (!signature) throw new Error("Could not authorize this wallet.");
          return signature;
        },
      };

      const qty = amount.trim();
      if (mode === "deposit") {
        await depositStock(ctx, picked.address, qty, picked.decimals);
        setDone(`Deposited ${qty} ${picked.symbol}.`);
      } else {
        await withdrawStock(ctx, picked.address, qty, picked.decimals);
        setDone(`Withdrew ${qty} ${picked.symbol}.`);
      }
      setAmount("");
      notifyBalancesChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-white/5 px-5 py-5 sm:px-6">
      <TokenRow
        holdings={STOCK_TOKENS.map((token) => {
          const h = holdings.find(
            (row) => row.token.address.toLowerCase() === token.address.toLowerCase(),
          );
          return { token, holding: h };
        })}
        selected={picked.address}
        onSelect={(token) => {
          setPicked(token);
          setAmount("");
          setError(null);
          setDone(null);
        }}
      />

      <dl className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
        <div>
          <dt className="text-muted">Wallet</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {formatStockQty(wallet)} {picked.symbol}
          </dd>
        </div>
        <div>
          <dt className="text-muted">In book</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {formatStockQty(deposited)} {picked.symbol}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Locked</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {formatStockQty(locked)} {picked.symbol}
          </dd>
        </div>
      </dl>

      {mark > 0 ? (
        <p className="mt-3 text-[12px] text-muted">
          Mark {fiat(mark)} · {haircut / 100}% haircut
          {quote != null ? (
            <span className="text-[#cfcfcf]">
              {" "}
              · {formatStockQty(value)} posts {fiat(quote)} margin
            </span>
          ) : null}
        </p>
      ) : stockCollateralIsLive ? (
        <p className="mt-3 text-[12px] text-gold">
          No mark on {picked.symbol} yet. Deposits still work; leverage waits
          on a mark.
        </p>
      ) : (
        <p className="mt-3 text-[12px] text-muted">
          The stock desk is not live yet. Holdings above are in your wallet.
        </p>
      )}

      {authenticated && stockCollateralIsLive ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-[#1b1b1b] p-1">
            {(["deposit", "withdraw"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setAmount("");
                  setError(null);
                  setDone(null);
                }}
                className={`rounded-full py-2 text-[13px] font-semibold capitalize transition ${
                  mode === m
                    ? "bg-white text-black"
                    : "text-[#cfcfcf] hover:text-white"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-2xl bg-[#1f1f1f] px-4 py-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[13px] text-muted">
                  {mode === "withdraw" ? "Withdraw" : "Deposit"}
                </p>
                <p className="mt-0.5 text-[11px] text-[#6b6b6b]">
                  {picked.symbol}
                </p>
              </div>
              <input
                type="number"
                min={0}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-36 bg-transparent text-right text-[2rem] font-bold leading-none tracking-tight outline-none placeholder-white/25 sm:w-44"
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
              <span className="tabular-nums">
                {mode === "deposit"
                  ? `${formatStockQty(wallet)} in wallet`
                  : `${formatStockQty(free)} free`}
              </span>
              <button
                type="button"
                onClick={() =>
                  setAmount(
                    String(Math.floor(max * 100_000_000) / 100_000_000),
                  )
                }
                className="font-semibold text-gold hover:text-gold/80"
              >
                Max
              </button>
            </div>
          </div>

          {desk?.depositsPaused && mode === "deposit" ? (
            <p className="mt-3 text-[12px] text-gold">Deposits paused</p>
          ) : null}
          {error ? <p className="mt-3 text-[12px] text-down">{error}</p> : null}
          {done ? <p className="mt-3 text-[12px] text-up">{done}</p> : null}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={
              busy ||
              !valid ||
              Boolean(desk?.depositsPaused && mode === "deposit")
            }
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3.5 text-[15px] font-semibold text-black transition hover:bg-gold/90 disabled:opacity-40"
          >
            {busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black" />
            ) : null}
            {busy
              ? mode === "deposit"
                ? "Depositing…"
                : "Withdrawing…"
              : mode === "deposit"
                ? `Deposit ${picked.symbol}`
                : `Withdraw ${picked.symbol}`}
          </button>
        </>
      ) : authenticated ? (
        <p className="mt-4 text-[13px] text-muted">
          Set the stock desk address and fund it to turn deposits on.
        </p>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className="mt-4 w-full rounded-full bg-gold py-3.5 text-[15px] font-semibold text-black transition hover:bg-gold/90"
        >
          Connect
        </button>
      )}
    </div>
  );
}

function TokenRow({
  holdings,
  selected,
  onSelect,
}: {
  holdings: { token: StockToken; holding?: StockHolding }[];
  selected?: string;
  onSelect?: (token: StockToken) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {holdings.map(({ token, holding }) => {
        const active =
          selected?.toLowerCase() === token.address.toLowerCase();
        const qty = holding
          ? stockToNumber(holding.wallet + holding.deposited, token.decimals)
          : null;
        return (
          <button
            key={token.address}
            type="button"
            onClick={() => onSelect?.(token)}
            disabled={!onSelect}
            className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition disabled:cursor-default ${
              active
                ? "bg-gold text-black"
                : "bg-[#1b1b1b] text-[#cfcfcf] hover:bg-[#2c2c2c] hover:text-white"
            }`}
          >
            {token.symbol}
            {qty != null && qty > 0 ? (
              <span className="ml-1 font-medium opacity-70">
                {formatStockQty(qty, 2)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
