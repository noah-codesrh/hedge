import { Link } from "react-router";
import type { ReactNode } from "react";
import { originFromMatches, siteMeta } from "../lib/seo";
import type { Route } from "./+types/roadmap";

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({
    title: "Roadmap · Hedge",
    description:
      "What Hedge is shipping next. Trades create fees. Fees buy and burn $HEDGE. This is the map.",
    origin: originFromMatches(matches),
    url: "/roadmap",
  });
}

const PUBLISHED = "5 September 2026";

export default function Roadmap() {
  return (
    <main className="mx-auto min-w-0 max-w-3xl px-4 pt-6 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:pt-10 lg:pb-16">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
        From the team
      </p>
      <h1 className="mt-2 text-[1.85rem] font-bold leading-tight tracking-tight sm:text-4xl">
        Hedge roadmap
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-[16px]">
        The loop is simple. Trades create fees. Fees buy and burn $HEDGE. More
        trades make the loop real. Everything we ship next is in service of
        that.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl bg-card-2 px-5 py-4 ring-1 ring-white/5 sm:grid-cols-3">
        <Meta label="Published">{PUBLISHED}</Meta>
        <Meta label="Where">hedgeapp.trade</Meta>
        <Meta label="Talk to us">
          <a
            href="https://t.me/hedgetradeltd"
            target="_blank"
            rel="noreferrer"
            className="text-gold hover:underline"
          >
            Telegram
          </a>
        </Meta>
      </dl>

      <div className="mt-10 space-y-3 text-[15px] leading-relaxed text-[#cfcfcf]">
        <p>
          This is the map. A lot of it came from the Telegram group and from
          people who wrote in. We are putting it in one place so you can see
          the order, and what is already live.
        </p>
      </div>

      <Section id="live" title="Live today">
        <p>
          Spot Yes/No in USDG on Robinhood Chain. 1x is a real fill on the
          venue book. Listed markets offer vault leverage.{" "}
          <Link to="/earn" className="font-semibold text-gold hover:underline">
            Earn
          </Link>{" "}
          is the LP side of that vault. Hedgie is the copilot. You can already
          turn a position into a P&amp;L card and save it.
        </p>
        <p>
          The{" "}
          <Link to="/wall" className="font-semibold text-gold hover:underline">
            Agent Wall
          </Link>{" "}
          is live for quotes and 1x tickets. New vault tickets from agents are
          a separate switch. That switch stays off until a liquidator is
          running. We will not reopen leveraged agent flow without one.
        </p>
        <p>
          We are still a thin layer on one upstream book for spot. That is the
          honest starting point, and it is why native markets are on this list.
        </p>
      </Section>

      <Section id="now" title="Now: make every trade count twice">
        <h3>Referrals</h3>
        <p>
          Pick a public name. Share hedgeapp.trade/?ref=name. The referrer
          earns a cut of the trading fees that flow through that link, not a
          one-time signup bonus. First login binds. One referrer, for good.
          This is the next thing to turn on.
        </p>
        <h3>Share cards at the trade, not after</h3>
        <p>
          The card already exists. Next is generating it when you open or
          close, with a one-tap post to X. Entry, leverage, P&amp;L, market.
          Every fill should be able to leave the app as an ad.
        </p>
        <h3>A public trade tape</h3>
        <p>
          A live feed of real tickets: market, size, tx hash. Aggregate stats
          on the data site are not the same thing. Traders want to see prints.
        </p>
        <h3>Agent Wall, in front of builders</h3>
        <p>
          The quote and ticket APIs are already there. 1x fills in the app.
          Agents hold their own wallets. Hedge never holds that key. The job
          now is to get that in front of people writing agents on Robinhood
          Chain, not to rebuild it.
        </p>
      </Section>

      <Section id="next" title="Next: markets that are not someone else's book">
        <h3>Crypto-native prediction markets</h3>
        <p>
          Will this token&apos;s price or market cap sit above a level by a
          date. That is a way to be short a meme that has no perp and no CEX
          listing. Listing needs a floor: market cap and 24h volume high enough
          that one wallet cannot cheaply shove the outcome. Tune the floor from
          what we see, not from a slogan.
        </p>
        <h3>Meme PvP</h3>
        <p>
          Token A vs token B. Pick a side. The losing pool pays the winners. No
          external CLOB. A different product from &quot;above or below a
          strike,&quot; and more degen on purpose.
        </p>
        <p>
          Both of these are Hedge markets. They do not inherit the venue&apos;s
          book, pause, or roadmap. That is the point.
        </p>
      </Section>

      <Section id="then" title="Then: token, makers, phone">
        <h3>$HEDGE utility</h3>
        <p>
          $HEDGE should do more than get bought and burned. The shape we like
          is gated desks: stake $HEDGE to unlock a market category or a higher
          multiple, once the vault can stand behind that multiple. We are not
          locking a stake size in this post. Utility comes after there is
          something worth gating. See{" "}
          <Link to="/token" className="font-semibold text-gold hover:underline">
            the token
          </Link>
          .
        </p>
        <h3>Makers</h3>
        <p>
          There is no Hedge order book and no rebate programme today. Spot
          takes the venue. Leverage is filled by the vault. A maker programme
          that quotes into a book we do not have would be theatre. When we have
          native markets, or a quoting API into the engine, we can seed
          liquidity and pay people who actually tighten spreads. Not before.
        </p>
        <h3>A mobile app</h3>
        <p>
          The site should feel like a trading app on a phone first. A store
          listing comes after the web loop is the one we want people opening
          every day: fund, trade, share, come back.
        </p>
      </Section>

      <Section id="not-this" title="What we will not rush">
        <p>
          We will not turn vault agent flow back on without a liquidator. We
          will not advertise 10x while the pool cannot back it. We will not
          pretend a maker programme exists. We will not list thin meme names
          just to look busy.
        </p>
        <p>
          Fees still go 30% to buyback and burn. That does not change.
        </p>
        <p>
          If you want to argue with the order,{" "}
          <a
            href="https://t.me/hedgetradeltd"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-gold hover:underline"
          >
            Telegram
          </a>{" "}
          is the place. Native crypto markets and the tape are the two we most
          want a second opinion on.
        </p>
      </Section>
    </main>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold">{children}</dd>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-20">
      <h2 className="text-[1.15rem] font-semibold tracking-tight sm:text-xl">
        {title}
      </h2>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-[#cfcfcf] [&_h3]:mt-6 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-white">
        {children}
      </div>
    </section>
  );
}
