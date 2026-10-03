"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { useToast } from "@/components/toast";
import { GoalForm } from "@/components/goal-form";
import { ok, useData } from "@/lib/use-data";
import { loadPlanner, PRIORITY } from "@/lib/planner-data";
import { addMonths, emiFor, freeMoney, HORIZON, simulate, ymLabel, type PlannerInputs } from "@/lib/planner";
import { inr } from "@/lib/money";

const DAYS_PER_MONTH = 365 / 12;
const LEVER_KINDS = new Set(["savings", "buffer", "prepayment"]);

export default function GoalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { cycle, today, ready, reload: reloadStore } = useStore();
  const toast = useToast();
  const sb = createClient();

  const { data, reload } = useData(async () => (cycle ? loadPlanner(sb, cycle, today) : null), cycle?.id);

  const [editing, setEditing] = useState(false);
  const [extra, setExtra] = useState<number | null>(null);
  const [source, setSource] = useState("free");
  const [tenure, setTenure] = useState(12);
  const [rate, setRate] = useState("14");
  const [addAmt, setAddAmt] = useState("");

  if (!ready || !cycle || !data) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;

  const goal = data.custom.find((g) => g.id === id);
  if (!goal) {
    return (
      <div className="space-y-3 pt-4">
        <Link href="/goals" className="text-sm text-muted">‹ Goals</Link>
        <p className="rounded-2xl bg-surface p-5 text-sm text-muted">This goal doesn&apos;t exist any more.</p>
      </div>
    );
  }

  const { inputs } = data;
  const target = goal.target ?? 0;
  const remaining = Math.max(0, target - goal.balance);
  const pct = target ? Math.min(100, (goal.balance / target) * 100) : 0;
  const res = data.results[goal.id];
  const fundedNow = res.readyBy === addMonths(inputs.start, -1);
  const committed = data.lines.filter((l) => l.goal_id === goal.id).reduce((s, l) => s + l.planned, 0);
  const targetYm = goal.target_date?.slice(0, 7) ?? null;
  const onTrack = !!targetYm && !!res.readyBy && res.readyBy <= targetYm;

  // How free money changes over time (scheduled plan changes, loan closing).
  const timeline: { ym: string; free: number }[] = [];
  for (let i = 0; i < HORIZON && timeline.length < 4; i++) {
    const ym = addMonths(inputs.start, i);
    const f = Math.round(freeMoney(ym, inputs));
    if (timeline.at(-1)?.free !== f) timeline.push({ ym, free: f });
  }

  // "Speed it up" lever: set aside ₹x/month for this goal, taken from a chosen source.
  const sources = data.lines.filter((l) => LEVER_KINDS.has(l.kind) && l.goal_id !== goal.id);
  const defaultExtra = targetYm && !onTrack && res.needPerMonth && isFinite(res.needPerMonth)
    ? Math.min(20000, Math.ceil(Math.max(0, res.needPerMonth - committed) / 500) * 500)
    : 2000;
  const x = extra ?? defaultExtra;

  const withLever = (amount: number, src: string): PlannerInputs => {
    if (amount <= 0) return inputs;
    const lines = data.lines.map((l) => ({ ...l }));
    let changes = data.changes;
    let dailyBudget = inputs.dailyBudget;
    lines.push({ id: "lever", name: goal.name, kind: "savings", planned: amount, goal_id: goal.id });
    if (src === "daily") dailyBudget = Math.max(0, dailyBudget - amount / DAYS_PER_MONTH);
    else if (src !== "free") {
      const line = lines.find((l) => l.id === src);
      if (line) {
        line.planned = Math.max(0, line.planned - amount);
        changes = changes.map((c) => (c.name === line.name ? { ...c, planned: Math.max(0, c.planned - amount) } : c));
      }
    }
    return { ...inputs, lines, changes, dailyBudget };
  };
  const lever = simulate(withLever(x, source), data.plannerGoals)[goal.id];
  const sooner = res.months != null && lever.months != null ? res.months - lever.months : null;

  const freeNow = freeMoney(inputs.start, inputs);
  const emi = emiFor(remaining, Number(rate || 0) / 100, tenure);

  async function run(fn: () => Promise<void>, msg: string) {
    try {
      await fn();
      await Promise.all([reload(), reloadStore()]);
      toast({ msg });
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  const applyLever = () =>
    run(async () => {
      const own = data.lines.find((l) => l.goal_id === goal.id);
      if (own) ok(await sb.from("plan_items").update({ planned: own.planned + x }).eq("id", own.id));
      else ok(await sb.from("plan_items").insert({ cycle_id: cycle.id, name: goal.name, kind: "savings", goal_id: goal.id, planned: x }));

      if (source === "daily") {
        ok(await sb.from("cycles").update({ daily_budget: Math.round(inputs.dailyBudget - x / DAYS_PER_MONTH) }).eq("id", cycle.id));
      } else if (source !== "free") {
        const line = data.lines.find((l) => l.id === source)!;
        ok(await sb.from("plan_items").update({ planned: Math.max(0, line.planned - x) }).eq("id", line.id));
        for (const c of data.changes.filter((c) => c.name === line.name && c.effective_from > cycle.starts_on)) {
          ok(await sb.from("plan_changes").update({ planned: Math.max(0, c.planned - x) }).eq("id", c.id));
        }
      }
      setExtra(null);
    }, `${inr(x)}/month added to your plan for ${goal.name}`);

  const deposit = () => {
    const v = Number(addAmt);
    if (!(v > 0)) return;
    return run(async () => {
      ok(await sb.from("goal_transactions").insert({ goal_id: goal.id, amount: v, note: "Added", happened_on: today }));
      setAddAmt("");
    }, `Added ${inr(v)} to ${goal.name}`);
  };

  const remove = async () => {
    if (!confirm(`Delete "${goal.name}"? Its savings history and plan line go too.`)) return;
    try {
      ok(await sb.from("plan_items").delete().eq("goal_id", goal.id).eq("cycle_id", cycle.id));
      ok(await sb.from("goals").delete().eq("id", goal.id));
      await reloadStore();
      router.replace("/goals");
    } catch (e) {
      toast({ msg: e instanceof Error ? e.message : "Couldn't delete" });
    }
  };

  if (editing) {
    return (
      <div className="space-y-4 pt-2">
        <button onClick={() => setEditing(false)} className="text-sm text-muted">‹ Back</button>
        <h1 className="text-2xl font-bold">Edit goal</h1>
        <GoalForm
          submitLabel="Save"
          initial={{
            name: goal.name,
            icon: goal.icon ?? "🎯",
            target: String(goal.target ?? ""),
            saved: String(goal.opening_balance || ""),
            target_date: goal.target_date ?? "",
            priority: (goal.priority as 1 | 2 | 3) ?? 2,
          }}
          onSubmit={(g) =>
            run(async () => {
              ok(
                await sb
                  .from("goals")
                  .update({
                    name: g.name.trim(),
                    icon: g.icon,
                    target: Number(g.target),
                    opening_balance: Number(g.saved || 0),
                    target_date: g.target_date || null,
                    priority: g.priority,
                  })
                  .eq("id", goal.id),
              );
              setEditing(false);
            }, "Goal updated")
          }
        />
        <button onClick={remove} className="h-12 w-full rounded-xl text-sm font-medium text-bad">
          Delete goal
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/goals" className="text-sm text-muted">‹ Goals</Link>
          <h1 className="text-2xl font-bold">
            {goal.icon} {goal.name}
          </h1>
          <p className="text-sm text-muted">
            {PRIORITY[goal.priority as 1 | 2 | 3] ?? "Medium"} priority{committed > 0 ? ` · ${inr(committed)}/month in your plan` : ""}
          </p>
        </div>
        <button onClick={() => setEditing(true)} className="h-11 rounded-xl px-3 text-sm text-muted">
          Edit
        </button>
      </div>

      <section className="rounded-3xl bg-gradient-to-br from-navy to-navy-2 p-5 text-white shadow-lg">
        <p className="text-sm text-white/70">{fundedNow ? "You can afford it" : "You can buy it by"}</p>
        <p className="mt-1 text-4xl font-bold tracking-tight text-mint">
          {fundedNow ? "Now 🎉" : res.readyBy ? ymLabel(res.readyBy) : "Not in sight"}
        </p>
        {!fundedNow && res.months != null && <p className="text-sm text-white/70">{res.months} salary {res.months === 1 ? "day" : "days"} from now</p>}
        {!res.readyBy && <p className="mt-1 text-sm text-white/70">Your current plan leaves no free money for it. Use a lever below.</p>}

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-mint" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-sm text-white/75">
          <span>Saved {inr(goal.balance)}</span>
          <span>of {inr(target)}</span>
        </div>

        {targetYm && (
          <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${onTrack ? "bg-mint/20 text-mint" : "bg-[#ff7a7e]/20 text-[#ffb3b5]"}`}>
            {onTrack
              ? `On track for ${ymLabel(targetYm)} ✓`
              : res.needPerMonth === Infinity
                ? `${ymLabel(targetYm)} has already passed: pick a new date`
                : `To have it by ${ymLabel(targetYm)} you need ${inr(Math.ceil(res.needPerMonth ?? 0))}/month`}
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Your free money</h2>
        <p className="text-xs text-muted">
          Salary {inr(inputs.salary)}
          {inputs.extraMonthly > 0 ? ` + ${inr(inputs.extraMonthly)} extra income` : ""} − daily spending − plan. Goals get it in priority order.
        </p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {timeline.map((t, i) => (
            <li key={t.ym} className="flex justify-between">
              <span className="text-muted">{i === 0 ? "Now" : `From ${ymLabel(t.ym)}`}</span>
              <span className={`font-medium tabular-nums ${t.free < 0 ? "text-bad" : ""}`}>
                {inr(t.free)}/mo{inputs.loanFreeFrom === t.ym ? " · loan closed" : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Speed it up</h2>
        <p className="text-xs text-muted">Set aside a fixed amount each month for this goal.</p>
        <p className="mt-2 text-3xl font-bold tabular-nums">{inr(x)}<span className="text-base font-medium text-muted">/month</span></p>
        <input
          type="range"
          min={0}
          max={20000}
          step={500}
          value={x}
          onChange={(e) => setExtra(Number(e.target.value))}
          aria-label="Monthly amount for this goal"
          className="h-11 w-full accent-[var(--good)]"
        />
        <label className="block text-xs text-muted">
          Take it from
          <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-2 text-base text-ink">
            <option value="free">Free money ({inr(Math.round(freeNow))}/mo now)</option>
            {sources.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({inr(l.planned)}/mo)
              </option>
            ))}
            <option value="daily">Daily budget (₹{Math.round(inputs.dailyBudget)} → ₹{Math.max(0, Math.round(inputs.dailyBudget - x / DAYS_PER_MONTH))}/day)</option>
          </select>
        </label>
        <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-sm">
          {lever.readyBy ? (
            <>
              Ready by <b>{ymLabel(lever.readyBy)}</b>
              {sooner != null && sooner > 0 ? <span className="text-good"> · {sooner} months sooner</span> : sooner === 0 ? <span className="text-muted"> · same as now</span> : null}
              {res.readyBy == null && <span className="text-good"> · now reachable</span>}
            </>
          ) : (
            "Still out of reach at this amount"
          )}
        </p>
        {source === "free" && x > freeNow && (
          <p className="mt-2 text-xs text-warn">That&apos;s more than your free money now: your Salary Day checklist will show you as over budget.</p>
        )}
        <button disabled={x <= 0} onClick={applyLever} className="mt-3 h-12 w-full rounded-xl bg-navy text-sm font-semibold text-white disabled:opacity-40">
          Add {inr(x)}/month to my plan
        </button>
        <p className="mt-2 text-xs text-muted">It shows up on your Salary Day checklist, and ticking it moves the money into this goal.</p>
      </section>

      {remaining > 0 && (
        <section className="rounded-2xl bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Or buy it now on EMI?</h2>
          <div className="mt-2 flex items-center gap-2">
            {[6, 12, 18, 24].map((m) => (
              <button
                key={m}
                onClick={() => setTenure(m)}
                aria-pressed={tenure === m}
                className={`h-11 flex-1 rounded-xl text-sm font-medium ${tenure === m ? "bg-navy text-white" : "bg-bg text-muted"}`}
              >
                {m} mo
              </button>
            ))}
            <label className="flex h-11 w-20 items-center rounded-xl border border-line bg-bg px-2 text-sm">
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
                aria-label="Interest rate per year"
                className="w-full bg-transparent text-base outline-none"
              />
              %
            </label>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">EMI</dt>
              <dd className="font-semibold tabular-nums">{inr(Math.round(emi.emi))}/mo</dd>
            </div>
            <div>
              <dt className="text-muted">Extra interest</dt>
              <dd className="font-semibold tabular-nums text-bad">{inr(Math.round(emi.interest))}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted">
            {emi.emi <= freeNow
              ? "This EMI fits in your free money, but saving up costs ₹0 in interest."
              : `This EMI is ${inr(Math.round(emi.emi - Math.max(0, freeNow)))}/month more than your free money: it would squeeze your budget.`}
          </p>
        </section>
      )}

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">Add money now</h2>
        <div className="flex gap-2">
          <input
            inputMode="decimal"
            value={addAmt}
            onChange={(e) => setAddAmt(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="Amount ₹"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-mint"
          />
          <button onClick={deposit} className="h-11 rounded-xl bg-navy px-4 text-sm font-semibold text-white">
            Add
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Got extra income? <Link href="/more/income" className="font-medium text-ink underline">Log it and split it across goals</Link>.
        </p>
      </section>

    </div>
  );
}
