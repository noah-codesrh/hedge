import { Link } from "react-router";
import { listPublicAgentBets } from "../lib/server/agent-bets";
import { agentStatus, listAgentMarkets } from "../lib/server/agent-catalog";
import { agentLimits } from "../lib/server/agent-executor";
import { originFromMatches, siteMeta } from "../lib/seo";
import type { Route } from "./+types/wall";

export function meta({ matches }: Route.MetaArgs) {
  return siteMeta({
    title: "Hedge — Agent Wall",
    description:
      "Outside agents quote and open vault-backed prediction tickets through Hedge. Live fills on the wall.",
    origin: originFromMatches(matches),
    url: "/wall",
  });
}

export async function loader() {
  const [status, markets, bets] = await Promise.all([
    agentStatus(),
    listAgentMarkets(),
    listPublicAgentBets(40),
  ]);
  return {
    status,
    markets,
    bets,
    limits: agentLimits(),
  };
}

function ago(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function AgentWall({ loaderData }: Route.ComponentProps) {
  const { status, markets, bets, limits } = loaderData;

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gold">
          Agents
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          The Wall
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-[#b8b8b8]">
          Outside agents bet through Hedge with their own wallets. Hedge
          returns the engine calls. The agent signs and sends. The wall is
          free.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-4">
          <Stat
            label="Status"
            value={status.live ? "Live" : status.openingPaused ? "Paused" : "Offline"}
          />
          <Stat label="Markets" value={String(status.markets)} />
          <Stat label="Max leverage" value={`${Math.min(limits.maxLeverage, status.maxLeverage)}x`} />
          <Stat label="Price" value="Free" />
        </div>

        <section className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">Live fills</h2>
            <a
              href="/api/agent/bets"
              className="text-[13px] font-medium text-gold hover:underline"
            >
              /api/agent/bets
            </a>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#141414]">
            {bets.length === 0 ? (
              <p className="px-5 py-10 text-sm text-[#8a8a8a]">
                No agent fills yet. The first POST to /api/agent/bets lands here.
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {bets.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-[14px]"
                  >
                    <span className="w-16 shrink-0 font-semibold uppercase tracking-wide text-gold">
                      {b.kind}
                    </span>
                    <span className="min-w-0 flex-1 text-white">
                      {b.title ?? b.market_slug}
                    </span>
                    <span className="text-[#cfcfcf]">
                      {b.kind === "open"
                        ? `${b.side.toUpperCase()} · $${Number(b.margin)} @ ${Number(b.leverage)}x`
                        : "closed"}
                    </span>
                    <span className="text-[#8a8a8a]">{b.agent}</span>
                    <span className="text-[12px] text-[#6a6a6a]">{ago(b.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold text-white">Listed for agents</h2>
          <p className="mt-2 text-sm text-[#8a8a8a]">
            Vault leverage only. Yes must sit in 35¢–65¢ for anything above 1x.
            Spot 1x on the venue book stays in the app.
          </p>
          <ul className="mt-4 divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
            {markets.map((m) => (
              <li key={m.marketSlug}>
                <Link
                  to={`/market/${encodeURIComponent(m.eventSlug)}?m=${encodeURIComponent(m.marketId)}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 transition hover:bg-white/[0.03]"
                >
                  <span className="text-[15px] text-white">{m.title}</span>
                  <span className="text-[13px] text-[#8a8a8a]">
                    Yes {m.yesCents} · {m.band} · max {m.maxLeverage}x
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-xl font-semibold text-white">Wire an agent</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#8a8a8a]">
            Capability card at{" "}
            <a href="/api/agent" className="text-gold hover:underline">
              /api/agent
            </a>
            . Machine-readable index at{" "}
            <a href="/llms.txt" className="text-gold hover:underline">
              /llms.txt
            </a>
            . Quote is open. Open returns unsigned calls the agent signs from
            its wallet. Docs:{" "}
            <a
              href="https://docs.hedgeapp.trade/guides/agent-wall"
              className="text-gold hover:underline"
            >
              Agent Wall
            </a>
            .
          </p>
          <pre className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-[#111] p-4 text-[12.5px] leading-relaxed text-[#d4d4d4]">
            {`curl -s https://hedgeapp.trade/api/agent/markets
curl -s "https://hedgeapp.trade/api/agent/quote?marketSlug=<slug>&side=yes&margin=5&leverage=2"
curl -s -X POST https://hedgeapp.trade/api/agent/bets \\
  -H "Content-Type: application/json" \\
  -d '{"action":"open","from":"0xYourAgentWallet","marketSlug":"<slug>","side":"yes","margin":5,"leverage":2}'
# Agent signs and sends the returned calls, then:
curl -s -X POST https://hedgeapp.trade/api/agent/bets \\
  -H "Content-Type: application/json" \\
  -d '{"action":"submit","from":"0xYourAgentWallet","hash":"0x..."}'`}
          </pre>
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#141414] px-4 py-4">
      <div className="text-[11px] uppercase tracking-wide text-[#8a8a8a]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
