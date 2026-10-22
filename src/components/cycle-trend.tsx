"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { pastFlow, useMoney, useMoneyHistory } from "@/lib/use-money";
import type { FlowRow } from "@/lib/month";
import { BUCKET_COLORS } from "@/components/money-overview";

const SERIES = ["emis", "fixed", "saved", "setAside", "cardBill", "cash"] as const;
const LABELS: Record<(typeof SERIES)[number], string> = {
  emis: "EMIs & loan",
  fixed: "Fixed costs",
  saved: "Saved & invested",
  setAside: "Set aside",
  cardBill: "Card bill",
  cash: "UPI / cash",
};

type Row = Record<(typeof SERIES)[number], number> & { label: string; salary: number; left: number };

/** Month by month: what each salary paid (cash flow), stacked, with the salary as a dashed line. */
export function CycleTrend() {
  const { cycle, cards, goals } = useStore();
  const { data: history, loading, error } = useMoneyHistory(cycle?.id);
  const m = useMoney();
  if (!cycle || !m) return null;

  const credit = new Set([...cards.filter((c) => c.monthly_cap > 0).map((c) => c.id), ...(history?.creditIds ?? [])]);
  const toRow = (label: string, salary: number, f: { rows: FlowRow[]; left: number }): Row => {
    const amount = (k: (typeof SERIES)[number]) => Math.max(0, f.rows.find((r) => r.key === k)!.amount);
    return {
      label,
      salary,
      left: f.left,
      emis: amount("emis"),
      fixed: amount("fixed"),
      saved: amount("saved"),
      setAside: amount("setAside"),
      cardBill: amount("cardBill"),
      cash: amount("cash"),
    };
  };
  const month = (d: string) => parseYmd(d).toLocaleDateString("en-IN", { month: "short" });
  const past = history?.cycles ?? [];
  // The oldest fetched cycle only supplies the card bill for the one after it.
  const shown = past.length > 5 ? past.slice(1) : past;
  const rows: Row[] = [
    ...shown.map((c) => toRow(month(c.starts_on), c.salary, pastFlow(c, past[past.indexOf(c) - 1], credit, goals))),
    toRow(`${month(cycle.starts_on)} (now)`, m.salary, m.flow),
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
                      <td className="text-right">{inr(r.emis + r.fixed + r.cardBill + r.cash)}</td>
                      <td className="text-right text-good">{inr(r.saved + r.setAside)}</td>
                      <td className={`text-right ${r.left < 0 ? "text-bad" : ""}`}>{inr(r.left)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-muted">*Saved & invested plus set aside. Each salary pays the card bill of the cycle before it. Current cycle is so far.</p>
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
