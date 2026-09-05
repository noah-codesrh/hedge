import type { Route } from "./+types/profile.referral";
import { ReferralInvite } from "../components/ReferralInvite";
import { originFromMatches, siteMeta } from "../lib/seo";

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({
    title: "Invite friends · Hedge",
    description:
      "Share Hedge with people who have opinions worth backing. Earn a cut of the trading fees they generate.",
    origin: originFromMatches(matches),
    url: "/profile/referral",
  });
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
      href: "/assets/referral/honeycomb.png",
      as: "image",
    },
  ];
}

export default function ReferralPage() {
  return (
    <main className="relative overflow-x-clip">
      <img
        src="/assets/rewards/honeycomb.png"
        alt=""
        width={1440}
        height={493}
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-0 h-[640px] w-screen max-w-none -translate-x-1/2 -translate-y-10 object-cover object-top"
      />
      <div className="relative z-10 mx-auto min-w-0 max-w-3xl px-4 pt-8 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:pt-12 lg:pb-16">
        <ReferralInvite />
      </div>
    </main>
  );
}
