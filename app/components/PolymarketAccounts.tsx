import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { useWallets, type User } from "@privy-io/react-auth";
import type { loader as accountLoader } from "../routes/api.pm.account";
import type { PolymarketAccountSnapshot } from "../lib/polymarket-account";
import { fiat } from "../lib/format";
import { deriveDepositWallet, resolvePolymarketFunder } from "../lib/pm-funder";
import { loadDepositWallet } from "../lib/pm-wallet";
import { isEmbeddedWallet, linkedEmbeddedAddress } from "../lib/wallet";
import { watchBalanceReloads } from "../lib/positions";

function snapshotFor(
  accounts: PolymarketAccountSnapshot[] | undefined,
  address?: string | null,
) {
  if (!address || !accounts) return undefined;
  const key = address.toLowerCase();
  return accounts.find((row) => row.address.toLowerCase() === key);
}

export function PolymarketAccounts({
  user,
  onCashOut,
}: {
  user: User | null;
  onCashOut?: (pusd: number) => void;
}) {
  const { wallets: connected } = useWallets();
  const wallets = (user?.linkedAccounts ?? []).filter(
    (account) => account.type === "wallet",
  ) as { address: string; walletClientType?: string | null }[];
  const embedded = wallets
    .filter((w) => isEmbeddedWallet(w.walletClientType))
    .map((w) => w.address);
  const liveEmbedded = connected
    .filter((w) => isEmbeddedWallet(w.walletClientType))
    .map((w) => w.address);
  const linked = linkedEmbeddedAddress(user);
  const signers = [
    ...new Set(
      [...embedded, ...liveEmbedded, linked].filter(
        (a): a is string => Boolean(a && /^0x[a-fA-F0-9]{40}$/.test(a)),
      ),
    ),
  ];

  const [funders, setFunders] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const next: Record<string, string> = {};
    for (const signer of signers) {
      next[signer.toLowerCase()] =
        loadDepositWallet(signer) ?? deriveDepositWallet(signer);
    }
    setFunders(next);
    void Promise.all(
      signers.map(async (signer) => {
        try {
          return [signer.toLowerCase(), await resolvePolymarketFunder(signer)] as const;
        } catch {
          return [signer.toLowerCase(), next[signer.toLowerCase()]!] as const;
        }
      }),
    ).then((rows) => {
      if (!cancelled) setFunders(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signers.join(",")]);

  const rows = useMemo(
    () =>
      signers.map((signer) => {
        const funder =
          funders[signer.toLowerCase()] ??
          loadDepositWallet(signer) ??
          deriveDepositWallet(signer);
        return { signer, proxy: funder };
      }),
    [signers, funders],
  );

  const addresses = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const value of [row.signer, row.proxy]) {
        if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
      }
    }
    return out;
  }, [rows]);

  const fetcher = useFetcher<typeof accountLoader>();

  useEffect(() => {
    if (addresses.length === 0) return;
    const load = () => {
      void fetcher.load(
        `/api/pm/account?addresses=${encodeURIComponent(addresses.join(","))}`,
      );
    };
    return watchBalanceReloads(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses.join(",")]);

  const accounts = fetcher.data?.accounts ?? [];
  if (rows.length === 0) return null;

  return (
    <section>
      {/* The heading lives with the toggle in the parent, which switches this
          panel with the swap one. */}
      <div className="space-y-2">
        {rows.map((row) => {
          const proxySnap = snapshotFor(accounts, row.proxy);
          const signerSnap = snapshotFor(accounts, row.signer);
          const proxyPusd = proxySnap?.pusd ?? 0;
          const signerPusd =
            row.proxy.toLowerCase() !== row.signer.toLowerCase()
              ? (signerSnap?.pusd ?? 0)
              : 0;
          const pusd = proxyPusd + signerPusd;
          return (
            <CompactRow
              key={row.signer}
              pusd={pusd}
              loading={fetcher.state !== "idle" && fetcher.data == null}
              onCashOut={onCashOut && pusd >= 1 ? () => onCashOut(pusd) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

function CompactRow({
  pusd,
  loading,
  onCashOut,
}: {
  pusd: number;
  loading: boolean;
  onCashOut?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card px-3.5 py-3 ring-1 ring-white/5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted">On Polymarket</p>
        <p className="text-[13px] leading-snug text-[#8a8a8a]">
          Trading balance — deposit USDG from Receive, not here.
        </p>
      </div>
      <div className="text-right">
        <p className="text-[13px] text-muted">pUSD</p>
        <p className="text-[15px] font-semibold tabular-nums">
          {loading ? "…" : fiat(pusd)}
        </p>
      </div>
      {onCashOut ? (
        <button
          type="button"
          onClick={onCashOut}
          className="shrink-0 rounded-full bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-[#cfcfcf] transition hover:text-white"
        >
          Cash out
        </button>
      ) : null}
    </div>
  );
}
