"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { ok, useData } from "@/lib/use-data";
import Link from "next/link";
import { addDays, cycleEnd, parseYmd, sumBetween } from "@/lib/budget";
import { inr } from "@/lib/money";
import { amountOf, normalizePlan, STEP_TITLES, stepOf, type Goal, type PlanItem } from "@/lib/plan";

export default function SalaryPage() {
  const { cycle, cards, today, reload, ready } = useStore();
  const toast = useToast();
  const sb = createClient();
  const [rolling, setRolling] = useState(false);
  const [newDate, setNewDate] = useState(today);
  const [newSalary, setNewSalary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      ? await sb.from("spends").select("amount, card_id, spent_on").gte("spent_on", p.starts_on).lte("spent_on", p.ends_on).then(ok)
      : [];
    return {
      items: (items as Record<string, unknown>[]).map(normalizePlan),
      goals: (goals as Goal[]).map((g) => ({ ...g, target: g.target == null ? null : Number(g.target) })),
      loanId: (loan as { id: string }[])?.[0]?.id as string | undefined,
      prev: p as { starts_on: string; ends_on: string } | undefined,
      extraIncome: (income as { amount: number }[]).reduce((s, i) => s + Number(i.amount), 0),
      prevSpends: (prevSpends as { amount: number; card_id: string; spent_on: string }[]).map((s) => ({ ...s, amount: Number(s.amount) })),
    };
  }, cycle?.id);

  if (!ready || !cycle || !data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;
  const { items, goals, loanId, prev, prevSpends, extraIncome } = data;

  const total = items.reduce((t, i) => t + amountOf(i), 0);
  const salary = Number(cycle.salary);
  const diff = salary - total;
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
    if (item.goal_id && ["buffer", "savings", "unspent"].includes(item.kind)) {
      ok(await sb.from("goal_transactions").update({ amount }).eq("plan_item_id", item.id));
    }
    if (item.kind === "prepayment") ok(await sb.from("loan_prepayments").update({ amount }).eq("plan_item_id", item.id));
  };

  const toggle = (item: PlanItem, checked: boolean) =>
    run(async () => {
      const amount = amountOf(item);
      if (checked) {
        ok(await sb.from("plan_items").update({ done: true, actual: amount }).eq("id", item.id));
        if (amount > 0 && item.goal_id && ["buffer", "savings", "unspent"].includes(item.kind)) {
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
    if (v !== null && (!Number.isFinite(v) || v < 0)) return;
    if (v === item.actual) return;
    return run(async () => {
      ok(await sb.from("plan_items").update({ actual: v }).eq("id", item.id));
      if (item.done) await syncSideEffects(item, v ?? item.planned);
    });
  };

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
            This closes the current cycle, starts a new one, copies the plan (with any scheduled changes) and moves your unspent daily budget to the Trip fund row.
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

      <section
        role="status"
        className={`rounded-2xl p-4 ${Math.abs(diff) < 0.5 ? "bg-good/15 text-good" : diff > 0 ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad"}`}
      >
        <p className="text-sm font-semibold">
          {Math.abs(diff) < 0.5
            ? `Allocated ${inr(total)}: matches your salary`
            : diff > 0
              ? `${inr(diff)} not allocated yet`
              : `${inr(-diff)} over your salary`}
        </p>
        <p className="text-xs opacity-80">
          {inr(total)} planned of {inr(salary)} salary
        </p>
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
          {step === 1 && prev && (
            <ul className="mb-2 mt-2 space-y-1 text-xs text-muted">
              {cards
                .filter((c) => c.monthly_cap > 0)
                .map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>{c.nickname}</span>
                    <span className="tabular-nums">{inr(sumBetween(prevSpends, prev.starts_on, prev.ends_on, c.id))}</span>
                  </li>
                ))}
            </ul>
          )}
          <ul className="divide-y divide-line">
            {items
              .filter((i) => stepOf(i, goals) === step)
              .map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={i.done}
                    onChange={(e) => toggle(i, e.target.checked)}
                    aria-label={`Mark ${i.name} done`}
                    className="h-6 w-6 shrink-0 accent-[var(--good)]"
                  />
                  <span className={`min-w-0 flex-1 text-sm ${i.done ? "text-muted line-through" : ""}`}>
                    {i.name}
                    <span className="block text-xs text-muted">planned {inr(i.planned)}</span>
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
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
