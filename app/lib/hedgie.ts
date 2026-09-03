/**
 * Hedgie — the Hedge markets copilot.
 *
 * Shared types, prompt, and trade-ticket parser.
 */
export const HEDGIE_NAME = "Hedgie";
export const HEDGIE_AVATAR = "/hedgie-ai-tag.jpg";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/** A trade Hedgie proposes. The user still has to open it on the market. */
export type TradeIntent = {
  eventSlug: string;
  marketId: string;
  marketSlug: string;
  side: "yes" | "no";
  margin: number;
  leverage: number;
  market: string;
  selection: string;
};

const TRADE_FENCE = /```hedge-trade\s*([\s\S]*?)```/g;

export function systemPrompt(marketContext: string): string {
  return `You are ${HEDGIE_NAME}, the sharp copilot for Hedge. Hedge is a prediction desk: 1x buys real Polymarket Yes/No shares in USDG. 2x to 4x is margin against the Hedge vault on Robinhood Chain. Limits rest off-chain and fill on the live engine. Earn is senior USDG into that vault.

STRICT SCOPE — you ONLY discuss Hedge:
- Live markets in the data below (spot and leverage).
- Implied Yes/No prices, value, favourites, the $0.35–$0.65 leverage band.
- How Hedge works: 1x vs vault leverage, limits, take profit / stop, Earn, fees (1.5% on notional, 70% senior / 30% junior).
If the user asks about anything else, decline in one short sentence and steer back to Hedge. Never invent markets, slugs, ids, or prices. Use ONLY the live data.

STYLE:
- Concise, confident, conversational. Short paragraphs and tight bullets.
- Quote Yes prices in cents when you can. Name the real market title.

PLACING A TRADE:
When the user clearly wants to place/open a position, give a one-line rationale, then emit EXACTLY ONE trade block and nothing after it:

\`\`\`hedge-trade
{"eventSlug":"<event slug>","marketId":"<gamma market id>","marketSlug":"<market slug>","side":"yes"|"no","margin":<number>,"leverage":<number>,"market":"<title>","selection":"Yes"|"No"}
\`\`\`

Rules for trade blocks:
- eventSlug, marketId and marketSlug MUST come from the live data.
- side is yes or no. If they did not name a stake, default margin to 5. If they did not name leverage, default to 1. Never exceed that market's maxLeverage. 2x–4x only on rows marked leverage=yes.
- Do NOT emit a trade block for a pure question.
- The user still reviews the ticket and confirms on the market page. Tell them to hit Review & open.

LIVE DATA (refreshed each turn — treat as the source of truth):
${marketContext}`;
}

export function parseTradeIntents(text: string): {
  cleanText: string;
  intents: TradeIntent[];
} {
  const intents: TradeIntent[] = [];
  let match: RegExpExecArray | null;
  TRADE_FENCE.lastIndex = 0;
  while ((match = TRADE_FENCE.exec(text)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
      const side = String(raw.side ?? "").toLowerCase();
      if (side !== "yes" && side !== "no") continue;
      const eventSlug = String(raw.eventSlug ?? "").trim();
      const marketId = String(raw.marketId ?? "").trim();
      const marketSlug = String(raw.marketSlug ?? "").trim();
      if (!eventSlug || !marketId) continue;
      const leverage = Math.min(4, Math.max(1, Number(raw.leverage) || 1));
      intents.push({
        eventSlug,
        marketId,
        marketSlug,
        side,
        margin: Math.max(1, Number(raw.margin) || 5),
        leverage,
        market: String(raw.market ?? "Hedge market"),
        selection: String(raw.selection ?? (side === "yes" ? "Yes" : "No")),
      });
    } catch {
      /* prose still renders */
    }
  }
  return { cleanText: text.replace(TRADE_FENCE, "").trim(), intents };
}

export function ticketHref(intent: TradeIntent) {
  const q = new URLSearchParams({
    m: intent.marketId,
    s: intent.side,
  });
  if (intent.leverage > 1) q.set("lev", String(intent.leverage));
  return `/market/${encodeURIComponent(intent.eventSlug)}?${q}`;
}

export const HEDGIE_SUGGESTIONS = [
  "Which leverage market has the best Yes price in band?",
  "What is the implied chance Lula wins?",
  "Open $5 Yes on Fed no-change at 2x",
  "How does vault leverage work?",
];
