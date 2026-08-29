import { Link } from "react-router";
import { fiat, signedPct } from "../lib/format";
import { leverageFromEntry, pnlTone } from "../lib/pnl";
import type { LivePosition } from "../lib/polymarket-portfolio";

function sharePrice(price: number) {
  if (!Number.isFinite(price) || price <= 0) return "—";
  return fiat(price);
}

export function liveHref(position: LivePosition) {
  if (position.eventSlug) return `/market/${position.eventSlug}`;
  if (position.marketSlug) return `/market/${position.marketSlug}`;
  return "/";
}

function SiteQr() {
  return (
    <div className="size-11 overflow-hidden rounded-md @sm:size-14 @lg:size-[72px]">
      <img src="/api/qr" alt="" className="h-full w-full object-cover" />
    </div>
  );
}

export function PnlShareCard({
  title,
  href,
  outcome,
  entryPrice,
  markPrice,
  pnl,
  pctChange,
  status,
  loading = false,
  asLink = true,
  rounded = true,
  leverage: leverageOverride,
}: {
  title: string;
  href: string;
  outcome: string;
  entryPrice: number;
  markPrice: number | null;
  pnl: number | null;
  pctChange: number | null;
  status: "open" | "closed";
  loading?: boolean;
  /** Off inside the share modal, where the card is artwork rather than a link. */
  asLink?: boolean;
  /** Off for the downloaded image, which should be a full-bleed square. */
  rounded?: boolean;
  /**
   * Borrowed multiple (2x / 3x). When omitted, the badge uses the implied
   * payout from the entry price, which is what a spot ticket is.
   */
  leverage?: number | null;
}) {
  const tone = pnl == null ? "flat" : pnlTone(pnl);
  const pctColor =
    tone === "up"
      ? "text-[#81e36e]"
      : tone === "down"
        ? "text-down"
        : "text-white";
  const badge =
    tone === "up"
      ? "bg-[#37482a] text-[#81e36e]"
      : tone === "down"
        ? "bg-[#482a2a] text-down"
        : "bg-white/10 text-white";
  const leverage =
    leverageOverride != null && leverageOverride > 1
      ? leverageOverride % 1 === 0
        ? leverageOverride
        : Math.round(leverageOverride * 10) / 10
      : leverageFromEntry(entryPrice);
  const pctText =
    loading && pctChange == null
      ? "…"
      : pctChange == null
        ? "—"
        : signedPct(pctChange, 2);
  const markLabel = status === "open" ? "Now" : "Exit price";

  const body = (
    <>
      <img
        src="/assets/pnl/honeycomb.png"
        alt=""
        width={512}
        height={512}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <div className="relative flex h-full min-w-0 flex-1 flex-col justify-between gap-3 p-4 @sm:p-5 @lg:gap-5 @lg:p-8">
        <p className="line-clamp-3 max-w-[92%] text-[22px] font-medium leading-[1.15] tracking-tight text-white @sm:text-[26px] @lg:text-[34px]">
          {title}
        </p>

        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-2 @sm:gap-3 @lg:gap-4">
            <p
              className={`min-w-0 text-[40px] font-medium leading-none tracking-tight @sm:text-[52px] @lg:text-[68px] ${pctColor}`}
            >
              {pctText}
            </p>
            <span
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[15px] font-medium tracking-tight @sm:text-[17px] @lg:mt-2 @lg:px-4 @lg:py-1.5 @lg:text-[22px] ${badge}`}
            >
              <span className="max-w-[7rem] truncate @lg:max-w-[10rem]">
                {outcome}
              </span>
              {leverage != null ? <span>{leverage}x</span> : null}
            </span>
          </div>

          <div className="mt-4 space-y-1.5 text-[15px] font-medium tracking-tight @sm:mt-5 @sm:text-[17px] @lg:mt-7 @lg:space-y-2.5 @lg:text-[22px]">
            <div className="flex gap-6">
              <span className="w-[7.5rem] shrink-0 text-white/70 @lg:w-[10rem]">
                Entry price
              </span>
              <span className="tabular-nums text-white">
                {sharePrice(entryPrice)}
              </span>
            </div>
            <div className="flex gap-6">
              <span className="w-[7.5rem] shrink-0 text-white/70 @lg:w-[10rem]">
                {markLabel}
              </span>
              <span className="tabular-nums text-white">
                {markPrice == null ? "—" : sharePrice(markPrice)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <SiteQr />
          <img
            src="/assets/pnl/wordmark.svg"
            alt="Hedge"
            width={343}
            height={87}
            className="h-7 w-auto @sm:h-8 @lg:h-11"
          />
        </div>
      </div>
    </>
  );

  // Sized off the card's own width, not the viewport: it renders at ~320px
  // inside the share modal even on a desktop screen.
  const shell = `@container relative flex aspect-square w-full overflow-hidden bg-[#141414] ${
    rounded ? "rounded-[28px] ring-1 ring-white/5" : ""
  }`;

  if (!asLink) return <div className={shell}>{body}</div>;

  return (
    <Link to={href} className={`${shell} transition hover:ring-white/15`}>
      {body}
    </Link>
  );
}
