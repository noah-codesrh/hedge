import { useAuthModal } from "./Providers";
import { MarketCard } from "./MarketCard";
import type { PolymarketEvent } from "../lib/types";

export function Hero({ featured }: { featured: PolymarketEvent[] }) {
  const { openModal } = useAuthModal();
  const cards = featured.slice(0, 2);

  return (
    <section className="relative overflow-hidden rounded-2xl sm:rounded-3xl">
      <img
        src="/hero-banner.jpg"
        alt=""
        width={1600}
        height={900}
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-top"
      />

      <div className="relative z-10 grid min-w-0 gap-4 p-4 sm:gap-6 sm:p-5 md:min-h-[340px] md:grid-cols-[1fr_auto] md:items-center md:p-8">
        <div className="max-w-md min-w-0">
          <img
            src="/logo-mark-dark.svg"
            alt=""
            className="mb-2 h-8 w-auto sm:mb-3 sm:h-12 md:h-14"
          />
          <h1 className="text-[1.65rem] font-bold leading-tight tracking-tight text-black sm:text-3xl md:text-4xl">
            Trade predictions. Up to 10x leverage
          </h1>
          <p className="mt-1 text-sm font-medium text-black/70 md:text-base">
            Trade Yes/No markets in USDG on Robinhood.
          </p>
          <button
            onClick={openModal}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#141414] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-black sm:mt-5 sm:px-6 sm:py-3"
          >
            <span className="text-gold">●</span> Get started
          </button>
        </div>

        {cards.length > 0 ? (
          <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2 sm:gap-4 md:w-[520px]">
            {cards.map((event, i) => (
              <div
                key={event.id}
                className={i > 0 ? "hidden sm:block" : undefined}
              >
                <MarketCard event={event} dark compact />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
