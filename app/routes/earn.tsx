import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useAuthorizationSignature, usePrivy } from "@privy-io/react-auth";
import { fiat, pct } from "../lib/format";
import { earnIsLive, VAULT_ADDRESS } from "../lib/leverage";
import {
  leverageAtTvl,
  readEngineState,
  readLeverageTiers,
  readLpPosition,
  readSeniorApr,
  readUsdgBalance,
  readVaultState,
  type EngineState,
  type LeverageTier,
  type LpPosition,
  type VaultState,
} from "../lib/leverage-chain";
import {
  ACTIVITY_LEVELS,
  MAX_POOL_EXPOSURE,
  projectSeniorYield,
  ROUND_TRIP_FEE,
  SENIOR_FEE_SHARE,
} from "../lib/leverage-yield";
import { notifyBalancesChanged } from "../lib/positions";
import { RH_EXPLORER } from "../lib/robinhood";
import { useEnsureCashWallet } from "../lib/wallet";
import { LeverageWipNotice } from "../components/LeverageWipNotice";
import { useAuthModal, usePrivyMounted } from "../components/Providers";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  LayersIcon,
  SparkleIcon,
  VaultIcon,
} from "../components/icons";

export function meta() {
  return [
    { title: "Earn · Hedge" },
    {
      name: "description",
      content:
        "Provide USDG liquidity to the Hedge vault and earn a share of trading fees.",
    },
  ];
}

export default function Earn() {
  const mounted = usePrivyMounted();
  return (
    <main className="mx-auto min-w-0 max-w-3xl space-y-4 px-3 pt-5 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:space-y-5 sm:px-4 sm:pt-8 lg:pb-10">
      {mounted ? <EarnInner /> : <Skeleton />}
    </main>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-44 animate-pulse rounded-3xl bg-card ring-1 ring-white/5" />
      <div className="h-52 animate-pulse rounded-3xl bg-card ring-1 ring-white/5" />
      <div className="h-64 animate-pulse rounded-3xl bg-card ring-1 ring-white/5" />
    </div>
  );
}

function EarnInner() {
  const { authenticated, getAccessToken } = usePrivy();
  const { openModal } = useAuthModal();
  const { cashAddress } = useEnsureCashWallet();
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const [vault, setVault] = useState<VaultState | null>(null);
  const [engine, setEngine] = useState<EngineState | null>(null);
  const [tiers, setTiers] = useState<LeverageTier[]>([]);
  const [mine, setMine] = useState<LpPosition | null>(null);
  const [balance, setBalance] = useState(0);
  const [realised, setRealised] = useState<Awaited<
    ReturnType<typeof readSeniorApr>
  > | null>(null);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [v, e, m, b] = await Promise.all([
      readVaultState(),
      readEngineState(),
      cashAddress ? readLpPosition(cashAddress) : Promise.resolve(null),
      cashAddress ? readUsdgBalance(cashAddress) : Promise.resolve(0),
    ]);
    setVault(v);
    setEngine(e);
    setMine(m);
    setBalance(b);
    setLoading(false);
  }, [cashAddress]);

  useEffect(() => {
    if (!earnIsLive) {
      setLoading(false);
      return;
    }
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  // Split from the rest: these walk event logs and read a static schedule, so
  // neither should hold up the numbers people came to see.
  useEffect(() => {
    if (!earnIsLive) return;
    void readSeniorApr().then(setRealised);
    void readLeverageTiers().then(setTiers);
  }, []);

  if (!earnIsLive) return <NotLive />;

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
      if (!cashAddress) throw new Error("Your wallet isn't ready yet.");

      const ctx = {
        accessToken,
        from: cashAddress,
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
        // Withdrawals are denominated in shares on-chain. Converting from the
        // asset amount here would round against the LP and strand dust, so a
        // full exit passes the exact share balance instead.
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

  return (
    <>
      <Hero vault={vault} realised={realised} mine={withdrawable} loading={loading} />

      <LeverageWipNotice />

      <Projector vault={vault} engine={engine} tiers={tiers} />

      <section className="rounded-3xl bg-card p-4 ring-1 ring-white/5 sm:p-6">
        <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-full bg-[#1b1b1b] p-1">
          {(
            [
              ["deposit", "Deposit", <ArrowDownTrayIcon key="d" size={15} />],
              ["withdraw", "Withdraw", <ArrowUpTrayIcon key="w" size={15} />],
            ] as const
          ).map(([m, label, icon]) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setAmount("");
                setError(null);
                setDone(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-full py-2.5 text-[14px] font-bold transition ${
                mode === m
                  ? "bg-white text-black"
                  : "text-[#cfcfcf] hover:text-white"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl bg-[#252525] p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] text-muted">Amount</span>
            <div className="flex min-w-0 items-baseline gap-0.5 text-2xl font-bold sm:text-3xl">
              <span className="text-lg text-muted sm:text-xl">$</span>
              <input
                type="number"
                min={0}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-28 bg-transparent text-right outline-none placeholder-white sm:w-32"
              />
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
            <span>
              {mode === "deposit"
                ? `${fiat(balance)} USDG available`
                : `${fiat(withdrawable)} withdrawable`}
            </span>
            <button
              type="button"
              onClick={() => setAmount(String(Math.floor(max * 100) / 100))}
              className="font-semibold text-gold transition hover:text-gold/80"
            >
              Max
            </button>
          </div>

          {max > 0 ? (
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() =>
                    setAmount(String(Math.floor(max * f * 100) / 100))
                  }
                  className="rounded-full bg-[#1b1b1b] py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#2c2c2c]"
                >
                  {f === 1 ? "Max" : `${f * 100}%`}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {mode === "deposit" && value > 0 && vault ? (
          <DepositPreview amount={value} vault={vault} tiers={tiers} />
        ) : null}

        {mode === "withdraw" && vault && withdrawable > vault.free ? (
          <Notice tone="gold">
            {fiat(vault.free)} is free right now. The rest frees up as open
            trades close.
          </Notice>
        ) : null}

        {vault?.depositsPaused && mode === "deposit" ? (
          <Notice tone="gold">
            Deposits are paused right now. Withdrawals are unaffected.
          </Notice>
        ) : null}

        {error ? <Notice tone="down">{error}</Notice> : null}
        {done ? <Notice tone="up">{done}</Notice> : null}

        <button
          onClick={() => void submit()}
          disabled={authenticated && (busy || !valid)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-4 text-base font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {busy && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
          )}
          {!authenticated
            ? "Connect wallet"
            : busy
              ? mode === "deposit"
                ? "Depositing…"
                : "Withdrawing…"
              : mode === "deposit"
                ? "Deposit USDG"
                : "Withdraw USDG"}
        </button>
      </section>

      <HowItWorks vault={vault} />
      <RiskNote />
    </>
  );
}

/**
 * Headline block.
 *
 * Leads with realised APR when there is enough history to compute one, and
 * falls back to the vault's size otherwise. Deliberately does not lead with the
 * projection: an estimate rendered at hero size reads as a promise.
 */
function Hero({
  vault,
  realised,
  mine,
  loading,
}: {
  vault: VaultState | null;
  realised: Awaited<ReturnType<typeof readSeniorApr>> | null;
  mine: number;
  loading: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-3xl bg-card ring-1 ring-white/5">
      <div className="relative border-b border-white/5 bg-gradient-to-br from-gold/[0.12] via-transparent to-transparent p-5 sm:p-6">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-gold">
          <VaultIcon size={16} />
          Hedge vault
        </div>
        <h1 className="mt-2.5 text-[26px] font-bold leading-tight tracking-tight sm:text-3xl">
          Back the other side of every leveraged trade
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted sm:text-[15px]">
          Deposit USDG. You keep {Math.round(SENIOR_FEE_SHARE * 100)}% of the
          fees traders pay.
        </p>
      </div>

      <div className="grid grid-cols-2 divide-x divide-white/5 border-b border-white/5 sm:grid-cols-4">
        <HeroStat
          label="Vault size"
          value={loading ? "—" : fiat(vault?.tvl ?? 0)}
        />
        <HeroStat
          label="Realised APR"
          value={realised ? `${realised.apr.toFixed(1)}%` : "—"}
          hint={
            realised
              ? `over ${realised.windowDays.toFixed(0)}d`
              : "no history yet"
          }
        />
        <HeroStat
          label="In use"
          value={loading ? "—" : pct(vault?.utilisation ?? 0)}
          hint="backing trades"
        />
        <HeroStat label="Your deposit" value={loading ? "—" : fiat(mine)} />
      </div>

      {vault ? (
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span>
              Senior{" "}
              <span className="font-semibold text-white">
                {fiat(vault.senior)}
              </span>{" "}
              · Junior{" "}
              <span className="font-semibold text-white">
                {fiat(vault.junior)}
              </span>
            </span>
            <span className="tabular-nums">{fiat(vault.free)} free</span>
          </div>
          <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full bg-gold transition-all"
              style={{ width: `${Math.min(100, vault.utilisation * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HeroStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3.5 sm:px-5">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums sm:text-xl">{value}</p>
      {hint ? (
        <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * What the vault could pay once leverage markets are busy.
 *
 * Framed as a model rather than a rate, with its inputs on screen and
 * adjustable, because the honest answer today is that the vault has no trading
 * history to extrapolate from. Showing a single confident number here would be
 * the most misleading thing on the page.
 */
function Projector({
  vault,
  engine,
  tiers,
}: {
  vault: VaultState | null;
  engine: EngineState | null;
  tiers: LeverageTier[];
}) {
  const [levelId, setLevelId] = useState(ACTIVITY_LEVELS[1]!.id);
  const [target, setTarget] = useState<number | null>(null);

  const level =
    ACTIVITY_LEVELS.find((l) => l.id === levelId) ?? ACTIVITY_LEVELS[1]!;

  const junior = vault?.junior ?? 0;
  const liveSenior = vault?.senior ?? 0;

  // Scenario sizes worth showing: where the vault is now, and the TVL each
  // tier steps up at, so the slider lands on thresholds that mean something.
  const steps = useMemo(() => {
    const fromTiers = tiers.map((t) => t.minTvl).filter((t) => t > 0);
    const base = fromTiers.length > 0 ? fromTiers : [1_000, 5_000, 20_000];
    const all = [Math.max(250, Math.round(liveSenior + junior)), ...base, 50_000];
    return [...new Set(all)].sort((a, b) => a - b);
  }, [tiers, liveSenior, junior]);

  const tvl = target ?? steps[Math.min(1, steps.length - 1)]!;
  const senior = Math.max(0, tvl - junior);
  const avgLeverage =
    tiers.length > 0 ? leverageAtTvl(tiers, tvl) : (engine?.maxLeverage ?? 2);

  // A typical ticket, not a maximum one: most traders do not post the cap.
  const maxMargin = engine?.maxMargin ?? 5;
  const avgPositionSize = maxMargin * 0.6 * avgLeverage;

  const projection = projectSeniorYield({
    senior,
    junior,
    tradesPerDay: level.tradesPerDay,
    avgPositionSize,
    avgHoldHours: level.avgHoldHours,
    borrowRateBps: engine?.borrowRateBps ?? 1,
    avgLeverage,
  });

  return (
    <section className="rounded-3xl bg-card p-4 ring-1 ring-white/5 sm:p-6">
      <div className="flex items-center gap-2">
        <SparkleIcon size={15} />
        <h2 className="text-[15px] font-semibold">What this could pay</h2>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        No trading history yet. This is arithmetic on the assumptions below, not
        a forecast.
      </p>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-gold/[0.14] to-transparent p-4 ring-1 ring-gold/15 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] text-muted">Projected senior APR</p>
            <p className="mt-0.5 text-4xl font-bold tabular-nums text-gold sm:text-5xl">
              {rate(projection.apr)}
            </p>
          </div>
          <div className="text-right text-[12px] text-muted">
            <p>{rate(projection.apy)} APY reinvested</p>
            <p className="mt-0.5">
              ~{fiat(projection.dailyToSenior)} a day to LPs
            </p>
          </div>
        </div>

        {projection.implausible ? (
          <p className="mt-3 rounded-xl bg-black/25 px-3 py-2 text-[12px] leading-snug text-gold">
            A ceiling, not a rate — it assumes{" "}
            {projection.turnover.toFixed(1)}x the vault turns over every day for
            a year.
          </p>
        ) : null}

        {projection.capacityBound ? (
          <p className="mt-3 rounded-xl bg-black/25 px-3 py-2 text-[12px] leading-snug text-gold">
            The pool fills first. Only {fiat(projection.dailyVolume)} of the{" "}
            {fiat(projection.requestedVolume)} a day could be backed.
          </p>
        ) : null}
      </div>

      <div className="mt-5">
        <p className="text-[12px] font-semibold text-muted">How busy</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {ACTIVITY_LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLevelId(l.id)}
              className={`rounded-full py-2.5 text-[13px] font-bold transition ${
                l.id === levelId
                  ? "bg-white text-black"
                  : "bg-[#1b1b1b] text-white hover:bg-[#2c2c2c]"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">{level.detail}</p>
      </div>

      <div className="mt-4">
        <p className="text-[12px] font-semibold text-muted">
          If the vault reaches
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {steps.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTarget(s)}
              className={`rounded-full px-3.5 py-2 text-[13px] font-bold tabular-nums transition ${
                s === tvl
                  ? "bg-gold text-black"
                  : "bg-[#1b1b1b] text-white hover:bg-[#2c2c2c]"
              }`}
            >
              {s >= 1000 ? `$${Math.round(s / 1000)}k` : fiat(s)}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/5 pt-4 text-[12px] sm:grid-cols-4">
        <Assumption
          label="Leverage on offer"
          value={`${avgLeverage % 1 === 0 ? avgLeverage : avgLeverage.toFixed(1)}x`}
          hint="from the tier schedule"
        />
        <Assumption
          label="Typical ticket"
          value={fiat(avgPositionSize)}
          hint={`held ${level.avgHoldHours}h`}
        />
        <Assumption
          label="Volume backed"
          value={`${fiat(projection.dailyVolume)}/day`}
          hint={`${level.tradesPerDay} trades`}
        />
        <Assumption
          label="Fee to LPs"
          value={`${(ROUND_TRIP_FEE * SENIOR_FEE_SHARE * 100).toFixed(2)}%`}
          hint="of every round trip"
        />
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Fee income only, assuming traders break even overall. Their P&amp;L moves
        this either way.
      </p>
    </section>
  );
}

/**
 * Renders a rate at a legible width.
 *
 * Four-figure percentages are already at the edge of meaning something, so
 * anything past that is capped rather than printed in full — the difference
 * between 2,000% and 40,000% is not information an LP can act on, and a wall
 * of digits reads as a bug.
 */
function rate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 5_000) return ">5,000%";
  if (value >= 100) return `${Math.round(value).toLocaleString()}%`;
  return `${value.toFixed(1)}%`;
}

function Assumption({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted">{label}</dt>
      <dd className="mt-0.5 font-bold tabular-nums">{value}</dd>
      <dd className="truncate text-[11px] text-muted">{hint}</dd>
    </div>
  );
}

/** What a specific deposit does to the pool, shown before it is made. */
function DepositPreview({
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
  const share = after > 0 ? amount / after : 0;

  return (
    <div className="mt-3 space-y-1.5 rounded-2xl bg-[#1b1b1b] px-3.5 py-3 text-[12px]">
      <Row label="Your share of the vault" value={pct(share)} />
      <Row
        label="Capacity this adds"
        value={`+${fiat(amount * MAX_POOL_EXPOSURE)}`}
      />
      {unlocks ? (
        <p className="flex items-start gap-1.5 pt-1 text-[12px] leading-snug text-gold">
          <LayersIcon size={13} />
          <span>
            This deposit takes the vault past {fiat(after)} and unlocks {next}x
            leverage for every trader.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "gold" | "up" | "down";
  children: React.ReactNode;
}) {
  const cls = {
    gold: "bg-gold/10 text-gold",
    up: "bg-up/10 text-up",
    down: "bg-down/10 text-down",
  }[tone];
  return (
    <p className={`mt-3 rounded-2xl px-3 py-2.5 text-[12px] leading-snug ${cls}`}>
      {children}
    </p>
  );
}

function HowItWorks({ vault }: { vault: VaultState | null }) {
  return (
    <section className="rounded-3xl bg-card p-4 ring-1 ring-white/5 sm:p-6">
      <h2 className="text-[15px] font-semibold">Where the yield comes from</h2>
      <ul className="mt-3 space-y-3 text-[13px] leading-relaxed text-muted">
        <li className="flex gap-3">
          <Bullet>1</Bullet>
          <span>
            <span className="font-semibold text-white">
              {(ROUND_TRIP_FEE * 100).toFixed(0)}% round-trip fee.
            </span>{" "}
            On position size, not margin. {Math.round(SENIOR_FEE_SHARE * 100)}%
            comes to senior LPs the moment a trade opens.
          </span>
        </li>
        <li className="flex gap-3">
          <Bullet>2</Bullet>
          <span>
            <span className="font-semibold text-white">Spread.</span> Entry is
            priced 1% against the trader.
          </span>
        </li>
        <li className="flex gap-3">
          <Bullet>3</Bullet>
          <span>
            <span className="font-semibold text-white">Liquidations.</span> At
            90% margin loss the position closes and the rest stays in the pool.
          </span>
        </li>
        <li className="flex gap-3">
          <Bullet>4</Bullet>
          <span>
            <span className="font-semibold text-white">Carry.</span> The
            borrowed slice is charged by the hour while the trade is open.
          </span>
        </li>
      </ul>

      {vault ? (
        <p className="mt-4 rounded-2xl bg-[#1b1b1b] px-3.5 py-3 text-[12px] leading-relaxed text-muted">
          Only {Math.round(MAX_POOL_EXPOSURE * 100)}% of the vault is exposed at
          once — {fiat(vault.tvl * MAX_POOL_EXPOSURE)} of {fiat(vault.tvl)}. The
          rest stays free for withdrawals.
        </p>
      ) : null}
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[11px] font-bold text-gold">
      {children}
    </span>
  );
}

function NotLive() {
  return (
    <section className="rounded-3xl bg-card p-8 text-center ring-1 ring-white/5">
      <VaultIcon size={28} />
      <p className="mt-3 text-[15px] font-semibold">Earn is up soon</p>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">
        We’re fine-tuning the liquidity pool. Once it’s ready this is where
        you’ll deposit USDG and earn a share of every trading fee. Markets trade
        as normal in the meantime.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black"
      >
        Explore markets
      </Link>
    </section>
  );
}

function RiskNote() {
  return (
    <section className="rounded-3xl bg-card p-4 ring-1 ring-white/5 sm:p-6">
      <h2 className="text-[15px] font-semibold">What you’re taking on</h2>
      <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-muted">
        <li>
          <span className="font-semibold text-white">
            The vault is the counterparty.
          </span>{" "}
          Winning traders are paid out of the pool. A run of them is a real loss
          to LPs.
        </li>
        <li>
          <span className="font-semibold text-white">
            Junior takes the first loss.
          </span>{" "}
          Hedge’s own money is spent before yours, but it is finite.
        </li>
        <li>
          <span className="font-semibold text-white">
            Withdrawals need free liquidity.
          </span>{" "}
          Capital backing an open trade can’t leave until that trade closes.
        </li>
        <li>
          <span className="font-semibold text-white">
            Prices come from an oracle.
          </span>{" "}
          If the keeper stalls, liquidations are late and the vault wears it.
        </li>
      </ul>
      {VAULT_ADDRESS ? (
        <a
          href={`${RH_EXPLORER}/address/${VAULT_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex text-[13px] font-semibold text-gold transition hover:text-gold/80"
        >
          View the vault contract
        </a>
      ) : null}
    </section>
  );
}
