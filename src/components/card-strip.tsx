"use client";

import { capLevel, sumBetween } from "@/lib/budget";
import { inr } from "@/lib/money";
import { useStore } from "@/lib/store";

const BAR = { ok: "bg-good", amber: "bg-warn", red: "bg-bad" } as const;
const TEXT = { ok: "text-muted", amber: "text-warn", red: "text-bad" } as const;

export function CardStrip() {
  const { cards, dailySpends, summary } = useStore();
  if (!summary) return null;
  return (
    <section aria-label="Cards" className="grid grid-cols-2 gap-3">
      {cards.map((c) => {
        const spent = sumBetween(dailySpends, summary.cycle.start, summary.cycle.end, c.id);
        const level = capLevel(spent, c.monthly_cap);
        const pct = c.monthly_cap > 0 ? Math.min(100, (spent / c.monthly_cap) * 100) : 0;
        return (
          <div key={c.id} className="rounded-2xl bg-surface p-3 shadow-sm">
            <p className="truncate text-xs font-medium text-muted">{c.nickname}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{inr(spent)}</p>
            {c.monthly_cap > 0 ? (
              <>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${c.nickname} cap used`}
                >
                  <div className={`h-full rounded-full ${BAR[level]}`} style={{ width: `${pct}%` }} />
                </div>
                <p className={`mt-1 text-[11px] ${TEXT[level]}`}>of {inr(c.monthly_cap)}</p>
              </>
            ) : (
              <p className="mt-3 text-[11px] text-muted">no cap</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
