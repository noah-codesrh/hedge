/** Premier League spot challenge. $1,000 pool: $500 volume, $500 realized PnL. */

export const CHALLENGE_TAG = "epl";
export const CHALLENGE_SECTION = "sports";
export const CHALLENGE_LEAGUE = "epl";

export const CHALLENGE_START = new Date("2026-08-31T00:00:00.000Z");
export const CHALLENGE_END = new Date("2026-09-30T23:59:59.000Z");

export const CHALLENGE_PRIZE_TOTAL = 1000;
export const CHALLENGE_PRIZE_VOLUME = 500;
export const CHALLENGE_PRIZE_PNL = 500;

const EPL_SLUGS = new Set(["epl", "premier-league", "english-premier-league"]);

export function challengeHref() {
  return `/?tag=${CHALLENGE_TAG}&section=${CHALLENGE_SECTION}`;
}

export function rewardsHref() {
  return "/rewards";
}

export type BoardRow = {
  rank: number;
  userId: string;
  wallet: string;
  name: string;
  volume: number;
  pnl: number;
  trades: number;
};

export type ChallengeBoard = {
  volume: BoardRow[];
  pnl: BoardRow[];
  tracked: boolean;
};

export function challengeActive(now = new Date()) {
  return now >= CHALLENGE_START && now <= CHALLENGE_END;
}

export function isEplTrade(input: {
  tags?: Array<{ slug?: string | null } | string> | null;
  eventSlug?: string | null;
  marketSlug?: string | null;
  title?: string | null;
}) {
  const slugs = (input.tags ?? []).map((t) =>
    (typeof t === "string" ? t : t.slug ?? "").toLowerCase(),
  );
  if (slugs.some((s) => EPL_SLUGS.has(s))) return true;

  const hay = [input.eventSlug, input.marketSlug, input.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay) return false;
  return (
    /\bepl\b/.test(hay) ||
    hay.includes("premier-league") ||
    hay.includes("premier league")
  );
}
