import type { Route } from "./+types/rewards";
import { MarketNav } from "../components/MarketNav";
import { RewardsChallenge } from "../components/RewardsChallenge";
import { challengeActive } from "../lib/challenge";
import { loadChallengeBoard } from "../lib/server/challenge-board";
import { originFromMatches, rewardsMeta } from "../lib/seo";

export function meta({ matches }: Route.MetaArgs) {
  return rewardsMeta(originFromMatches(matches));
}

export function links() {
  return [
    {
      rel: "preload",
      href: "/assets/rewards/honeycomb.png",
      as: "image",
    },
    {
      rel: "preload",
      href: "/assets/rewards/trophy.png",
      as: "image",
    },
  ];
}

export async function loader() {
  const board = await loadChallengeBoard();
  return { ...board, active: challengeActive() };
}

export default function Rewards({ loaderData }: Route.ComponentProps) {
  return (
    <main className="relative overflow-x-clip">
      <img
        src="/assets/rewards/honeycomb.png"
        alt=""
        width={1440}
        height={493}
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-0 h-[493px] w-screen max-w-none -translate-x-1/2 -translate-y-14 object-cover object-top sm:-translate-y-16"
      />
      <div className="relative z-10 mx-auto min-w-0 max-w-7xl space-y-6 px-3 pt-3 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:space-y-8 sm:pt-4 lg:space-y-10 lg:pb-8">
        <MarketNav tag="all" sort="rewards" />
        <RewardsChallenge
          volume={loaderData.volume}
          pnl={loaderData.pnl}
          tracked={loaderData.tracked}
          active={loaderData.active}
        />
      </div>
    </main>
  );
}
