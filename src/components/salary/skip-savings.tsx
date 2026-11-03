"use client";

import { useStore } from "@/lib/store";
import { rpc } from "@/lib/rpc";
import { inr } from "@/lib/money";
import { isSkipped, skippableSavings } from "@/lib/month";
import { useMoney } from "@/lib/use-money";

/**
 * Skip savings for this month (e.g. to make up last month's overspend): the line is marked done at ₹0,
 * so nothing moves to the fund and the money stays in the account. Next month's plan is unchanged.
 */
export function SkipSavings({ act }: { act: (fn: () => Promise<unknown>, msg?: string, optimistic?: () => void) => Promise<void> }) {
  const { planItems, goals, patchLocal } = useStore();
  const m = useMoney();
  const { lines, skippedTotal } = skippableSavings(planItems);
  if (!m || !lines.length) return null;
  const L = m.left.left;
  // Short if what's left can't pay for the daily budget until salary day.
  const short = Math.max(0, m.dailyStillNeeded - L);

  return (
    <section id="skip" aria-label="Skip savings this month" className="scroll-mt-4 space-y-3 rounded-2xl bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold">Skip savings this month</h2>
        <p className="text-xs text-muted">
          Behind from last month? Pause an investment or fund for this month only. Nothing goes into it, the money stays in your account, and next month goes back
          to normal.
        </p>
      </div>

      <ul className="divide-y divide-line">
        {lines.map((i) => {
          const skipped = isSkipped(i);
          const fund = goals.find((g) => g.id === i.goal_id)?.name;
          const paid = i.done && !skipped;
          return (
            <li key={i.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 text-sm">
                <span className={skipped ? "text-muted line-through" : ""}>{i.name}</span>
                <span className={`block text-xs ${skipped ? "text-warn" : "text-muted"}`}>
                  {skipped ? `Skipped this month · ${inr(Number(i.planned))} kept` : paid ? `Paid ${inr(Number(i.actual ?? i.planned))}` : `${inr(Number(i.planned))} planned`}
                  {fund && fund !== i.name ? ` · ${fund}` : ""}
                </span>
              </span>
              {skipped ? (
                <button
                  onClick={() =>
                    act(
                      () => rpc("set_plan_item", { p_item: i.id, p_done: false, p_clear_actual: true }),
                      `${i.name} is back on for this month`,
                      () => patchLocal("planItems", i.id, { done: false, actual: null }),
                    )
                  }
                  className="h-10 shrink-0 rounded-full border border-line px-4 text-sm font-medium text-muted"
                >
                  Undo
                </button>
              ) : (
                <button
                  disabled={paid}
                  onClick={() =>
                    act(
                      () => rpc("set_plan_item", { p_item: i.id, p_done: true, p_actual: 0 }),
                      `${i.name} skipped this month · ${inr(Number(i.planned))} kept in your account`,
                      () => patchLocal("planItems", i.id, { done: true, actual: 0 }),
                    )
                  }
                  className="h-10 shrink-0 rounded-full bg-navy px-4 text-sm font-semibold text-white disabled:opacity-30"
                >
                  Skip
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className={`rounded-xl p-3 text-sm ${short > 0 ? "bg-bad/[.07]" : "bg-good/10"}`}>
        {skippedTotal > 0 && (
          <p>
            Skipping <b className="tabular-nums">{inr(skippedTotal)}</b> this month.
          </p>
        )}
        <p className={short > 0 ? "text-bad" : "text-good"}>
          {short > 0
            ? `Still ${inr(short)} short: your daily budget needs ${inr(m.dailyStillNeeded)} for the next ${m.daysLeft} days, but only ${inr(Math.max(0, L))} is left. Skip more, or the gap comes out of your savings.`
            : skippedTotal > 0
              ? `That covers it ✓ ${inr(L)} left: enough for your daily budget until salary day.`
              : `${inr(L)} left: enough for your daily budget until salary day, no need to skip.`}
        </p>
      </div>
      <p className="text-xs text-muted">Already paid a line? It can&apos;t be skipped here; untick it in the checklist below first.</p>
    </section>
  );
}
