import { useEffect, useState } from "react";
import {
  useAuthorizationSignature,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { PRIVY_RESTORE_MS } from "../lib/privy-session";
import { usePrivyMounted } from "./Providers";
import {
  markNativeTicket,
  sideLabel,
  ticketCanRefund,
  timeframeFromSlug,
  POOL_REFUND_COPY,
  type NativeTicketView,
} from "../lib/native";
import type { LivePosition } from "../lib/polymarket-portfolio";
import { poolIsLive } from "../lib/hedge-pool";
import { claimPool, refundPool, type PoolSendContext } from "../lib/pool-actions";
import {
  findWallet,
  primaryWalletAddress,
  useEnsureCashWallet,
} from "../lib/wallet";
import { LivePositionCard } from "./PositionPnl";

export function liveFromNativeTicket(ticket: NativeTicketView): LivePosition {
  const mark = markNativeTicket(ticket);
  const outcome = sideLabel(
    ticket.kind,
    ticket.side,
    ticket.token_a,
    ticket.token_b,
  );
  const closed =
    ticket.resolved_side != null || Boolean(ticket.payoutTx);
  const refundable = ticketCanRefund(ticket);
  return {
    id: ticket.id,
    wallet: ticket.wallet ?? "",
    tokenId: null,
    conditionId: null,
    eventSlug: null,
    marketSlug: ticket.slug,
    href: `/pool/${ticket.slug}`,
    title: ticket.title,
    outcome,
    side: ticket.side === "a" ? "yes" : "no",
    shares: ticket.amount,
    entryPrice: mark.entryPrice,
    currentPrice: mark.markPrice,
    exitPrice: closed ? mark.markPrice : null,
    initialValue: ticket.amount,
    currentValue: mark.currentValue,
    pnl: mark.pnl,
    pctChange: mark.pctChange,
    status: closed ? "closed" : "open",
    redeemable:
      !ticket.payoutTx &&
      (Boolean(ticket.claimable) || Boolean(ticket.releasable)) &&
      (ticket.resolved_side === "void" ||
        ticket.resolved_side === ticket.side ||
        Boolean(ticket.releasable)),
    refundable,
    stakeBack: Boolean(ticket.releasable) && !ticket.payoutTx,
    endDate: ticket.expiry_at,
    leverage: 1,
    duration: ticket.timeframe ?? timeframeFromSlug(ticket.slug),
  };
}

export function NativeTicketCard({
  ticket,
  onClaim,
  onRefund,
}: {
  ticket: NativeTicketView;
  onClaim?: () => void;
  onRefund?: () => void;
}) {
  const canClaim = Boolean(onClaim) && !ticket.payoutTx;
  const canRefund = Boolean(onRefund) && ticketCanRefund(ticket);
  return (
    <LivePositionCard
      position={liveFromNativeTicket(ticket)}
      showClose={canClaim || canRefund}
      onClose={canClaim ? onClaim : canRefund ? onRefund : undefined}
    />
  );
}

export function NativeTickets({ compact = false }: { compact?: boolean }) {
  const privyMounted = usePrivyMounted();
  if (!privyMounted) return null;
  return <NativeTicketsInner compact={compact} />;
}

function NativeTicketsInner({ compact }: { compact: boolean }) {
  const { authenticated, getAccessToken, user } = usePrivy();
  const { wallets } = useWallets();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { cashAddress, ensureCashWallet } = useEnsureCashWallet();
  const cashWallet = findWallet(wallets, cashAddress);
  const [tickets, setTickets] = useState<NativeTicketView[] | null>(null);
  const [busyId, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const token = await getAccessToken().catch(() => null);
    if (!token) return;
    const res = await fetch("/api/native/tickets", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { tickets?: NativeTicketView[] };
    if (Array.isArray(data.tickets)) setTickets(data.tickets);
  }

  useEffect(() => {
    if (!authenticated) {
      setTickets(null);
      return;
    }
    let alive = true;
    const run = async () => {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      const res = await fetch("/api/native/tickets", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { tickets?: NativeTicketView[] };
      if (alive && Array.isArray(data.tickets)) setTickets(data.tickets);
    };
    const start = window.setTimeout(() => {
      void run();
    }, PRIVY_RESTORE_MS);
    const onPlaced = () => void run();
    window.addEventListener("native-ticket", onPlaced);
    return () => {
      alive = false;
      window.clearTimeout(start);
      window.removeEventListener("native-ticket", onPlaced);
    };
  }, [authenticated, getAccessToken]);

  async function poolCtx(preferred?: string | null): Promise<PoolSendContext> {
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in again.");
    const wanted = preferred?.trim() || null;
    const signer =
      (wanted ? findWallet(wallets, wanted) : null) ??
      (await ensureCashWallet()) ??
      cashWallet;
    const from = signer?.address ?? primaryWalletAddress(user, wallets);
    if (!from || !signer) {
      throw new Error("Connect the wallet that holds this ticket.");
    }
    if (wanted && signer.address.toLowerCase() !== wanted.toLowerCase()) {
      throw new Error("Connect the wallet that holds this ticket.");
    }
    return {
      accessToken: token,
      from,
      wallet: signer,
      signAuthorization: async (payload) => {
        const { signature } = await generateAuthorizationSignature(payload);
        if (!signature) throw new Error("Could not authorize this wallet.");
        return signature;
      },
    };
  }

  async function recordRefund(slug: string, wallet: string, txHash: string) {
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in again.");
    const res = await fetch("/api/native/refund", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ slug, wallet, txHash }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(data?.error ?? "Could not record that refund.");
  }

  async function onRefund(ticket: NativeTicketView) {
    setError(null);
    setBusy(ticket.id);
    try {
      const ctx = await poolCtx(ticket.wallet);
      let hash = "";
      try {
        hash = await refundPool(ctx, ticket.slug);
      } catch (err) {
        const text = err instanceof Error ? err.message : "";
        if (!/No ticket/i.test(text)) throw err;
      }
      await recordRefund(ticket.slug, ctx.from, hash);
      window.dispatchEvent(new Event("native-ticket"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refund.");
    } finally {
      setBusy(null);
    }
  }

  async function releaseTicket(ticket: NativeTicketView) {
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in again.");
    const res = await fetch("/api/native/release", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ slug: ticket.slug }),
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      payout?: number;
    } | null;
    if (!res.ok) {
      const raw = data?.error?.trim() ?? "";
      throw new Error(
        raw && raw.length < 160 ? raw : "Could not release this stake.",
      );
    }
    return data?.payout ?? 0;
  }

  async function onClaim(ticket: NativeTicketView) {
    setError(null);
    setBusy(ticket.id);
    try {
      const ctx = await poolCtx(ticket.wallet);
      let payout = ticket.claimable ? ticket.amount : 0;
      if (!ticket.claimable || ticket.releasable) {
        payout = await releaseTicket(ticket);
      }
      if (!(payout > 0)) {
        throw new Error("This side lost. There is nothing to claim.");
      }
      await claimPool(ctx, ticket.slug);
      window.dispatchEvent(new Event("native-ticket"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim.");
    } finally {
      setBusy(null);
    }
  }

  if (!authenticated || !tickets || tickets.length === 0) {
    return null;
  }

  return (
    <section id="tickets" className={compact ? "mt-5" : "mt-8"}>
      <h2 className="text-xl font-semibold text-white">Your tickets</h2>
      <p className="mt-1 text-sm text-muted">
        {POOL_REFUND_COPY} After expiry, Claim stake settles a one-sided pot
        and returns your USDG. That is a refund, not a profit.
      </p>
      {error ? <p className="mt-2 text-sm text-down">{error}</p> : null}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {tickets.map((ticket) => {
          const canClaim =
            poolIsLive &&
            !ticket.payoutTx &&
            (Boolean(ticket.claimable) || Boolean(ticket.releasable));
          const canRefund = poolIsLive && ticketCanRefund(ticket);
          return (
            <li
              key={ticket.id}
              className={`min-w-0 ${busyId === ticket.id ? "opacity-60" : ""}`}
            >
              <NativeTicketCard
                ticket={ticket}
                onClaim={canClaim ? () => void onClaim(ticket) : undefined}
                onRefund={canRefund ? () => void onRefund(ticket) : undefined}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
