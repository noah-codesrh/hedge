export type TradeReport = {
  wallet: string;
  proxyWallet?: string | null;
  direction: "buy" | "sell";
  outcome: "yes" | "no";
  outcomeLabel?: string | null;
  eventSlug?: string | null;
  marketSlug?: string | null;
  tokenId?: string | null;
  title?: string | null;
  /** Volume: what went in on a buy, what came out on a sell. */
  usdg: number;
  pusd?: number | null;
  shares?: number | null;
  price?: number | null;
  orderId?: string | null;
  conversionId?: string | null;
  tags?: Array<{ slug?: string | null } | string> | null;
};

/**
 * Record a filled trade for volume reporting.
 *
 * Deliberately fire-and-forget: the trade has already settled on chain by the
 * time this runs, so a failed report must never surface to the user. keepalive
 * lets it finish if they navigate away from the confirmation.
 */
export function trackTrade(accessToken: string, report: TradeReport) {
  send("/api/track/trade", accessToken, report);
}

/**
 * Record the nickname a user just saved.
 *
 * The nickname itself still lives in localStorage, so this is a mirror rather
 * than the source of truth and may fail without the user losing anything. The
 * server decides whether it counts as a change.
 */
export function trackNickname(
  accessToken: string,
  report: { nickname: string; wallet?: string | null },
) {
  send("/api/track/nickname", accessToken, report);
}

function send(path: string, accessToken: string, body: unknown) {
  void fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
