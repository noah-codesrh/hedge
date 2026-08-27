export type Side = "yes" | "no";

export interface Outcome {
  label: string;
  price: number;
  tokenId: string | null;
}

export interface Market {
  id: string;
  eventId: string;
  slug: string;
  question: string;
  image: string | null;
  icon: string | null;
  yes: Outcome;
  no: Outcome;
  volume24hr: number;
  liquidity: number;
  spread: number | null;
  endDate: string | null;
  enableOrderBook: boolean;
  acceptingOrders: boolean;
  groupItemTitle: string | null;
}

export interface EventTag {
  id: string;
  slug: string;
  label: string;
}

export interface PolymarketEvent {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  icon: string | null;
  volume24hr: number;
  liquidity: number;
  endDate: string | null;
  tags: EventTag[];
  markets: Market[];
  /**
   * Outcomes the event really has. List responses ship only the markets a card
   * can show, so this stays truthful when `markets` has been shortened.
   */
  marketCount: number;
}

export interface HedgePosition {
  id: string;
  eventId: string;
  eventSlug?: string;
  eventTitle: string;
  marketId: string;
  question: string;
  groupItemTitle?: string | null;
  side: Side;
  amountUsdg: number;
  entryPrice: number;
  shares: number;
  conversionId?: string;
  amountPusd?: number;
  createdAt: number;
  status: "open" | "closed";
}
