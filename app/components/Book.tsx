import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { fiat } from "../lib/format";
import type { LivePosition } from "../lib/polymarket-portfolio";
import { RH_EXPLORER } from "../lib/robinhood";
import { knownPortfolioAddresses } from "../lib/pm-wallet";
import { deriveDepositWallet } from "../lib/pm-funder";
import { isEmbeddedWallet, primaryWalletAddress } from "../lib/wallet";
import { ArrowDownTrayIcon, CheckIcon, CopyIcon, WalletIcon } from "./icons";

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
  const address = authenticated ? primaryWalletAddress(user) : null;
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
      .map((a) => a as { address: string; walletClientType?: string });
    const connected = wallets.map((w) => ({
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
      .map((w) => deriveDepositWallet(w.address));
    const owners = knownPortfolioAddresses([
      address,
      ...signers.map((w) => w.address),
      ...derived,
    ]);
    void Promise.all([
      fetch(`/api/assets?address=${address}`).then((r) => r.json()),
      owners.length
        ? fetch(
            `/api/pm/portfolio?addresses=${encodeURIComponent(owners.join(","))}`,
          ).then((r) => r.json())
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
        setCash(0);
        setPositionsValue(0);
        setOpenPositions([]);
      })
      .finally(() => setLoading(false));
  }, [address, user, wallets]);

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [ready, refresh]);

  useEffect(() => {
    const onPos = () => refresh();
    window.addEventListener("hedge:positions", onPos);
    window.addEventListener("storage", onPos);
    return () => {
      window.removeEventListener("hedge:positions", onPos);
      window.removeEventListener("storage", onPos);
    };
  }, [refresh]);

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

function DepositModal({
  address,
  cash,
  onClose,
}: {
  address: string | null;
  cash: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"crypto" | "cash">("crypto");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard?.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 animate-fade-in sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-t-[28px] border border-white/10 bg-[#161616] shadow-2xl animate-pop-in sm:rounded-[28px]">
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

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTab("crypto")}
              className={`rounded-2xl py-3 text-sm font-semibold transition ${
                tab === "crypto"
                  ? "bg-white text-black"
                  : "bg-white/5 text-[#cfcfcf]"
              }`}
            >
              Use crypto
            </button>
            <button
              type="button"
              onClick={() => setTab("cash")}
              className={`rounded-2xl py-3 text-sm font-semibold transition ${
                tab === "cash"
                  ? "bg-white text-black"
                  : "bg-white/5 text-[#cfcfcf]"
              }`}
            >
              Use cash
            </button>
          </div>

          {tab === "crypto" ? (
            <div className="mt-4 space-y-2">
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
              <div className="flex items-center gap-3 rounded-2xl bg-[#1b1b1b] px-4 py-4 ring-1 ring-white/5">
                <WalletIcon size={22} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Connect exchange</p>
                  <p className="text-[12px] text-muted">No limit · Coming soon</p>
                </div>
                <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold text-gold">
                  Soon
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl bg-[#1b1b1b] px-4 py-8 text-center ring-1 ring-white/5">
              <p className="font-semibold">Card and bank deposits</p>
              <p className="mt-1 text-sm text-muted">
                Fiat on-ramp into USDG is coming soon. For now, transfer USDG on
                Robinhood Chain.
              </p>
              <span className="mt-3 inline-block rounded-full bg-gold/20 px-2.5 py-1 text-[11px] font-semibold text-gold">
                Soon
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
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
