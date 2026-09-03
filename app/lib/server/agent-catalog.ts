import { cents } from "../format";
import {
  LEVERAGE_MARKETS,
  PRICE_BAND,
  leverageIsLive,
  type LeverageMarket,
} from "../leverage";
import { quoteOpenOnChain, readEngineState } from "../leverage-chain";
import { listLeverageMarkets } from "../polymarket";
import { agentLimits } from "./agent-executor";

export type AgentMarket = {
  marketSlug: string;
  marketId: string;
  eventSlug: string;
  title: string;
  yes: number;
  no: number;
  yesCents: string;
  band: "in-band" | "off-band";
  maxLeverage: number;
  volume24h: number;
  ticketUrl: string;
};

function resolveListed(input: {
  marketSlug?: string;
  marketId?: string;
}): LeverageMarket | null {
  const slug = (input.marketSlug ?? "").trim();
  const id = (input.marketId ?? "").trim();
  return (
    LEVERAGE_MARKETS.find(
      (m) =>
        (slug && m.marketSlug === slug) ||
        (id && (m.marketId === id || m.yesTokenId === id)),
    ) ?? null
  );
}

export function listedMarket(input: {
  marketSlug?: string;
  marketId?: string;
}) {
  return resolveListed(input);
}

export async function listAgentMarkets(): Promise<AgentMarket[]> {
  const listed = await listLeverageMarkets().catch(() => []);
  return listed.map((row) => {
    const yes = row.market.yes.price;
    const inBand = yes >= PRICE_BAND.min && yes <= PRICE_BAND.max;
    return {
      marketSlug: row.config.marketSlug,
      marketId: row.market.id,
      eventSlug: row.event.slug,
      title: row.config.title,
      yes,
      no: row.market.no.price,
      yesCents: cents(yes),
      band: inBand ? "in-band" : "off-band",
      maxLeverage: row.config.maxLeverage,
      volume24h: Math.round(row.market.volume24hr),
      ticketUrl: `https://hedgeapp.trade/market/${encodeURIComponent(row.event.slug)}?m=${encodeURIComponent(row.market.id)}`,
    };
  });
}

export async function agentStatus() {
  const [engine, markets] = await Promise.all([
    readEngineState(),
    listAgentMarkets(),
  ]);
  const limits = agentLimits();
  return {
    live: leverageIsLive && !engine?.openingPaused,
    openingPaused: engine?.openingPaused ?? true,
    maxLeverage: engine?.maxLeverage ?? 1,
    minMargin: engine?.minMargin ?? limits.minMargin,
    maxMargin: Math.min(engine?.maxMargin ?? limits.maxMargin, limits.maxMargin),
    capacity: engine?.capacity ?? null,
    markets: markets.length,
    betting: leverageIsLive && !engine?.openingPaused,
  };
}

export async function quoteAgentTicket(input: {
  marketSlug?: string;
  marketId?: string;
  side: "yes" | "no";
  margin: number;
  leverage: number;
}) {
  const listed = resolveListed(input);
  if (!listed) {
    return { error: "That market is not on the agent wall.", status: 404 as const };
  }
  const quote = await quoteOpenOnChain({
    marketSlug: listed.marketSlug,
    isLong: input.side === "yes",
    margin: input.margin,
    leverage: input.leverage,
  });
  if (!quote) {
    return { error: "Could not quote that ticket.", status: 502 as const };
  }
  return {
    marketSlug: listed.marketSlug,
    marketId: listed.marketId,
    title: listed.title,
    side: input.side,
    margin: input.margin,
    leverage: input.leverage,
    notional: input.margin * input.leverage,
    quote,
  };
}
