import { Form, Link, useSearchParams } from "react-router";
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
import { BallIcon, SearchIcon } from "./icons";
import { useT } from "./I18n";
import { RemoteImg } from "./RemoteImg";
import type { MessageKey } from "../locales/messages";

const SORTS = [
  { id: "trending", labelKey: "nav.trending" as const, icon: "fire" },
  { id: "new", labelKey: "nav.new" as const, icon: "sparkle" },
  { id: "ending", labelKey: "nav.ending" as const, icon: "clock" },
] as const;

function ChromeGlyph({
  name,
  size,
}: {
  name: "fire" | "sparkle" | "clock" | "normal" | "leverage";
  size: 12 | 14;
}) {
  return (
    <img
      src={`/icons/chrome/${name}.svg`}
      alt=""
      width={size}
      height={size}
      className="block max-w-none shrink-0"
    />
  );
}

const CAT_KEYS: Record<string, MessageKey> = {
  all: "cat.all",
  politics: "cat.politics",
  sports: "cat.sports",
  crypto: "cat.crypto",
  finance: "cat.finance",
  tech: "cat.tech",
  "pop-culture": "cat.culture",
};

export function HeaderMarketNav() {
  const [params] = useSearchParams();
  return (
    <MarketNav
      chrome
      tag={params.get("tag") ?? "all"}
      sort={params.get("sort") ?? "trending"}
      q={params.get("q") ?? undefined}
      section={params.get("section")}
    />
  );
}

export function MarketNav({
  tag,
  sort,
  q,
  section,
  chrome = false,
}: {
  tag: string;
  sort: string;
  q?: string;
  section?: string | null;
  chrome?: boolean;
}) {
  const t = useT();
  const hideCats = sort === "leverage" || sort === "rewards";
  const leverageOn = sort === "leverage";

  return (
    <div className={chrome ? "w-full" : "space-y-4"}>
      {!chrome ? (
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
            placeholder={t("nav.searchMarkets")}
            className="w-full bg-transparent text-sm text-white placeholder-muted outline-none"
          />
        </Form>
      ) : (
        <Form
          action="/"
          method="get"
          className="mb-2 flex items-center gap-2.5 rounded-full border border-white/10 bg-[#1e1e1e] px-4 py-2 lg:hidden"
        >
          {tag !== "all" ? <input type="hidden" name="tag" value={tag} /> : null}
          {sort !== "trending" ? (
            <input type="hidden" name="sort" value={sort} />
          ) : null}
          {section && section !== tag ? (
            <input type="hidden" name="section" value={section} />
          ) : null}
          <SearchIcon size={16} />
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("nav.searchMarkets")}
            className="w-full bg-transparent text-sm text-white placeholder-muted outline-none"
          />
        </Form>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto no-scrollbar">
          <div className="flex shrink-0 items-center gap-1">
            {SORTS.map((tab) => {
              const active = tab.id === sort;
              return (
                <Link
                  key={tab.id}
                  to={browseHref({ tag, sort: tab.id, q, section })}
                  className={`inline-flex shrink-0 items-center gap-2 px-2.5 py-1 text-sm font-semibold text-white transition ${
                    active
                      ? "border-b border-white"
                      : "opacity-50 hover:opacity-100"
                  }`}
                >
                  <ChromeGlyph name={tab.icon} size={14} />
                  {tab.id === "ending" ? (
                    <>
                      <span className="sm:hidden">{t("nav.endingShort")}</span>
                      <span className="hidden sm:inline">{t(tab.labelKey)}</span>
                    </>
                  ) : (
                    t(tab.labelKey)
                  )}
                </Link>
              );
            })}
          </div>

          {!hideCats ? (
            <>
              <span
                aria-hidden
                className="hidden h-[22px] w-px shrink-0 bg-white/20 sm:block"
              />
              <div className="flex shrink-0 items-center gap-[22px]">
                {CATEGORIES.map((cat) => {
                  const active = tag === cat.id || section === cat.id;
                  return (
                    <Link
                      key={cat.id}
                      to={browseHref({ tag: cat.id, sort, q })}
                      className={`shrink-0 pb-1 text-sm font-semibold transition ${
                        active
                          ? "border-b-2 border-white text-white"
                          : "text-muted hover:text-white"
                      }`}
                    >
                      {CAT_KEYS[cat.id] ? t(CAT_KEYS[cat.id]) : cat.label}
                    </Link>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-[#1e1e1e] p-[3px]">
          <Link
            to={browseHref({
              tag: leverageOn ? "all" : tag,
              sort: "trending",
              q,
              section: leverageOn ? null : section,
            })}
            className={`inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-sm font-medium transition ${
              !leverageOn
                ? "bg-white/12 text-white"
                : "text-white/50 opacity-50 hover:text-white hover:opacity-100"
            }`}
          >
            <ChromeGlyph name="normal" size={12} />
            {t("nav.normal")}
          </Link>
          <Link
            to={browseHref({ tag: "all", sort: "leverage", q })}
            className={`inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-sm font-medium transition ${
              leverageOn
                ? "bg-gold text-black"
                : "text-gold hover:text-gold-soft"
            }`}
          >
            <span className={leverageOn ? "brightness-0" : undefined}>
              <ChromeGlyph name="leverage" size={12} />
            </span>
            {t("nav.leverage")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ChallengeChips({
  tag,
  section,
}: {
  tag: string;
  section?: string | null;
}) {
  return (
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
