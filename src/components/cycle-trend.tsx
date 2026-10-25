"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { useMoney, useMoneyHistory } from "@/lib/use-money";
import { moneyLeft, type LeftRow } from "@/lib/month";
import { LEFT_COLORS } from "@/components/money-overview";

const SERIES = ["bills", "saved", "setAside", "spent", "overspent"] as const;
const LABELS: Record<(typeof SERIES)[number], string> = {
  bills: "Bills & EMIs",
  saved: "Saved & invested",
  setAside: "Set aside",
  spent: "Spent",
  overspent: "Beyond funds",
};

type Row = Record<(typeof SERIES)[number], number> & { label: string; salary: number; left: number };

/** Month by month: how each salary was used, stacked, with the salary as a dashed line. */
export function CycleTrend() {
  const { cycle, goals } = useStore();
  const { data: history, loading, error } = useMoneyHistory(cycle?.id);
  const m = useMoney();
  if (!cycle || !m) return null;

  const toRow = (label: string, salary: number, f: { rows: LeftRow[]; left: number }): Row => {
    const amount = (k: (typeof SERIES)[number]) => Math.max(0, f.rows.find((r) => r.key === k)!.amount);
    return {
      label,
      salary,
      left: f.left,
      bills: amount("bills"),
      saved: amount("saved"),
      setAside: amount("setAside"),
      spent: amount("spent"),
      overspent: amount("overspent"),
    };
  };
  const month = (d: string) => parseYmd(d).toLocaleDateString("en-IN", { month: "short" });
  // Past months: everyday spending only (how far funds were overdrawn back then isn't kept).
  const rows: Row[] = [
    ...(history?.cycles ?? []).slice(-5).map((c) => {
      const daily = c.spends.filter((s) => (s.spend_type ?? "daily") === "daily").reduce((t, s) => t + s.amount, 0);
      return toRow(month(c.starts_on), c.salary, moneyLeft(c.salary, c.items, c.settlements, goals.map((g) => ({ ...g, available: 0 })), daily));
    }),
    toRow(`${month(cycle.starts_on)} (now)`, m.salary, m.left),
  ];
  const series = SERIES.filter((k) => k !== "overspent" || rows.some((r) => r.overspent > 0));

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
                {series.map((k) => (
                  <Bar key={k} dataKey={k} name={LABELS[k]} stackId="s" fill={LEFT_COLORS[k]} stroke="var(--surface-solid)" strokeWidth={1} />
                ))}
                {rows.length > 1 ? (
                  <Line
                    dataKey="salary"
                    name="Salary"
                    type="linear"
                    stroke="var(--ink)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 4, fill: "var(--ink)", stroke: "var(--surface-solid)", strokeWidth: 2, strokeDasharray: "none" }}
                    activeDot={{ r: 5, strokeDasharray: "none" }}
                  />
                ) : (
                  // One cycle: a dot alone means nothing, so draw the salary as a labelled line across the chart.
                  <ReferenceLine
                    y={rows[0].salary}
                    ifOverflow="extendDomain"
                    stroke="var(--ink)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    label={{ value: `Salary ${inr(rows[0].salary)}`, position: "insideTopLeft", fontSize: 11, fill: "var(--ink)" }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {series.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEFT_COLORS[k] }} />
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
                      <td className="text-right">{inr(r.bills + r.spent + r.overspent)}</td>
                      <td className="text-right text-good">{inr(r.saved + r.setAside)}</td>
                      <td className={`text-right ${r.left < 0 ? "text-bad" : ""}`}>{inr(r.left)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-muted">*Saved & invested plus set aside. Spent includes bills & EMIs. This month is so far.</p>
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
        {[...SERIES].reverse().filter((k) => k !== "overspent" || r.overspent > 0).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: LEFT_COLORS[k] }} />
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
