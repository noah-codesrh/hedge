import { cents, fiat } from "../lib/format";
import type { LeverageOrder } from "../lib/leverage-chain";
import type { TradeStage } from "../lib/leverage-actions";

const STAGE: Record<TradeStage, string> = {
  approving: "Approving…",
  checking: "Checking…",
  submitting: "Working…",
};

export function LeverageOrders({
  orders,
  busyId,
  stage,
  onCancel,
}: {
  orders: LeverageOrder[];
  busyId: string | null;
  stage: TradeStage | null;
  onCancel: (order: LeverageOrder) => void;
}) {
  if (orders.length === 0) return null;

  return (
    <section className="mt-4">
      <h3 className="text-[13px] font-semibold text-muted">Resting limits</h3>
      <ul className="mt-2 divide-y divide-white/5 overflow-hidden rounded-2xl bg-card-2 ring-1 ring-white/5">
        {orders.map((order) => {
          const busy = busyId === `order:${order.id}`;
          return (
            <li
              key={String(order.id)}
              className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]"
            >
              <div className="min-w-0">
                <p className="truncate text-white/90">
                  {order.isClose ? "Close" : `${order.leverage.toFixed(0)}x open`}{" "}
                  {order.isLong ? "Yes" : "No"} at {cents(order.limitPrice)}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {order.label ?? "Market"}
                  {!order.isClose ? ` · ${fiat(order.margin)} margin` : ""}
                  {order.fillable ? " · fillable now" : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onCancel(order)}
                className="shrink-0 text-[12px] font-semibold text-gold disabled:opacity-40"
              >
                {busy ? STAGE[stage ?? "submitting"] : "Cancel"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
