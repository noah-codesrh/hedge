import { Link } from "react-router";
import type { PolymarketEvent } from "../lib/types";
import { RemoteImg } from "./RemoteImg";

export function FeaturedBanner({ event }: { event: PolymarketEvent }) {
  return (
    <div className="relative h-full min-h-[140px] overflow-hidden rounded-3xl ring-1 ring-white/5 sm:min-h-[200px]">
      {event.image ? (
        <RemoteImg
          src={event.image}
          size={640}
          eager
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 honeycomb" />
      )}
      <div className="absolute inset-0 bg-gradient-to-tr from-black/90 via-black/55 to-black/20" />
      <div className="relative flex h-full min-h-[140px] flex-col justify-end p-4 sm:min-h-[200px] sm:p-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-down animate-pulse-dot" />
          <p className="text-sm font-medium text-gold">Markets live</p>
        </div>
        <h3 className="mt-1 max-w-md text-xl font-bold leading-tight sm:text-2xl">
          {event.title}
        </h3>
        <Link
          to={`/market/${event.slug}`}
          prefetch="intent"
          className="mt-4 inline-flex w-fit rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black transition hover:brightness-105"
        >
          Trade now
        </Link>
      </div>
    </div>
  );
}
