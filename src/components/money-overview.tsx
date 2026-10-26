"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { ok, useData } from "@/lib/use-data";
import { capLevel, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { bucketOf, categoryChange, monthSpending, type Bucket, type LeftRow } from "@/lib/month";
import { useMoney } from "@/lib/use-money";
import { CardMatch } from "@/components/card-match";
import { useQuickAdd } from "@/components/quick-add";
import { isDaily, type Card, type Spend } from "@/lib/types";

/** One colour per part of the salary, the same everywhere (validated order: blue, aqua, yellow, violet, red). */
export const LEFT_COLORS: Record<LeftRow["key"], string> = {
  bills: "#2a78d6",
  saved: "#1baf7a",
  setAside: "#eda100",
  spent: "#6250d6",
  overspent: "#e34948",
};

const shortDate = (d: string) => parseYmd(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const pctOf = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const signed = (n: number) => (n < 0 ? `−${inr(-n)}` : inr(n));
const money = (n: number) => (n < 0 ? `+${inr(-n)}` : inr(n)); // refunds show as money back

/** Salary as one bar: each part's share, a 2px gap between parts, what's left as the empty track. */
function SalaryBar({ rows, salary, className = "h-4" }: { rows: LeftRow[]; salary: number; className?: string }) {
  const shown = rows.filter((r) => r.amount > 0);
  const scale = Math.max(salary, shown.reduce((t, r) => t + r.amount, 0));
  return (
    <div className={`flex gap-[2px] overflow-hidden rounded-full bg-line ${className}`} role="img" aria-label="How this salary has been used">
      {shown.map((r) => (
        <div key={r.key} title={`${r.label}: ${inr(r.amount)}`} style={{ width: `${(r.amount / scale) * 100}%`, background: LEFT_COLORS[r.key] }} />
      ))}
    </div>
  );
}

/** Home: today's everyday spending against the daily budget. */
export function TodayCard() {
  const { summary, cycle } = useStore();
  if (!summary || !cycle) return null;
  const daily = Number(cycle.daily_budget);
  const spent = summary.todaySpent; // everyday spends today, net of money back
  const left = daily - spent;
  return (
    <section aria-label="Today" className="glass-hero rounded-[28px] p-5">
      <p className="text-sm text-muted">Spent today</p>
      <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight" aria-live="polite">
        {inr(Math.max(0, spent))}
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.max(0, (spent / daily) * 100))}%`, background: left >= 0 ? "var(--good)" : "var(--bad)" }}
        />
      </div>
      <p className="mt-2 text-sm">
        <b className={left >= 0 ? "text-good" : "text-bad"}>{left >= 0 ? `${inr(left)} left` : `${inr(-left)} over`}</b>
        <span className="text-muted"> of your {inr(daily)} daily budget</span>
      </p>
      {spent < 0 && <p className="text-xs text-good">+{inr(-spent)} money back today</p>}
    </section>
  );
}

/** Spends behind a row, biggest first; tap one to edit it (or mark it refunded). */
function SpendList({ list }: { list: Spend[] }) {
  const { cards, categories } = useStore();
  const { open } = useQuickAdd();
  const sorted = [...list].sort((a, b) => b.amount - a.amount);
  return (
    <ul className="mt-1.5 space-y-0.5 border-l border-line pl-3 text-xs">
      {sorted.map((s) => {
        const c = categories.find((x) => x.id === s.category_id);
        return (
          <li key={s.id}>
            <button onClick={() => open(s)} className="flex min-h-8 w-full justify-between gap-2 text-left">
              <span className="truncate text-muted">
                {shortDate(s.spent_on)} · {s.note || c?.name || (s.amount < 0 ? "Money back" : "Other")}
                {cards.find((x) => x.id === s.card_id) ? ` · ${cards.find((x) => x.id === s.card_id)!.nickname}` : ""}
              </span>
              <span className={`shrink-0 tabular-nums ${s.amount < 0 ? "text-good" : ""}`}>{money(Number(s.amount))}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const LIMIT_LABEL = { fund: "set aside", card: "monthly cap", daily: "budget so far", bill: "planned" } as const;

/** Home: every limit this month went over, in plain words, each opening to the spends behind it. */
export function OverLimits() {
  const { spends } = useStore();
  const m = useMoney();
  if (!m) return null;
  if (!m.over.length)
    return <p className="rounded-2xl bg-good/10 px-4 py-3 text-sm font-medium text-good">✓ Within all your limits this month</p>;
  const inCycle = spends.filter((s) => s.spent_on >= m.start && s.spent_on <= m.end);
  const behind = (o: (typeof m.over)[number]) =>
    o.kind === "fund"
      ? inCycle.filter((s) => !isDaily(s) && s.goal_id === o.ref)
      : o.kind === "card"
        ? inCycle.filter((s) => s.card_id === o.ref)
        : o.kind === "daily"
          ? inCycle.filter(isDaily)
          : [];
  const total = m.over.reduce((t, o) => t + o.over, 0);

  return (
    <section aria-label="Where you went over" className="rounded-2xl bg-bad/[.06] p-4 ring-1 ring-bad/15">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-bad">Where you went over</h2>
        <span className="text-xs text-muted">tap to see why</span>
      </div>
      <ul className="mt-1 divide-y divide-bad/10">
        {m.over.map((o) => {
          const list = behind(o);
          return (
            <li key={o.key}>
              <details className="group py-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{o.title}</span>
                    <span className="block text-xs text-muted">
                      {inr(o.spent)} spent · {inr(o.limit)} {LIMIT_LABEL[o.kind]}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-bad">{inr(o.over)} over</span>
                  <span aria-hidden className="text-muted transition group-open:rotate-90">
                    ›
                  </span>
                </summary>
                {o.kind === "fund" && (
                  <p className="mt-1 text-xs text-muted">
                    These were logged as {o.title.startsWith("Unplanned") ? "Unplanned" : "Planned"}, but more was spent than you&apos;d set aside, so the rest comes out of
                    your salary.
                  </p>
                )}
                {o.kind === "card" && <p className="mt-1 text-xs text-muted">Everything you put on this card this month.</p>}
                {o.kind === "bill" && <p className="mt-1 text-xs text-muted">This bill cost more than planned on Salary Day.</p>}
                {list.length > 0 && <SpendList list={list} />}
              </details>
            </li>
          );
        })}
      </ul>
      {m.over.length > 1 && (
        <p className="mt-1 text-xs text-muted">
          {m.over.length} limits over, {inr(total)} in all (some spends count in more than one, e.g. a card and a fund).
        </p>
      )}
    </section>
  );
}

/** Home: this month's total, what's left of the salary, and where the money went by category. */
export function MonthCard() {
  const { spends, categories } = useStore();
  const m = useMoney();
  if (!m) return null;
  const inCycle = spends.filter((s) => s.spent_on >= m.start && s.spent_on <= m.end);
  const s = monthSpending(inCycle);
  const cats = categoryChange(inCycle, null).filter((c) => c.amount > 0);
  const top = cats.slice(0, 5);
  const rest = cats.slice(5).reduce((t, c) => t + c.amount, 0);
  const max = top[0]?.amount ?? 1;
  const L = m.left.left;
  const perDay = m.plans.at(-1)?.perDay;
  const cat = (id: string) => categories.find((c) => c.id === id);

  return (
    <section aria-label="This month" className="rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">This month</h2>
        <span className="text-xs text-muted">{m.daysLeft <= 1 ? "salary tomorrow" : `${m.daysLeft} days to salary`}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-bg p-2.5">
          <dt className="text-xs text-muted">Spent</dt>
          <dd className="text-lg font-semibold tabular-nums">{inr(s.total)}</dd>
          <dd className="text-[11px] text-muted">everything you logged</dd>
        </div>
        <Link href="/insights" className="rounded-xl bg-bg p-2.5">
          <dt className="text-xs text-muted">Left from salary</dt>
          <dd className={`text-lg font-semibold tabular-nums ${L >= 0 ? "text-good" : "text-bad"}`}>{signed(L)}</dd>
          <dd className="text-[11px] text-muted">{L >= 0 && perDay != null ? `up to ${inr(perDay)}/day` : "after bills & savings ›"}</dd>
        </Link>
      </dl>

      <h3 className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">Where it went</h3>
      {top.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Nothing spent yet this month.</p>
      ) : (
        <ul className="mt-1">
          {top.map((c) => {
            const k = cat(c.id);
            const list = inCycle.filter((x) => (x.category_id ?? "none") === c.id);
            return (
              <li key={c.id}>
                <details className="group py-1.5">
                  <summary className="cursor-pointer list-none text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="flex-1 truncate">
                        {k?.icon ?? "•"} {k?.name ?? "Other"}
                      </span>
                      <span className="font-medium tabular-nums">{inr(c.amount)}</span>
                      <span aria-hidden className="text-muted transition group-open:rotate-90">
                        ›
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-navy/70" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </summary>
                  <SpendList list={list} />
                </details>
              </li>
            );
          })}
          {rest > 0 && (
            <li className="flex justify-between py-1.5 text-sm text-muted">
              <span>Everything else</span>
              <span className="tabular-nums">{inr(rest)}</span>
            </li>
          )}
        </ul>
      )}
      {s.back > 0 && <p className="mt-1 text-xs text-good">+{inr(s.back)} money back already taken off</p>}
      <Link href="/history" className="mt-2 block text-xs font-medium text-navy">
        All transactions ›
      </Link>
    </section>
  );
}

type Line = { id: string; label: string; amount: number; note?: string; tone?: "good" | "bad" | "warn"; spends?: Spend[] };
const TONE = { good: "text-good", bad: "text-bad", warn: "text-warn" } as const;

function Lines({ lines }: { lines: Line[] }) {
  const { cards } = useStore();
  const { open } = useQuickAdd();
  if (!lines.length) return <p className="text-xs text-muted">Nothing yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((l) =>
        l.spends ? (
          <li key={l.id}>
            <details className="group/line">
              <summary className="flex cursor-pointer list-none justify-between gap-2">
                <span className="truncate">
                  {l.label} <span className="text-xs text-muted">· {l.spends.length}</span>
                </span>
                <span className={`tabular-nums ${l.amount < 0 ? "text-good" : ""}`}>{money(l.amount)}</span>
              </summary>
              <ul className="mb-1 mt-1 space-y-0.5 border-l border-line pl-3 text-xs text-muted">
                {l.spends.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => open(s)} className="flex min-h-8 w-full justify-between gap-2 text-left">
                      <span className="truncate">
                        {shortDate(s.spent_on)}
                        {[cards.find((c) => c.id === s.card_id)?.nickname, s.note].filter(Boolean).map((x) => ` · ${x}`)}
                      </span>
                      <span className={`tabular-nums ${s.amount < 0 ? "text-good" : ""}`}>{money(Number(s.amount))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ) : (
          <li key={l.id} className="flex justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">{l.label}</span>
              {l.note && <span className={`block text-xs ${l.tone ? TONE[l.tone] : "text-muted"}`}>{l.note}</span>}
            </span>
            <span className="shrink-0 tabular-nums">{signed(l.amount)}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/** Insights: salary − bills − saved − set aside − spent = left, each part opening to its details. */
export function ThisMonth() {
  const { cycle, spends, planItems, settlements, goals, categories } = useStore();
  const m = useMoney();
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

  const inCycle = spends.filter((s) => s.spent_on >= m.start && s.spent_on <= m.end);
  const cat = (id: string | null) => categories.find((c) => c.id === id);
  const byCategory = (list: Spend[]): Line[] =>
    [...new Set(list.map((s) => s.category_id ?? "none"))]
      .map((id) => {
        const items = list.filter((s) => (s.category_id ?? "none") === id);
        const c = cat(id === "none" ? null : id);
        return { id, label: `${c?.icon ?? "•"} ${c?.name ?? "Other"}`, amount: items.reduce((t, s) => t + Number(s.amount), 0), spends: items };
      })
      .sort((a, b) => b.amount - a.amount);

  const planLines = (buckets: Bucket[]): Line[] => [
    ...planItems
      .filter((i) => buckets.includes(bucketOf(i, goals)))
      .map((i) => {
        const amount = Number(i.actual ?? i.planned);
        const diff = amount - Number(i.planned);
        const savings = !["emis", "fixed"].includes(bucketOf(i, goals));
        const note = !i.done
          ? "not done yet"
          : Math.abs(diff) >= 1
            ? `plan ${inr(Number(i.planned))} · ${diff > 0 ? `${inr(diff)} more` : `${inr(-diff)} less`}`
            : undefined;
        return { id: i.id, label: i.name, amount, note, tone: !i.done ? ("warn" as const) : Math.abs(diff) < 1 ? undefined : (diff > 0) === savings ? ("good" as const) : ("bad" as const) };
      }),
    ...settlements
      .filter((s) => (s.kind === "leftover" || s.kind === "borrow") && buckets.includes(s.goal_id ? bucketOf({ kind: "savings", goal_id: s.goal_id }, goals) : "emis"))
      .map((s) => ({ id: s.id, label: s.note ?? (Number(s.amount) < 0 ? "Borrowed" : "Leftover moved"), amount: Number(s.amount) })),
  ];

  const daily = inCycle.filter(isDaily);
  const spentOver = (m.left.rows.find((r) => r.key === "spent")?.amount ?? 0) - m.budgetToDate;
  const fundSpends = inCycle.filter((s) => !isDaily(s));
  const fundTotal = fundSpends.reduce((t, s) => t + Number(s.amount), 0);
  const fundLines: Line[] = [...new Set(fundSpends.map((s) => s.goal_id ?? "none"))].map((gid) => {
    const items = fundSpends.filter((s) => (s.goal_id ?? "none") === gid);
    return { id: gid, label: goals.find((g) => g.id === gid)?.name ?? "Fund", amount: items.reduce((t, s) => t + Number(s.amount), 0), spends: items };
  });

  const details: Record<LeftRow["key"], { lines: Line[]; head?: React.ReactNode }> = {
    bills: { lines: planLines(["emis", "fixed"]) },
    saved: {
      lines: planLines(["saved"]),
      head: (
        <p className="mb-1.5 text-xs text-muted">
          {Math.round(m.rate * 100)}% of your salary · target {Math.round(m.target * 100)}%
        </p>
      ),
    },
    setAside: {
      lines: planLines(["setAside"]),
      head: <p className="mb-1.5 text-xs text-muted">Sinking funds and the Surprise buffer: money kept for planned and unexpected costs.</p>,
    },
    spent: {
      lines: byCategory(daily),
      head: (
        <p className={`mb-1.5 text-xs ${spentOver > 0 ? "text-bad" : "text-good"}`}>
          Budget so far {inr(m.budgetToDate)} (day {m.elapsed} of {m.days}) · {spentOver > 0 ? `${inr(spentOver)} over` : `${inr(-spentOver)} under`}
        </p>
      ),
    },
    overspent: {
      lines: m.left.overspent.map((f) => ({ id: f.name, label: f.name, amount: f.amount, note: "spent more than you'd set aside in it", tone: "bad" as const })),
      head: (
        <p className="mb-1.5 text-xs text-muted">
          Planned and unplanned spends use money you set aside first. Anything spent beyond that comes out of this salary.
        </p>
      ),
    },
  };

  return (
    <section aria-label="This month" className="rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">This month</h2>
        <p className="text-xs text-muted">
          {shortDate(m.start)} – {shortDate(m.end)}
        </p>
      </div>
      <SalaryBar rows={m.left.rows} salary={m.salary} className="mt-3 h-4" />

      <div className="mt-3 flex justify-between text-sm font-semibold">
        <span>Salary</span>
        <span className="tabular-nums">{inr(m.salary)}</span>
      </div>
      {!!extra && <p className="text-xs text-muted">+ {inr(extra)} extra income, already split into goals when you logged it</p>}

      <ul className="mt-1 divide-y divide-line">
        {m.left.rows
          .filter((r) => r.key !== "overspent" || r.amount > 0)
          .map((r) => (
            <li key={r.key}>
              <details className="group py-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                  <span aria-hidden className="w-3 text-muted">−</span>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: LEFT_COLORS[r.key] }} />
                  <span className="flex-1">{r.label}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted">{pctOf(r.amount, m.salary)}%</span>
                  <span className={`w-24 text-right font-medium tabular-nums ${r.key === "overspent" ? "text-bad" : ""}`}>{inr(r.amount)}</span>
                  <span aria-hidden className="text-muted transition group-open:rotate-90">›</span>
                </summary>
                <div className="ml-10 mt-2">
                  {details[r.key].head}
                  <Lines lines={details[r.key].lines} />
                </div>
              </details>
            </li>
          ))}
        <li className="flex items-center gap-2 py-2.5 font-semibold">
          <span aria-hidden className="w-3 text-muted">=</span>
          <span className="h-3 w-3 shrink-0 rounded-full bg-line" />
          <span className="flex-1">Left until salary day</span>
          <span className={`text-right tabular-nums ${m.left.left >= 0 ? "text-good" : "text-bad"}`}>{signed(m.left.left)}</span>
        </li>
      </ul>

      {fundTotal !== 0 && (
        <details className="group mt-1 rounded-xl bg-bg p-3 text-sm">
          <summary className="flex cursor-pointer list-none justify-between gap-2">
            <span>Paid through your funds</span>
            <span className="tabular-nums">
              {inr(fundTotal)} <span aria-hidden className="inline-block text-muted transition group-open:rotate-90">›</span>
            </span>
          </summary>
          <p className="mb-1.5 mt-1 text-xs text-muted">Planned and unplanned spends. Funds you&apos;d already filled paid for these, so only an overspend counts above.</p>
          <Lines lines={fundLines} />
        </details>
      )}
      {m.nextCardBill > 0 && (
        <p className="mt-2 rounded-xl bg-warn/10 p-3 text-xs text-ink">
          💳 <b>{inr(m.nextCardBill)}</b> of this went on credit cards. Keep it in your account: your next salary ({shortDate(m.nextSalaryOn)}) pays that bill first.
        </p>
      )}
    </section>
  );
}

const BAR = { ok: "bg-good", amber: "bg-warn", red: "bg-bad" } as const;

/** Insights: last card bill, what's on each card now (vs its cap), and matching a card with the bank. */
export function CardsSection() {
  const { spends, cards, settlements } = useStore();
  const m = useMoney();
  const [matching, setMatching] = useState<Card | null>(null);
  if (!m) return null;
  const bill = settlements.find((s) => s.kind === "card_bills");
  const inCycle = spends.filter((s) => s.spent_on >= m.start && s.spent_on <= m.end);
  const rows = cards
    .map((c) => {
      const list = inCycle.filter((s) => s.card_id === c.id);
      const by = (t: string) => list.filter((s) => (s.spend_type ?? "daily") === t).reduce((a, s) => a + Number(s.amount), 0);
      return { card: c, total: list.reduce((a, s) => a + Number(s.amount), 0), daily: by("daily"), planned: by("planned"), unplanned: by("unplanned") };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <section aria-label="Cards" className="rounded-2xl bg-surface p-4 shadow-sm">
      {matching && <CardMatch card={matching} onClose={() => setMatching(null)} />}
      <h2 className="text-sm font-semibold">Cards</h2>
      {bill && (
        <div className="mt-2 rounded-xl bg-bg p-3 text-sm">
          <div className="flex justify-between">
            <span className="font-medium">Last card bill (paid on salary day)</span>
            <span className="font-semibold tabular-nums">{inr(Number(bill.amount))}</span>
          </div>
          <p className={`text-xs ${bill.done ? "text-good" : "text-warn"}`}>{bill.done ? "✓ Paid in full" : "Not marked paid yet (Salary → step 1)"}</p>
        </div>
      )}
      {m.nextCardBill > 0 && (
        <p className="mt-2 text-xs text-muted">
          Next bill so far: {inr(m.nextCardBill)} of everyday spending on credit cards, paid from your next salary ({shortDate(m.nextSalaryOn)}).
        </p>
      )}
      <ul className="mt-1 divide-y divide-line text-sm">
        {rows.map((r) => {
          const level = capLevel(r.total, r.card.monthly_cap);
          return (
            <li key={r.card.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{r.card.nickname}</span>
                <span className="font-semibold tabular-nums">{money(r.total)}</span>
              </div>
              <p className="text-xs text-muted">
                Daily {money(r.daily)}
                {r.planned !== 0 ? ` · Planned ${money(r.planned)}` : ""}
                {r.unplanned !== 0 ? ` · Unplanned ${money(r.unplanned)}` : ""}
              </p>
              {r.card.monthly_cap > 0 && (
                <>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${r.card.nickname}: ${inr(r.total)} of ${inr(r.card.monthly_cap)} cap`}>
                    <div className={`h-full rounded-full ${BAR[level]}`} style={{ width: `${Math.min(100, Math.max(0, (r.total / r.card.monthly_cap) * 100))}%` }} />
                  </div>
                  <p className={`mt-0.5 text-xs ${r.total > r.card.monthly_cap ? "text-bad" : "text-muted"}`}>
                    {r.total > r.card.monthly_cap ? `${inr(r.total - r.card.monthly_cap)} over the ${inr(r.card.monthly_cap)} monthly cap` : `of ${inr(r.card.monthly_cap)} monthly cap`}
                  </p>
                </>
              )}
              <button onClick={() => setMatching(r.card)} className="mt-1.5 text-xs font-medium text-navy">
                Match with bank ›
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
