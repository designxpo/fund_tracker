"use client";

import { useState } from "react";
import { inr } from "@/lib/money";
import type { MonthSummary } from "@/lib/month";
import type { StoreGoal } from "@/lib/types";

/** Salary − plan (actuals) − daily budget = leftover / shortfall, with a one-step move or borrow. */
export function MonthCard({
  month,
  salary,
  dailyBudget,
  days,
  goals,
  loanName,
  onSettle,
}: {
  month: MonthSummary;
  salary: number;
  dailyBudget: number;
  days: number;
  goals: StoreGoal[];
  loanName: string | null;
  onSettle: (target: string) => Promise<void>;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const diff = month.result;
  const saved = month.variances.filter((v) => v.diff < 0);
  const over = month.variances.filter((v) => v.diff > 0);
  // Borrow only from goals that have the money; the emergency fund goes last.
  const sources = goals
    .filter((g) => g.available >= Math.abs(diff))
    .sort((a, b) => (a.role === "emergency" ? 1 : b.role === "emergency" ? -1 : b.available - a.available));

  return (
    <section role="status" className="space-y-3 rounded-2xl bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">This month</h2>
          <p className="text-xs text-muted">
            Salary {inr(salary)} − plan {inr(month.actualTotal)} − daily budget {inr(month.dailyReserve)} (₹{dailyBudget} × {days})
            {month.adjustments !== 0 ? ` − already moved ${inr(month.adjustments)}` : ""}
          </p>
        </div>
        <p className={`shrink-0 text-xl font-bold tabular-nums ${diff >= -0.5 ? "text-good" : "text-bad"}`}>
          {Math.abs(diff) < 0.5 ? "Balanced ✓" : diff > 0 ? `+${inr(diff)}` : `−${inr(-diff)}`}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-bg p-2.5">
          <dt className="text-xs text-muted">Planned</dt>
          <dd className="font-semibold tabular-nums">{inr(month.plannedTotal)}</dd>
        </div>
        <div className="rounded-xl bg-bg p-2.5">
          <dt className="text-xs text-muted">Actual</dt>
          <dd className={`font-semibold tabular-nums ${month.actualTotal > month.plannedTotal ? "text-bad" : "text-good"}`}>{inr(month.actualTotal)}</dd>
        </div>
      </dl>

      {(saved.length > 0 || over.length > 0) && (
        <ul className="space-y-1 text-sm">
          {saved.map((v) => (
            <li key={v.name} className="flex justify-between">
              <span>{v.name}</span>
              <span className="font-medium tabular-nums text-good">{inr(-v.diff)} saved</span>
            </li>
          ))}
          {over.map((v) => (
            <li key={v.name} className="flex justify-between">
              <span>{v.name}</span>
              <span className="font-medium tabular-nums text-bad">{inr(v.diff)} over</span>
            </li>
          ))}
        </ul>
      )}

      {Math.abs(diff) >= 0.5 && (
        <div className={`rounded-xl p-3 ${diff > 0 ? "bg-good/10" : "bg-bad/[.07]"}`}>
          <p className="text-sm font-medium">{diff > 0 ? `You have ${inr(diff)} left over. Move it to:` : `You're ${inr(-diff)} short. Borrow it from:`}</p>
          <div className="mt-2 flex gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={diff > 0 ? "Where to move the leftover" : "Where to borrow from"}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white/80 px-2 text-base text-ink"
            >
              <option value="">Choose…</option>
              {diff > 0 ? (
                <>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} (has {inr(Math.round(g.balance))})
                    </option>
                  ))}
                  {loanName && <option value="loan">{loanName} prepayment (cuts interest)</option>}
                </>
              ) : (
                sources.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({inr(Math.round(g.available))} free){g.role === "emergency" ? " · emergencies only" : ""}
                  </option>
                ))
              )}
            </select>
            <button
              disabled={!target || busy}
              onClick={async () => {
                setBusy(true);
                await onSettle(target);
                setBusy(false);
                setTarget("");
              }}
              className="h-11 shrink-0 rounded-xl bg-navy px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {diff > 0 ? "Move" : "Borrow"}
            </button>
          </div>
          {diff < 0 && sources.length === 0 && <p className="mt-2 text-xs text-bad">No goal has enough to cover it. Lower a plan line below instead.</p>}
          {diff > 0 && <p className="mt-2 text-xs text-muted">Tip: wait until the end of the cycle if you might still need it.</p>}
        </div>
      )}
    </section>
  );
}
