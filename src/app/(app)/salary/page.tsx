"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { ok, useData } from "@/lib/use-data";
import { rpc } from "@/lib/rpc";
import { addDays, cycleEnd, diffDays, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { monthSummary } from "@/lib/month";
import { STEP_TITLES, stepOf } from "@/lib/plan";
import { MonthCard } from "@/components/salary/month-card";
import { CardBillStep } from "@/components/salary/card-bill-step";
import { DailyResultRow, MoveRow, PlanRow } from "@/components/salary/rows";

export default function SalaryPage() {
  const { cycle, cards, today, reload, ready, goals, planItems, settlements } = useStore();
  const toast = useToast();
  const sb = createClient();
  const [rolling, setRolling] = useState(false);
  const [newDate, setNewDate] = useState(today);
  const [newSalary, setNewSalary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Only what the store doesn't already have: last cycle's spends (for card bills), extra income, the loan.
  const { data } = useData("salary-extra", async () => {
    if (!cycle) return null;
    const [prev, income, loan] = await Promise.all([
      sb.from("cycles").select("starts_on, ends_on").eq("ends_on", addDays(cycle.starts_on, -1)).limit(1).then(ok),
      sb.from("income").select("amount").gte("received_on", cycle.starts_on).lte("received_on", cycleEnd(cycle.starts_on, cycle.ends_on)).then(ok),
      sb.from("loan").select("name").limit(1).then(ok),
    ]);
    const p = (prev as { starts_on: string; ends_on: string }[])[0];
    const prevSpends = p
      ? ((await sb.from("spends").select("amount, card_id, spent_on, spend_type").gte("spent_on", p.starts_on).lte("spent_on", p.ends_on).then(ok)) as {
          amount: number; card_id: string | null; spent_on: string; spend_type?: string;
        }[])
      : [];
    return {
      prev: p,
      prevSpends: prevSpends.map((s) => ({ ...s, amount: Number(s.amount) })),
      extraIncome: (income as { amount: number }[]).reduce((t, i) => t + Number(i.amount), 0),
      loanName: ((loan as { name: string }[])[0]?.name as string | undefined) ?? null,
    };
  }, cycle?.id);

  if (!ready || !cycle || !data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;

  const days = diffDays(cycle.starts_on, cycleEnd(cycle.starts_on, cycle.ends_on)) + 1;
  const salary = Number(cycle.salary);
  const month = monthSummary(salary, Number(cycle.daily_budget) * days, planItems, settlements);
  const bill = settlements.find((s) => s.kind === "card_bills");
  const dailyResults = settlements.filter((s) => s.kind === "daily_result");
  const moves = settlements.filter((s) => s.kind === "leftover" || s.kind === "borrow");
  const doneCount = planItems.filter((i) => i.done).length;
  const planSteps = [...new Set(planItems.map((i) => stepOf(i, goals)))];
  const steps = [1, ...planSteps, ...(dailyResults.length ? [10] : []), ...(moves.length ? [11] : [])].sort((a, b) => a - b);

  /** Run a database function, then refresh everything that shows money. */
  async function act(fn: () => Promise<unknown>, msg?: string) {
    try {
      await fn();
      await reload();
      if (msg) toast({ msg });
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  async function settleMonth(target: string) {
    const amount = Math.round(month.result * 100) / 100;
    const goal = goals.find((g) => g.id === target);
    if (amount < 0 && goal?.role === "emergency" && !confirm(`Borrow ${inr(-amount)} from your Emergency fund?`)) return;
    await act(
      () => rpc("settle_month", { p_cycle: cycle!.id, p_amount: amount, p_goal: target === "loan" ? null : target, p_to_loan: target === "loan" }),
      amount > 0
        ? target === "loan"
          ? `${inr(amount)} prepaid. Ask your lender to reduce tenure, not EMI.`
          : `${inr(amount)} moved to ${goal?.name}`
        : `${inr(-amount)} borrowed from ${goal?.name}`,
    );
  }

  async function startCycle() {
    setBusy(true);
    setErr(null);
    try {
      await rpc("start_cycle", { p_starts_on: newDate, p_salary: Number(newSalary || salary) });
      setRolling(false);
      await reload();
      toast({ msg: "New cycle started. Work through the checklist." });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start the cycle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Salary day</h1>
          <p className="text-sm text-muted">
            Cycle from {parseYmd(cycle.starts_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {doneCount}/
            {planItems.length} done
          </p>
        </div>
        <button
          onClick={() => {
            setRolling((v) => !v);
            setNewSalary(String(salary));
          }}
          className="h-11 shrink-0 rounded-xl bg-mint px-4 text-sm font-semibold text-navy"
        >
          Salary received
        </button>
      </header>

      {rolling && (
        <section className="space-y-3 rounded-2xl bg-surface p-4">
          <p className="text-sm">
            This closes the current cycle, starts a new one and uses next month&apos;s plan (or copies this one). Last cycle&apos;s card bills and daily
            budget result (left over or overspent) appear as steps 1 and 10.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-muted">
              Salary date
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink" />
            </label>
            <label className="text-xs text-muted">
              Salary (₹)
              <input
                inputMode="decimal"
                value={newSalary}
                onChange={(e) => setNewSalary(e.target.value.replace(/[^\d.]/g, ""))}
                className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink"
              />
            </label>
          </div>
          {err && <p className="text-sm text-bad">{err}</p>}
          <button disabled={busy} onClick={startCycle} className="h-12 w-full rounded-xl bg-navy font-semibold text-white disabled:opacity-50">
            {busy ? "Starting…" : "Close cycle & start new"}
          </button>
        </section>
      )}

      <MonthCard
        month={month}
        salary={salary}
        dailyBudget={Number(cycle.daily_budget)}
        days={days}
        goals={goals}
        loanName={data.loanName}
        onSettle={settleMonth}
      />

      {data.extraIncome > 0 && (
        <Link href="/more/income" className="flex items-center justify-between rounded-2xl bg-surface p-4 text-sm">
          <span>
            Extra income this cycle <b className="text-good">+{inr(data.extraIncome)}</b>
            <span className="block text-xs text-muted">Already split into goals when you logged it</span>
          </span>
          <span aria-hidden className="text-muted">›</span>
        </Link>
      )}

      {steps.map((step) => (
        <section key={step} className="rounded-2xl bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold">
            <span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">{step}</span>
            {STEP_TITLES[step]}
          </h2>

          {step === 1 && (
            <CardBillStep
              cards={cards}
              prev={data.prev}
              prevSpends={data.prevSpends}
              bill={bill}
              onPaid={(done) => act(() => rpc("set_settlement", { p_id: bill!.id, p_done: done }))}
            />
          )}

          <ul className="divide-y divide-line">
            {step >= 2 &&
              step <= 9 &&
              planItems
                .filter((i) => stepOf(i, goals) === step)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((i) => (
                  <PlanRow
                    key={i.id}
                    item={i}
                    onToggle={(done) =>
                      act(
                        () => rpc("set_plan_item", { p_item: i.id, p_done: done }),
                        done && i.kind === "prepayment" ? "Ask your lender to reduce tenure, not EMI." : undefined,
                      )
                    }
                    onActual={(v) =>
                      act(() => rpc("set_plan_item", v === null ? { p_item: i.id, p_clear_actual: true } : { p_item: i.id, p_actual: v }))
                    }
                  />
                ))}
            {step === 10 &&
              dailyResults.map((s) => (
                <DailyResultRow
                  key={s.id}
                  s={s}
                  goals={goals}
                  onGoal={(goalId) => act(() => rpc("set_settlement", { p_id: s.id, p_goal: goalId || null, p_set_goal: true }))}
                  onToggle={(done) => act(() => rpc("set_settlement", { p_id: s.id, p_done: done }))}
                />
              ))}
            {step === 11 &&
              moves.map((s) => (
                <MoveRow
                  key={s.id}
                  s={s}
                  onUndo={() => confirm(`Undo "${s.note}"?`) && act(() => rpc("undo_settlement", { p_id: s.id }), "Undone")}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
