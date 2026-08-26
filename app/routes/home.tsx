import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { Route } from "./+types/home";
import type { loader as eventsLoader } from "./api.events";
import { FeaturedBanner } from "../components/FeaturedBanner";
import { Hero } from "../components/Hero";
import { MarketCard } from "../components/MarketCard";
import { CategoryBar, MarketNav } from "../components/MarketNav";
import { OutrightCard } from "../components/OutrightCard";
import {
  listEvents,
  searchEvents,
  isLiveMarket,
  pickLiveMarket,
  resolveBrowse,
  categoryLabel,
} from "../lib/polymarket";
import type { PolymarketEvent } from "../lib/types";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Hedge — Predictions, Reimagined." },
    {
      name: "description",
      content:
        "Trade Polymarket Yes/No markets in USDG on Robinhood.",
    },
  ];
}

function isMulti(event: PolymarketEvent) {
  return event.markets.filter(isLiveMarket).length > 2;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tag = (url.searchParams.get("tag") ?? "all").toLowerCase();
  const sort = url.searchParams.get("sort") ?? "trending";
  const q = (url.searchParams.get("q") ?? "").trim();
  const sectionHint = url.searchParams.get("section");

  try {
    const [page, browse] = await Promise.all([
      q ? searchEvents(q) : listEvents({ tag, sort }),
      q ? Promise.resolve({ section: null, children: [] }) : resolveBrowse(tag, sectionHint),
    ]);
    return {
      events: page.events,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore && !q,
      tag,
      sort,
      q,
      section: browse.section,
      children: browse.children,
      error: null as string | null,
    };
  } catch (e) {
    return {
      events: [] as PolymarketEvent[],
      nextOffset: 0,
      hasMore: false,
      tag,
      sort,
      q,
      section: null as string | null,
      children: [],
      error: e instanceof Error ? e.message : "Failed to load markets",
    };
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { events: initial, tag, sort, q, error, section, children } = loaderData;
  const fetcher = useFetcher<typeof eventsLoader>();
  const [extra, setExtra] = useState<PolymarketEvent[]>([]);
  const [cursor, setCursor] = useState(loaderData.nextOffset);
  const [hasMore, setHasMore] = useState(loaderData.hasMore);
  const seenPage = useRef<string | null>(null);
  const split = Boolean(section && children.length > 0 && !q);

  useEffect(() => {
    setExtra([]);
    setCursor(loaderData.nextOffset);
    setHasMore(loaderData.hasMore);
    seenPage.current = null;
  }, [tag, sort, q, loaderData.nextOffset, loaderData.hasMore]);

  useEffect(() => {
    const page = fetcher.data;
    if (!page || fetcher.state !== "idle") return;
    const key = `${page.nextOffset}:${page.events[0]?.id ?? ""}:${page.events.length}`;
    if (seenPage.current === key) return;
    seenPage.current = key;
    setExtra((list) => {
      const ids = new Set(list.map((e) => e.id));
      return [...list, ...page.events.filter((e) => !ids.has(e.id))];
    });
    setCursor(page.nextOffset);
    setHasMore(page.hasMore);
  }, [fetcher.data, fetcher.state]);

  const events = extra.length
    ? [
        ...initial,
        ...extra.filter((e) => !initial.some((x) => x.id === e.id)),
      ]
    : initial;

  const binary = events.filter((e) => !isMulti(e) && pickLiveMarket(e));
  const multi = events.filter((e) => isMulti(e) && pickLiveMarket(e));
  const heroCards = binary.slice(0, 2);
  const secondary = binary[2];
  const outright = multi[0];
  const banner =
    events.find((e) =>
      e.tags.some((t) =>
        ["sports", "nba", "soccer", "nfl", "mlb"].includes(t.slug),
      ),
    ) ?? events[0];

  const used = new Set(
    [secondary, outright, banner]
      .filter(Boolean)
      .map((e) => e!.id)
      .concat(heroCards.map((e) => e.id)),
  );
  const rest = events.filter((e) => !used.has(e.id));
  const restMulti = rest.filter(isMulti);
  const restBinary = rest.filter((e) => !isMulti(e));
  const loadingMore = fetcher.state !== "idle";

  const selectedLabel =
    children.find((c) => c.slug === tag)?.label ?? categoryLabel(tag);

  const feed = (
    <>
      {error ? (
        <p className="rounded-2xl bg-card p-6 text-sm text-down ring-1 ring-white/5">
          {error}
        </p>
      ) : events.length === 0 ? (
        <p className="rounded-2xl bg-card p-6 text-sm text-muted ring-1 ring-white/5">
          {q
            ? `No markets matching “${q}”.`
            : "No live markets in this category."}
        </p>
      ) : (
        <>
          {!split && (secondary || outright || banner) ? (
            <section className="grid min-w-0 gap-3 sm:gap-4 md:grid-cols-4">
              {secondary ? <MarketCard event={secondary} delay={40} /> : null}
              {outright ? <OutrightCard event={outright} delay={80} /> : null}
              {banner ? (
                <div
                  className={
                    secondary && outright
                      ? "hidden min-w-0 md:col-span-2 md:block"
                      : secondary || outright
                        ? "hidden min-w-0 md:col-span-3 md:block"
                        : "min-w-0 md:col-span-4"
                  }
                >
                  <FeaturedBanner event={banner} />
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {split
              ? events.map((event) =>
                  isMulti(event) ? (
                    <OutrightCard key={event.id} event={event} />
                  ) : (
                    <MarketCard key={event.id} event={event} />
                  ),
                )
              : (
                <>
                  {restBinary.slice(0, 3).map((event, i) => (
                    <MarketCard key={event.id} event={event} delay={i * 40} />
                  ))}
                  {restMulti[0] ? (
                    <OutrightCard event={restMulti[0]} delay={120} />
                  ) : null}
                  {restBinary.slice(3).map((event) => (
                    <MarketCard key={event.id} event={event} />
                  ))}
                  {restMulti.slice(1).map((event) => (
                    <OutrightCard key={event.id} event={event} />
                  ))}
                </>
              )}
          </section>

          <div className="flex flex-col items-center gap-3 pt-2 pb-4">
            <p className="text-[13px] text-muted">
              Showing {events.length} live event{events.length === 1 ? "" : "s"}
              {q
                ? ` for “${q}”`
                : tag !== "all"
                  ? ` in ${selectedLabel}`
                  : ""}
            </p>
            {hasMore ? (
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => {
                  const p = new URLSearchParams({
                    offset: String(cursor),
                    sort,
                  });
                  if (tag && tag !== "all") p.set("tag", tag);
                  void fetcher.load(`/api/events?${p}`);
                }}
                className="rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-black transition hover:brightness-105 disabled:opacity-60"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </div>
        </>
      )}
    </>
  );

  return (
    <main className="mx-auto min-w-0 max-w-7xl space-y-4 px-3 pt-3 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:space-y-5 sm:pt-4 lg:pb-8">
      {!split ? <Hero featured={heroCards} /> : null}
      <MarketNav
        tag={tag}
        sort={sort}
        q={q || undefined}
        section={section}
      />

      {split && section ? (
        <div className="min-w-0 space-y-4">
          <CategoryBar
            section={section}
            tag={tag}
            sort={sort}
            q={q || undefined}
            items={children}
          />
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">
            {selectedLabel}
          </h2>
          {feed}
        </div>
      ) : (
        feed
      )}
    </main>
  );
}
