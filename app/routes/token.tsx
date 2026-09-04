import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "../components/icons";
import { originFromMatches, siteMeta } from "../lib/seo";
import { shorten } from "../lib/format";
import {
  HEDGE_CA,
  HEDGE_DEXSCREENER,
  HEDGE_EXPLORER,
  HEDGE_SITE,
  fetchHedgeBurns,
  fetchHedgePair,
  formatHedgeAmount,
  formatTokenUsd,
  type HedgeBurns,
  type HedgePair,
} from "../lib/hedge-token";
import type { Route } from "./+types/token";

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({
    title: "$HEDGE · Hedge",
    origin: originFromMatches(matches),
  });
}

export async function loader() {
  const [pair, burns] = await Promise.all([fetchHedgePair(), fetchHedgeBurns()]);
  return { pair, burns };
}

export default function Token({ loaderData }: Route.ComponentProps) {
  const [pair, setPair] = useState<HedgePair | null>(loaderData.pair);
  const [burns, setBurns] = useState<HedgeBurns>(loaderData.burns);

  useEffect(() => {
    setPair(loaderData.pair);
    setBurns(loaderData.burns);
  }, [loaderData.pair, loaderData.burns]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/token");
        if (!res.ok) return;
        const data: unknown = await res.json();
        const next = data as { pair?: HedgePair | null; burns?: HedgeBurns };
        if (!alive) return;
        if (next.pair) setPair(next.pair);
        if (next.burns) setBurns(next.burns);
      } catch {
        /* keep the last good snapshot */
      }
    };
    const id = window.setInterval(() => void tick(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <main className="mx-auto min-w-0 max-w-3xl space-y-4 px-3 pt-5 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:space-y-5 sm:px-4 sm:pt-8 lg:pb-10">
      <section className="overflow-hidden rounded-3xl bg-card ring-1 ring-white/5">
        <div className="border-b border-white/5 p-5 sm:p-6">
          <p className="text-[13px] font-semibold text-muted">$HEDGE</p>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight sm:text-3xl">
            The token behind Hedge
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted sm:text-[15px]">
            $HEDGE is the native token of the Hedge prediction platform on
            Robinhood Chain. Verify the contract before you buy. Only this
            address is $HEDGE.
          </p>
          <a
            href={HEDGE_DEXSCREENER}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Buy $HEDGE
          </a>
        </div>

        <div className="border-b border-white/5 px-5 py-4 sm:px-6">
          <p className="text-[11px] uppercase tracking-wide text-muted">Price</p>
          <p className="mt-1 text-2xl font-bold tabular-nums sm:text-3xl">
            {formatTokenUsd(pair?.priceUsd ?? null)}
          </p>
        </div>

        <ContractRow />

        <div className="divide-y divide-white/5 border-t border-white/5">
          <InfoLink
            label="Website"
            href={HEDGE_SITE}
            value="hedgeapp.trade"
          />
          {burns.latestHref ? (
            <InfoLink
              label="Burn txn"
              href={burns.latestHref}
              value={shorten(burns.latestHash)}
            />
          ) : null}
          <InfoRow
            label="Total burnt"
            value={`${formatHedgeAmount(burns.total)} $HEDGE`}
          />
        </div>
      </section>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6">
        <h2 className="text-[1.15rem] font-semibold tracking-tight sm:text-xl">
          30% of fees goes straight to buyback and burn
        </h2>
        <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[#cfcfcf]">
          <p>
            Every trade on Hedge pays a fee. 30% of those fees is routed
            straight into buyback and burn. $HEDGE is bought on the open market
            and permanently removed from supply.
          </p>
          <p>
            That loop is the token&apos;s core utility. Platform volume creates
            buy pressure, and each burn reduces circulating $HEDGE. The more
            people trade predictions, the more the token is bought and the
            smaller the remaining supply.
          </p>
        </div>
      </section>
    </main>
  );
}

function ContractRow() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(HEDGE_CA);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted">
          Contract address
        </p>
        <p className="mt-1 truncate font-mono text-[13px] font-semibold sm:text-[14px]">
          {HEDGE_CA}
        </p>
      </div>
      <a
        href={HEDGE_EXPLORER}
        target="_blank"
        rel="noreferrer"
        className="rounded-full bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-[#cfcfcf] transition hover:text-white"
      >
        Explorer
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-full bg-white/5 p-1.5 text-[#cfcfcf] transition hover:text-white"
        aria-label={copied ? "Copied" : "Copy contract address"}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="truncate font-mono text-[13px] font-semibold tabular-nums sm:text-[14px]">
        {value}
      </p>
    </div>
  );
}

function InfoLink({
  label,
  href,
  value,
}: {
  label: string;
  href: string;
  value: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-white/[0.03] sm:px-6"
    >
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="truncate font-mono text-[13px] font-semibold text-gold sm:text-[14px]">
        {value}
      </p>
    </a>
  );
}
