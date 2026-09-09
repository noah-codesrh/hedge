import {
  publicCorsHeaders,
  publicJson,
  publicOptions,
} from "../lib/server/public-cors";
import { listSpotMarkets } from "../lib/server/spot";
import { SPOT_MAX_AMOUNT, SPOT_MIN_AMOUNT } from "../lib/spot-ticket";

export function headers() {
  return publicCorsHeaders();
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") return publicOptions();

  const origin = new URL(request.url).origin;
  const catalog = await listSpotMarkets({ origin, limit: 1 }).catch(() => ({
    total: 0,
  }));

  return publicJson({
    name: "Hedge 1x spot",
    version: "1",
    description:
      "Another product can list and quote every live 1x market, then send the user to a prefilled ticket. The fill stays in Hedge. No builder key, no Privy token.",
    docs: "https://docs.hedgeapp.trade/developers",
    llms: `${origin}/llms.txt`,
    fill: "ticket",
    limits: {
      minAmount: SPOT_MIN_AMOUNT,
      maxAmount: SPOT_MAX_AMOUNT,
      currency: "USDG",
      orderType: "FAK",
    },
    status: {
      live: catalog.total > 0,
      markets: catalog.total,
    },
    endpoints: [
      { method: "GET", path: "/api/spot", auth: false, summary: "This card." },
      {
        method: "GET",
        path: "/api/spot/markets",
        auth: false,
        summary: "Live 1x book. ?q= &limit= &offset=",
      },
      {
        method: "GET",
        path: "/api/spot/quote",
        auth: false,
        summary: "Walk the book. ?marketId= &side=yes|no &amount=5",
      },
      {
        method: "GET",
        path: "/api/spot/ticket",
        auth: false,
        summary: "Same as quote, plus a ticketUrl the user opens.",
      },
    ],
    ticket: {
      pattern: `${origin}/market/{eventSlug}?m={marketId}&s=yes|no&amt={amount}`,
      example: `${origin}/market/brazil-presidential-election?m=601819&s=yes&amt=5`,
    },
  });
}
