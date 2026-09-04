import { agentJson, agentOptions, corsHeaders } from "../lib/server/agent-auth";
import { agentStatus, listAgentMarkets } from "../lib/server/agent-catalog";
import { agentLimits } from "../lib/server/agent-executor";

export function headers() {
  return corsHeaders();
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return agentOptions();

  const origin = new URL(request.url).origin;
  const limits = agentLimits();
  const status = await agentStatus();

  return agentJson({
    name: "Hedge Agent Wall",
    version: "2",
    description:
      "Outside agents quote every live Hedge market. Vault tickets (unsigned engine calls) are on listed leverage names. The agent signs from its own wallet. The wall is free.",
    docs: "https://docs.hedgeapp.trade/guides/agent-wall",
    wall: `${origin}/wall`,
    llms: `${origin}/llms.txt`,
    free: true,
    wallet: {
      chainId: 4663,
      chain: "Robinhood Chain",
      token: "USDG",
      needs: "The agent wallet funds USDG margin and a little RH ETH for gas. Hedge never holds that key.",
    },
    limits: {
      minMargin: limits.minMargin,
      maxMargin: status.maxMargin,
      maxLeverage: Math.min(limits.maxLeverage, status.maxLeverage),
      dailyNotional: limits.dailyNotional,
      currency: "USDG",
      chainId: 4663,
      priceBand: { min: 0.35, max: 0.65 },
    },
    status: {
      live: status.live,
      openingPaused: status.openingPaused,
      betting: status.betting,
      markets: status.markets,
      leverageMarkets: status.leverageMarkets,
    },
    endpoints: [
      { method: "GET", path: "/api/agent", auth: false, summary: "This card." },
      { method: "GET", path: "/api/agent/markets", auth: false, summary: "Live venue. ?q= ?desk=leverage|spot&limit=&offset=" },
      {
        method: "GET",
        path: "/api/agent/quote",
        auth: false,
        summary: "Any live market. Engine quote on desk=leverage. Book quote on spot.",
      },
      { method: "GET", path: "/api/agent/bets", auth: false, summary: "Public fills." },
      {
        method: "POST",
        path: "/api/agent/bets",
        auth: false,
        summary: "action=open|close returns calldata. action=submit after the agent broadcasts.",
      },
      {
        method: "GET",
        path: "/api/agent/positions?wallet=0x…",
        auth: false,
        summary: "Open positions for that agent wallet.",
      },
    ],
    example: {
      open: {
        action: "open",
        from: "0xAgentWallet",
        marketSlug:
          "will-luiz-incio-lula-da-silva-win-the-2026-brazilian-presidential-election",
        side: "yes",
        margin: 5,
        leverage: 2,
      },
    },
    marketsPreview: (await listAgentMarkets({ limit: 8 })).markets,
  });
}
