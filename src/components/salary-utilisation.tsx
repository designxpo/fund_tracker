"use client";

import { useStore } from "@/lib/store";
import { inr } from "@/lib/money";
import { diffDays } from "@/lib/budget";
import { salaryUtilisation, type MonthItem } from "@/lib/month";
import { isDaily } from "@/lib/types";

const COLORS: Record<string, string> = {
  emis: "#5b8def",
  fixed: "#f5b042",
  saved: "#4fe0ad",
  daily: "#ff7a7e",
  dailyLeft: "#ffc9cb",
};

/** Where this cycle's salary is going, and what was spent through each payment mode. */
export function SalaryUtilisation() {
  const { cycle, summary, planItems, spends, cards } = useStore();
  if (!cycle || !summary) return null;

  const salary = Number(cycle.salary);
  const days = diffDays(summary.cycle.start, summary.cycle.end) + 1;
  const reserve = Number(cycle.daily_budget) * days;
  const util = salaryUtilisation(salary, reserve, summary.cycle.spent, planItems as MonthItem[]);
  const pct = (n: number) => (salary > 0 ? (n / salary) * 100 : 0);

  // Every spend this cycle, whatever the type, grouped by how it was paid.
  const inCycle = spends.filter((s) => s.spent_on >= summary.cycle.start && s.spent_on <= summary.cycle.end);
  const modes = [...cards.map((c) => ({ id: c.id as string | null, name: c.nickname })), { id: null, name: "No card picked" }]
    .map((m) => {
      const list = inCycle.filter((s) => (s.card_id ?? null) === m.id);
      const by = (t: string) => list.filter((s) => (s.spend_type ?? "daily") === t).reduce((a, s) => a + Number(s.amount), 0);
      return { ...m, total: list.reduce((a, s) => a + Number(s.amount), 0), daily: by("daily"), planned: by("planned"), unplanned: by("unplanned") };
    })
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);
  const totalSpent = modes.reduce((a, m) => a + m.total, 0);
  const fromFunds = inCycle.filter((s) => !isDaily(s)).reduce((a, s) => a + Number(s.amount), 0);

  return (
    <>
      <section aria-label="Salary utilisation" className="rounded-2xl bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Salary utilisation</h2>
          <p className="text-xs text-muted">this cycle · {inr(salary)}</p>
        </div>
        <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-line" role="img" aria-label="How the salary is split">
          {util.rows.map((r) => (
            <div key={r.key} style={{ width: `${Math.max(0, pct(r.amount))}%`, background: COLORS[r.key] }} />
          ))}
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {util.rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: COLORS[r.key] }} />
              <span className="flex-1">{r.label}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted">{Math.round(pct(r.amount))}%</span>
              <span className="w-20 text-right font-medium tabular-nums">{inr(r.amount)}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 border-t border-line pt-1.5 font-semibold">
            <span className="h-3 w-3 shrink-0" />
            <span className="flex-1">{util.left >= 0 ? "Not allocated yet" : "Over salary"}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted">{Math.round(pct(Math.abs(util.left)))}%</span>
            <span className={`w-20 text-right tabular-nums ${util.left >= 0 ? "text-good" : "text-bad"}`}>{inr(util.left)}</span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted">Plan lines use the actual amounts you entered on Salary Day. Daily spending includes every payment mode.</p>
      </section>

      {totalSpent > 0 && (
        <section aria-label="Spent by payment mode" className="rounded-2xl bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Spent by payment mode</h2>
            <p className="text-xs text-muted">this cycle · {inr(totalSpent)}</p>
          </div>
          <ul className="mt-2 divide-y divide-line text-sm">
            {modes.map((m) => (
              <li key={m.name} className="py-2">
                <div className="flex justify-between">
                  <span className="font-medium">{m.name}</span>
                  <span className="font-semibold tabular-nums">{inr(m.total)}</span>
                </div>
                <p className="text-xs text-muted">
                  Daily {inr(m.daily)}
                  {m.planned > 0 ? ` · Planned ${inr(m.planned)}` : ""}
                  {m.unplanned > 0 ? ` · Unplanned ${inr(m.unplanned)}` : ""}
                </p>
              </li>
            ))}
          </ul>
          {fromFunds > 0 && <p className="mt-1 text-xs text-muted">{inr(fromFunds)} of this is paid from funds (Surprise buffer / sinking funds), not the daily budget.</p>}
        </section>
      )}
    </>
  );
}
