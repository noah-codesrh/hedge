import { Link } from "react-router";
import { LayersIcon } from "./icons";

/**
 * Tells people leverage is not finished yet and points them at what is.
 *
 * Shown on both the leverage tab and the earn page so the message is the same
 * in both places — someone who reads it on one and then lands on the other
 * should not be told a different story.
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
            Leverage is up soon.
          </span>{" "}
          We're fine-tuning the liquidity pool first. Every market on Hedge
          trades as normal in the meantime.
        </p>
      </div>
      <Link
        to="/"
        className="shrink-0 self-start rounded-full bg-gold px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-gold/90 sm:self-auto"
      >
        Explore markets
      </Link>
    </div>
  );
}
