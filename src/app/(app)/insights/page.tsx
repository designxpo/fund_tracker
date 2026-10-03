"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { addDays, capLevel, dailyOnly, diffDays, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";

const PALETTE = ["#4fe0ad", "#5b8def", "#f5b042", "#ff7a7e", "#a78bfa", "#38bdf8", "#fb923c", "#34d399", "#94a3b8"];
const BAR = { ok: "bg-good", amber: "bg-warn", red: "bg-bad" } as const;

export default function InsightsPage() {
  const { ready, summary, spends, cards, categories, cycle } = useStore();
  const [mode, setMode] = useState<"week" | "cycle">("week");

  const range = summary ? (mode === "week" ? summary.week : summary.cycle) : null;
  const daily = Number(cycle?.daily_budget ?? 500);

  // Charts, categories and caps use daily spends; planned/unplanned are summarised separately.
  const allInRange = useMemo(
    () => (range ? spends.filter((s) => s.spent_on >= range.start && s.spent_on <= range.end) : []),
    [spends, range],
  );
  const inRange = useMemo(() => dailyOnly(allInRange), [allInRange]);
  const outside = {
    planned: allInRange.filter((s) => s.spend_type === "planned").reduce((t, s) => t + s.amount, 0),
    unplanned: allInRange.filter((s) => s.spend_type === "unplanned").reduce((t, s) => t + s.amount, 0),
  };

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
      .map(([id, value]) => ({ id, value, name: categories.find((c) => c.id === id)?.name ?? "Uncategorised", icon: categories.find((c) => c.id === id)?.icon ?? "•" }))
      .sort((a, b) => b.value - a.value);
  }, [inRange, categories]);

  if (!ready || !summary || !range) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;

  const total = inRange.reduce((t, s) => t + s.amount, 0);
  const unspent = Math.max(0, summary.cycle.left);

  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-2xl font-bold">Insights</h1>

      <div role="tablist" className="grid grid-cols-2 rounded-full bg-surface p-1">
        {(["week", "cycle"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`h-10 rounded-full text-sm font-semibold transition ${mode === m ? "bg-white text-ink shadow-[0_2px_10px_-2px_rgba(20,38,79,.2)]" : "text-muted"}`}
          >
            {m === "week" ? "Week" : "Salary cycle"}
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
          {total > range.budget ? `${inr(total - range.budget)} over` : `${inr(range.budget - total)} under`} the {inr(range.budget)} budget
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

      {(outside.planned > 0 || outside.unplanned > 0) && (
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xs text-muted">Planned (from funds)</p>
            <p className="text-lg font-semibold tabular-nums">{inr(outside.planned)}</p>
          </div>
          <div className="rounded-2xl bg-surface p-3">
            <p className="text-xs text-muted">Unplanned (from buffer)</p>
            <p className="text-lg font-semibold tabular-nums">{inr(outside.unplanned)}</p>
          </div>
          <p className="col-span-2 -mt-1 text-xs text-muted">Not counted in the daily budget or card caps above.</p>
        </section>
      )}

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">By category (daily)</h2>
        {byCat.length === 0 ? (
          <p className="text-sm text-muted">No spends in this period yet.</p>
        ) : (
          <>
            <div className="mx-auto h-44 w-44" role="img" aria-label="Category share of spending">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byCat} dataKey="value" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
                    {byCat.map((c, i) => (
                      <Cell key={c.id} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {byCat.map((c, i) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="flex-1 truncate">
                    {c.icon} {c.name}
                  </span>
                  <span className="tabular-nums text-muted">{total ? Math.round((c.value / total) * 100) : 0}%</span>
                  <span className="w-20 text-right font-medium tabular-nums">{inr(c.value)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Cards vs caps</h2>
        <ul className="space-y-3">
          {cards.map((c) => {
            const spent = inRange.reduce((t, s) => (s.card_id === c.id ? t + s.amount : t), 0);
            const level = capLevel(spent, c.monthly_cap);
            return (
              <li key={c.id}>
                <div className="flex justify-between text-sm">
                  <span>{c.nickname}</span>
                  <span className="tabular-nums">
                    {inr(spent)}
                    {c.monthly_cap > 0 && <span className="text-muted"> / {inr(c.monthly_cap)}</span>}
                  </span>
                </div>
                {c.monthly_cap > 0 && (
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full ${BAR[level]}`} style={{ width: `${Math.min(100, (spent / c.monthly_cap) * 100)}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {mode === "week" && <p className="mt-3 text-xs text-muted">Caps are monthly; switch to Salary cycle for the full picture.</p>}
      </section>

      <section className="glass-hero rounded-3xl p-4">
        <p className="text-sm text-muted">Unspent this cycle (projected)</p>
        <p className="text-3xl font-bold tabular-nums text-good">{inr(unspent)}</p>
        <p className="mt-1 text-sm text-muted">Will go to Trip fund on salary day, if you stay on budget.</p>
      </section>
    </div>
  );
}
