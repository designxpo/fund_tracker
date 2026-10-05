"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { OutsideBudget } from "@/components/outside-budget";
import { ok, useData } from "@/lib/use-data";
import Link from "next/link";
import { addDays, cycleEnd, diffDays, parseYmd, sumBetween } from "@/lib/budget";
import { inr } from "@/lib/money";
import { amountOf, normalizePlan, STEP_TITLES, stepOf, type Goal, type PlanItem } from "@/lib/plan";
import { monthSummary } from "@/lib/month";

export default function SalaryPage() {
  const { cycle, cards, today, reload, ready, goals: storeGoals } = useStore();
  const toast = useToast();
  const sb = createClient();
  const [rolling, setRolling] = useState(false);
  const [newDate, setNewDate] = useState(today);
  const [newSalary, setNewSalary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState(""); // where the leftover goes / where the shortfall comes from

  const { data, reload: reloadPage } = useData(async () => {
    if (!cycle) return null;
    const [items, goals, loan, prev, income] = await Promise.all([
      sb.from("plan_items").select("*").eq("cycle_id", cycle.id).order("name").then(ok),
      sb.from("goals").select("*").then(ok),
      sb.from("loan").select("id").limit(1).then(ok),
      sb.from("cycles").select("*").eq("ends_on", addDays(cycle.starts_on, -1)).limit(1).then(ok),
      sb.from("income").select("amount").gte("received_on", cycle.starts_on).lte("received_on", cycleEnd(cycle.starts_on, cycle.ends_on)).then(ok),
    ]);
    const p = prev?.[0];
    const prevSpends = p
      ? await sb.from("spends").select("amount, card_id, spent_on, spend_type").gte("spent_on", p.starts_on).lte("spent_on", p.ends_on).then(ok)
      : [];
    return {
      items: (items as Record<string, unknown>[]).map(normalizePlan),
      goals: (goals as Goal[]).map((g) => ({ ...g, target: g.target == null ? null : Number(g.target) })),
      loanId: (loan as { id: string }[])?.[0]?.id as string | undefined,
      prev: p as { starts_on: string; ends_on: string } | undefined,
      extraIncome: (income as { amount: number }[]).reduce((s, i) => s + Number(i.amount), 0),
      prevSpends: (prevSpends as { amount: number; card_id: string; spent_on: string; spend_type: string }[]).map((s) => ({ ...s, amount: Number(s.amount) })),
    };
  }, cycle?.id);

  if (!ready || !cycle || !data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;
  const { items, goals, loanId, prev, prevSpends, extraIncome } = data;

  // Salary = this cycle's plan (actual amounts where entered) + the daily budget (₹/day × days in cycle).
  const days = diffDays(cycle.starts_on, cycleEnd(cycle.starts_on, cycle.ends_on)) + 1;
  const dailyReserve = Number(cycle.daily_budget) * days;
  const salary = Number(cycle.salary);
  const month = monthSummary(salary, dailyReserve, items);
  const diff = month.result;
  const saved = month.variances.filter((v) => v.diff < 0);
  const over = month.variances.filter((v) => v.diff > 0);

  // Leftover can go to any goal or the loan; a shortfall can be borrowed from a goal that has the money.
  const moveTargets = storeGoals;
  const borrowSources = storeGoals.filter((g) => g.available >= Math.abs(diff)).sort((a, b) => (a.name === "Emergency fund" ? 1 : b.name === "Emergency fund" ? -1 : b.available - a.available));
  const doneCount = items.filter((i) => i.done).length;

  const steps = [...new Set(items.map((i) => stepOf(i, goals)))].sort((a, b) => a - b);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await reloadPage();
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  const syncSideEffects = async (item: PlanItem, amount: number) => {
    if (item.goal_id && ["buffer", "savings", "unspent", "adjustment"].includes(item.kind)) {
      ok(await sb.from("goal_transactions").update({ amount }).eq("plan_item_id", item.id));
    }
    if (item.kind === "prepayment") ok(await sb.from("loan_prepayments").update({ amount }).eq("plan_item_id", item.id));
  };

  const toggle = (item: PlanItem, checked: boolean) =>
    run(async () => {
      const amount = amountOf(item);
      if (checked) {
        ok(await sb.from("plan_items").update({ done: true, actual: amount }).eq("id", item.id));
        // unspent can be negative (overspent daily budget): that's a withdrawal from the chosen goal
        if (amount !== 0 && item.goal_id && ["buffer", "savings", "unspent"].includes(item.kind)) {
          ok(await sb.from("goal_transactions").insert({ goal_id: item.goal_id, amount, note: item.name, plan_item_id: item.id }));
        }
        if (amount > 0 && item.kind === "prepayment" && loanId) {
          ok(await sb.from("loan_prepayments").insert({ loan_id: loanId, amount, plan_item_id: item.id }));
          toast({ msg: "Ask your lender to reduce tenure, not EMI." });
        }
      } else {
        ok(await sb.from("plan_items").update({ done: false }).eq("id", item.id));
        ok(await sb.from("goal_transactions").delete().eq("plan_item_id", item.id));
        ok(await sb.from("loan_prepayments").delete().eq("plan_item_id", item.id));
      }
    });

  const setActual = (item: PlanItem, raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v !== null && (!Number.isFinite(v) || (v < 0 && item.kind !== "unspent"))) return;
    if (v === item.actual) return;
    return run(async () => {
      ok(await sb.from("plan_items").update({ actual: v }).eq("id", item.id));
      if (item.done) await syncSideEffects(item, v ?? item.planned);
    });
  };

  /** Balance the month: move the leftover into a goal/loan, or borrow the shortfall from a goal. */
  const settleMonth = () =>
    run(async () => {
      const amount = Math.round(diff * 100) / 100;
      if (!target || Math.abs(amount) < 0.5) return;
      const toLoan = target === "loan";
      const goal = storeGoals.find((g) => g.id === target);
      if (amount < 0 && goal?.name === "Emergency fund" && !confirm(`Borrow ${inr(-amount)} from your Emergency fund?`)) return;
      const label = amount > 0 ? `Leftover → ${toLoan ? "Navi prepayment" : goal?.name}` : `Borrowed from ${goal?.name}`;
      const row = ok(
        await sb
          .from("plan_items")
          .insert({ cycle_id: cycle.id, name: label, kind: "adjustment", goal_id: toLoan ? null : target, planned: amount, actual: amount, done: true })
          .select("id")
          .single(),
      ) as { id: string };
      if (toLoan && loanId) {
        ok(await sb.from("loan_prepayments").insert({ loan_id: loanId, amount, plan_item_id: row.id }));
        toast({ msg: `${inr(amount)} prepaid. Ask your lender to reduce tenure, not EMI.` });
      } else {
        ok(await sb.from("goal_transactions").insert({ goal_id: target, amount, note: label, plan_item_id: row.id, happened_on: today }));
        toast({ msg: amount > 0 ? `${inr(amount)} moved to ${goal?.name}` : `${inr(-amount)} borrowed from ${goal?.name}` });
      }
      setTarget("");
      await reload();
    });

  /** Undo a leftover/borrow entry (its goal money / prepayment is removed with it). */
  const undoAdjustment = (item: PlanItem) =>
    run(async () => {
      if (!confirm(`Undo "${item.name}"?`)) return;
      ok(await sb.from("plan_items").delete().eq("id", item.id));
      await reload();
    });

  /** Pick where last cycle's daily-budget result goes (or comes from). */
  const setRowGoal = (item: PlanItem, goalId: string) =>
    run(async () => {
      ok(await sb.from("plan_items").update({ goal_id: goalId || null }).eq("id", item.id));
      if (item.done) ok(await sb.from("goal_transactions").update({ goal_id: goalId }).eq("plan_item_id", item.id));
    });

  async function startCycle() {
    setBusy(true);
    setErr(null);
    const { error } = await sb.rpc("start_cycle", { p_starts_on: newDate, p_salary: Number(newSalary || salary) });
    setBusy(false);
    if (error) return setErr(error.message);
    setRolling(false);
    await reload(); // cycle id changes, which re-fetches this page's data
    toast({ msg: "New cycle started. Work through the checklist." });
  }

  return (
    <div className="space-y-4 pt-2">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Salary day</h1>
          <p className="text-sm text-muted">
            Cycle from {parseYmd(cycle.starts_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {doneCount}/{items.length} done
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
        <section className="space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
          <p className="text-sm">
            This closes the current cycle, starts a new one and uses next month&apos;s plan (or copies this one). Last cycle&apos;s daily budget result (left over or overspent) appears as a row where you choose where it goes.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-muted">
              Salary date
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink" />
            </label>
            <label className="text-xs text-muted">
              Salary (₹)
              <input inputMode="decimal" value={newSalary} onChange={(e) => setNewSalary(e.target.value.replace(/[^\d.]/g, ""))} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-ink" />
            </label>
          </div>
          {err && <p className="text-sm text-bad">{err}</p>}
          <button disabled={busy} onClick={startCycle} className="h-12 w-full rounded-xl bg-navy font-semibold text-white disabled:opacity-50">
            {busy ? "Starting…" : "Close cycle & start new"}
          </button>
        </section>
      )}

      <section role="status" className="space-y-3 rounded-2xl bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">This month</h2>
            <p className="text-xs text-muted">
              Salary {inr(salary)} − plan {inr(month.actualTotal)} − daily budget {inr(dailyReserve)} (₹{Number(cycle.daily_budget)} × {days})
              {month.adjustments !== 0 ? ` − already moved ${inr(month.adjustments)}` : ""}
            </p>
          </div>
          <p className={`shrink-0 text-xl font-bold tabular-nums ${Math.abs(diff) < 0.5 ? "text-good" : diff > 0 ? "text-good" : "text-bad"}`}>
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
            <p className="text-sm font-medium">
              {diff > 0 ? `You have ${inr(diff)} left over. Move it to:` : `You're ${inr(-diff)} short. Borrow it from:`}
            </p>
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
                    {moveTargets.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} (has {inr(Math.round(g.balance))})
                      </option>
                    ))}
                    {loanId && <option value="loan">Navi prepayment (cuts interest)</option>}
                  </>
                ) : (
                  borrowSources.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({inr(Math.round(g.available))} free){g.name === "Emergency fund" ? " · emergencies only" : ""}
                    </option>
                  ))
                )}
              </select>
              <button disabled={!target} onClick={settleMonth} className="h-11 shrink-0 rounded-xl bg-navy px-4 text-sm font-semibold text-white disabled:opacity-40">
                {diff > 0 ? "Move" : "Borrow"}
              </button>
            </div>
            {diff < 0 && borrowSources.length === 0 && <p className="mt-2 text-xs text-bad">No goal has enough to cover it. Lower a plan line below instead.</p>}
            {diff > 0 && <p className="mt-2 text-xs text-muted">Tip: wait until the end of the cycle if you might still need it.</p>}
          </div>
        )}
      </section>

      {extraIncome > 0 && (
        <Link href="/more/income" className="flex items-center justify-between rounded-2xl bg-surface p-4 text-sm shadow-sm">
          <span>
            Extra income this cycle <b className="text-good">+{inr(extraIncome)}</b>
            <span className="block text-xs text-muted">Already split into goals when you logged it</span>
          </span>
          <span aria-hidden className="text-muted">›</span>
        </Link>
      )}

      {steps.map((step) => (
        <section key={step} className="rounded-2xl bg-surface p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold">
            <span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">{step}</span>
            {STEP_TITLES[step]}
          </h2>
          {step === 1 && prev && (() => {
            const cardIds = new Set(cards.filter((c) => c.monthly_cap > 0).map((c) => c.id));
            const onCards = prevSpends.filter((x) => cardIds.has(x.card_id));
            const byType = (t: string) => onCards.filter((x) => (x.spend_type ?? "daily") === t).reduce((a, x) => a + x.amount, 0);
            return (
              <div className="mb-2 mt-2 text-xs text-muted">
                <ul className="space-y-1">
                  {cards
                    .filter((c) => c.monthly_cap > 0)
                    .map((c) => (
                      <li key={c.id} className="flex justify-between">
                        <span>{c.nickname}</span>
                        <span className="tabular-nums">{inr(sumBetween(prevSpends, prev.starts_on, prev.ends_on, c.id))}</span>
                      </li>
                    ))}
                </ul>
                <p className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-semibold text-ink">
                  <span>Full card bill</span>
                  <span className="tabular-nums">{inr(onCards.reduce((a, x) => a + x.amount, 0))}</span>
                </p>
                <p>
                  Daily {inr(byType("daily"))} · Planned {inr(byType("planned"))} (paid from funds) · Unplanned {inr(byType("unplanned"))} (from buffer)
                </p>
              </div>
            );
          })()}
          {step === 1 && (
            <div className="mb-2">
              <OutsideBudget showTotals={false} />
            </div>
          )}
          <ul className="divide-y divide-line">
            {items
              .filter((i) => stepOf(i, goals) === step)
              .map((i) =>
                i.kind === "adjustment" ? (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>{i.name}</span>
                    <span className="flex items-center gap-2">
                      <b className={`tabular-nums ${i.planned < 0 ? "text-bad" : "text-good"}`}>
                        {i.planned < 0 ? "−" : "+"}
                        {inr(Math.abs(i.planned))}
                      </b>
                      <button onClick={() => undoAdjustment(i)} aria-label={`Undo ${i.name}`} className="h-9 w-9 text-muted">
                        ✕
                      </button>
                    </span>
                  </li>
                ) : (
                <li key={i.id} className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={i.done}
                    disabled={i.kind === "unspent" && !i.goal_id && amountOf(i) !== 0}
                    onChange={(e) => toggle(i, e.target.checked)}
                    aria-label={`Mark ${i.name} done`}
                    className="h-6 w-6 shrink-0 accent-[var(--good)]"
                  />
                  <span className={`min-w-0 flex-1 text-sm ${i.done ? "text-muted line-through" : ""}`}>
                    {i.name}
                    <span className="block text-xs text-muted">
                      {i.kind === "unspent" ? (i.planned < 0 ? `overspent ${inr(-i.planned)}` : `left ${inr(i.planned)}`) : `planned ${inr(i.planned)}`}
                    </span>
                    {i.kind === "unspent" && amountOf(i) !== 0 && (
                      <select
                        value={i.goal_id ?? ""}
                        onChange={(e) => setRowGoal(i, e.target.value)}
                        aria-label={i.planned < 0 ? "Borrow the overspend from" : "Move what's left to"}
                        className="mt-1 h-9 w-full rounded-lg border border-line bg-white/80 px-2 text-sm text-ink no-underline"
                      >
                        <option value="">{i.planned < 0 ? "Borrow from…" : "Move to…"}</option>
                        {storeGoals.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({inr(Math.round(g.available))} free)
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                  <span className="text-muted">₹</span>
                  <input
                    key={`${i.id}-${i.actual}`}
                    inputMode="decimal"
                    defaultValue={i.actual ?? ""}
                    placeholder={String(i.planned)}
                    onBlur={(e) => setActual(i, e.target.value.replace(/[^\d.]/g, ""))}
                    aria-label={`Actual amount for ${i.name}`}
                    className="h-11 w-24 rounded-xl border border-line bg-bg px-2 text-right text-base tabular-nums outline-none focus:border-mint"
                  />
                </li>
                ),
              )}
          </ul>
        </section>
      ))}
    </div>
  );
}
