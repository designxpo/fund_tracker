"use client";

import { Bar, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr } from "@/lib/money";
import { parseYmd } from "@/lib/budget";

type Day = { date: string; label: string; amount: number };
type Row = Day & { diff: number; balance: number };

/**
 * Do the light days make up for the heavy ones? Each day's budget left (+) or overspent (−),
 * with the running balance across the period as a line.
 */
export function DailyBalance({ days, daily, today, periodLabel }: { days: Day[]; daily: number; today: string; periodLabel: string }) {
  const rows = days
    .filter((d) => d.date <= today)
    .reduce<Row[]>((out, d) => [...out, { ...d, diff: daily - d.amount, balance: (out.at(-1)?.balance ?? 0) + daily - d.amount }], []);
  if (!rows.length) return null;

  const over = rows.filter((r) => r.diff < 0);
  const under = rows.filter((r) => r.diff > 0);
  const overBy = -over.reduce((t, r) => t + r.diff, 0);
  const underBy = under.reduce((t, r) => t + r.diff, 0);
  const net = underBy - overBy;
  const left = days.filter((d) => d.date > today).length;
  const perDay = left > 0 ? daily + net / left : null;

  return (
    <section aria-label="Daily balance" className="rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Balancing your days</h2>
        <p className="text-xs text-muted">{periodLabel} so far</p>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-bad/[.07] p-2.5">
          <p className="text-xs text-muted">▲ {over.length} heavy {over.length === 1 ? "day" : "days"}</p>
          <p className="font-semibold tabular-nums text-bad">{inr(overBy)} over</p>
        </div>
        <div className="rounded-xl bg-good/10 p-2.5">
          <p className="text-xs text-muted">▼ {under.length} light {under.length === 1 ? "day" : "days"}</p>
          <p className="font-semibold tabular-nums text-good">{inr(underBy)} saved</p>
        </div>
      </div>
      <p className={`mt-2 text-sm font-medium ${net >= 0 ? "text-good" : "text-bad"}`}>
        {net >= 0
          ? `Balanced ✓ Your light days cover the heavy ones, with ${inr(net)} to spare.`
          : `Not balanced yet: the heavy days are ${inr(-net)} ahead of the light ones.`}
      </p>
      {perDay != null && (
        <p className="text-xs text-muted">
          {net >= 0
            ? `You could spend up to ${inr(Math.round(perDay))}/day for the last ${left} days and still finish on budget, or invest the spare.`
            : perDay > 0
              ? `Keep to ${inr(Math.round(perDay))}/day for the last ${left} days to balance out.`
              : `Even spending nothing for the last ${left} days won't balance it: cover the rest on Salary Day.`}
        </p>
      )}

      <div className="mt-3 h-44" role="img" aria-label="Budget left or overspent each day, with the running balance">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 11, fill: "var(--muted)" }} />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--muted)" }}
              tickFormatter={(v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1)}k` : Math.abs(v)}`}
            />
            <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.5} />
            <Tooltip cursor={{ fill: "var(--line)", opacity: 0.5 }} content={<BalanceTip daily={daily} />} />
            <Bar dataKey="diff" radius={[3, 3, 3, 3]}>
              {rows.map((r) => (
                <Cell key={r.date} fill={r.diff < 0 ? "var(--bad)" : "var(--good)"} fillOpacity={0.75} />
              ))}
            </Bar>
            <Line dataKey="balance" type="monotone" stroke="var(--ink)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-good" /> Under budget that day
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-bad" /> Over budget that day
        </li>
        <li className="flex items-center gap-1.5">
          <span className="w-3 border-t-2 border-ink" /> Running balance
        </li>
      </ul>
    </section>
  );
}

function BalanceTip({ active, payload, daily }: { active?: boolean; payload?: { payload: Row }[]; daily: number }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  return (
    <div className="rounded-2xl border border-white/90 bg-white/95 p-3 text-xs shadow-[0_10px_30px_-12px_rgba(20,38,79,.3)]">
      <p className="font-semibold">{parseYmd(r.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</p>
      <p>
        Spent {inr(r.amount)} of {inr(daily)} ·{" "}
        <span className={r.diff < 0 ? "text-bad" : "text-good"}>{r.diff < 0 ? `${inr(-r.diff)} over` : `${inr(r.diff)} under`}</span>
      </p>
      <p className="text-muted">
        Running balance: <span className={r.balance < 0 ? "text-bad" : "text-good"}>{r.balance < 0 ? `−${inr(-r.balance)}` : `+${inr(r.balance)}`}</span>
      </p>
    </div>
  );
}
