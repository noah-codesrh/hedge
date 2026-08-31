import { Form, Link } from "react-router";
import {
  browseHref,
  CATEGORIES,
  categoryLabel,
  type SubTag,
} from "../lib/polymarket";
import {
  CHALLENGE_PRIZE_TOTAL,
  CHALLENGE_TAG,
  challengeHref,
  rewardsHref,
} from "../lib/challenge";
import {
  BallIcon,
  ClockIcon,
  DiamondIcon,
  FlameIcon,
  LayersIcon,
  SearchIcon,
  SparkleIcon,
} from "./icons";
import { RemoteImg } from "./RemoteImg";

const TABS = [
  { id: "trending", label: "Trending", icon: FlameIcon },
  { id: "rewards", label: "Rewards", icon: DiamondIcon },
  { id: "new", label: "New", icon: SparkleIcon },
  { id: "leverage", label: "Leverage", icon: LayersIcon },
  { id: "ending", label: "Ending soon", icon: ClockIcon },
] as const;

export function MarketNav({
  tag,
  sort,
  q,
  section,
}: {
  tag: string;
  sort: string;
  q?: string;
  section?: string | null;
}) {
  return (
    <div className="space-y-4">
      <Form
        action="/"
        method="get"
        className="flex items-center gap-2.5 rounded-full border border-white/10 bg-[#1e1e1e] px-4 py-2.5 md:hidden"
      >
        {tag !== "all" ? <input type="hidden" name="tag" value={tag} /> : null}
        {sort !== "trending" ? (
          <input type="hidden" name="sort" value={sort} />
        ) : null}
        {section && section !== tag ? (
          <input type="hidden" name="section" value={section} />
        ) : null}
        <SearchIcon />
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search markets"
          className="w-full bg-transparent text-sm text-white placeholder-muted outline-none"
        />
      </Form>

      <div className="-mx-3 flex max-w-[calc(100%+1.5rem)] justify-center overflow-x-auto px-3 no-scrollbar sm:mx-0 sm:max-w-full sm:px-0">
        <nav className="inline-flex max-w-none items-center gap-0.5 rounded-full border border-white/10 bg-[#1e1e1e] p-1 sm:gap-1 sm:p-1.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const soon = "soon" in tab && tab.soon;
            const active = !soon && tab.id === sort;
            const className = `inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[15px] md:px-5 md:py-3 md:text-base ${
              active
                ? "bg-white/12 text-white ring-1 ring-gold/50"
                : "text-[#b8b8b8] hover:bg-white/5 hover:text-white"
            }`;

            if (soon) {
              return (
                <span key={tab.id} className={`${className} cursor-default`}>
                  <Icon size={14} />
                  {tab.label}
                  <span className="rounded-full bg-gold/20 px-1.5 py-0.5 text-[10px] font-semibold text-gold sm:px-2 sm:text-[11px]">
                    Soon
                  </span>
                </span>
              );
            }

            return (
              <Link
                key={tab.id}
                to={
                  tab.id === "rewards"
                    ? rewardsHref()
                    : browseHref({ tag, sort: tab.id, q, section })
                }
                className={className}
              >
                <Icon size={14} />
                {tab.id === "ending" ? (
                  <>
                    <span className="sm:hidden">Ending</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                  </>
                ) : (
                  tab.label
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Leverage is a fixed allowlist, so category filters do not apply. */}
      <div
        className={`-mx-3 justify-center overflow-x-auto border-t border-white/5 px-3 pt-3 no-scrollbar sm:mx-0 sm:px-0 ${
          sort === "leverage" || sort === "rewards" ? "hidden" : "flex"
        }`}
      >
        {CATEGORIES.map((cat) => {
          const active = tag === cat.id || section === cat.id;
          return (
            <Link
              key={cat.id}
              to={browseHref({ tag: cat.id, sort, q })}
              className={`shrink-0 px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-b-2 border-white text-white"
                  : "text-muted hover:text-white"
              }`}
            >
              {cat.label}
            </Link>
          );
        })}
      </div>

      {sort !== "leverage" && sort !== "rewards" ? (
        <div className="-mx-3 flex items-center justify-center gap-2 overflow-x-auto px-3 no-scrollbar sm:mx-0 sm:px-0">
          <Link
            to={challengeHref()}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
              tag === CHALLENGE_TAG || section === CHALLENGE_TAG
                ? "bg-gold text-black"
                : "bg-gold/15 text-gold ring-1 ring-gold/40 hover:bg-gold/25"
            }`}
          >
            <BallIcon size={15} />
            Premier League
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                tag === CHALLENGE_TAG
                  ? "bg-black/15 text-black"
                  : "bg-gold/20 text-gold"
              }`}
            >
              ${CHALLENGE_PRIZE_TOTAL.toLocaleString()} pool
            </span>
          </Link>
          <Link
            to={rewardsHref()}
            className="inline-flex shrink-0 items-center rounded-full bg-white/5 px-3.5 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10"
          >
            Leaderboard
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function CategoryBar({
  section,
  tag,
  sort,
  q,
  items,
}: {
  section: string;
  tag: string;
  sort: string;
  q?: string;
  items: SubTag[];
}) {
  const parentLabel = categoryLabel(section);
  return (
    <div className="-mx-3 overflow-x-auto px-3 no-scrollbar sm:mx-0 sm:px-0">
      <nav className="flex w-max min-w-full items-center gap-1 sm:gap-1.5">
        <Chip
          to={browseHref({ tag: section, sort, q })}
          label={parentLabel}
          active={tag === section}
        />
        {items.map((item) => (
          <Chip
            key={item.slug}
            to={browseHref({ tag: item.slug, sort, q, section })}
            label={item.label}
            image={item.image}
            count={item.count}
            active={tag === item.slug}
          />
        ))}
      </nav>
    </div>
  );
}

function Chip({
  to,
  label,
  image,
  count,
  active,
}: {
  to: string;
  label: string;
  image?: string | null;
  count?: number;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-white/10 text-white"
          : "text-[#cfcfcf] hover:bg-white/5 hover:text-white"
      }`}
    >
          {image ? (
            <RemoteImg
              src={image}
              size={20}
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
        <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[9px] font-bold">
          {label.slice(0, 1)}
        </span>
      )}
      <span>{label}</span>
      {count != null && count > 0 ? (
        <span className="text-[12px] font-normal tabular-nums text-muted">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
