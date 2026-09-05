import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthModal, usePrivyMounted } from "./Providers";
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  ShareIcon,
  TelegramIcon,
  WhatsAppIcon,
  XIcon,
} from "./icons";
import { fiat } from "../lib/format";
import {
  parseReferralCode,
  referralPath,
  REFERRAL_MIN_CLAIM,
} from "../lib/referral";
import { primaryWalletAddress } from "../lib/wallet";
import { identityName } from "../lib/nickname";
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

const SHARE_TEXT = "Trade predictions on Hedge.";

function origin() {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://hedgeapp.trade";
}

function socialHref(
  kind: "x" | "telegram" | "whatsapp",
  link: string,
) {
  const text = `${SHARE_TEXT} ${link}`;
  if (kind === "x") {
    return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
  }
  if (kind === "telegram") {
    return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(SHARE_TEXT)}`;
  }
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function ReferralTeaser() {
  return (
    <section className="overflow-hidden rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
      <h2 className="text-lg font-semibold capitalize sm:text-xl">
        Invite friends. Call the future.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted sm:text-[15px]">
        Share Hedge with people who have opinions worth backing.
      </p>
      <Link
        to="/profile/referral"
        prefetch="intent"
        className="mt-4 inline-flex rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-105"
      >
        Share invite
      </Link>
    </section>
  );
}

export function ReferralInvite({ wallet }: { wallet?: string | null }) {
  const privyMounted = usePrivyMounted();
  if (!privyMounted) return <ReferralHero />;
  return <ReferralAuthed wallet={wallet ?? null} />;
}

function ReferralHero({
  displayName = "Your name",
  link = null,
  onShare,
  sharing = false,
  copied = false,
}: {
  displayName?: string;
  link?: string | null;
  onShare?: () => void;
  sharing?: boolean;
  copied?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <ReferralCard name={displayName} link={link} />
      <div className="mt-10 w-full max-w-[475px] text-center sm:mt-12">
        <h1 className="text-[36px] font-medium leading-[1.1] tracking-[-0.03em] text-white capitalize sm:text-[48px] lg:text-[59px] lg:tracking-[-1.77px]">
          Invite friends. Call the future.
        </h1>
        <p className="mt-6 text-[18px] leading-snug text-white/80 sm:text-2xl">
          Share Hedge with people who have opinions worth backing.
        </p>
      </div>
      <div className="mt-9 flex flex-col items-center gap-5">
        <button
          type="button"
          onClick={onShare}
          disabled={!onShare || sharing}
          className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-105 disabled:opacity-50"
        >
          {copied ? "Copied" : sharing ? "Sharing" : "Share invite"}
        </button>
        <ShareRow link={link} />
      </div>
    </div>
  );
}

function ReferralCard({
  name,
  link,
}: {
  name: string;
  link: string | null;
}) {
  const code = link ? parseReferralCode(new URL(link).searchParams.get("ref")) : null;
  const qr = code ? `/api/qr?ref=${encodeURIComponent(code)}` : "/api/qr";

  return (
    <div
      className="relative h-[433px] w-[min(100%,326px)] overflow-hidden rounded-[21px] bg-[#141414] shadow-[0px_4px_77px_0px_rgba(241,214,90,0.12)]"
    >
      <div className="absolute left-[23px] top-[30px] z-10">
        <p className="text-[23px] font-medium leading-none tracking-[-0.68px] text-white capitalize">
          Referral card
        </p>
        <img
          src="/assets/referral/wordmark.svg"
          alt="Hedge"
          width={100}
          height={23}
          className="mt-[11px] h-[23px] w-[100px]"
        />
      </div>
      <div className="absolute right-[23px] top-[30px] z-10 size-[66px] overflow-hidden">
        <img src={qr} alt="" width={66} height={66} className="size-full object-cover" />
      </div>
      <p className="absolute left-1/2 top-[191px] z-10 w-[90%] -translate-x-1/2 truncate text-center text-[34px] font-medium leading-none tracking-[-1.02px] text-white">
        {name}
      </p>
      <img
        src="/assets/referral/honeycomb.png"
        alt=""
        width={346}
        height={273}
        aria-hidden
        className="pointer-events-none absolute -bottom-[85px] -left-[18px] h-[273px] w-[346px] max-w-none object-cover"
      />
    </div>
  );
}

function ShareRow({ link }: { link: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const nativeShare = async () => {
    if (!link) return;
    if (navigator.share) {
      await navigator.share({ title: "Hedge", text: SHARE_TEXT, url: link }).catch(() => {});
      return;
    }
    await copy();
  };

  const btn =
    "grid size-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-muted transition hover:border-white/25 hover:text-white disabled:opacity-40";

  return (
    <div className="flex items-center gap-2">
      <ShareLink href={link ? socialHref("x", link) : null} label="Share on X" className={btn}>
        <XIcon size={15} />
      </ShareLink>
      <ShareLink
        href={link ? socialHref("telegram", link) : null}
        label="Share on Telegram"
        className={btn}
      >
        <TelegramIcon size={16} />
      </ShareLink>
      <ShareLink
        href={link ? socialHref("whatsapp", link) : null}
        label="Share on WhatsApp"
        className={btn}
      >
        <WhatsAppIcon size={16} />
      </ShareLink>
      <button type="button" onClick={() => void copy()} disabled={!link} aria-label="Copy link" className={btn}>
        {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      </button>
      <button type="button" onClick={() => void nativeShare()} disabled={!link} aria-label="Share" className={btn}>
        <ShareIcon size={15} />
      </button>
    </div>
  );
}

function ShareLink({
  href,
  label,
  className,
  children,
}: {
  href: string | null;
  label: string;
  className: string;
  children: ReactNode;
}) {
  if (!href) {
    return (
      <span className={`${className} pointer-events-none`} aria-hidden>
        {children}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} className={className}>
      {children}
    </a>
  );
}

function ReferralAuthed({ wallet }: { wallet: string | null }) {
  const { authenticated, getAccessToken, user } = usePrivy();
  const cash = wallet ?? primaryWalletAddress(user);
  const { openModal } = useAuthModal();
  const nameField = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const load = async () => {
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    const next = await authed<ReferralStats>(token, "/api/referral");
    setStats(next);
    if (next.code) {
      setName(next.code);
      setEditing(false);
    }
  };

  useEffect(() => {
    if (!authenticated) {
      setStats(null);
      return;
    }
    void load().catch(() => {});
  }, [authenticated, getAccessToken]);

  const code = stats?.code ?? null;
  const link = code ? `${origin()}${referralPath(code)}` : null;
  const cardName = code || identityName(user) || "Your name";
  const canClaim =
    Boolean(cash) &&
    (stats?.payoutReady ?? false) &&
    (stats?.claimable ?? 0) + 1e-9 >= (stats?.minClaim ?? REFERRAL_MIN_CLAIM);

  const share = async () => {
    if (!authenticated) {
      openModal();
      return;
    }
    if (!link) return;
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Hedge", text: SHARE_TEXT, url: link });
      } else {
        await navigator.clipboard?.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* user cancelled */
    } finally {
      setSharing(false);
    }
  };

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
    <>
      <ReferralHero
        displayName={cardName}
        link={link}
        onShare={() => void share()}
        sharing={sharing}
        copied={copied}
      />

      <section className="mx-auto mt-16 w-full max-w-xl rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
        {!authenticated ? (
          <>
            <p className="text-sm leading-relaxed text-muted">
              Sign in to get a code and start earning 20% of the trading fees
              people generate through your link.
            </p>
            <button
              type="button"
              onClick={openModal}
              className="mt-4 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-black"
            >
              Sign in to get your link
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Your link</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              You get a random 6-letter code to start. Change it whenever you
              want. Claim sends USDG to your cash wallet.
            </p>
            {stats && !stats.tracked ? (
              <p className="mt-3 text-sm text-gold">
                Referrals are not live yet. You can still pick a name once
                tracking is connected.
              </p>
            ) : null}

            <label htmlFor={nameField} className="mt-5 block text-[12px] font-medium text-muted">
              Your name
            </label>
            {editing || !stats?.code ? (
              <div className="mt-1.5 flex gap-2">
                <input
                  id={nameField}
                  ref={nameRef}
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
                {stats?.code ? (
                  <button
                    type="button"
                    onClick={() => {
                      setName(stats.code ?? "");
                      setEditing(false);
                      setError(null);
                    }}
                    className="shrink-0 rounded-full px-3 py-3 text-sm font-semibold text-muted"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate rounded-2xl border border-white/10 bg-[#0f0f0f] px-4 py-3 font-mono text-[15px]">
                  {stats.code}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setName(stats.code ?? "");
                    setEditing(true);
                    window.setTimeout(() => nameRef.current?.focus(), 0);
                  }}
                  className="shrink-0 rounded-full bg-white/10 px-4 py-3 text-sm font-semibold"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <PencilIcon /> Edit
                  </span>
                </button>
              </div>
            )}

            {link ? (
              <p className="mt-3 truncate font-mono text-[13px] text-white/80">{link}</p>
            ) : (
              <p className="mt-3 text-[13px] text-muted">Your link appears once tracking is connected.</p>
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
          </>
        )}
      </section>
    </>
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
