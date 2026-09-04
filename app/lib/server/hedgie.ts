import { cents } from "../format";
import { systemPrompt, type ChatMessage } from "../hedgie";
import { LEVERAGE_MARKETS } from "../leverage";
import {
  isLiveMarket,
  listEvents,
  listLeverageMarkets,
  pickLiveMarket,
} from "../polymarket";
import { serverSecrets } from "./secrets";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function hedgieConfigured() {
  return Boolean(serverSecrets().openrouterKey);
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export async function buildMarketContext(): Promise<string> {
  const [listed, feed] = await Promise.all([
    listLeverageMarkets().catch(() => []),
    listEvents({ sort: "trending" }).catch(() => ({ events: [] })),
  ]);

  const lines: string[] = [];
  lines.push("### HEDGE LEVERAGE MARKETS");
  lines.push(
    "These can be opened 2x–4x against the vault when Yes is inside $0.35–$0.65. 1x is always spot Polymarket.",
  );
  for (const row of listed) {
    const yes = row.market.yes.price;
    const band = yes >= 0.35 && yes <= 0.65 ? "in-band" : "off-band";
    lines.push(
      `- leverage=yes | eventSlug=${row.event.slug} | marketId=${row.market.id} | marketSlug=${row.config.marketSlug} | ${row.config.title} | Yes ${cents(yes)} (${pct(yes)}) No ${cents(row.market.no.price)} | ${band} | maxLeverage=${row.config.maxLeverage}x`,
    );
  }

  lines.push("");
  lines.push("### TRENDING SPOT MARKETS (1x only unless also listed above)");
  let n = 0;
  for (const event of feed.events) {
    const market = pickLiveMarket(event) ?? event.markets.find(isLiveMarket);
    if (!market) continue;
    if (LEVERAGE_MARKETS.some((m) => m.marketId === market.id)) continue;
    lines.push(
      `- leverage=no | eventSlug=${event.slug} | marketId=${market.id} | marketSlug=${market.slug} | ${event.title} | Yes ${cents(market.yes.price)} No ${cents(market.no.price)} | maxLeverage=1x`,
    );
    if (++n >= 12) break;
  }

  return lines.join("\n");
}

export async function streamHedgie(
  history: ChatMessage[],
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const { openrouterKey, openrouterModel } = serverSecrets();
  if (!openrouterKey) {
    throw new Error("Hedgie is unavailable.");
  }

  const context = await buildMarketContext();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(context) },
    ...history.filter((m) => m.role === "user" || m.role === "assistant"),
  ];

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://hedgeapp.trade",
      "X-Title": "Hedge - Hedgie",
    },
    body: JSON.stringify({
      model: openrouterModel,
      messages,
      stream: true,
      temperature: 0.4,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail || `Hedgie request failed (${res.status})`);
  }

  return res.body;
}
