import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { fiat } from "../lib/format";
import type { LivePosition } from "../lib/polymarket-portfolio";
import { RH_EXPLORER } from "../lib/robinhood";
import { knownPortfolioAddresses } from "../lib/pm-wallet";
import { deriveDepositWallet } from "../lib/pm-funder";
import {
  isEmbeddedWallet,
  isEvmAddress,
  primaryWalletAddress,
  useEnsureTradingWallet,
} from "../lib/wallet";
import {
  useWalletFunding,
  type FundPhase,
  type FundProvider,
} from "../lib/wallet-funding";
import { watchBalanceReloads } from "../lib/positions";
import {
  ArrowDownTrayIcon,
  CheckIcon,
  CoinbaseMark,
  CopyIcon,
  MoonpayMark,
  StripeMark,
} from "./icons";
import { TransferCryptoModal, ChainIcons } from "./ChainDeposit";
import { DEPOSIT_CHAINS, type DepositChain } from "../lib/deposit-chains";

type BookValue = {
  address: string | null;
  cash: number;
  portfolio: number;
  openPositions: LivePosition[];
  loading: boolean;
  refresh: () => void;
  depositOpen: boolean;
  openDeposit: () => void;
  closeDeposit: () => void;
};

const EMPTY: BookValue = {
  address: null,
  cash: 0,
  portfolio: 0,
  openPositions: [],
  loading: false,
  refresh: () => {},
  depositOpen: false,
  openDeposit: () => {},
  closeDeposit: () => {},
};

const BookContext = createContext<BookValue>(EMPTY);

export function useBook() {
  return useContext(BookContext);
}

export function BookProvider({ children }: { children: React.ReactNode }) {
  return <BookInner>{children}</BookInner>;
}

function BookInner({ children }: { children: React.ReactNode }) {
  const { authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();
  useEnsureTradingWallet();
  const address = authenticated ? primaryWalletAddress(user, wallets) : null;
  const [cash, setCash] = useState(0);
  const [positionsValue, setPositionsValue] = useState(0);
  const [openPositions, setOpenPositions] = useState<LivePosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  const refresh = useCallback(() => {
    if (!address) {
      setCash(0);
      setPositionsValue(0);
      setOpenPositions([]);
      return;
    }
    setLoading(true);
    const linked = (user?.linkedAccounts ?? [])
      .filter((a) => a.type === "wallet" && "address" in a)
      .map((a) => a as { address: string; walletClientType?: string })
      .filter((w) => isEvmAddress(w.address));
    const connected = wallets
      .filter((w) => isEvmAddress(w.address))
      .map((w) => ({
        address: w.address,
        walletClientType: w.walletClientType,
      }));
    const signers = [...linked];
    for (const w of connected) {
      if (
        !signers.some((s) => s.address.toLowerCase() === w.address.toLowerCase())
      ) {
        signers.push(w);
      }
    }
    const derived = signers
      .filter((w) => isEmbeddedWallet(w.walletClientType))
      .flatMap((w) => {
        try {
          return [deriveDepositWallet(w.address)];
        } catch {
          return [];
        }
      });
    const owners = knownPortfolioAddresses([
      address,
      ...signers.map((w) => w.address),
      ...derived,
    ]);
    const assetOwners = knownPortfolioAddresses([
      address,
      ...signers.map((w) => w.address),
    ]);
    void Promise.all([
      fetch(
        `/api/assets?addresses=${encodeURIComponent(assetOwners.join(","))}`,
      ).then(async (r) => {
        const text = await r.text();
        if (text.trimStart().startsWith("<")) {
          throw new Error("assets html");
        }
        return JSON.parse(text) as { assets?: { symbol: string; balance: number }[] };
      }),
      owners.length
        ? fetch(
            `/api/pm/portfolio?addresses=${encodeURIComponent(owners.join(","))}`,
          ).then(async (r) => {
            const text = await r.text();
            if (text.trimStart().startsWith("<")) {
              return { positionsValue: 0 };
            }
            return JSON.parse(text) as {
              positionsValue?: number;
              open?: LivePosition[];
            };
          })
        : Promise.resolve({ positionsValue: 0 }),
    ])
      .then(
        ([
          data,
          portfolio,
        ]: [
          { assets?: { symbol: string; balance: number }[] },
          { positionsValue?: number; open?: LivePosition[] },
        ]) => {
          const usdg = data.assets?.find((a) => a.symbol === "USDG");
          setCash(usdg?.balance ?? 0);
          setPositionsValue(
            typeof portfolio.positionsValue === "number"
              ? portfolio.positionsValue
              : 0,
          );
          setOpenPositions(Array.isArray(portfolio.open) ? portfolio.open : []);
        },
      )
      .catch(() => {
        /* keep last cash; a bad hop must not wipe the book */
      })
      .finally(() => setLoading(false));
  }, [address, user, wallets]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!ready) return;
    return watchBalanceReloads(() => refreshRef.current());
  }, [ready, address]);

  const value = useMemo<BookValue>(
    () => ({
      address,
      cash,
      portfolio: cash + positionsValue,
      openPositions,
      loading,
      refresh,
      depositOpen,
      openDeposit: () => setDepositOpen(true),
      closeDeposit: () => setDepositOpen(false),
    }),
    [address, cash, positionsValue, openPositions, loading, refresh, depositOpen],
  );

  return (
    <BookContext.Provider value={value}>
      {children}
      {depositOpen ? (
        <DepositModal
          address={address}
          cash={cash}
          onClose={() => setDepositOpen(false)}
        />
      ) : null}
    </BookContext.Provider>
  );
}

function cashHint(
  kind: FundProvider,
  busy: FundProvider | null,
  phase: FundPhase | null,
  opening: string,
  hint: string,
) {
  if (busy !== kind) return hint;
  if (phase === "wait") return "Waiting for the purchase to land…";
  if (phase === "convert") return "Converting to USDG cash…";
  return opening;
}

function CashMethod({
  title,
  hint,
  opening,
  icon,
  kind,
  busy,
  phase,
  disabled,
  onClick,
}: {
  title: string;
  hint: string;
  opening: string;
  icon: ReactNode;
  kind: FundProvider;
  busy: FundProvider | null;
  phase: FundPhase | null;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl bg-[#1b1b1b] px-4 py-4 text-left ring-1 ring-white/5 transition hover:ring-white/15 disabled:opacity-60"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-[12px] text-muted">
          {cashHint(kind, busy, phase, opening, hint)}
        </p>
      </div>
    </button>
  );
}

function DepositModal({
  address,
  cash,
  onClose,
}: {
  address: string | null;
  cash: number;
  onClose: () => void;
}) {
  const { refresh } = useBook();
  const { busy, phase, error, openStripe, openCoinbase, openMoonpay } =
    useWalletFunding();
  const [tab, setTab] = useState<"crypto" | "cash">("crypto");
  const [copied, setCopied] = useState(false);
  const [transfer, setTransfer] = useState<DepositChain | null>(null);

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard?.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const openTransfer = (next?: DepositChain) => {
    if (!address) return;
    setTransfer(next ?? DEPOSIT_CHAINS[0]!);
  };

  return (
    <>
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 animate-fade-in sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-visible rounded-t-[28px] border border-white/10 bg-[#161616] shadow-2xl animate-pop-in sm:rounded-[28px]">
        <div className="px-5 pb-6 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Deposit</h2>
              <p className="mt-0.5 text-sm text-muted">
                Cash: {fiat(cash)} USDG
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white"
            >
              ×
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-[#222] p-1">
            <button
              type="button"
              onClick={() => {
                setTab("crypto");
                setTransfer(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition ${
                tab === "crypto"
                  ? "bg-white text-black shadow"
                  : "text-[#9a9a9a]"
              }`}
            >
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
                  tab === "crypto" ? "bg-black text-white" : "bg-[#3a3a3a] text-white"
                }`}
              >
                ₿
              </span>
              Use Crypto
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("cash");
                setTransfer(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition ${
                tab === "cash"
                  ? "bg-white text-black shadow"
                  : "text-[#9a9a9a]"
              }`}
            >
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-[13px] font-bold ${
                  tab === "cash" ? "bg-black text-white" : "bg-[#3a3a3a] text-white"
                }`}
              >
                $
              </span>
              Use Cash
            </button>
          </div>

          {tab === "crypto" ? (
            <div className="relative mt-4 space-y-2">
              <div
                role="button"
                tabIndex={0}
                onClick={() => openTransfer()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openTransfer();
                  }
                }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-[#1b1b1b] px-4 py-4 text-left ring-1 ring-white/5 transition hover:ring-white/15"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-white">
                  <QrMark />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Transfer Crypto</p>
                  <p className="text-[12px] text-muted">
                    {address
                      ? "No limit · Instant"
                      : "Connect a wallet to deposit"}
                  </p>
                </div>
                <ChainIcons onPick={openTransfer} disabled={!address} />
              </div>

              <div className="rounded-2xl bg-[#1b1b1b] p-4 ring-1 ring-white/5">
                <div className="flex items-center gap-3">
                  <img
                    src="/tokens/usdg.png"
                    alt=""
                    width={40}
                    height={40}
                    decoding="async"
                    className="h-10 w-10 rounded-full object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">Transfer USDG</p>
                    <p className="text-[12px] text-muted">
                      No limit · Instant on Robinhood Chain
                    </p>
                  </div>
                </div>
                {address ? (
                  <>
                    <p className="mt-3 break-all rounded-xl bg-[#0f0f0f] px-3 py-2.5 font-mono text-[12px]">
                      {address}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <a
                        href={`${RH_EXPLORER}/address/${address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-white/5 py-2.5 text-center text-sm font-semibold"
                      >
                        Explorer
                      </a>
                      <button
                        type="button"
                        onClick={() => void copy()}
                        className="inline-flex items-center justify-center gap-1.5 rounded-full bg-gold py-2.5 text-sm font-semibold text-black"
                      >
                        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted">
                    Connect a wallet to get a deposit address.
                  </p>
                )}
              </div>
              <CashMethod
                title="Connect exchange"
                hint="Coinbase. Lands as USDG cash."
                opening="Opening Coinbase…"
                icon={<CoinbaseMark />}
                kind="coinbase"
                busy={busy}
                phase={phase}
                disabled={busy !== null}
                onClick={() => void openCoinbase(address)}
              />
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <CashMethod
                title="Stripe"
                hint="Apple Pay, Google Pay, or card"
                opening="Opening Stripe…"
                icon={<StripeMark />}
                kind="stripe"
                busy={busy}
                phase={phase}
                disabled={busy !== null}
                onClick={() => void openStripe(address)}
              />
              <CashMethod
                title="MoonPay"
                hint="Card or Apple Pay"
                opening="Opening MoonPay…"
                icon={<MoonpayMark />}
                kind="moonpay"
                busy={busy}
                phase={phase}
                disabled={busy !== null}
                onClick={() => void openMoonpay(address)}
              />
            </div>
          )}
          {error ? (
            <p className="mt-3 text-sm text-red-400">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
    {transfer && address ? (
      <TransferCryptoModal
        address={address}
        cash={cash}
        initialChain={transfer}
        onBack={() => setTransfer(null)}
        onClose={onClose}
        onArrived={refresh}
      />
    ) : null}
    </>
  );
}

function QrMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v7M14 20h3" />
    </svg>
  );
}

export function DepositButton({ compact = false }: { compact?: boolean }) {
  const { openDeposit } = useBook();
  return (
    <button
      type="button"
      onClick={openDeposit}
      className="inline-flex items-center justify-center gap-1.5 rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-105 sm:px-4 sm:py-2 sm:text-sm"
    >
      <ArrowDownTrayIcon size={15} />
      {compact ? null : <span>Deposit</span>}
    </button>
  );
}
