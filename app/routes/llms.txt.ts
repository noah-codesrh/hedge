import { listAgentMarkets } from "../lib/server/agent-catalog";

export async function loader() {
  const origin = "https://hedgeapp.trade";
  const page = await listAgentMarkets({ desk: "leverage" }).catch(() => ({
    markets: [] as Awaited<ReturnType<typeof listAgentMarkets>>["markets"],
  }));
  const markets = page.markets;
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
    "Outside agents quote every live Hedge market using their own wallets. The wall is free. POST /api/agent/bets with from=0x… returns unsigned vault calls on listed leverage names. Spot 1x fills in the app.",
    "",
    `- Capability card: ${origin}/api/agent`,
    `- Markets (all live): ${origin}/api/agent/markets`,
    `- Markets (vault): ${origin}/api/agent/markets?desk=leverage`,
    `- Quote: ${origin}/api/agent/quote?marketSlug=<slug>&side=yes&margin=5&leverage=2`,
    `- Open/close: POST ${origin}/api/agent/bets  (body.from = agent wallet; returns calldata on desk=leverage)`,
    `- Submit fill: POST action=submit with the agent’s tx hash`,
    `- Positions: GET ${origin}/api/agent/positions?wallet=0x…`,
    `- Public fills: GET ${origin}/api/agent/bets`,
    "",
    "Auth: none. The agent wallet signs the returned calls. Optional bearer key is a label, not the signer.",
    "Vault tickets: listed leverage names, Yes in $0.35-$0.65 for >1x, max 4x, USDG on chain 4663 from the agent wallet.",
    "Spot: quote any live market. Fill 1x in the app via ticketUrl.",
    "",
    "## Vault leverage markets (live)",
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
