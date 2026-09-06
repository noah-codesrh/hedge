import { useEffect, useState } from "react";
import { Link } from "react-router";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyMounted } from "./Providers";
import {
  nativePhase,
  sideLabel,
  type NativeTicketView,
} from "../lib/native";
import { fiat } from "../lib/format";
import { RH_EXPLORER } from "../lib/robinhood";

function statusLine(ticket: NativeTicketView) {
  const phase = nativePhase(ticket);
  if (ticket.payoutTx) return `Paid ${fiat(ticket.payout)}`;
  if (ticket.resolved_side === "void") return "Refund pending";
  if (ticket.resolved_side && ticket.side === ticket.resolved_side) {
    return `Won · ${fiat(ticket.payout)}`;
  }
  if (ticket.resolved_side) return "Lost";
  if (phase === "locked") return "Locked";
  return `Open · pays about ${fiat(ticket.payout)}`;
}

export function NativeTickets({ compact = false }: { compact?: boolean }) {
  const privyMounted = usePrivyMounted();
  if (!privyMounted) return null;
  return <NativeTicketsInner compact={compact} />;
}

function NativeTicketsInner({ compact }: { compact: boolean }) {
  const { authenticated, getAccessToken } = usePrivy();
  const [tickets, setTickets] = useState<NativeTicketView[] | null>(null);

  useEffect(() => {
    if (!authenticated) {
      setTickets(null);
      return;
    }
    let alive = true;
    const load = async () => {
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
    void load();
    const onPlaced = () => void load();
    window.addEventListener("native-ticket", onPlaced);
    return () => {
      alive = false;
      window.removeEventListener("native-ticket", onPlaced);
    };
  }, [authenticated, getAccessToken]);

  if (!authenticated || !tickets || tickets.length === 0) {
    return null;
  }

  return (
    <section id="tickets" className={compact ? "mt-5" : "mt-8"}>
      <h2 className="text-xl font-semibold text-white">Your tickets</h2>
      <p className="mt-1 text-sm text-muted">
        Pool positions. Winners are paid at expiry from escrow.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {tickets.map((ticket) => {
          const side = sideLabel(
            ticket.kind,
            ticket.side,
            ticket.token_a,
            ticket.token_b,
          );
          return (
            <li
              key={ticket.id}
              className="rounded-2xl bg-card px-4 py-3.5 ring-1 ring-white/5"
            >
              <Link
                to={`/pool/${ticket.slug}`}
                prefetch="intent"
                className="block"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gold">
                  {ticket.kind === "pvp" ? "Meme PvP" : "Strike"} · {side}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-white">
                  {ticket.title}
                </p>
                <p className="mt-2 text-sm tabular-nums text-muted">
                  {fiat(ticket.amount)} · {statusLine(ticket)}
                </p>
              </Link>
              {ticket.txHash ? (
                <a
                  href={`${RH_EXPLORER}/tx/${ticket.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[12px] font-semibold text-gold hover:underline"
                >
                  Stake tx
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
