import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthModal, usePrivyMounted } from "./Providers";
import { CheckIcon } from "./icons";
import { fiat } from "../lib/format";
import {
  parseReferralCode,
  referralPath,
  REFERRAL_MIN_CLAIM,
} from "../lib/referral";
import { primaryWalletAddress } from "../lib/wallet";
import { RH_EXPLORER } from "../lib/robinhood";

export type ReferralStats = {
  tracked: boolean;
  payoutReady: boolean;
  code: string | null;
  referred: number;
  volume: number;
  earned: number;
  claimable: number;
  paid: number;
  minClaim: number;
  takeBps: number;
  shareBps: number;
  leaders: Array<{ code: string; referred: number; volume: number }>;
};

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

export function ReferralPanel({ wallet }: { wallet?: string | null }) {
  const privyMounted = usePrivyMounted();
  if (!privyMounted) return <ReferralCopy />;
  return <ReferralAuthed wallet={wallet ?? null} />;
}

function ReferralCopy() {
  return (
    <section className="overflow-hidden rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
      <h2 className="text-lg font-semibold">Referrals</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Share your link. You earn 20% of the trading fees people generate
        through it. Claim pays USDG to your cash wallet.
      </p>
    </section>
  );
}

function ReferralAuthed({ wallet }: { wallet: string | null }) {
  const { authenticated, getAccessToken, user } = usePrivy();
  const cash = wallet ?? primaryWalletAddress(user);
  const { openModal } = useAuthModal();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const load = async () => {
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    const next = await authed<ReferralStats>(token, "/api/referral");
    setStats(next);
    if (next.code) setName(next.code);
  };

  useEffect(() => {
    if (!authenticated) {
      setStats(null);
      return;
    }
    void load().catch(() => {});
  }, [authenticated, getAccessToken]);

  if (!authenticated) {
    return (
      <section className="overflow-hidden rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
        <h2 className="text-lg font-semibold">Referrals</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Share your link. You earn 20% of the trading fees people generate
          through it. Claim pays USDG to your cash wallet.
        </p>
        <button
          type="button"
          onClick={openModal}
          className="mt-4 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black"
        >
          Sign in to get your link
        </button>
      </section>
    );
  }

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://hedgeapp.trade";
  const code = stats?.code ?? parseReferralCode(name);
  const link = code ? `${origin}${referralPath(code)}` : null;
  const canClaim =
    Boolean(cash) &&
    (stats?.payoutReady ?? false) &&
    (stats?.claimable ?? 0) + 1e-9 >= (stats?.minClaim ?? REFERRAL_MIN_CLAIM);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again.");
      const parsed = parseReferralCode(name);
      if (!parsed) {
        throw new Error(
          "Use 3 to 24 letters, numbers, or hyphens. Start and end with a letter or number.",
        );
      }
      await authed(token, "/api/referral", {
        method: "POST",
        body: JSON.stringify({ code: parsed }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that name.");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const claim = async () => {
    if (!cash) return;
    setError(null);
    setHash(null);
    setClaiming(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again.");
      const result = await authed<{ hash: string; amount: number }>(
        token,
        "/api/referral/claim",
        {
          method: "POST",
          body: JSON.stringify({ wallet: cash }),
        },
      );
      setHash(result.hash);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed.");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
      <h2 className="text-lg font-semibold">Referrals</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Pick a name. Share the link. You earn 20% of the trading fees from
        people who use it. Claim sends USDG to your cash wallet.
      </p>
      {stats && !stats.tracked ? (
        <p className="mt-3 text-sm text-gold">
          Referrals are not live yet. You can still pick a name once tracking
          is connected.
        </p>
      ) : null}

      <label className="mt-5 block text-[12px] font-medium text-muted">
        Your name
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          maxLength={24}
          placeholder="your-name"
          className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3 outline-none focus:border-gold/60"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || stats?.tracked === false}
          className="shrink-0 rounded-full bg-white/10 px-4 py-3 text-sm font-semibold disabled:opacity-50"
        >
          {saving ? "Saving" : "Save"}
        </button>
      </div>

      {link ? (
        <button
          type="button"
          onClick={() => void copy()}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-[#0f0f0f] px-4 py-3 text-left text-[13px]"
        >
          <span className="min-w-0 truncate font-mono text-white/90">{link}</span>
          <span className="shrink-0 font-semibold text-gold">
            {copied ? (
              <span className="inline-flex items-center gap-1">
                <CheckIcon /> Copied
              </span>
            ) : (
              "Copy"
            )}
          </span>
        </button>
      ) : (
        <p className="mt-3 text-[13px] text-muted">
          Save a name to get your link.
        </p>
      )}

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="Referred" value={String(stats?.referred ?? 0)} />
        <Stat label="Volume" value={fiat(stats?.volume ?? 0)} />
        <Stat label="Earned" value={fiat(stats?.earned ?? 0)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Claimable {fiat(stats?.claimable ?? 0)}
          {(stats?.minClaim ?? REFERRAL_MIN_CLAIM) > 0
            ? ` · min ${fiat(stats?.minClaim ?? REFERRAL_MIN_CLAIM)}`
            : ""}
        </p>
        <button
          type="button"
          onClick={() => void claim()}
          disabled={!canClaim || claiming}
          className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {claiming ? "Sending" : "Claim USDG"}
        </button>
      </div>
      {!stats?.payoutReady ? (
        <p className="mt-2 text-[12px] text-muted">
          Payouts are not on yet. Earnings still accrue.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      {hash ? (
        <a
          href={`${RH_EXPLORER}/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[13px] font-semibold text-gold"
        >
          View payout
        </a>
      ) : null}

      {(stats?.leaders.length ?? 0) > 0 ? (
        <div className="mt-6">
          <h3 className="text-[13px] font-semibold text-muted">Top referrers</h3>
          <ul className="mt-2 divide-y divide-white/5">
            {stats!.leaders.map((row) => (
              <li
                key={row.code}
                className="flex items-center justify-between gap-3 py-2 text-[13px]"
              >
                <span className="truncate text-white">@{row.code}</span>
                <span className="shrink-0 text-muted">
                  {row.referred} · {fiat(row.volume)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#0f0f0f] px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
