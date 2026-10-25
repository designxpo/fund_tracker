"use client";

import { useState } from "react";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { useQuickAdd } from "@/components/quick-add";
import { CycleTrend } from "@/components/cycle-trend";
import { addDays, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { categoryChange, monthSpending, salaryUtilisation, type MonthItem, type MonthSettlement } from "@/lib/month";
import { useMoney, useMoneyHistory, type HistSpend } from "@/lib/use-money";
import type { Spend } from "@/lib/types";

type Month = {
  id: string;
  start: string;
  end: string;
  salary: number;
  items: MonthItem[];
  settlements: MonthSettlement[];
  spends: (Spend | HistSpend)[];
  current: boolean;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "daily", label: "Everyday" },
  { key: "planned", label: "Planned" },
  { key: "unplanned", label: "Unplanned" },
  { key: "back", label: "Money back" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const compact = (n: number) => (Math.abs(n) >= 1000 ? `₹${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `₹${Math.round(n)}`);
const money = (n: number) => (n < 0 ? `+${inr(-n)}` : inr(n));
const monthName = (m: Month, style: "short" | "long" = "short") =>
  parseYmd(m.start).toLocaleDateString("en-IN", style === "long" ? { month: "long", year: "numeric" } : { month: "short" });

/** Month by month: how much was spent each month, and every transaction of the month you pick. */
export default function HistoryPage() {
  const { ready, cycle, spends, categories, cards, goals, planItems, settlements } = useStore();
  const { data: hist, loading, error } = useMoneyHistory(cycle?.id);
  const m = useMoney();
  const { open } = useQuickAdd();
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [cardId, setCardId] = useState("");

  if (!ready || !cycle || !m) return <div className="h-64 animate-pulse rounded-3xl bg-surface" />;

  const months: Month[] = [
    ...(hist?.cycles ?? []).map((c) => ({ id: c.id, start: c.starts_on, end: c.ends_on, salary: c.salary, items: c.items, settlements: c.settlements, spends: c.spends, current: false })),
    {
      id: cycle.id,
      start: m.start,
      end: m.end,
      salary: m.salary,
      items: planItems,
      settlements,
      spends: spends.filter((s) => s.spent_on >= m.start && s.spent_on <= m.end),
      current: true,
    },
  ];
  const found = months.findIndex((x) => x.id === sel);
  const i = found >= 0 ? found : months.length - 1;
  const month = months[i];
  const prev = i > 0 ? months[i - 1] : null;

  const chart = months.slice(-7).map((mo) => ({ id: mo.id, label: monthName(mo), total: monthSpending(mo.spends).total, current: mo.current }));
  const closed = months.filter((mo) => !mo.current);
  const avg = closed.length ? closed.reduce((t, mo) => t + monthSpending(mo.spends).total, 0) / closed.length : null;

  const spend = monthSpending(month.spends);
  // This month so far is compared with the month before up to the same day; past months, whole to whole.
  const prevSpend = prev
    ? monthSpending(month.current ? prev.spends.filter((s) => s.spent_on <= addDays(prev.start, m.elapsed - 1)) : prev.spends)
    : null;
  const delta = prevSpend ? spend.total - prevSpend.total : null;
  const u = salaryUtilisation(month.salary, 0, 0, month.items, month.settlements, goals);
  const bills = u.rows.filter((r) => r.key === "emis" || r.key === "fixed").reduce((t, r) => t + r.amount, 0);
  const cats = categoryChange(month.spends, prev?.spends ?? null);
  const cat = (id: string | null) => categories.find((c) => c.id === id);

  const list = month.spends
    .filter((s) => (filter === "all" ? true : filter === "back" ? s.amount < 0 : (s.spend_type ?? "daily") === filter && s.amount > 0))
    .filter((s) => !cardId || s.card_id === cardId);
  const byDay = [...new Set(list.map((s) => s.spent_on))].sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h1 className="text-2xl font-bold">History</h1>
        <p className="text-sm text-muted">How much you spend, month by month</p>
      </div>

      <section aria-label="Spending by month" className="rounded-2xl bg-surface p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Spending by month</h2>
          {avg != null && <p className="text-xs text-muted">average {inr(Math.round(avg))}</p>}
        </div>
        {loading && !hist ? (
          <div className="mt-3 h-48 animate-pulse rounded-xl bg-line" />
        ) : (
          <div className="mt-3 h-48" role="img" aria-label="Total spending each month; tap a month to see it">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 18, right: 4, left: 4, bottom: 0 }} barCategoryGap="24%">
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <YAxis hide domain={[0, (max: number) => Math.max(max, avg ?? 0) * 1.15]} />
                <Tooltip
                  cursor={{ fill: "var(--line)", opacity: 0.5 }}
                  formatter={(v) => [inr(Number(v)), "Spent"]}
                  contentStyle={{ background: "rgba(255,255,255,.95)", border: "1px solid rgba(255,255,255,.9)", borderRadius: 14, color: "var(--ink)", boxShadow: "0 10px 30px -12px rgba(20,38,79,.3)" }}
                />
                {avg != null && <ReferenceLine y={avg} stroke="var(--muted)" strokeDasharray="4 4" />}
                <Bar dataKey="total" radius={[6, 6, 0, 0]} onClick={(d) => setSel((d as unknown as { id: string }).id)} cursor="pointer">
                  {chart.map((d) => (
                    <Cell key={d.id} fill="var(--navy)" fillOpacity={d.id === month.id ? 1 : 0.3} />
                  ))}
                  <LabelList dataKey="total" position="top" formatter={(v) => compact(Number(v))} style={{ fontSize: 10, fill: "var(--muted)" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          Everything you logged: everyday, planned and unplanned, minus money back. {months.some((mo) => mo.current) ? "This month is so far." : ""}
          {avg != null ? " Dashed line: your average." : ""}
        </p>
        {error && <p className="mt-1 text-xs text-bad">Couldn&apos;t load past months: {error}</p>}
      </section>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Month">
        {[...months].reverse().map((mo) => (
          <button
            key={mo.id}
            role="tab"
            aria-selected={mo.id === month.id}
            onClick={() => setSel(mo.id)}
            className={`h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition ${mo.id === month.id ? "bg-navy text-white" : "bg-surface text-muted"}`}
          >
            {monthName(mo)}
            {mo.current ? " (now)" : ""}
          </button>
        ))}
      </div>

      <section aria-label={`${monthName(month, "long")} summary`} className="rounded-2xl bg-surface p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">
            {monthName(month, "long")}
            {month.current ? " · so far" : ""}
          </h2>
          <p className="text-xs text-muted">
            {parseYmd(month.start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} –{" "}
            {parseYmd(month.end).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </p>
        </div>
        <p className="mt-1 text-3xl font-bold tabular-nums">{inr(spend.total)}</p>
        <p className="text-sm text-muted">
          spent
          {delta != null && prev && (
            <span className={delta > 0 ? "text-bad" : "text-good"}>
              {" "}
              · {delta > 0 ? "▲" : "▼"} {inr(Math.abs(delta))} vs {monthName(prev)}
              {month.current ? " by this day" : ""}
            </span>
          )}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {[
            { label: "Everyday", value: spend.everyday },
            { label: "Planned", value: spend.planned },
            { label: "Unplanned", value: spend.unplanned },
            { label: "Money back", value: -spend.back },
            { label: "Bills & EMIs", value: bills },
            { label: `Saved (${month.salary > 0 ? Math.round((u.saved / month.salary) * 100) : 0}% of salary)`, value: u.saved },
          ].map((t) => (
            <div key={t.label} className="rounded-xl bg-bg p-2.5">
              <dt className="text-xs text-muted">{t.label}</dt>
              <dd className={`font-semibold tabular-nums ${t.value < 0 ? "text-good" : ""}`}>{money(t.value)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">Salary {inr(month.salary)}</p>

        {cats.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">By category{prev ? ` · vs ${monthName(prev)}` : ""}</h3>
            <ul className="mt-1 divide-y divide-line text-sm">
              {cats.map((c) => {
                const d = c.before == null ? null : c.amount - c.before;
                return (
                  <li key={c.id} className="flex items-center gap-2 py-2">
                    <span className="flex-1 truncate">
                      {cat(c.id === "none" ? null : c.id)?.icon ?? "•"} {cat(c.id === "none" ? null : c.id)?.name ?? "Other"}
                    </span>
                    {d != null && Math.abs(d) >= 1 && (
                      <span className={`text-xs tabular-nums ${d > 0 ? "text-bad" : "text-good"}`}>
                        {c.before === 0 ? "new" : `${d > 0 ? "▲" : "▼"} ${inr(Math.abs(d))}`}
                      </span>
                    )}
                    <span className={`w-24 text-right font-medium tabular-nums ${c.amount < 0 ? "text-good" : ""}`}>{money(c.amount)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Transactions" className="rounded-2xl bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Transactions</h2>
          <select
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            aria-label="Card"
            className="h-9 max-w-[50%] rounded-xl border border-line bg-bg px-2 text-sm text-ink"
          >
            <option value="">All cards</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
              </option>
            ))}
          </select>
        </div>
        <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`h-9 shrink-0 rounded-full border px-3 text-xs font-medium ${filter === f.key ? "border-navy bg-navy text-white" : "border-line text-muted"}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {byDay.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No transactions here.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {byDay.map((day) => {
              const items = list.filter((s) => s.spent_on === day);
              return (
                <div key={day}>
                  <p className="flex justify-between border-b border-line pb-1 text-xs font-medium text-muted">
                    <span>{parseYmd(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span className="tabular-nums">{money(items.reduce((t, s) => t + Number(s.amount), 0))}</span>
                  </p>
                  <ul>
                    {items.map((s) => {
                      const c = cat(s.category_id);
                      const type = s.amount < 0 ? "Money back" : s.spend_type === "planned" ? "Planned" : s.spend_type === "unplanned" ? "Unplanned" : null;
                      const sub = [cards.find((x) => x.id === s.card_id)?.nickname, s.note, type].filter(Boolean).join(" · ");
                      const row = (
                        <>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg">{c?.icon ?? (s.amount < 0 ? "↩" : "•")}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{c?.name ?? (s.amount < 0 ? "Money back" : "Other")}</span>
                            {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
                          </span>
                          <span className={`text-sm font-medium tabular-nums ${s.amount < 0 ? "text-good" : ""}`}>{money(Number(s.amount))}</span>
                        </>
                      );
                      return (
                        <li key={s.id}>
                          {month.current ? (
                            <button onClick={() => open(s as Spend)} className="flex min-h-12 w-full items-center gap-3 py-1.5 text-left">
                              {row}
                            </button>
                          ) : (
                            <div className="flex min-h-12 items-center gap-3 py-1.5">
                              {row}
                              {s.amount > 0 && (
                                <button
                                  onClick={() => open(undefined, s as Spend)}
                                  aria-label={`Got money back for ${c?.name ?? "this"}`}
                                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-good/40 text-good"
                                >
                                  ↩
                                </button>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          {month.current ? "Tap a transaction to edit it or mark it refunded." : "Got money back for an older charge? Tap ↩ to log it today."}
        </p>
      </section>

      <CycleTrend />
    </div>
  );
}
