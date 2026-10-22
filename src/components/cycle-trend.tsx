"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { ok, useData } from "@/lib/use-data";
import { parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { BUCKET_LABELS, salaryUtilisation, type MonthItem, type MonthSettlement } from "@/lib/month";
import { BUCKET_COLORS } from "@/components/money-overview";

const SERIES = ["emis", "fixed", "saved", "setAside", "daily"] as const;
const LABELS = { ...BUCKET_LABELS, setAside: "Set aside" };

type Past = { id: string; starts_on: string; salary: number; items: MonthItem[]; settlements: MonthSettlement[]; dailySpent: number };
type Row = Record<(typeof SERIES)[number], number> & { label: string; salary: number; left: number; current: boolean };

/** Last few closed cycles: salary, plan lines, moves and daily spending. */
async function fetchHistory(): Promise<Past[]> {
  const sb = createClient();
  const cycles = ok(
    await sb.from("cycles").select("id, starts_on, ends_on, salary").not("ends_on", "is", null).order("starts_on", { ascending: false }).limit(5),
  ) as { id: string; starts_on: string; ends_on: string; salary: number }[];
  if (!cycles.length) return [];
  const ids = cycles.map((c) => c.id);
  const [items, sets, ...daily] = await Promise.all([
    sb.from("plan_items").select("cycle_id, name, kind, goal_id, planned, actual").in("cycle_id", ids).then(ok),
    sb.from("cycle_settlements").select("cycle_id, kind, goal_id, amount").in("cycle_id", ids).then(ok),
    ...cycles.map((c) =>
      sb.from("spends").select("amount").eq("spend_type", "daily").gte("spent_on", c.starts_on).lte("spent_on", c.ends_on).limit(5000).then(ok),
    ),
  ]);
  type R = { cycle_id: string; kind: string; goal_id: string | null; name: string; planned: unknown; actual: unknown; amount: unknown };
  return cycles
    .map((c, i) => ({
      id: c.id,
      starts_on: c.starts_on,
      salary: Number(c.salary),
      items: (items as R[])
        .filter((r) => r.cycle_id === c.id)
        .map((r): MonthItem => ({ ...r, planned: Number(r.planned), actual: r.actual == null ? null : Number(r.actual) })),
      settlements: (sets as R[]).filter((r) => r.cycle_id === c.id).map((r): MonthSettlement => ({ ...r, amount: Number(r.amount) })),
      dailySpent: (daily[i] as { amount: unknown }[]).reduce((t: number, s) => t + Number(s.amount), 0),
    }))
    .reverse();
}

/** Month by month: where each salary went, stacked, with the salary as a dashed line. */
export function CycleTrend() {
  const { cycle, summary, planItems, settlements, goals } = useStore();
  const { data: history, loading, error } = useData("money-history", fetchHistory, cycle?.id);
  if (!cycle || !summary) return null;

  const toRow = (p: Omit<Past, "id">, current: boolean): Row => {
    const u = salaryUtilisation(p.salary, 0, p.dailySpent, p.items, p.settlements, goals);
    const amount = (k: (typeof SERIES)[number]) => Math.max(0, u.rows.find((r) => r.key === k)!.amount);
    const month = parseYmd(p.starts_on).toLocaleDateString("en-IN", { month: "short" });
    return {
      label: current ? `${month} (now)` : month,
      salary: p.salary,
      left: u.left,
      current,
      emis: amount("emis"),
      fixed: amount("fixed"),
      saved: amount("saved"),
      setAside: amount("setAside"),
      daily: amount("daily"),
    };
  };
  const rows: Row[] = [
    ...(history ?? []).map((p) => toRow(p, false)),
    toRow({ starts_on: cycle.starts_on, salary: Number(cycle.salary), items: planItems, settlements, dailySpent: summary.cycle.spent }, true),
  ];

  return (
    <section aria-label="Month by month" className="rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Month by month</h2>
        <p className="text-xs text-muted">salary cycles</p>
      </div>
      {loading && !history ? (
        <div className="mt-3 h-52 animate-pulse rounded-xl bg-line" />
      ) : (
        <>
          {rows.length < 2 && <p className="mt-1 text-xs text-muted">Past months appear here after your next Salary Day.</p>}
          <div className="mt-3 h-52" role="img" aria-label="Where each month's salary went, with the salary as a dashed line">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <YAxis
                  width={38}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  tickFormatter={(v: number) => (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)}
                />
                <Tooltip cursor={{ fill: "var(--line)", opacity: 0.5 }} content={<TrendTip />} />
                {SERIES.map((k) => (
                  <Bar key={k} dataKey={k} name={LABELS[k]} stackId="s" fill={BUCKET_COLORS[k]} stroke="var(--surface-solid)" strokeWidth={1} />
                ))}
                <Line dataKey="salary" name="Salary" type="linear" stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, fill: "var(--ink)" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {SERIES.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: BUCKET_COLORS[k] }} />
                {LABELS[k]}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span className="w-3 border-t-2 border-dashed border-ink" />
              Salary
            </li>
          </ul>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted">Show as table</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full tabular-nums">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 text-left font-medium">Cycle</th>
                    <th className="text-right font-medium">Salary</th>
                    <th className="text-right font-medium">Spent</th>
                    <th className="text-right font-medium">Saved*</th>
                    <th className="text-right font-medium">Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <td className="py-1">{r.label}</td>
                      <td className="text-right">{inr(r.salary)}</td>
                      <td className="text-right">{inr(r.emis + r.fixed + r.daily)}</td>
                      <td className="text-right text-good">{inr(r.saved + r.setAside)}</td>
                      <td className={`text-right ${r.left < 0 ? "text-bad" : ""}`}>{inr(r.left)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-muted">*Saved & invested plus set aside. Current cycle is so far.</p>
            </div>
          </details>
        </>
      )}
      {error && <p className="mt-2 text-xs text-bad">Couldn&apos;t load past months: {error}</p>}
    </section>
  );
}

function TrendTip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  const saved = r.saved + r.setAside;
  return (
    <div className="rounded-2xl border border-white/90 bg-white/95 p-3 text-xs shadow-[0_10px_30px_-12px_rgba(20,38,79,.3)]">
      <p className="mb-1 font-semibold">
        {r.label} · salary {inr(r.salary)}
      </p>
      <ul className="space-y-0.5">
        {[...SERIES].reverse().map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: BUCKET_COLORS[k] }} />
            <span className="flex-1">{LABELS[k]}</span>
            <span className="tabular-nums">{inr(r[k])}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 border-t border-line pt-1">
        Saved {r.salary > 0 ? Math.round((saved / r.salary) * 100) : 0}% · {r.left < 0 ? `${inr(-r.left)} over salary` : `${inr(r.left)} left`}
      </p>
    </div>
  );
}
