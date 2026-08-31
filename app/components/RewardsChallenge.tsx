import { Link } from "react-router";
import {
  CHALLENGE_END,
  CHALLENGE_PRIZE_PNL,
  CHALLENGE_PRIZE_TOTAL,
  CHALLENGE_PRIZE_VOLUME,
  CHALLENGE_START,
  challengeHref,
} from "../lib/challenge";
import { fiat, signedFiat } from "../lib/format";
import type { BoardRow, ChallengeBoard } from "../lib/challenge";

function when(d: Date) {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function RewardsChallenge({
  volume,
  pnl,
  tracked,
  active,
}: ChallengeBoard & { active: boolean }) {
  const pool = `$${CHALLENGE_PRIZE_TOTAL.toLocaleString("en-US")}`;

  return (
    <div className="min-w-0 space-y-8 sm:space-y-10">
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,664px)_1fr] lg:items-start lg:gap-6 xl:gap-10">
        <div className="flex max-w-[664px] flex-col items-start gap-6 sm:gap-7 lg:pt-[4.5rem]">
          <h1 className="text-[2rem] font-medium capitalize leading-[1.1] tracking-[-0.03em] text-white/80 sm:text-[2.75rem] lg:text-[59px] lg:tracking-[-1.77px]">
            Win a share of <span className="text-gold">{pool}</span> trading{" "}
            <span className="text-gold">Premier League.</span>
          </h1>
          <div className="space-y-3 text-white">
            <p className="text-lg leading-snug sm:text-2xl">
              Trade EPL markets, climb the volume and realized PnL
              leaderboards, and earn from a {pool} prize pool.
            </p>
            <p className="text-xs text-white/60">
              Spot EPL only. {when(CHALLENGE_START)} to {when(CHALLENGE_END)}{" "}
              UTC.
              {active ? " Live now." : " Window closed."}
            </p>
          </div>
          <Link
            to={challengeHref()}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-gold px-5 text-base font-semibold text-black transition hover:brightness-105 sm:w-[206px]"
          >
            Trade EPL
          </Link>
        </div>

        <img
          src="/assets/rewards/trophy.png"
          alt="Trophy, prize money, and soccer balls"
          width={3244}
          height={2732}
          fetchPriority="high"
          decoding="async"
          className="mx-auto h-auto w-[min(100%,26.5rem)] object-contain lg:mx-0 lg:w-full lg:max-w-[424px] lg:justify-self-end"
        />
      </section>

      {!tracked ? (
        <p className="text-sm text-gold">
          Tracking is not connected yet. Trades still work. The board fills
          once the database is set.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Board
          title="Top volume"
          prize={CHALLENGE_PRIZE_VOLUME}
          rows={volume}
          value={(row) => fiat(row.volume)}
          empty="No EPL volume yet. Open a spot ticket to get on the board."
        />
        <Board
          title="Highest PnL"
          prize={CHALLENGE_PRIZE_PNL}
          rows={pnl}
          value={(row) => signedFiat(row.pnl)}
          empty="PnL ranks after you close a position. Buys alone do not count here."
        />
      </div>

      <p className="text-[13px] leading-relaxed text-muted">
        Volume is USDG spent on EPL buys during the window. PnL is realized:
        what you sold minus the average cost of those shares. Open tickets are
        not marked to market. One wallet per Privy account. We can exclude
        wash volume.
      </p>
    </div>
  );
}

function Board({
  title,
  prize,
  rows,
  value,
  empty,
}: {
  title: string;
  prize: number;
  rows: BoardRow[];
  value: (row: BoardRow) => string;
  empty: string;
}) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#161616]">
      <div className="flex items-end justify-between gap-3 px-5 py-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm font-semibold text-gold">{fiat(prize)} first</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-muted">{empty}</p>
      ) : (
        <ol className="divide-y divide-white/5">
          {rows.map((row) => (
            <li
              key={row.userId}
              className="flex items-center gap-3 px-5 py-3"
            >
              <span
                className={`w-7 shrink-0 text-sm font-bold tabular-nums ${
                  row.rank === 1 ? "text-gold" : "text-muted"
                }`}
              >
                {row.rank}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {row.name}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {value(row)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
