"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { addDays, dailyOnly, diffDays, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { CardsSection, ThisMonth } from "@/components/money-overview";
import { SavingsCoach } from "@/components/coach";
import { DailyBalance } from "@/components/daily-balance";

/** Insights, top to bottom: this month's money, savings, everyday spending, cards. Month by month is on History. */
export default function InsightsPage() {
  const { ready, summary, spends, categories, cycle, today } = useStore();
  const [mode, setMode] = useState<"week" | "cycle">("cycle");

  const range = summary ? (mode === "week" ? summary.week : summary.cycle) : null;
  const daily = Number(cycle?.daily_budget ?? 500);

  // Everyday (daily) spends only: planned/unplanned are paid from funds and shown under "This month".
  const inRange = useMemo(() => (range ? dailyOnly(spends.filter((s) => s.spent_on >= range.start && s.spent_on <= range.end)) : []), [spends, range]);

  const days = useMemo(() => {
    if (!range) return [];
    const n = diffDays(range.start, range.end) + 1;
    return Array.from({ length: n }, (_, i) => {
      const date = addDays(range.start, i);
      const amount = inRange.reduce((t, s) => (s.spent_on === date ? t + s.amount : t), 0);
      const dt = parseYmd(date);
      return { date, label: mode === "week" ? dt.toLocaleDateString("en-IN", { weekday: "short" }) : String(dt.getDate()), amount };
    });
  }, [range, inRange, mode]);

  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    inRange.forEach((s) => m.set(s.category_id ?? "none", (m.get(s.category_id ?? "none") ?? 0) + s.amount));
    return [...m.entries()]
      .map(([id, value]) => ({ id, value, name: categories.find((c) => c.id === id)?.name ?? "Other", icon: categories.find((c) => c.id === id)?.icon ?? "•" }))
      .sort((a, b) => b.value - a.value);
  }, [inRange, categories]);

  if (!ready || !summary || !range) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;

  const total = inRange.reduce((t, s) => t + s.amount, 0);
  const top = Math.max(1, ...byCat.map((c) => c.value));

  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-bold">Insights</h1>

      <ThisMonth />

      <h2 className="pt-2 text-lg font-semibold">Savings</h2>
      <SavingsCoach />

      <h2 className="pt-2 text-lg font-semibold">Everyday spending</h2>
      <div role="tablist" className="grid grid-cols-2 rounded-full bg-surface p-1">
        {(["cycle", "week"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`h-10 rounded-full text-sm font-semibold transition ${mode === m ? "bg-white text-ink shadow-[0_2px_10px_-2px_rgba(20,38,79,.2)]" : "text-muted"}`}
          >
            {m === "week" ? "This week" : "This month"}
          </button>
        ))}
      </div>

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-muted">Spent</p>
          <p className="text-xs text-muted">
            {parseYmd(range.start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} –{" "}
            {parseYmd(range.end).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </p>
        </div>
        <p className="text-3xl font-bold tabular-nums">{inr(total)}</p>
        <p className={`text-sm ${total > range.budget ? "text-bad" : "text-good"}`}>
          {total > range.budget ? `${inr(total - range.budget)} over` : `${inr(range.budget - total)} under`} the {inr(range.budget)} budget ({inr(daily)}/day)
        </p>
        <div className="mt-3 h-44" role="img" aria-label="Daily spend against the daily budget">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval={mode === "cycle" ? 4 : 0} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis hide domain={[0, (max: number) => Math.max(max, daily * 1.3)]} />
              <Tooltip
                cursor={{ fill: "var(--line)", opacity: 0.5 }}
                formatter={(v) => [inr(Number(v)), "Spent"]}
                labelFormatter={(_, p) => p?.[0]?.payload?.date ?? ""}
                contentStyle={{ background: "rgba(255,255,255,.92)", border: "1px solid rgba(255,255,255,.9)", borderRadius: 14, color: "var(--ink)", boxShadow: "0 10px 30px -12px rgba(20,38,79,.3)", backdropFilter: "blur(20px)" }}
              />
              <ReferenceLine y={daily} stroke="var(--warn)" strokeDasharray="4 4" label={{ value: inr(daily), position: "insideTopRight", fontSize: 10, fill: "var(--warn)" }} />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                {days.map((d) => (
                  <Cell key={d.date} fill={d.amount > daily ? "var(--bad)" : "var(--good)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <DailyBalance days={days} daily={daily} today={today} periodLabel={mode === "week" ? "this week" : "this month"} />

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">By category</h2>
        {byCat.length === 0 ? (
          <p className="text-sm text-muted">No spends in this period yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {byCat.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="flex items-baseline gap-3">
                  <span className="flex-1 truncate">
                    {c.icon} {c.name}
                  </span>
                  <span className="tabular-nums text-muted">{total ? Math.round((c.value / total) * 100) : 0}%</span>
                  <span className="w-20 text-right font-medium tabular-nums">{inr(c.value)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-navy/70" style={{ width: `${Math.max(0, (c.value / top) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CardsSection />
    </div>
  );
}
