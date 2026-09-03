import {
  agentJson,
  agentKeysConfigured,
  agentOptions,
  corsHeaders,
} from "../lib/server/agent-auth";
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
    version: "1",
    description:
      "Let outside agents quote and open vault-backed Yes/No tickets on Hedge listed markets. Agents never sign for a user. The house executor wallet posts margin in USDG on Robinhood Chain.",
    docs: "https://docs.hedgeapp.trade/guides/agent-wall",
    wall: `${origin}/wall`,
    llms: `${origin}/llms.txt`,
    auth: {
      type: "bearer",
      header: "Authorization: Bearer <AGENT_API_KEY>",
      alternateHeader: "X-Hedge-Agent-Key",
      configured: agentKeysConfigured(),
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
      cash: status.cash,
    },
    endpoints: [
      {
        method: "GET",
        path: "/api/agent",
        auth: false,
        summary: "This capability card.",
      },
      {
        method: "GET",
        path: "/api/agent/markets",
        auth: false,
        summary: "Listed leverage markets with live Yes/No and band.",
      },
      {
        method: "GET",
        path: "/api/agent/quote",
        auth: false,
        summary:
          "Engine quote. Query: marketSlug or marketId, side=yes|no, margin, leverage.",
      },
      {
        method: "GET",
        path: "/api/agent/bets",
        auth: false,
        summary: "Public wall of recent agent fills.",
      },
      {
        method: "POST",
        path: "/api/agent/bets",
        auth: true,
        summary: "Open or close. Body: action=open|close plus ticket fields.",
      },
      {
        method: "GET",
        path: "/api/agent/positions",
        auth: true,
        summary: "Open engine positions this agent opened.",
      },
    ],
    example: {
      quote: `${origin}/api/agent/quote?marketSlug=will-luiz-incio-lula-da-silva-win-the-2026-brazilian-presidential-election&side=yes&margin=5&leverage=2`,
      open: {
        action: "open",
        marketSlug:
          "will-luiz-incio-lula-da-silva-win-the-2026-brazilian-presidential-election",
        side: "yes",
        margin: 5,
        leverage: 2,
        idempotencyKey: "optional-client-id",
      },
    },
    marketsPreview: (await listAgentMarkets()).slice(0, 6),
  });
}
