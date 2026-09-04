import { listAgentMarkets } from "../lib/server/agent-catalog";

export async function loader() {
  const origin = "https://hedgeapp.trade";
  const [venue, vault] = await Promise.all([
    listAgentMarkets({ desk: "spot", limit: 40 }).catch(() => ({
      markets: [] as Awaited<ReturnType<typeof listAgentMarkets>>["markets"],
    })),
    listAgentMarkets({ desk: "leverage", limit: 40 }).catch(() => ({
      markets: [] as Awaited<ReturnType<typeof listAgentMarkets>>["markets"],
    })),
  ]);
  const markets = venue.markets;
  const vaultMarkets = vault.markets;
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
    "Outside agents quote every live Hedge market. The wall is free. 1x fills in the app via ticketUrl. POST /api/agent/bets with from=0x… returns unsigned vault calls only on listed leverage names. status.live is the venue, not the vault pause.",
    "",
    `- Capability card: ${origin}/api/agent`,
    `- Markets (all live): ${origin}/api/agent/markets`,
    `- Markets (spot): ${origin}/api/agent/markets?desk=spot`,
    `- Markets (vault): ${origin}/api/agent/markets?desk=leverage`,
    `- Quote: ${origin}/api/agent/quote?marketSlug=<slug>&side=yes&margin=5`,
    `- Open/close vault: POST ${origin}/api/agent/bets  (desk=leverage only; body.from = agent wallet)`,
    `- Submit fill: POST action=submit with the agent’s tx hash`,
    `- Positions: GET ${origin}/api/agent/positions?wallet=0x…`,
    `- Public fills: GET ${origin}/api/agent/bets`,
    "",
    "Auth: none. Optional bearer key is a label, not the signer.",
    "Spot: quote any live market. Fill 1x in the app via ticketUrl.",
    "Vault tickets: listed leverage names, Yes in $0.35-$0.65 for >1x, max 4x, USDG on chain 4663 from the agent wallet. openingPaused is vault-only.",
    "",
    "## Live markets",
    "",
    ...markets.map(
      (m) =>
        `- ${m.title} | slug=${m.marketSlug} | id=${m.marketId} | Yes ${m.yesCents} | 1x | ${m.ticketUrl}`,
    ),
    "",
    "## Vault leverage markets",
    "",
    ...(vaultMarkets.length > 0
      ? vaultMarkets.map(
          (m) =>
            `- ${m.title} | slug=${m.marketSlug} | id=${m.marketId} | Yes ${m.yesCents} | ${m.band} | max ${m.maxLeverage}x | ${m.ticketUrl}`,
        )
      : ["- none listed right now"]),
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
