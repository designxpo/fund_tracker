"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { ok, useData } from "@/lib/use-data";
import { addDays, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { amountOf, normalizePlan, type Goal } from "@/lib/plan";
import { loadPlanner } from "@/lib/planner-data";
import { addMonths, ymLabel } from "@/lib/planner";
import { diffDays, sinkingTarget } from "@/lib/budget";

const SAVINGS_2M_TARGET = 50000;
const WITHDRAWABLE = new Set(["Surprise buffer", "Emergency fund"]);
const ICON: Record<string, string> = { "Emergency fund": "🛟", "Trip fund": "✈️", "Long-term invested": "📈", "Surprise buffer": "🎁" };

type Tx = { id: string; goal_id: string; amount: number; note: string | null; happened_on: string };

export default function GoalsPage() {
  const { cycle, today, ready, goals: storeGoals } = useStore();
  const toast = useToast();
  const sb = createClient();
  const [form, setForm] = useState<{ goal: Goal; kind: "deposit" | "withdraw" } | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const { data, reload } = useData(async () => {
    if (!cycle) return null;
    const [goals, txs, items, templates] = await Promise.all([
      sb.from("goals").select("*").order("name").then(ok),
      sb.from("goal_transactions").select("*").order("happened_on", { ascending: false }).order("id").then(ok),
      sb.from("plan_items").select("*").eq("cycle_id", cycle.id).then(ok),
      sb.from("plan_templates").select("month, goal_id, kind, planned").then(ok),
    ]);
    return {
      goals: (goals as Goal[]).map((g) => ({ ...g, target: g.target == null ? null : Number(g.target), opening_balance: Number(g.opening_balance ?? 0) })),
      txs: (txs as Tx[]).map((t) => ({ ...t, amount: Number(t.amount) })),
      items: (items as Record<string, unknown>[]).map(normalizePlan),
      templates: (templates as { month: string; goal_id: string | null; kind: string; planned: number }[]).map((t) => ({ ...t, planned: Number(t.planned) })),
    };
  }, cycle?.id);

  const planner = useData(async () => (cycle ? loadPlanner(sb, cycle, today) : null), cycle?.id);

  if (!ready || !data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;
  const { goals, txs, items, templates } = data;

  const order = ["Emergency fund", "Trip fund", "Long-term invested", "Surprise buffer"];
  const sorted = goals.filter((g) => !(g as Goal & { is_custom?: boolean }).is_custom && (g as Goal).kind !== "sinking").sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const balanceOf = (g: Goal) => g.opening_balance + txs.filter((t) => t.goal_id === g.id).reduce((s, t) => s + t.amount, 0);

  // Monthly contribution uses the latest upcoming month's plan if there is one (e.g. the Dec-2026 step-up).
  const cycleMonth = cycle ? cycle.starts_on.slice(0, 7) : "";
  const latestMonth = templates.map((t) => t.month.slice(0, 7)).filter((m) => m > cycleMonth).sort().at(-1);
  const monthlyOf = (g: Goal) =>
    latestMonth
      ? templates.filter((t) => t.month.slice(0, 7) === latestMonth && t.goal_id === g.id).reduce((s, t) => s + t.planned, 0)
      : items
          .filter((i) => i.goal_id === g.id && i.kind !== "unspent")
          .reduce((s, i) => s + amountOf({ planned: i.planned, actual: null }), 0);

  const since = addDays(today, -60);
  const last2m = txs.filter((t) => t.happened_on >= since).reduce((s, t) => s + t.amount, 0);

  const estimate = (g: Goal) => {
    if (!g.target) return null;
    const left = g.target - balanceOf(g);
    if (left <= 0) return "Reached 🎉";
    const m = monthlyOf(g);
    if (m <= 0) return "No monthly contribution planned";
    const d = parseYmd(today);
    d.setMonth(d.getMonth() + Math.ceil(left / m));
    return `Est. ${d.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`;
  };

  async function submit() {
    if (!form) return;
    const v = Number(amount);
    if (!(v > 0)) return;
    if (form.kind === "withdraw") {
      if (!note.trim()) return toast({ msg: "Add a reason for the withdrawal" });
      if (v > balanceOf(form.goal)) return toast({ msg: "That's more than the balance" });
    }
    try {
      ok(
        await sb.from("goal_transactions").insert({
          goal_id: form.goal.id,
          amount: form.kind === "withdraw" ? -v : v,
          note: note.trim() || null,
          happened_on: today,
        }),
      );
      toast({ msg: `${form.kind === "withdraw" ? "Withdrew" : "Added"} ${inr(v)} ${form.kind === "withdraw" ? "from" : "to"} ${form.goal.name}` });
      setForm(null);
      setAmount("");
      setNote("");
      await reload();
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Couldn't save" });
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Goals</h1>
        <div className="flex gap-2">
          <Link href="/more/income" className="grid h-11 place-items-center rounded-xl bg-surface px-3 text-sm font-medium shadow-sm">
            + Income
          </Link>
          <Link href="/goals/new" className="grid h-11 place-items-center rounded-xl bg-mint px-3 text-sm font-semibold text-navy">
            + New goal
          </Link>
        </div>
      </header>

      {planner.data && (
        <section aria-label="My goals" className="space-y-2">
          <h2 className="text-sm font-semibold">My goals</h2>
          {planner.data.custom.length === 0 ? (
            <Link href="/goals/new" className="block rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">
              Want a phone, bike or trip? Add it and see when you can afford it.
            </Link>
          ) : (
            [...planner.data.custom]
              .sort((a, b) => a.priority - b.priority)
              .map((g) => {
                const r = planner.data!.results[g.id];
                const target = g.target ?? 0;
                const pct = target ? Math.min(100, (g.balance / target) * 100) : 0;
                const now = r.readyBy === addMonths(planner.data!.inputs.start, -1);
                const late = g.target_date && (!r.readyBy || r.readyBy > g.target_date.slice(0, 7));
                return (
                  <Link key={g.id} href={`/goals/${g.id}`} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-sm">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-bg text-xl">{g.icon ?? "🎯"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2">
                        <span className="truncate font-medium">{g.name}</span>
                        <span className="shrink-0 text-sm tabular-nums">{inr(target)}</span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full bg-good" style={{ width: `${pct}%` }} />
                      </span>
                      <span className={`mt-1 block text-xs ${late ? "text-warn" : "text-muted"}`}>
                        {now ? "You can buy it now 🎉" : r.readyBy ? `Ready by ${ymLabel(r.readyBy)}` : "Not in sight yet: tap for options"}
                        {late && r.readyBy ? ` · wanted ${ymLabel(g.target_date!.slice(0, 7))}` : ""}
                      </span>
                    </span>
                  </Link>
                );
              })
          )}
        </section>
      )}

      {storeGoals.some((g) => g.kind === "sinking") && (
        <section aria-label="Sinking funds" className="space-y-2">
          <h2 className="text-sm font-semibold">Sinking funds</h2>
          {storeGoals
            .filter((g) => g.kind === "sinking")
            .sort((a, b) => (a.next_due_date ?? "9").localeCompare(b.next_due_date ?? "9"))
            .map((g) => {
              const need = sinkingTarget(g);
              const short = Math.max(0, need - g.balance);
              const pct = need > 0 ? Math.max(0, Math.min(100, (g.balance / need) * 100)) : 0;
              const inDays = g.next_due_date ? diffDays(today, g.next_due_date) : null;
              return (
                <div key={g.id} className="rounded-2xl bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{g.name}</p>
                      <p className="text-xs text-muted">
                        {inr(g.monthly_contribution ?? 0)}/month · {inr(need)} every {g.cycle_months ?? 1} {g.cycle_months === 1 ? "month" : "months"}
                      </p>
                    </div>
                    <p className="text-lg font-bold tabular-nums">{inr(Math.round(g.balance))}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full ${short > 0 ? "bg-warn" : "bg-good"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted">
                      {g.next_due_date
                        ? `Next due ${parseYmd(g.next_due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}${inDays != null && inDays >= 0 ? ` · in ${inDays} days` : inDays != null ? " · overdue" : ""}`
                        : "No due date"}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${short > 0 ? "bg-warn/15 text-warn" : "bg-good/15 text-good"}`}>
                      {short > 0 ? `Short by ${inr(short)}` : "Ready ✓"}
                    </span>
                  </div>
                </div>
              );
            })}
          <p className="text-xs text-muted">Filled on Salary Day. Spend from it with Quick Add → Planned.</p>
        </section>
      )}

      <h2 className="text-sm font-semibold">Savings</h2>

      <section className="glass-hero rounded-3xl p-4">
        <p className="text-sm text-muted">Saved in the last 2 months</p>
        <p className="text-3xl font-bold tabular-nums text-good">{inr(last2m)}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full bg-good" style={{ width: `${Math.max(0, Math.min(100, (last2m / SAVINGS_2M_TARGET) * 100))}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">Target {inr(SAVINGS_2M_TARGET)} every 2 months</p>
      </section>

      {sorted.map((g) => {
        const bal = balanceOf(g);
        const pct = g.target ? Math.max(0, Math.min(100, (bal / g.target) * 100)) : null;
        const hist = txs.filter((t) => t.goal_id === g.id);
        const est = estimate(g);
        return (
          <section key={g.id} className="rounded-2xl bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-bg text-xl">{ICON[g.name] ?? "🎯"}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{g.name}</p>
                <p className="text-xs text-muted">{g.target ? `Target ${inr(g.target)}` : "No target"}{est ? ` · ${est}` : ""}</p>
              </div>
              <p className="text-lg font-bold tabular-nums">{inr(bal)}</p>
            </div>
            {pct !== null && (
              <div className="mt-3 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name} progress`}>
                  <div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-right text-xs tabular-nums text-muted">{Math.round(pct)}%</span>
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setForm({ goal: g, kind: "deposit" })} className="h-11 flex-1 rounded-xl bg-navy text-sm font-semibold text-white">
                Add
              </button>
              {WITHDRAWABLE.has(g.name) && (
                <button onClick={() => setForm({ goal: g, kind: "withdraw" })} className="h-11 flex-1 rounded-xl border border-line text-sm font-medium">
                  Withdraw
                </button>
              )}
              <button onClick={() => setOpen(open === g.id ? null : g.id)} className="h-11 rounded-xl px-3 text-sm text-muted">
                {open === g.id ? "Hide" : "History"}
              </button>
            </div>

            {form?.goal.id === g.id && (
              <div className="mt-3 space-y-2 rounded-xl bg-bg p-3">
                <p className="text-sm font-medium">{form.kind === "withdraw" ? "Withdraw from" : "Add to"} {g.name}</p>
                <input autoFocus inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-mint" />
                <input placeholder={form.kind === "withdraw" ? "Reason (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-mint" />
                <div className="flex gap-2">
                  <button onClick={submit} className="h-11 flex-1 rounded-xl bg-navy text-sm font-semibold text-white">Save</button>
                  <button onClick={() => setForm(null)} className="h-11 rounded-xl px-4 text-sm text-muted">Cancel</button>
                </div>
              </div>
            )}

            {open === g.id && (
              <ul className="mt-3 divide-y divide-line text-sm">
                {hist.length === 0 && <li className="py-2 text-muted">No transactions yet.</li>}
                {hist.slice(0, 20).map((t) => (
                  <li key={t.id} className="flex justify-between py-2">
                    <span className="min-w-0 truncate">
                      {t.note ?? (t.amount < 0 ? "Withdrawal" : "Deposit")}
                      <span className="ml-2 text-xs text-muted">{t.happened_on}</span>
                    </span>
                    <span className={`tabular-nums ${t.amount < 0 ? "text-bad" : "text-good"}`}>{t.amount < 0 ? "-" : "+"}{inr(Math.abs(t.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
