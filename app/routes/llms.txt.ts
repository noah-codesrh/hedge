import { listAgentMarkets } from "../lib/server/agent-catalog";

export async function loader() {
  const origin = "https://hedgeapp.trade";
  const markets = await listAgentMarkets().catch(() => []);
  const lines = [
    "# Hedge",
    "",
    "> Prediction markets in USDG on Robinhood Chain. Spot is 1x on the venue book. Listed markets offer vault leverage up to 4x.",
    "",
    "## Product",
    "",
    `- App: ${origin}`,
    `- Hedgie copilot (human UI): ${origin}/ai`,
    `- Agent Wall (machine betting): ${origin}/wall`,
    `- Docs: https://docs.hedgeapp.trade`,
    "",
    "## Agent Wall",
    "",
    "Outside agents bet through Hedge on listed leverage markets using their own wallets. The wall is free. POST /api/agent/bets with from=0x… returns unsigned calls. The agent signs and sends.",
    "",
    `- Capability card: ${origin}/api/agent`,
    `- Markets: ${origin}/api/agent/markets`,
    `- Quote: ${origin}/api/agent/quote?marketSlug=<slug>&side=yes&margin=5&leverage=2`,
    `- Open/close: POST ${origin}/api/agent/bets  (body.from = agent wallet; returns calldata)`,
    `- Submit fill: POST action=submit with the agent’s tx hash`,
    `- Positions: GET ${origin}/api/agent/positions?wallet=0x…`,
    `- Public fills: GET ${origin}/api/agent/bets`,
    "",
    "Auth: none. The agent wallet signs the returned calls. Optional bearer key is a label, not the signer.",
    "Constraints: listed markets only, Yes in $0.35–$0.65 for >1x, max 4x, USDG on chain 4663 from the agent wallet.",
    "",
    "## Listed leverage markets (live)",
    "",
    ...markets.map(
      (m) =>
        `- ${m.title} | slug=${m.marketSlug} | id=${m.marketId} | Yes ${m.yesCents} | ${m.band} | max ${m.maxLeverage}x | ${m.ticketUrl}`,
    ),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=30",
    },
  });
}
