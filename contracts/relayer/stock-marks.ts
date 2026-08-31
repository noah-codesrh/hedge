import type { Hex } from "viem";

/**
 * Same five as `frontend/app/lib/stock-tokens.ts`. Keep them in lockstep.
 * Quotes come from Blockscout, not Yahoo — SPCX is not a public ticker.
 */
export const LISTED_STOCKS: { symbol: string; address: Hex }[] = [
  { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { symbol: "SPCX", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" },
  { symbol: "AAPL", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { symbol: "GME", address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E" },
  { symbol: "TSLA", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
];

const BLOCKSCOUT =
  process.env.BLOCKSCOUT_API ?? "https://robinhoodchain.blockscout.com/api/v2";

export type StockMark = {
  symbol: string;
  token: Hex;
  markUsd6: bigint;
};

export async function fetchStockMarksUsd6(): Promise<StockMark[]> {
  const out: StockMark[] = [];
  for (const stock of LISTED_STOCKS) {
    const res = await fetch(`${BLOCKSCOUT}/tokens/${stock.address}`);
    if (!res.ok) {
      throw new Error(`blockscout ${stock.symbol} HTTP ${res.status}`);
    }
    const body = (await res.json()) as { exchange_rate?: string | null };
    const dollars = Number(body.exchange_rate);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      console.warn(`[marks] ${stock.symbol} has no exchange_rate`);
      continue;
    }
    out.push({
      symbol: stock.symbol,
      token: stock.address,
      markUsd6: BigInt(Math.round(dollars * 1e6)),
    });
  }
  return out;
}
