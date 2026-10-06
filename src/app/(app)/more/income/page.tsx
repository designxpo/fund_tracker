"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { ok, useData } from "@/lib/use-data";
import { rpc } from "@/lib/rpc";
import { loadPlanner, type GoalRow, type Split } from "@/lib/planner-data";
import { cycleEnd, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";

const SOURCES = ["Freelance", "Bonus", "Refund", "Gift", "Interest", "Cashback", "Other"];
const ROLE_ORDER = ["emergency", "trip", "long_term", "buffer"];

/** Custom goals by priority, then the built-in savings goals. */
const orderGoals = (goals: GoalRow[]) => [
  ...goals.filter((g) => g.is_custom).sort((a, b) => a.priority - b.priority),
  ...goals.filter((g) => !g.is_custom).sort((a, b) => ROLE_ORDER.indexOf(a.role ?? "") - ROLE_ORDER.indexOf(b.role ?? "")),
];

function defaultSplit(goals: GoalRow[], saved: Split | null): Record<string, number> {
  const ids = new Set(goals.map((g) => g.id));
  if (saved?.some((s) => ids.has(s.goal_id))) {
    return Object.fromEntries(saved.filter((s) => ids.has(s.goal_id)).map((s) => [s.goal_id, s.pct]));
  }
  const top = goals.filter((g) => g.is_custom).sort((a, b) => a.priority - b.priority)[0] ?? goals.find((g) => g.role === "trip");
  const emergency = goals.find((g) => g.role === "emergency");
  return { ...(top && { [top.id]: 50 }), ...(emergency && { [emergency.id]: 30 }) };
}

export default function IncomePage() {
  const { cycle, today, ready } = useStore();
  const toast = useToast();
  const sb = createClient();

  const { data, reload } = useData("planner", async () => (cycle ? loadPlanner(sb, cycle, today) : null), cycle?.id);

  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("Freelance");
  const [custom, setCustom] = useState("");
  const [date, setDate] = useState(today);
  const [recurring, setRecurring] = useState(false);
  const [note, setNote] = useState("");
  const [split, setSplit] = useState<Record<string, number> | null>(null);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  const goals = useMemo(() => (data ? orderGoals(data.goals) : []), [data]);

  if (!ready || !cycle || !data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;

  const pcts = split ?? defaultSplit(goals, data.split);
  const allocatedPct = Object.values(pcts).reduce((s, v) => s + (v || 0), 0);
  const amt = Number(amount) || 0;
  const src = source === "Other" ? custom.trim() || "Other" : source;

  const end = cycleEnd(cycle.starts_on, cycle.ends_on);
  const thisCycle = data.income.filter((i) => i.received_on >= cycle.starts_on && i.received_on <= end);
  const cycleTotal = thisCycle.reduce((s, i) => s + i.amount, 0);

  const setPct = (id: string, v: number) => setSplit({ ...pcts, [id]: Math.max(0, Math.min(100, v)) });

  async function save() {
    if (!(amt > 0) || allocatedPct > 100) return;
    setBusy(true);
    try {
      const split = Object.entries(pcts)
        .filter(([, p]) => p > 0)
        .map(([goal_id, pct]) => ({ goal_id, pct }));
      // One database call: income row + goal deposits + remembered split, all or nothing.
      await rpc("log_income", {
        p_amount: amt,
        p_source: src,
        p_date: date,
        p_recurring: recurring,
        p_note: note,
        p_split: split,
        p_remember: remember,
      });
      const rows = split.map((x) => ({ amount: Math.round((amt * x.pct) / 100) })).filter((r) => r.amount > 0);
      const kept = amt - rows.reduce((s, r) => s + r.amount, 0);
      toast({ msg: `${inr(amt)} from ${src} logged${rows.length ? ` · ${inr(amt - kept)} to goals` : ""}` });
      setAmount("");
      setNote("");
      setRecurring(false);
      setSplit(null);
      setRemember(false);
      void reload();
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Couldn't save" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this income? Money it moved into goals is taken back out.")) return;
    try {
      ok(await sb.from("income").delete().eq("id", id));
      void reload();
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Couldn't delete" });
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <div>
        <Link href="/more" className="text-sm text-muted">‹ More</Link>
        <h1 className="text-2xl font-bold">Extra income</h1>
      </div>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-surface p-3 shadow-sm">
          <p className="text-xs text-muted">This cycle</p>
          <p className="text-xl font-bold tabular-nums">{inr(cycleTotal)}</p>
        </div>
        <div className="rounded-2xl bg-surface p-3 shadow-sm">
          <p className="text-xs text-muted">Expected monthly</p>
          <p className="text-xl font-bold tabular-nums">{inr(data.extraMonthly)}</p>
          <p className="text-[11px] text-muted">used by the goal planner</p>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
        <label className="flex items-baseline gap-1 border-b border-line pb-2">
          <span className="text-2xl font-semibold text-muted">₹</span>
          <input
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label="Amount"
            className="w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:text-line"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              aria-pressed={source === s}
              className={`h-11 rounded-full border px-4 text-[15px] ${source === s ? "border-navy bg-navy text-white" : "border-line bg-bg"}`}
            >
              {s}
            </button>
          ))}
        </div>
        {source === "Other" && (
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Source name" className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint" />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} aria-label="Date received" className="h-11 rounded-xl border border-line bg-bg px-2 text-base" />
          <label className="flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="h-5 w-5 accent-[var(--good)]" />
            Comes every month
          </label>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint" />

        <div>
          <p className="text-sm font-semibold">Where should it go?</p>
          <ul className="mt-2 divide-y divide-line">
            {goals.map((g) => {
              const p = pcts[g.id] ?? 0;
              return (
                <li key={g.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {g.icon ?? ""} {g.name}
                  </span>
                  <span className="w-20 text-right text-xs tabular-nums text-muted">{amt ? inr(Math.round((amt * p) / 100)) : ""}</span>
                  <button onClick={() => setPct(g.id, p - 10)} aria-label={`Less to ${g.name}`} className="h-11 w-9 rounded-lg bg-bg text-lg">−</button>
                  <span className="w-11 text-center text-sm font-medium tabular-nums">{p}%</span>
                  <button onClick={() => setPct(g.id, p + 10)} aria-label={`More to ${g.name}`} className="h-11 w-9 rounded-lg bg-bg text-lg">+</button>
                </li>
              );
            })}
            <li className="flex items-center justify-between py-2 text-sm">
              <span className="text-muted">Keep as spending money</span>
              <span className={`font-medium tabular-nums ${allocatedPct > 100 ? "text-bad" : ""}`}>
                {allocatedPct > 100 ? `${allocatedPct - 100}% over` : `${100 - allocatedPct}%${amt ? ` · ${inr(amt - Object.values(pcts).reduce((s, v) => s + Math.round((amt * (v || 0)) / 100), 0))}` : ""}`}
              </span>
            </li>
          </ul>
          <label className="mt-1 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 accent-[var(--good)]" />
            Use this split next time
          </label>
        </div>

        <button
          disabled={!(amt > 0) || allocatedPct > 100 || busy}
          onClick={save}
          className="h-12 w-full rounded-xl bg-navy font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save income"}
        </button>
      </section>

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <ul className="divide-y divide-line text-sm">
          {data.income.length === 0 && <li className="py-2 text-muted">Nothing logged yet.</li>}
          {data.income.map((i) => (
            <li key={i.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {i.source}
                  {i.recurring && <span className="ml-2 rounded-full bg-mint/25 px-2 py-0.5 text-[10px] font-semibold text-good">monthly</span>}
                </span>
                <span className="block text-xs text-muted">
                  {parseYmd(i.received_on).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  {i.note ? ` · ${i.note}` : ""}
                </span>
              </span>
              <b className="tabular-nums text-good">+{inr(i.amount)}</b>
              <button onClick={() => remove(i.id)} aria-label="Delete income" className="h-9 w-9 text-muted">✕</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
