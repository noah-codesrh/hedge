import { useState } from "react";
import { formatStockQty, stockToNumber, type StockHolding } from "../lib/stock-collateral";
import {
  CASH_LOGO,
  STOCK_TOKENS,
  stockCollateralIsLive,
  type StockToken,
} from "../lib/stock-tokens";

export function TokenLogo({
  src,
  symbol,
  size = 18,
}: {
  src?: string | null;
  symbol: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full bg-[#0f0f0f] object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
      className="grid shrink-0 place-items-center rounded-full bg-white/15 font-bold leading-none"
    >
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function CollateralPicker({
  selected,
  holdings,
  onSelect,
  levered = false,
  kind = "trade",
}: {
  selected: StockToken | null;
  holdings: StockHolding[];
  onSelect: (token: StockToken | null) => void;
  /** 2x–4x locks stock on the desk. 1x sells it into USDG first. */
  levered?: boolean;
  kind?: "trade" | "pool";
}) {
  const cashActive = selected == null;
  return (
    <div className="mb-4">
      <p className="mb-2 text-[13px] text-muted">Pay with</p>
      <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 text-[13px] font-semibold transition ${
            cashActive
              ? "bg-gold text-black"
              : "bg-[#1b1b1b] text-[#cfcfcf] hover:bg-[#2c2c2c] hover:text-white"
          }`}
        >
          <TokenLogo src={CASH_LOGO} symbol="USDG" />
          Cash
        </button>
        {STOCK_TOKENS.map((token) => {
          const row = holdings.find(
            (h) => h.token.address.toLowerCase() === token.address.toLowerCase(),
          );
          const qty = row
            ? stockToNumber(row.wallet + row.free, token.decimals)
            : 0;
          const active =
            selected?.address.toLowerCase() === token.address.toLowerCase();
          return (
            <button
              key={token.address}
              type="button"
              onClick={() => onSelect(token)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 text-[13px] font-semibold transition ${
                active
                  ? "bg-gold text-black"
                  : "bg-[#1b1b1b] text-[#cfcfcf] hover:bg-[#2c2c2c] hover:text-white"
              }`}
            >
              <TokenLogo src={token.logoUrl} symbol={token.symbol} />
              {token.symbol}
              {qty > 0 ? (
                <span className="font-medium opacity-70">
                  {formatStockQty(qty, 2)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {selected && levered && !stockCollateralIsLive ? (
        <p className="mt-2 text-[11px] leading-snug text-gold">
          The stock desk is not live yet. You can size a ticket; opening waits
          on the contract.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-snug text-muted">
          {caption(selected, levered, kind)}
        </p>
      )}
    </div>
  );
}

function caption(
  selected: StockToken | null,
  levered: boolean,
  kind: "trade" | "pool",
) {
  if (selected && levered) {
    return `Locks ${selected.symbol} and posts USDG from the desk. Close pays cash; leftover stock unlocks.`;
  }
  if (selected && kind === "pool") {
    return `Sells ${selected.symbol} into cash, then stakes this ticket. Winnings pay cash.`;
  }
  if (selected) {
    return `Sells ${selected.symbol} into cash, then buys this outcome. Close and cash-out stay in cash.`;
  }
  if (kind === "pool") {
    return "Cash is USDG. You can sell a listed stock into the ticket instead. Winnings pay cash.";
  }
  return "Cash is USDG. Pick a listed stock to pay with it instead. Close and cash-out are always cash.";
}
