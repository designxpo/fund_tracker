"use client";

import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { inr } from "@/lib/money";
import { parseYmd } from "@/lib/budget";
import { isDaily } from "@/lib/types";

/**
 * Planned/unplanned spending this cycle (outside the daily budget), plus anything still
 * waiting on a card bill, with a one-tap "settle" once the fund actually pays for it.
 */
export function OutsideBudget({ showTotals = true }: { showTotals?: boolean }) {
  const { spends, summary, goals, owedSpends, cards, settleSpends } = useStore();
  const toast = useToast();
  if (!summary) return null;

  const inCycle = spends.filter((s) => !isDaily(s) && s.spent_on >= summary.cycle.start && s.spent_on <= summary.cycle.end);
  const planned = inCycle.filter((s) => s.spend_type === "planned").reduce((t, s) => t + Number(s.amount), 0);
  const unplanned = inCycle.filter((s) => s.spend_type === "unplanned").reduce((t, s) => t + Number(s.amount), 0);

  const byFund = goals
    .map((g) => ({ goal: g, items: owedSpends.filter((s) => s.goal_id === g.id) }))
    .filter((f) => f.items.length > 0);

  if (!byFund.length && !(showTotals && (planned || unplanned))) return null;

  return (
    <section aria-label="Outside the daily budget" className="space-y-3 rounded-2xl bg-surface p-4">
      {showTotals && (planned > 0 || unplanned > 0) && (
        <div>
          <h2 className="text-sm font-semibold">Outside the daily budget</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted">Unplanned this cycle</p>
              <p className="font-semibold tabular-nums">{inr(unplanned)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Planned this cycle</p>
              <p className="font-semibold tabular-nums">{inr(planned)}</p>
            </div>
          </div>
        </div>
      )}

      {byFund.map(({ goal, items }) => {
        const total = items.reduce((t, s) => t + Number(s.amount), 0);
        const enough = goal.balance >= total;
        return (
          <div key={goal.id} className="rounded-xl bg-warn/10 p-3">
            <p className="text-sm">
              <b>{inr(total)}</b> on your card bill, to be paid from <b>{goal.name}</b>
              <span className="text-muted"> (has {inr(Math.round(goal.balance))})</span>
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
              {items.map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {parseYmd(s.spent_on).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ·{" "}
                    {s.note || (s.spend_type === "planned" ? "Planned" : "Unplanned")} · {cards.find((c) => c.id === s.card_id)?.nickname ?? "card"}
                  </span>
                  <span className="tabular-nums">{inr(Number(s.amount))}</span>
                </li>
              ))}
            </ul>
            <button
              disabled={!enough}
              onClick={() => {
                settleSpends(items);
                toast({ msg: `${inr(total)} taken from ${goal.name} for the card bill` });
              }}
              className="mt-2 h-10 w-full rounded-full bg-navy text-sm font-semibold text-white disabled:opacity-40"
            >
              {enough ? `Paid the bill: take ${inr(total)} from ${goal.name}` : `${goal.name} is short by ${inr(total - goal.balance)}`}
            </button>
          </div>
        );
      })}
    </section>
  );
}
