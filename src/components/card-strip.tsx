"use client";

import { useState } from "react";
import { capLevel, sumBetween } from "@/lib/budget";
import { inr } from "@/lib/money";
import { useStore } from "@/lib/store";
import type { Card } from "@/lib/types";
import { CardMatch } from "@/components/card-match";

const BAR = { ok: "bg-good", amber: "bg-warn", red: "bg-bad" } as const;
const TEXT = { ok: "text-muted", amber: "text-warn", red: "text-bad" } as const;

export function CardStrip() {
  const { cards, dailySpends, spends, summary } = useStore();
  const [matching, setMatching] = useState<Card | null>(null);
  if (!summary) return null;
  return (
    <section aria-label="Cards" className="grid grid-cols-2 gap-3">
      {matching && <CardMatch card={matching} onClose={() => setMatching(null)} />}
      {cards.map((c) => {
        // Everything on the card this month (what the bank shows); only everyday spends use up the cap.
        const total = spends
          .filter((s) => s.card_id === c.id && s.spent_on >= summary.cycle.start && s.spent_on <= summary.cycle.end)
          .reduce((t, s) => t + Number(s.amount), 0);
        const spent = sumBetween(dailySpends, summary.cycle.start, summary.cycle.end, c.id);
        const level = capLevel(spent, c.monthly_cap);
        const pct = c.monthly_cap > 0 ? Math.min(100, Math.max(0, (spent / c.monthly_cap) * 100)) : 0;
        return (
          <button key={c.id} onClick={() => setMatching(c)} className="rounded-2xl bg-surface p-3 text-left shadow-sm active:scale-[.98]">
            <p className="truncate text-xs font-medium text-muted">{c.nickname}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{inr(total)}</p>
            <p className="-mt-0.5 text-[11px] text-muted">this month</p>
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
                <p className={`mt-1 text-[11px] ${TEXT[level]}`}>
                  Everyday {inr(Math.max(0, spent))} of {inr(c.monthly_cap)}
                </p>
              </>
            ) : (
              <p className="mt-3 text-[11px] text-muted">no cap</p>
            )}
            <p className="mt-1.5 text-[11px] font-medium text-navy">Match with bank ›</p>
          </button>
        );
      })}
    </section>
  );
}
