"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { ok, useData } from "@/lib/use-data";
import { rpc } from "@/lib/rpc";
import { useToast } from "@/components/toast";
import { addMonths, ymLabel } from "@/lib/planner";
import { budgetTotals, capUsage, moneyValue, type BudgetLine } from "@/lib/budget-controls";
import { cycleEnd, diffDays } from "@/lib/budget";
import { inr } from "@/lib/money";

type MonthRow = { month: string; daily_budget: number; salary: number | null };
type Template = BudgetLine & { month: string };
type CategoryCap = { month: string; category_id: string; amount: number };
type BudgetData = { months: MonthRow[]; templates: Template[]; caps: CategoryCap[] };
const inputClass = "mt-1 h-12 w-full min-w-0 rounded-xl border border-line bg-white/80 px-3 text-base text-ink outline-none focus:border-navy focus:ring-2 focus:ring-mint/40";

function Amount({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return <label className="block min-w-0 text-xs font-medium text-muted">{label}<input inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} className={inputClass} />{hint && <span className="mt-1 block text-xs font-normal">{hint}</span>}</label>;
}

export default function BudgetPage() {
  const { cycle, ready } = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const { data, error, reload } = useData("budget-controls", async (): Promise<BudgetData> => {
    const sb = createClient();
    const [months, templates, caps] = await Promise.all([
      sb.from("plan_months").select("month,daily_budget,salary").order("month").then(ok),
      sb.from("plan_templates").select("*").order("month").order("sort_order").then(ok),
      sb.from("category_month_caps").select("month,category_id,amount").then(ok),
    ]);
    return { months: months as MonthRow[], templates: templates as Template[], caps: caps as CategoryCap[] };
  });
  if (error) return <div role="alert" className="space-y-3 rounded-2xl bg-surface p-5"><h1 className="text-xl font-bold">Budget unavailable</h1><p className="text-sm text-bad">{error}</p><button className="h-11 rounded-xl bg-navy px-4 text-white" onClick={() => void reload()}>Try again</button></div>;
  if (!ready || !cycle || !data) return <div aria-label="Loading budget" aria-busy className="h-72 animate-pulse rounded-3xl bg-surface" />;
  const month = selected ?? cycle.starts_on.slice(0, 7);
  function choose(next: string) {
    if (dirty && !confirm("Discard the unsaved budget changes?")) return;
    setSelected(next); setDirty(false);
  }
  return <div className="space-y-5 pt-2">
    <header className="flex items-start justify-between gap-3"><div><Link href="/" className="text-sm text-muted">‹ Home</Link><h1 className="mt-1 text-3xl font-bold tracking-tight">Your budget</h1><p className="mt-1 text-sm text-muted">Give every month a plan you can follow.</p></div><span className="rounded-full bg-mint/30 px-3 py-1.5 text-xs font-semibold text-navy">{month === cycle.starts_on.slice(0, 7) ? "Current cycle" : "Upcoming"}</span></header>
    <div className="flex items-center gap-2 rounded-2xl bg-surface p-3"><button aria-label="Previous month" disabled={month <= cycle.starts_on.slice(0, 7)} onClick={() => choose(addMonths(month, -1))} className="h-11 w-11 shrink-0 rounded-xl bg-bg text-lg disabled:opacity-30">‹</button><label className="min-w-0 flex-1 text-xs text-muted">Plan for<input aria-label="Budget month" type="month" value={month} min={cycle.starts_on.slice(0, 7)} onChange={e => e.target.value && choose(e.target.value)} className="block h-10 w-full bg-transparent text-base font-semibold text-ink" /></label><button aria-label="Next month" onClick={() => choose(addMonths(month, 1))} className="h-11 w-11 shrink-0 rounded-xl bg-bg text-lg">›</button></div>
    <BudgetEditor key={`${cycle.id}:${month}`} month={month} data={data} onDirty={setDirty} refresh={reload} />
  </div>;
}

function BudgetEditor({ month, data, onDirty, refresh }: { month: string; data: BudgetData; onDirty: (v: boolean) => void; refresh: () => Promise<void> }) {
  const { cycle, cards, categories, planItems, spends, goals, reload } = useStore();
  const toast = useToast();
  const current = month === cycle!.starts_on.slice(0, 7);
  const effective = data.months.filter(r => r.month.slice(0, 7) > cycle!.starts_on.slice(0, 7) && r.month.slice(0, 7) <= month).at(-1);
  const templateMonth = data.templates.filter(r => r.month.slice(0, 7) > cycle!.starts_on.slice(0, 7) && r.month.slice(0, 7) <= month).at(-1)?.month;
  const source = current || !templateMonth ? planItems : data.templates.filter(r => r.month === templateMonth);
  const expectedSalary = data.months.filter(r => r.month.slice(0, 7) > cycle!.starts_on.slice(0, 7) && r.month.slice(0, 7) <= month && r.salary != null).at(-1)?.salary;
  const [salary, setSalary] = useState(String(current ? cycle!.salary : expectedSalary ?? cycle!.salary));
  const [daily, setDaily] = useState(String(current ? cycle!.daily_budget : effective?.daily_budget ?? cycle!.daily_budget));
  const [items, setItems] = useState(() => source.filter(r => !["bills", "unspent", "adjustment"].includes(r.kind)).map(r => ({ ...r, planned: String(r.planned) })));
  const [cardCaps, setCardCaps] = useState(() => Object.fromEntries(cards.filter(c => c.monthly_cap > 0).map(c => [c.id, String(c.monthly_cap)])));
  const [categoryCaps, setCategoryCaps] = useState(() => Object.fromEntries(data.caps.filter(c => c.month.slice(0, 7) === month).map(c => [c.category_id, String(c.amount)])));
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = current ? diffDays(cycle!.starts_on, cycleEnd(cycle!.starts_on, cycle!.ends_on)) + 1 : new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const numeric = (v: string) => { try { return moneyValue(v); } catch { return NaN; } };
  const totals = budgetTotals(numeric(salary), numeric(daily), days, items.map(i => ({ ...i, planned: numeric(i.planned) })));
  const valid = Number.isFinite(totals.total) && Number.isFinite(totals.remaining);
  const monthSpends = spends.filter(s => s.spent_on.slice(0, 7) === month);
  function change(fn: () => void) { fn(); setDirty(true); onDirty(true); setError(null); }

  async function save() {
    setBusy(true); setError(null);
    try {
      const payload = items.map(i => ({ ...i, planned: moneyValue(i.planned) }));
      const cc = Object.entries(cardCaps).map(([id, value]) => ({ id, amount: moneyValue(value) }));
      if (cc.some(c => c.amount <= 0)) throw new Error("Credit card caps must be greater than zero.");
      await rpc("save_budget", { p_month: `${month}-01`, p_salary: moneyValue(salary), p_daily: moneyValue(daily), p_items: payload, p_cards: cc,
        p_categories: Object.entries(categoryCaps).filter(([, v]) => v.trim() !== "").map(([id, v]) => ({ id, amount: moneyValue(v) })) });
      setDirty(false); onDirty(false);
      await Promise.all([reload(), refresh()]);
      toast({ msg: `${ymLabel(month)} budget saved` });
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save your budget"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <section className="glass-hero space-y-4 rounded-3xl p-5" aria-label="Budget summary">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-widest text-muted">{ymLabel(month)} · {days} days</p><span role="status" className={`rounded-full px-2.5 py-1 text-xs font-semibold ${!valid ? "bg-bg text-muted" : totals.remaining < 0 ? "bg-bad/10 text-bad" : "bg-good/10 text-good"}`}>{!valid ? "Check amounts" : totals.remaining < 0 ? "Over salary" : "Within salary"}</span></div>
      <div><p className="text-sm text-muted">{valid && totals.remaining < 0 ? "Reduce your plan by" : "Unallocated after your plan"}</p><p className="mt-1 text-4xl font-bold tabular-nums">{valid ? inr(Math.abs(totals.remaining)) : "—"}</p></div>
      <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs text-muted"><div>Salary<b className="mt-1 block text-sm text-ink">{Number.isFinite(numeric(salary)) ? inr(numeric(salary)) : "—"}</b></div><div>Commitments<b className="mt-1 block text-sm text-ink">{valid ? inr(totals.commitments) : "—"}</b></div><div>Daily spending<b className="mt-1 block text-sm text-ink">{valid ? inr(totals.spending) : "—"}</b></div></div>
      <p className="text-xs text-muted">Planned allocations only. Existing card bills and fund shortfalls are shown on <Link href="/salary" className="font-semibold underline">Salary day</Link>; allow for them before spending the remainder.</p>
    </section>

    <fieldset disabled={busy} className="min-w-0 space-y-4">
    <section className="space-y-4 rounded-2xl bg-surface p-4"><div><h2 className="font-semibold">Salary & daily cap</h2><p className="mt-1 text-xs text-muted">{current ? "Updates this cycle. Past transactions stay unchanged." : "Starts in this month and continues until a later budget takes over. Actual salary is confirmed on salary day."}</p></div><div className="grid grid-cols-2 gap-3"><Amount label={current ? "Take-home salary (₹)" : "Expected salary (₹)"} value={salary} onChange={v => change(() => setSalary(v))} /><Amount label="Daily cap (₹)" value={daily} onChange={v => change(() => setDaily(v))} /></div><div className="rounded-xl bg-bg px-3 py-3 text-sm"><span className="text-muted">Monthly daily-spending allowance</span><b className="mt-1 block text-lg tabular-nums">{valid ? `${inr(totals.spending)} · ${inr(numeric(daily))} × ${days} days` : "Enter valid amounts"}</b>{valid && <p className="mt-1 text-xs text-muted">With these commitments, up to {inr(totals.affordableDaily)}/day fits your salary before existing shortfalls.</p>}</div></section>

    <section className="space-y-3 rounded-2xl bg-surface p-4"><h2 className="font-semibold">Bills, savings & one-off expenses</h2><p className="text-xs text-muted">Edit planned amounts here. Payments and actual amounts stay on Salary day. Future month plans continue until the next saved plan.</p><div className="divide-y divide-line">{items.map((item, index) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.name}</p><p className="mt-0.5 text-xs text-muted">{item.kind === "savings" ? "Savings / fund" : item.kind === "loan" ? "EMI" : item.kind === "buffer" ? "Buffer" : item.kind === "prepayment" ? "Prepayment" : "Expense"}{current && item.done ? ` · actual ${inr(Number(item.actual ?? item.planned))}` : ""}</p></div><Amount label={`${item.name} (₹)`} value={item.planned} onChange={v => change(() => setItems(items.map((r, i) => i === index ? { ...r, planned: v } : r)))} /></div>)}</div><details className="rounded-xl border border-dashed border-line p-3"><summary className="cursor-pointer text-sm font-semibold text-navy">+ Plan a one-off expense</summary><div className="mt-3 space-y-3"><label className="block text-xs text-muted">Expense name<input value={newName} onChange={e => setNewName(e.target.value)} maxLength={120} placeholder="e.g. Supplements · 2 months" className={inputClass} /></label><Amount label="Planned cost (₹)" value={newAmount} onChange={setNewAmount} /><label className="block text-xs text-muted">Reserve into a fund (optional)<select value={newGoal} onChange={e => setNewGoal(e.target.value)} className={inputClass}><option value="">Fixed cost · record payment on Salary day</option>{goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><button type="button" disabled={!newName.trim() || !Number.isFinite(numeric(newAmount))} onClick={() => change(() => { setItems([...items, { id: crypto.randomUUID(), name: newName.trim(), planned: String(moneyValue(newAmount)), kind: newGoal ? "savings" : "fixed", goal_id: newGoal || null, loan_id: null, actual: null, done: false }]); setNewName(""); setNewAmount(""); setNewGoal(""); })} className="h-11 w-full rounded-xl bg-navy text-sm font-semibold text-white disabled:opacity-40">Add to this plan</button><p className="text-xs text-muted">For a fund purchase, reserve into the fund, record the contribution on Salary day, then log the purchase as Planned. Fixed-cost payments belong on Salary day; avoid logging them twice. Set a one-off line to ₹0 in the following month if it carries forward.</p></div></details></section>

    <section className="space-y-3 rounded-2xl bg-surface p-4"><h2 className="font-semibold">Category caps</h2><p className="text-xs text-muted">For {ymLabel(month)} only. Blank means no cap; ₹0 means no spending. Includes all purchase types, net of refunds. These are tracking limits within your plan, not extra allocations.</p><div className="space-y-3">{categories.map(c => { const spent = monthSpends.filter(s => s.category_id === c.id).reduce((t, s) => t + s.amount, 0); const cap = numeric(categoryCaps[c.id] ?? ""); const usage = capUsage(cap, spent); return <div key={c.id} className="rounded-xl border border-line p-3"><div className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3"><div><p className="text-sm font-medium">{c.icon} {c.name}</p><p className="mt-1 text-xs text-muted">{inr(spent)} spent{Number.isFinite(cap) ? ` · ${inr(Math.abs(usage.remaining))} ${usage.remaining < 0 ? "over cap" : "left"}` : ""}</p></div><Amount label={`${c.name} cap (₹)`} value={categoryCaps[c.id] ?? ""} onChange={v => change(() => setCategoryCaps({ ...categoryCaps, [c.id]: v }))} /></div>{Number.isFinite(cap) && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${usage.remaining < 0 ? "bg-bad" : "bg-mint"}`} style={{ width: `${usage.percent}%` }} /></div>}</div>; })}</div></section>

    <section className="space-y-3 rounded-2xl bg-surface p-4"><h2 className="font-semibold">Card caps · every month</h2><p className="text-xs text-muted">Recurring limits across all months, including this cycle. These do not reserve additional salary. Cash/debit has no credit cap.</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{cards.filter(c => c.monthly_cap > 0).map(c => <Amount key={c.id} label={`${c.nickname} cap (₹)`} value={cardCaps[c.id] ?? ""} onChange={v => change(() => setCardCaps({ ...cardCaps, [c.id]: v }))} />)}</div></section>
    </fieldset>

    {goals.some(g => g.kind === "sinking") && <section className="rounded-2xl bg-surface p-4"><h2 className="font-semibold">Bulk purchases & sinking funds</h2>{goals.filter(g => g.kind === "sinking").map(g => <div key={g.id} className="mt-3 rounded-xl bg-bg p-3"><p className="text-sm font-semibold">{g.name}</p><p className="mt-1 text-xs text-muted">{inr(g.target ?? 0)} every {g.cycle_months ?? "—"} months · save {inr(g.monthly_contribution ?? 0)}/month</p><p className={`mt-1 text-xs ${g.available < 0 ? "text-bad" : "text-muted"}`}>{inr(g.balance)} balance − {inr(g.owed)} pending bills = {inr(g.available)} available</p><Link href={`/goals/goal?id=${g.id}`} className="mt-2 inline-block py-1 text-sm font-semibold text-navy">View fund & purchases →</Link></div>)}<Link href="/more/settings#sinking-funds" className="mt-3 inline-block text-sm font-semibold text-navy">Edit bulk cost, frequency & next due →</Link></section>}

    <div className="sticky bottom-24 z-30 rounded-2xl border border-white/80 bg-white/95 p-3 shadow-lg backdrop-blur-xl"><div className="flex items-center gap-3"><p role="status" className="flex-1 text-xs text-muted">{busy ? "Saving your budget…" : dirty ? "Unsaved changes" : "All changes saved"}</p><button type="button" disabled={busy || !dirty || !valid} onClick={() => void save()} className="h-12 rounded-xl bg-navy px-5 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Saving…" : "Save budget"}</button></div>{error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}</div>
  </div>;
}
