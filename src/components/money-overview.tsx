"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { ok, useData } from "@/lib/use-data";
import { addDays, capLevel, parseYmd } from "@/lib/budget";
import { inr } from "@/lib/money";
import { bucketOf, monthSpending, type Bucket, type LeftRow } from "@/lib/month";
import { big, lumpValue } from "@/lib/coach";
import { useMoney, useMoneyHistory } from "@/lib/use-money";
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

/** The "save before salary day" choice for this cycle (this device only). Defaults to saving a quarter. */
function usePace(cycleId: string | undefined) {
  const key = `pace:${cycleId}`;
  const [picked, setPicked] = useState<Record<string, number>>({});
  const stored = () => {
    try {
      const v = typeof window === "undefined" ? null : localStorage.getItem(key);
      return v == null ? 0.25 : Number(v);
    } catch {
      return 0.25;
    }
  };
  const keep = picked[key] ?? stored();
  const choose = (k: number) => {
    setPicked((p) => ({ ...p, [key]: k }));
    try {
      localStorage.setItem(key, String(k));
    } catch {}
  };
  return [keep, choose] as const;
}

/** Home: what's left of this salary, how many days it has to last, today's share, and how much to save. */
export function UntilSalary() {
  const m = useMoney();
  const [keep, setKeep] = usePace(m?.cycleId);
  if (!m) return null;

  const { left, plans, daysLeft, todaySpent, salary } = m;
  const L = left.left;
  const plan = plans.find((p) => p.keep === keep) ?? plans.at(-1);
  const worst = [...left.overspent].sort((a, b) => b.amount - a.amount)[0];
  const usedPct = salary > 0 ? Math.min(100, ((salary - Math.max(0, L)) / salary) * 100) : 100;

  return (
    <>
      <section aria-label="Left until salary day" className="glass-hero rounded-[28px] p-5">
        <p className="text-sm text-muted">Left until salary day</p>
        <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight" style={{ color: L >= 0 ? "var(--good)" : "var(--bad)" }} aria-live="polite">
          {signed(L)}
        </p>
        <p className="mt-1 text-sm text-muted">
          {daysLeft <= 1 ? "Last day before salary" : `${daysLeft} days to go`} · salary on {shortDate(m.nextSalaryOn)}
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${usedPct}%`, background: L >= 0 ? "var(--good)" : "var(--bad)" }} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {pctOf(salary - L, salary)}% of your {inr(salary)} salary used
        </p>

        {plan ? (
          <div className="mt-3 flex items-baseline justify-between gap-2 rounded-2xl bg-white/60 px-3 py-2.5 text-sm">
            <span>
              Today <span className="text-muted">· spent {inr(todaySpent)} of {inr(plan.perDay)}</span>
            </span>
            <b className={`tabular-nums ${plan.todayLeft >= 0 ? "text-good" : "text-bad"}`}>
              {plan.todayLeft >= 0 ? `${inr(plan.todayLeft)} left` : `${inr(-plan.todayLeft)} over`}
            </b>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl bg-bad/10 px-3 py-2.5 text-sm text-bad">
            <p>
              {L < 0 ? `This salary is ${inr(-L)} short.` : "Nothing left for the coming days."} Spend only on essentials until salary day
              {L < 0 ? "; the gap comes out of your savings" : ""}.
            </p>
            {worst && (
              <p className="mt-1 text-xs">
                Biggest reason: {worst.name} paid out {inr(worst.amount)} more than it had.
              </p>
            )}
          </div>
        )}
      </section>

      {plans.length > 0 && (
        <section aria-label="Save before salary day" className="rounded-2xl bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Save before salary day</h2>
          <p className="text-xs text-muted">How much of the {inr(L)} do you want to keep? Today&apos;s limit above follows your pick.</p>
          <div role="radiogroup" aria-label="How much to save" className="mt-3 grid grid-cols-3 gap-2">
            {plans.map((p) => {
              const on = p.keep === plan?.keep;
              return (
                <button
                  key={p.keep}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKeep(p.keep)}
                  className={`rounded-2xl border px-2 py-2.5 text-center transition active:scale-[.98] ${
                    on ? "border-navy bg-navy text-white shadow-[0_6px_16px_-8px_rgba(20,38,79,.7)]" : "border-white/80 bg-white/60 text-ink"
                  }`}
                >
                  <span className={`block text-xs ${on ? "text-white/80" : "text-muted"}`}>{p.keep ? `Save ${p.keep * 100}%` : "Spend it all"}</span>
                  <span className="block font-semibold tabular-nums">{inr(p.perDay)}/day</span>
                  <span className={`block text-xs tabular-nums ${on ? "text-white/80" : "text-good"}`}>{p.keep ? `saves ${inr(p.save)}` : "saves ₹0"}</span>
                </button>
              );
            })}
          </div>
          {plan && plan.keep > 0 && (
            <p className="mt-2 text-xs text-muted">
              On salary day, move the {inr(plan.save)} to investments. In 10 years it could be {big(lumpValue(plan.save, 10))}.
            </p>
          )}
        </section>
      )}
    </>
  );
}

/** Home: this month's spending so far, against last month by the same day. Opens History. */
export function MonthSnapshot() {
  const { cycle, spends } = useStore();
  const { data: hist } = useMoneyHistory(cycle?.id);
  const m = useMoney();
  if (!m) return null;
  const now = monthSpending(spends.filter((s) => s.spent_on >= m.start && s.spent_on <= m.end));
  const prev = hist?.cycles.at(-1);
  const before = prev ? monthSpending(prev.spends.filter((s) => s.spent_on <= addDays(prev.starts_on, m.elapsed - 1))).total : null;
  const delta = before == null ? null : now.total - before;
  const prevName = prev ? parseYmd(prev.starts_on).toLocaleDateString("en-IN", { month: "short" }) : "";
  return (
    <Link href="/history" className="block rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Spent this month</h2>
        <span className="text-xs text-muted">History ›</span>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums">{inr(now.total)}</p>
      {delta != null && Math.abs(delta) >= 1 && (
        <p className={`text-sm ${delta > 0 ? "text-bad" : "text-good"}`}>
          {delta > 0 ? "▲" : "▼"} {inr(Math.abs(delta))} {delta > 0 ? "more" : "less"} than {prevName} by this day
        </p>
      )}
      <p className="mt-1 text-xs text-muted">
        Everyday {inr(now.everyday)} · Planned {inr(now.planned)} · Unplanned {inr(now.unplanned)}
        {now.back > 0 ? ` · Money back +${inr(now.back)}` : ""}
      </p>
    </Link>
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
      lines: m.left.overspent.map((f) => ({ id: f.name, label: f.name, amount: f.amount, note: "paid out more than it had", tone: "bad" as const })),
      head: <p className="mb-1.5 text-xs text-muted">Planned and unplanned spends come out of their funds first. When a fund runs out, the rest comes out of this salary.</p>,
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
          const level = capLevel(r.daily, r.card.monthly_cap);
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
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${r.card.nickname}: ${inr(r.daily)} of ${inr(r.card.monthly_cap)} cap`}>
                  <div className={`h-full rounded-full ${BAR[level]}`} style={{ width: `${Math.min(100, Math.max(0, (r.daily / r.card.monthly_cap) * 100))}%` }} />
                </div>
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
