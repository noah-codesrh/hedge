import { Link } from "react-router";
import { LayersIcon } from "./icons";

/**
 * Tells people leveraged trading is not open yet and points them at Earn.
 *
 * Only rendered while `VITE_LEVERAGE_ENABLED` is off. The Earn page has its
 * own seed notice — this one lives on the leverage tab.
 */
export function LeverageWipNotice({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl bg-gold/[0.07] px-4 py-3.5 ring-1 ring-gold/15 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-gold">
          <LayersIcon size={15} />
        </span>
        <p className="min-w-0 text-[13px] leading-relaxed text-muted">
          <span className="font-semibold text-gold">
            Leverage trading is up soon.
          </span>{" "}
          The pool is open. Deposit USDG on Earn — these markets trade as
          normal in the meantime.
        </p>
      </div>
      <Link
        to="/earn"
        className="shrink-0 self-start rounded-full bg-gold px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-gold/90 sm:self-auto"
      >
        Deposit on Earn
      </Link>
    </div>
  );
}
