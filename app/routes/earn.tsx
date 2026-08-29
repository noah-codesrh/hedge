import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useAuthorizationSignature, usePrivy } from "@privy-io/react-auth";
import type { Route } from "./+types/earn";
import { fiat, pct, shorten } from "../lib/format";
import { earnIsLive, leverageIsLive, VAULT_ADDRESS } from "../lib/leverage";
import {
  leverageAtTvl,
  readLeverageTiers,
  readLpPosition,
  readSeniorApr,
  readUsdgBalance,
  readVaultState,
  type LeverageTier,
  type LpPosition,
  type VaultState,
} from "../lib/leverage-chain";
import {
  ACTIVITY_LEVELS,
  MAX_POOL_EXPOSURE,
  projectSeniorYield,
} from "../lib/leverage-yield";
import { notifyBalancesChanged } from "../lib/positions";
import { RH_EXPLORER } from "../lib/robinhood";
import { useEnsureCashWallet } from "../lib/wallet";
import { useAuthModal, usePrivyMounted } from "../components/Providers";
import { CheckIcon, CopyIcon, VaultIcon } from "../components/icons";

/** Typical ticket the yield model is sized against ($3 margin at 2x). */
const TYPICAL_SIZE = 6;
/** First-LP reference so the page can show a rate before senior is seeded. */
const REFERENCE_SENIOR = 1_000;

type EarnRate = {
  apr: number;
  kind: "live" | "est";
};

function formatApr(n: number) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000) return "999+%";
  return `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;
}

function estimateApr(
  vault: VaultState | null,
  extraSenior: number,
  tiers: LeverageTier[],
): number | null {
  const junior = vault?.junior ?? 0;
  const senior = Math.max(0, (vault?.senior ?? 0) + extraSenior);
  const base = senior > 0 ? senior : REFERENCE_SENIOR;
  const lev =
    tiers.length > 0 ? leverageAtTvl(tiers, base + junior) : 2;

  const run = (id: "steady" | "quiet") => {
    const level = ACTIVITY_LEVELS.find((l) => l.id === id)!;
    return projectSeniorYield({
      senior: base,
      junior,
      tradesPerDay: level.tradesPerDay,
      avgPositionSize: TYPICAL_SIZE,
      avgHoldHours: level.avgHoldHours,
      borrowRateBps: 1,
      avgLeverage: Math.max(2, lev),
    });
  };

  // Quiet while leverage trading is off — a busy-book rate would be a
  // promise the pool cannot keep yet. Steady once the book is live.
  const headline = run(leverageIsLive ? "steady" : "quiet");
  const pick = headline.implausible ? run("quiet") : headline;
  return Number.isFinite(pick.apr) && pick.apr > 0 ? pick.apr : null;
}

async function fetchVaultSnapshot(): Promise<{
  vault: VaultState | null;
  tiers: LeverageTier[];
}> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch("/api/vault", { signal: ctrl.signal });
    if (!res.ok) throw new Error(`vault ${res.status}`);
    const data: unknown = await res.json();
    const row = data as { vault?: VaultState | null; tiers?: LeverageTier[] };
    return {
      vault: row.vault ?? null,
      tiers: Array.isArray(row.tiers) ? row.tiers : [],
    };
  } finally {
    window.clearTimeout(timer);
  }
}

function resolveRate(
  vault: VaultState | null,
  extraSenior: number,
  tiers: LeverageTier[],
  realised: Awaited<ReturnType<typeof readSeniorApr>> | null,
): EarnRate | null {
  if (realised && Number.isFinite(realised.apr) && realised.apr > 0) {
    return { apr: realised.apr, kind: "live" };
  }
  const apr = estimateApr(vault, extraSenior, tiers);
  return apr != null ? { apr, kind: "est" } : null;
}

export function meta() {
  return [
    { title: "Earn · Hedge" },
    {
      name: "description",
      content: "Deposit USDG into the Hedge vault.",
    },
  ];
}

export async function loader() {
  if (!earnIsLive) return { vault: null, tiers: [] as LeverageTier[] };
  const [vault, tiers] = await Promise.all([
    readVaultState(),
    readLeverageTiers(),
  ]);
  return { vault, tiers };
}

export default function Earn({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto min-w-0 max-w-5xl px-3 pt-5 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:pt-10 lg:pb-10">
      {earnIsLive ? <EarnLive initial={loaderData} /> : <NotLive />}
    </main>
  );
}

function EarnLive({
  initial,
}: {
  initial: { vault: VaultState | null; tiers: LeverageTier[] };
}) {
  const privyReady = usePrivyMounted();
  const [vault, setVault] = useState<VaultState | null>(initial.vault);
  const [tiers, setTiers] = useState<LeverageTier[]>(initial.tiers);
  const [realised, setRealised] = useState<Awaited<
    ReturnType<typeof readSeniorApr>
  > | null>(null);
  const [loading, setLoading] = useState(!initial.vault);

  const loadVault = useCallback(async () => {
    try {
      const snap = await fetchVaultSnapshot();
      if (snap.vault) setVault(snap.vault);
      if (snap.tiers.length) setTiers(snap.tiers);
    } catch {
      // Browser RPC hangs on some Chrome profiles. The route loader already
      // tried the server path — do not block the card on a second hang.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setVault((prev) => initial.vault ?? prev);
    if (initial.tiers.length) setTiers(initial.tiers);
    if (initial.vault) setLoading(false);
  }, [initial.vault, initial.tiers]);

  useEffect(() => {
    void loadVault();
    const timer = setInterval(() => void loadVault(), 20_000);
    return () => clearInterval(timer);
  }, [loadVault]);

  useEffect(() => {
    void readSeniorApr().then(setRealised);
  }, []);

  if (privyReady) {
    return (
      <EarnInner
        vault={vault}
        tiers={tiers}
        realised={realised}
        loading={loading}
        reloadVault={loadVault}
      />
    );
  }

  const rate = resolveRate(vault, 0, tiers, realised);

  return (
    <EarnSplit>
      <Hero vault={vault} rate={rate} mine={null} loading={loading} />
      <Panel
        vault={vault}
        tiers={tiers}
        rate={rate}
        authenticated={false}
        balance={0}
        withdrawable={0}
        onConnect
      />
    </EarnSplit>
  );
}

function EarnSplit({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-stretch">{children}</div>
  );
}

function EarnInner({
  vault,
  tiers,
  realised,
  loading,
  reloadVault,
}: {
  vault: VaultState | null;
  tiers: LeverageTier[];
  realised: Awaited<ReturnType<typeof readSeniorApr>> | null;
  loading: boolean;
  reloadVault: () => Promise<void>;
}) {
  const { authenticated, getAccessToken } = usePrivy();
  const { openModal } = useAuthModal();
  const { cashAddress, ensureCashWallet } = useEnsureCashWallet();
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const [mine, setMine] = useState<LpPosition | null>(null);
  const [balance, setBalance] = useState(0);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, b] = await Promise.all([
      cashAddress ? readLpPosition(cashAddress) : Promise.resolve(null),
      cashAddress ? readUsdgBalance(cashAddress) : Promise.resolve(0),
    ]);
    setMine(m);
    setBalance(b);
    await reloadVault();
  }, [cashAddress, reloadVault]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  const value = Number(amount);
  const withdrawable = mine?.assets ?? 0;
  const max = mode === "deposit" ? balance : withdrawable;
  const valid = Number.isFinite(value) && value > 0 && value <= max + 1e-9;

  const submit = async () => {
    if (!authenticated) return openModal();
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

      const actions = await import("../lib/leverage-actions");
      if (mode === "deposit") {
        await actions.depositToVault(ctx, value);
        setDone(`Deposited ${fiat(value)}.`);
      } else {
        const shares =
          mine && value >= withdrawable - 1e-9
            ? mine.shares
            : (BigInt(Math.round(value * 1e6)) * (mine?.shares ?? 0n)) /
              BigInt(Math.max(1, Math.round(withdrawable * 1e6)));
        if (shares <= 0n) throw new Error("That's too small to withdraw.");
        await actions.withdrawFromVault(ctx, shares);
        setDone(`Withdrew ${fiat(value)}.`);
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

  const extra =
    mode === "deposit" && Number.isFinite(value) && value > 0 ? value : 0;
  const rate = useMemo(
    () => resolveRate(vault, extra, tiers, realised),
    [vault, extra, tiers, realised],
  );

  return (
    <EarnSplit>
      <Hero
        vault={vault}
        rate={rate}
        mine={withdrawable}
        loading={loading}
      />
      <Panel
        vault={vault}
        tiers={tiers}
        rate={rate}
        authenticated={authenticated}
        balance={balance}
        withdrawable={withdrawable}
        mode={mode}
        amount={amount}
        busy={busy}
        error={error}
        done={done}
        valid={valid}
        onMode={(m) => {
          setMode(m);
          setAmount("");
          setError(null);
          setDone(null);
        }}
        onAmount={setAmount}
        onSubmit={() => void submit()}
        onConnect={false}
      />
    </EarnSplit>
  );
}

function Hero({
  vault,
  rate,
  mine,
  loading,
}: {
  vault: VaultState | null;
  rate: EarnRate | null;
  mine: number | null;
  loading: boolean;
}) {
  const tvl = vault?.tvl ?? 0;
  const senior = vault?.senior ?? 0;
  const junior = vault?.junior ?? 0;
  const lev =
    tvl >= 20_000 ? "5x" : tvl >= 5_000 ? "4x" : tvl >= 1_000 ? "3x" : "2x";
  const apr = rate ? formatApr(rate.apr) : null;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.75rem] bg-card ring-1 ring-white/5">
      <div className="px-5 pt-6 pb-5 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold">
              <VaultIcon size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-muted">
                Total in pool
              </p>
              <p className="mt-0.5 text-[12px] text-[#6b6b6b]">
                USDG · Robinhood Chain
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            {apr ? (
              <>
                <p className="text-[15px] font-semibold tabular-nums text-gold">
                  {apr} APR
                </p>
                <p className="mt-0.5 text-[11px] text-[#6b6b6b]">
                  {rate?.kind === "live"
                    ? "Paid to senior"
                    : "Est. senior yield"}
                  <span className="text-[#4a4a4a]"> · {lev}</span>
                </p>
              </>
            ) : (
              <p className="text-[13px] font-medium text-muted">{lev}</p>
            )}
          </div>
        </div>

        {vault == null && loading ? (
          <span
            className="mt-5 block h-11 w-44 animate-pulse rounded-xl bg-white/10 sm:h-14 sm:w-56"
            aria-label="Loading pool total"
          />
        ) : (
          <p className="mt-5 text-[2.35rem] font-bold leading-none tracking-tight tabular-nums sm:text-5xl">
            {fiat(tvl)}
          </p>
        )}

        <PoolBar senior={senior} junior={junior} loading={vault == null && loading} />
      </div>

      <div className="mt-auto grid grid-cols-3 divide-x divide-white/5 border-t border-white/5">
        <Stat label="You" value={mine == null ? "—" : fiat(mine)} />
        <Stat
          label="Junior"
          value={vault == null && loading ? "—" : fiat(junior)}
        />
        <Stat
          label="In use"
          value={vault == null && loading ? "—" : pct(vault?.utilisation ?? 0)}
        />
      </div>

      <ExplorerRow />
    </section>
  );
}

function PoolBar({
  senior,
  junior,
  loading,
}: {
  senior: number;
  junior: number;
  loading: boolean;
}) {
  const total = senior + junior;
  const seniorPct = total > 0 ? (senior / total) * 100 : 0;
  const juniorPct = total > 0 ? (junior / total) * 100 : 0;

  return (
    <div className="mt-5">
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        {!loading && total > 0 ? (
          <div className="flex h-full">
            <div className="bg-gold" style={{ width: `${seniorPct}%` }} />
            <div className="bg-white/20" style={{ width: `${juniorPct}%` }} />
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span>
          Senior{" "}
          <span className="tabular-nums text-[#cfcfcf]">
            {loading ? "—" : fiat(senior)}
          </span>
        </span>
        <span>
          Junior{" "}
          <span className="tabular-nums text-[#cfcfcf]">
            {loading ? "—" : fiat(junior)}
          </span>
        </span>
      </div>
    </div>
  );
}

function ExplorerRow() {
  const [copied, setCopied] = useState(false);
  if (!VAULT_ADDRESS) return null;

  const href = `${RH_EXPLORER}/address/${VAULT_ADDRESS}`;
  const copy = async () => {
    await navigator.clipboard?.writeText(VAULT_ADDRESS);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-3 border-t border-white/5 px-5 py-3.5 sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted">
          Vault contract
        </p>
        <p className="mt-0.5 truncate font-mono text-[13px] font-semibold">
          {shorten(VAULT_ADDRESS)}
        </p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="rounded-full bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-[#cfcfcf] transition hover:bg-white/10 hover:text-white"
      >
        Explorer
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-full bg-white/5 p-1.5 text-[#cfcfcf] transition hover:bg-white/10 hover:text-white"
        aria-label={copied ? "Copied" : "Copy vault address"}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 truncate text-[15px] font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function Panel({
  vault,
  tiers,
  rate,
  authenticated,
  balance,
  withdrawable,
  mode = "deposit",
  amount = "",
  busy = false,
  error = null,
  done = null,
  valid = false,
  onMode,
  onAmount,
  onSubmit,
  onConnect,
}: {
  vault: VaultState | null;
  tiers: LeverageTier[];
  rate: EarnRate | null;
  authenticated: boolean;
  balance: number;
  withdrawable: number;
  mode?: "deposit" | "withdraw";
  amount?: string;
  busy?: boolean;
  error?: string | null;
  done?: string | null;
  valid?: boolean;
  onMode?: (m: "deposit" | "withdraw") => void;
  onAmount?: (v: string) => void;
  onSubmit?: () => void;
  onConnect: boolean;
}) {
  const { openModal } = useAuthModal();
  const value = Number(amount);
  const max = mode === "deposit" ? balance : withdrawable;
  const apr = rate ? formatApr(rate.apr) : null;

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[1.75rem] bg-card p-4 ring-1 ring-white/5 sm:p-5">
      {onConnect ? (
        <div className="mb-3 px-1">
          <p className="text-[13px] text-muted">
            Deposit USDG to the senior side of the pool.
          </p>
          {apr ? (
            <p className="mt-1 text-[13px] font-semibold text-gold">
              Earn {apr} APR
              {rate?.kind === "est" ? (
                <span className="font-medium text-[#6b6b6b]"> est.</span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-[#1b1b1b] p-1">
          {(["deposit", "withdraw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode?.(m)}
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
      )}

      <div className="rounded-2xl bg-[#1f1f1f] px-4 py-5">
        <div className="flex items-end justify-between gap-3">
          <div className="mb-1.5">
            <p className="text-[13px] text-muted">
              {mode === "withdraw" ? "Withdraw" : "Deposit"}
            </p>
            <p className="mt-0.5 text-[11px] text-[#6b6b6b]">USDG</p>
          </div>
          <div className="flex min-w-0 items-baseline gap-0.5">
            <span className="text-2xl font-semibold text-muted">$</span>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={amount}
              onChange={(e) => onAmount?.(e.target.value)}
              placeholder="0"
              className="w-36 bg-transparent text-right text-[2.5rem] font-bold leading-none tracking-tight outline-none placeholder-white/25 sm:w-44"
            />
          </div>
        </div>
        {onConnect ? null : (
          <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
            <span className="tabular-nums">
              {mode === "deposit"
                ? `${fiat(balance)} available`
                : `${fiat(withdrawable)} free`}
            </span>
            <button
              type="button"
              onClick={() =>
                onAmount?.(String(Math.floor(max * 100) / 100))
              }
              className="font-semibold text-gold hover:text-gold/80"
            >
              Max
            </button>
          </div>
        )}
      </div>

      {mode === "deposit" && value > 0 && vault ? (
        <Preview amount={value} vault={vault} tiers={tiers} />
      ) : null}

      {mode === "withdraw" && vault && withdrawable > vault.free ? (
        <p className="mt-3 text-[12px] text-gold">{fiat(vault.free)} free</p>
      ) : null}
      {vault?.depositsPaused && mode === "deposit" ? (
        <p className="mt-3 text-[12px] text-gold">Deposits paused</p>
      ) : null}
      {error ? <p className="mt-3 text-[12px] text-down">{error}</p> : null}
      {done ? <p className="mt-3 text-[12px] text-up">{done}</p> : null}

      {!onConnect && apr && mode === "deposit" ? (
        <p className="mt-3 px-1 text-[13px] font-semibold text-gold">
          Earn {apr} APR
          {rate?.kind === "est" ? (
            <span className="font-medium text-[#6b6b6b]"> est.</span>
          ) : null}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onConnect ? openModal : onSubmit}
        disabled={!onConnect && authenticated && (busy || !valid)}
        className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3.5 text-[15px] font-semibold text-black transition hover:bg-gold/90 disabled:opacity-40 lg:mt-6"
      >
        {busy ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black" />
        ) : null}
        {onConnect || !authenticated
          ? "Connect"
          : busy
            ? mode === "deposit"
              ? "Depositing…"
              : "Withdrawing…"
            : mode === "deposit"
              ? "Deposit"
              : "Withdraw"}
      </button>
    </section>
  );
}

function Preview({
  amount,
  vault,
  tiers,
}: {
  amount: number;
  vault: VaultState;
  tiers: LeverageTier[];
}) {
  const after = vault.tvl + amount;
  const now = tiers.length > 0 ? leverageAtTvl(tiers, vault.tvl) : null;
  const next = tiers.length > 0 ? leverageAtTvl(tiers, after) : null;
  const unlocks = now != null && next != null && next > now;

  return (
    <div className="mt-3 flex items-center justify-between gap-3 px-1 text-[12px] text-muted">
      <span>
        Share{" "}
        <span className="font-semibold text-white">
          {pct(after > 0 ? amount / after : 0)}
        </span>
      </span>
      <span>
        +{fiat(amount * MAX_POOL_EXPOSURE)} cap
        {unlocks ? (
          <span className="ml-2 font-semibold text-gold">{next}x</span>
        ) : null}
      </span>
    </div>
  );
}

function NotLive() {
  return (
    <section className="rounded-[1.75rem] bg-card px-6 py-14 text-center ring-1 ring-white/5">
      <VaultIcon size={22} />
      <p className="mt-3 text-[15px] font-semibold">Soon</p>
      <Link
        to="/"
        className="mt-5 inline-flex rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black"
      >
        Markets
      </Link>
    </section>
  );
}
