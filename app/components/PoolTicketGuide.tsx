import { POOL_TICKET_STEPS } from "../lib/native";

export function PoolTicketGuide({ compact = false }: { compact?: boolean }) {
  return (
    <section
      className={
        compact
          ? "rounded-3xl bg-card p-4 ring-1 ring-white/5 sm:p-5"
          : "mt-6 rounded-3xl bg-card p-5 ring-1 ring-white/5 sm:p-6"
      }
    >
      <h2
        className={
          compact
            ? "text-base font-semibold text-white"
            : "text-xl font-semibold text-white"
        }
      >
        How a ticket works
      </h2>
      <p className="mt-1 text-sm text-muted">
        One path. The window you pick is the one that pays.
      </p>
      <ol
        className={`mt-4 grid gap-3 ${
          compact ? "" : "sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {POOL_TICKET_STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-gold text-[11px] font-bold text-black">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{step.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
