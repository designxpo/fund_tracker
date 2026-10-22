"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { ok, useData } from "@/lib/use-data";
import { diffDays, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { BUCKET_LABELS, bucketOf, planVsActual, salaryUtilisation, type UtilRow } from "@/lib/month";
import { isDaily, type Spend } from "@/lib/types";

/** One colour per bucket, the same on every chart (validated categorical order: blue, orange, aqua, yellow, magenta). */
export const BUCKET_COLORS: Record<UtilRow["key"] | "planned" | "unplanned", string> = {
  emis: "#2a78d6",
  fixed: "#eb6834",
  saved: "#1baf7a",
  setAside: "#eda100",
  daily: "#e87ba4",
  dailyLeft: "#f6cddc",
  planned: "#6250d6",
  unplanned: "#e34948",
};

const shortDate = (d: string) => parseYmd(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const pctOf = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/** This cycle's salary split and plan-vs-actual, from the store. */
function useCycleMoney() {
  const { cycle, summary, planItems, settlements, goals, today } = useStore();
  if (!cycle || !summary) return null;
  const salary = Number(cycle.salary);
  const daily = Number(cycle.daily_budget);
  const days = diffDays(summary.cycle.start, summary.cycle.end) + 1;
  const elapsed = Math.min(days, Math.max(0, diffDays(summary.cycle.start, today) + 1));
  const util = salaryUtilisation(salary, daily * days, summary.cycle.spent, planItems, settlements, goals);
  const variance = planVsActual(planItems, settlements, goals, { budgetToDate: daily * elapsed, spent: summary.cycle.spent });
  return { salary, util, variance, days, elapsed, start: summary.cycle.start, end: summary.cycle.end, available: util.rows.find((r) => r.key === "dailyLeft")!.amount + Math.max(0, util.left) };
}

/** Salary as one bar: each bucket's share, a 2px gap between parts, unallocated money as the track. */
function SplitBar({ rows, salary, used, className = "h-4" }: { rows: UtilRow[]; salary: number; used: number; className?: string }) {
  const scale = Math.max(salary, used);
  return (
    <div className={`flex gap-[2px] overflow-hidden rounded-full bg-line ${className}`} role="img" aria-label="How the salary is split">
      {rows
        .filter((r) => r.amount > 0)
        .map((r) => (
          <div key={r.key} title={`${r.label}: ${inr(r.amount)}`} style={{ width: `${(r.amount / scale) * 100}%`, background: BUCKET_COLORS[r.key] }} />
        ))}
    </div>
  );
}

/** Home: salary at a glance, linking to the full picture on Insights. */
export function SalarySnapshot() {
  const m = useCycleMoney();
  if (!m || m.salary <= 0) return null;
  const { util } = m;
  return (
    <Link href="/insights" className="block rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Salary {inr(m.salary)}</h2>
        <span className="text-xs text-muted">Where it went ›</span>
      </div>
      <SplitBar rows={util.rows} salary={m.salary} used={util.used} className="mt-3 h-3" />
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Spent</dt>
          <dd className="font-semibold tabular-nums">{inr(util.spent)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Saved & set aside</dt>
          <dd className="font-semibold tabular-nums text-good">{inr(util.saved + util.setAside)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{util.left < 0 ? "Over salary" : "Available"}</dt>
          <dd className={`font-semibold tabular-nums ${util.left < 0 ? "text-bad" : ""}`}>{inr(util.left < 0 ? -util.left : m.available)}</dd>
        </div>
      </dl>
    </Link>
  );
}

/** Insights hero: salary in, and every part of it: spent, saved, set aside, still available. */
export function SalarySplit() {
  const { cycle } = useStore();
  const m = useCycleMoney();
  const { data: extra } = useData(
    "cycle-income",
    async () => {
      if (!m) return 0;
      const rows = ok(await createClient().from("income").select("amount").gte("received_on", m.start).lte("received_on", m.end)) as { amount: number }[];
      return rows.reduce((t, r) => t + Number(r.amount), 0);
    },
    cycle?.id,
  );
  if (!m) return null;
  const { util, salary } = m;
  const tiles = [
    { label: "Spent", value: util.spent, note: "EMIs, fixed costs, daily", tone: "" },
    { label: "Saved & invested", value: util.saved, note: `${pctOf(util.saved, salary)}% of salary`, tone: "text-good" },
    { label: "Set aside", value: util.setAside, note: "Sinking funds & buffer", tone: "" },
    util.left < 0
      ? { label: "Over salary", value: -util.left, note: "Plan is more than salary", tone: "text-bad" }
      : { label: "Still available", value: m.available, note: "Daily budget left + unallocated", tone: "" },
  ];

  return (
    <section aria-label="Where your salary went" className="glass-hero rounded-3xl p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">Salary this cycle</p>
        <p className="text-xs text-muted">
          {shortDate(m.start)} – {shortDate(m.end)} · day {m.elapsed}/{m.days}
        </p>
      </div>
      <p className="text-3xl font-bold tabular-nums">{inr(salary)}</p>
      {!!extra && <p className="text-xs text-muted">+ {inr(extra)} extra income, already split into goals when you logged it</p>}

      <dl className="mt-3 grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-bg p-2.5">
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${t.tone}`}>{inr(t.value)}</dd>
            <dd className="text-[11px] text-muted">{t.note}</dd>
          </div>
        ))}
      </dl>

      <SplitBar rows={util.rows} salary={salary} used={util.used} className="mt-4 h-4" />
      <ul className="mt-3 space-y-1.5 text-sm">
        {util.rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: BUCKET_COLORS[r.key] }} />
            <span className="flex-1">{r.label}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted">{pctOf(r.amount, salary)}%</span>
            <span className="w-24 text-right font-medium tabular-nums">{inr(r.amount)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-line pt-1.5 font-semibold">
          <span className="h-3 w-3 shrink-0 rounded-full bg-line" />
          <span className="flex-1">{util.left >= 0 ? "Not allocated yet" : "Over salary"}</span>
          <span className="w-10 text-right text-xs tabular-nums text-muted">{pctOf(Math.abs(util.left), salary)}%</span>
          <span className={`w-24 text-right tabular-nums ${util.left >= 0 ? "text-good" : "text-bad"}`}>{inr(util.left)}</span>
        </li>
      </ul>
      <p className="mt-2 text-xs text-muted">Plan lines use the amounts entered on Salary Day (or the plan, until you enter one).</p>
    </section>
  );
}

/** Over/under per bucket: bar = actual, tick = plan, with the difference in words. */
export function PlanVsActual() {
  const m = useCycleMoney();
  if (!m || !m.variance.length) return null;
  const spending = m.variance.filter((r) => !r.moreIsBetter);
  const over = spending.reduce((t, r) => t + Math.max(0, r.actual - r.plan), 0);
  const under = spending.reduce((t, r) => t + Math.max(0, r.plan - r.actual), 0);

  return (
    <section aria-label="Plan vs actual" className="rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Plan vs actual</h2>
        <p className="text-xs text-muted">this cycle so far</p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-bad/[.07] p-2.5">
          <p className="text-xs text-muted">▲ Overspent</p>
          <p className={`font-semibold tabular-nums ${over > 0 ? "text-bad" : ""}`}>{inr(over)}</p>
        </div>
        <div className="rounded-xl bg-good/10 p-2.5">
          <p className="text-xs text-muted">▼ Underspent</p>
          <p className={`font-semibold tabular-nums ${under > 0 ? "text-good" : ""}`}>{inr(under)}</p>
        </div>
      </div>

      <ul className="mt-3 space-y-3.5">
        {m.variance.map((r) => {
          const diff = r.actual - r.plan;
          const scale = Math.max(r.plan, r.actual, 1);
          const good = r.moreIsBetter ? diff >= 0 : diff <= 0;
          const status =
            Math.abs(diff) < 0.5
              ? "On plan ✓"
              : r.moreIsBetter
                ? diff > 0
                  ? `▲ ${inr(diff)} more than planned`
                  : `▼ ${inr(-diff)} less than planned`
                : diff > 0
                  ? `▲ ${inr(diff)} over plan`
                  : `▼ ${inr(-diff)} under plan`;
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 tabular-nums">
                  <b>{inr(r.actual)}</b>
                  <span className="text-muted"> / {inr(r.plan)}</span>
                </span>
              </div>
              <div className="relative mt-1.5 h-2.5 rounded-full bg-line" role="img" aria-label={`${r.label}: ${inr(r.actual)} of ${inr(r.plan)} planned`}>
                <div className="h-full rounded-full" style={{ width: `${(r.actual / scale) * 100}%`, background: BUCKET_COLORS[r.key] }} />
                <div className="absolute -top-1 bottom-[-4px] w-[2px] rounded bg-ink" style={{ left: `calc(${(r.plan / scale) * 100}% - 1px)` }} />
              </div>
              <p className={`mt-1 text-xs ${Math.abs(diff) < 0.5 ? "text-muted" : good ? "text-good" : "text-bad"}`}>
                {status}
                {r.key === "daily" && <span className="text-muted"> · budget up to today (day {m.elapsed} of {m.days})</span>}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted">The dark tick is the plan. Saving more than planned is good; spending more is not.</p>
    </section>
  );
}

type Group = { key: keyof typeof BUCKET_COLORS; label: string; total: number; lines: { id: string; label: string; amount: number; spends?: Spend[]; note?: string }[] };

/** Every rupee that left this cycle: plan lines, daily spends by category, and fund-paid spends. */
export function EveryRupee() {
  const { summary, spends, planItems, settlements, goals, categories, cards } = useStore();
  if (!summary) return null;
  const inCycle = spends.filter((s) => s.spent_on >= summary.cycle.start && s.spent_on <= summary.cycle.end);
  const cat = (id: string | null) => categories.find((c) => c.id === id);

  const byCategory = (list: Spend[]) =>
    [...new Set(list.map((s) => s.category_id ?? "none"))]
      .map((id) => {
        const items = list.filter((s) => (s.category_id ?? "none") === id);
        const c = cat(id === "none" ? null : id);
        return { id, label: `${c?.icon ?? "•"} ${c?.name ?? "Uncategorised"}`, amount: items.reduce((t, s) => t + Number(s.amount), 0), spends: items };
      })
      .sort((a, b) => b.amount - a.amount);

  const planLines = (b: "emis" | "fixed") => [
    ...planItems
      .filter((i) => bucketOf(i, goals) === b)
      .map((i) => ({ id: i.id, label: i.name, amount: Number(i.actual ?? i.planned), note: i.done ? undefined : "not marked paid yet" })),
    ...(b === "emis" ? settlements.filter((s) => (s.kind === "leftover" || s.kind === "borrow") && !s.goal_id) : []).map((s) => ({
      id: s.id,
      label: s.note ?? "Loan prepayment",
      amount: Number(s.amount),
    })),
  ];
  const nonDaily = (t: "planned" | "unplanned") => inCycle.filter((s) => !isDaily(s) && s.spend_type === t);
  const planned = nonDaily("planned");

  const groups: Group[] = [
    { key: "emis" as const, label: BUCKET_LABELS.emis, lines: planLines("emis") },
    { key: "fixed" as const, label: BUCKET_LABELS.fixed, lines: planLines("fixed") },
    { key: "daily" as const, label: BUCKET_LABELS.daily, lines: byCategory(inCycle.filter(isDaily)) },
    {
      key: "planned" as const,
      label: "Planned (paid from sinking funds)",
      lines: [...new Set(planned.map((s) => s.goal_id ?? "none"))].map((gid) => {
        const items = planned.filter((s) => (s.goal_id ?? "none") === gid);
        return { id: gid, label: goals.find((g) => g.id === gid)?.name ?? "Fund", amount: items.reduce((t, s) => t + Number(s.amount), 0), spends: items };
      }),
    },
    { key: "unplanned" as const, label: "Unplanned (paid from Surprise buffer)", lines: byCategory(nonDaily("unplanned")) },
  ]
    .map((g) => ({ ...g, total: g.lines.reduce((t, l) => t + l.amount, 0) }))
    .filter((g) => g.total !== 0);
  const total = groups.reduce((t, g) => t + g.total, 0);

  return (
    <section aria-label="Every rupee spent this cycle" className="rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Every rupee spent</h2>
        <p className="text-xs text-muted">this cycle</p>
      </div>
      <p className="text-2xl font-bold tabular-nums">{inr(total)}</p>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing spent yet this cycle.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {groups.map((g) => (
            <li key={g.key}>
              <details className="group py-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: BUCKET_COLORS[g.key] }} />
                  <span className="flex-1 font-medium">{g.label}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted">{pctOf(g.total, total)}%</span>
                  <span className="w-24 text-right font-semibold tabular-nums">{inr(g.total)}</span>
                  <span aria-hidden className="text-muted transition group-open:rotate-90">›</span>
                </summary>
                <div className="ml-5 mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full" style={{ width: `${pctOf(g.total, total)}%`, background: BUCKET_COLORS[g.key] }} />
                </div>
                <ul className="ml-5 mt-2 space-y-1 text-sm">
                  {g.lines.map((l) =>
                    l.spends ? (
                      <li key={l.id}>
                        <details className="group/line">
                          <summary className="flex cursor-pointer list-none justify-between gap-2">
                            <span className="truncate">
                              {l.label} <span className="text-xs text-muted">· {l.spends.length}</span>
                            </span>
                            <span className="tabular-nums">{inr(l.amount)}</span>
                          </summary>
                          <ul className="mb-1 mt-1 space-y-0.5 border-l border-line pl-3 text-xs text-muted">
                            {l.spends.map((s) => (
                              <li key={s.id} className="flex justify-between gap-2">
                                <span className="truncate">
                                  {shortDate(s.spent_on)}
                                  {[cards.find((c) => c.id === s.card_id)?.nickname, s.note].filter(Boolean).map((x) => ` · ${x}`)}
                                </span>
                                <span className="tabular-nums">{inr(Number(s.amount))}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ) : (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span className="truncate">
                          {l.label}
                          {l.note && <span className="text-xs text-warn"> · {l.note}</span>}
                        </span>
                        <span className="tabular-nums">{inr(l.amount)}</span>
                      </li>
                    ),
                  )}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">
        Planned and unplanned spends come out of money you set aside earlier (sinking funds and the buffer), so they aren&apos;t a new cut of this salary. Tap a
        row to see each spend.
      </p>
    </section>
  );
}

/** How it was paid: card bill settled on Salary Day, then this cycle's spends by card / payment mode. */
export function PaidBy() {
  const { summary, spends, cards, settlements } = useStore();
  if (!summary) return null;
  const bill = settlements.find((s) => s.kind === "card_bills");
  const inCycle = spends.filter((s) => s.spent_on >= summary.cycle.start && s.spent_on <= summary.cycle.end);
  const modes = [...cards.map((c) => ({ id: c.id as string | null, name: c.nickname, credit: c.monthly_cap > 0 })), { id: null, name: "No card picked", credit: false }]
    .map((m) => {
      const list = inCycle.filter((s) => (s.card_id ?? null) === m.id);
      const by = (t: string) => list.filter((s) => (s.spend_type ?? "daily") === t).reduce((a, s) => a + Number(s.amount), 0);
      return { ...m, total: list.reduce((a, s) => a + Number(s.amount), 0), daily: by("daily"), planned: by("planned"), unplanned: by("unplanned") };
    })
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);
  const totalSpent = modes.reduce((a, m) => a + m.total, 0);
  const onCards = modes.filter((m) => m.credit).reduce((a, m) => a + m.total, 0);
  if (!bill && totalSpent === 0) return null;

  return (
    <section aria-label="How you paid" className="rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Card bills & payment modes</h2>
        <p className="text-xs text-muted">this cycle · {inr(totalSpent)}</p>
      </div>
      {bill && (
        <div className="mt-2 rounded-xl bg-bg p-3 text-sm">
          <div className="flex justify-between">
            <span className="font-medium">Card bill paid on Salary Day</span>
            <span className="font-semibold tabular-nums">{inr(Number(bill.amount))}</span>
          </div>
          <p className={`text-xs ${bill.done ? "text-good" : "text-warn"}`}>{bill.done ? "✓ Paid in full" : "Not marked paid yet (Salary → step 1)"}</p>
          <p className="mt-0.5 text-xs text-muted">Covers last cycle&apos;s card spends, which were counted in last cycle, so it isn&apos;t added again here.</p>
        </div>
      )}
      {onCards > 0 && <p className="mt-2 text-xs text-muted">{inr(onCards)} on credit cards this cycle will be on next Salary Day&apos;s bill.</p>}
      <ul className="mt-1 divide-y divide-line text-sm">
        {modes.map((m) => (
          <li key={m.name} className="py-2">
            <div className="flex justify-between">
              <span className="font-medium">{m.name}</span>
              <span className="font-semibold tabular-nums">{inr(m.total)}</span>
            </div>
            <p className="text-xs text-muted">
              Daily {inr(m.daily)}
              {m.planned > 0 ? ` · Planned ${inr(m.planned)}` : ""}
              {m.unplanned > 0 ? ` · Unplanned ${inr(m.unplanned)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
