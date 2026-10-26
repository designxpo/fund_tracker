"use client";

import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { ok, useData } from "@/lib/use-data";
import { addDays, diffDays, salaryPromptDue } from "@/lib/budget";
import { moneyLeft, monthSummary, overLimits, pacePlans, planVsActual, salaryUtilisation, type MonthItem, type MonthSettlement } from "@/lib/month";
import { coachNudges, savingsTarget } from "@/lib/coach";
import type { FundSettle, SpendType } from "@/lib/types";

export type HistSpend = {
  id: string;
  amount: number;
  card_id: string | null;
  spend_type: SpendType;
  category_id: string | null;
  spent_on: string;
  note: string | null;
  goal_id: string | null;
  fund_settle: FundSettle;
  created_at: string;
};
export type PastCycle = {
  id: string;
  starts_on: string;
  ends_on: string;
  salary: number;
  daily_budget: number;
  items: MonthItem[];
  settlements: MonthSettlement[];
  spends: HistSpend[];
};
/** Closed cycles, oldest first, and every credit card ever used (inactive ones too). */
export type MoneyHistory = { cycles: PastCycle[]; creditIds: string[] };

async function fetchHistory(): Promise<MoneyHistory> {
  const sb = createClient();
  const [cycles, credit] = await Promise.all([
    sb.from("cycles").select("id, starts_on, ends_on, salary, daily_budget").not("ends_on", "is", null).order("starts_on", { ascending: false }).limit(12).then(ok),
    sb.from("cards").select("id").gt("monthly_cap", 0).then(ok),
  ]);
  const list = cycles as { id: string; starts_on: string; ends_on: string; salary: unknown; daily_budget: unknown }[];
  const creditIds = (credit as { id: string }[]).map((c) => c.id);
  if (!list.length) return { cycles: [], creditIds };
  const ids = list.map((c) => c.id);
  const [items, sets, ...spends] = await Promise.all([
    sb.from("plan_items").select("cycle_id, name, kind, goal_id, planned, actual").in("cycle_id", ids).then(ok),
    sb.from("cycle_settlements").select("cycle_id, kind, goal_id, amount").in("cycle_id", ids).then(ok),
    ...list.map((c) =>
      sb
        .from("spends")
        .select("id, amount, card_id, spend_type, category_id, spent_on, note, goal_id, fund_settle, created_at")
        .gte("spent_on", c.starts_on)
        .lte("spent_on", c.ends_on)
        .order("spent_on", { ascending: false })
        .limit(5000)
        .then(ok),
    ),
  ]);
  type R = { cycle_id: string; kind: string; goal_id: string | null; name: string; planned: unknown; actual: unknown; amount: unknown };
  return {
    creditIds,
    cycles: list
      .map((c, i) => ({
        id: c.id,
        starts_on: c.starts_on,
        ends_on: c.ends_on,
        salary: Number(c.salary),
        daily_budget: Number(c.daily_budget),
        items: (items as R[])
          .filter((r) => r.cycle_id === c.id)
          .map((r): MonthItem => ({ ...r, planned: Number(r.planned), actual: r.actual == null ? null : Number(r.actual) })),
        settlements: (sets as R[]).filter((r) => r.cycle_id === c.id).map((r): MonthSettlement => ({ ...r, amount: Number(r.amount) })),
        spends: (spends[i] as HistSpend[]).map((s) => ({ ...s, amount: Number(s.amount) })),
      }))
      .reverse(),
  };
}

export function useMoneyHistory(cycleId: string | undefined) {
  return useData("money-history-v3", fetchHistory, cycleId);
}

type SpendLike = { amount: number; card_id: string | null; spend_type?: string };
const isDailyType = (s: { spend_type?: string }) => (s.spend_type ?? "daily") === "daily";
const total = (list: { amount: number }[]) => list.reduce((t, s) => t + Number(s.amount), 0);

/** Everyday spends paid by credit card (they go on the bill the next salary pays). */
const onCardDaily = (spends: SpendLike[], credit: Set<string>) => total(spends.filter((s) => isDailyType(s) && !!s.card_id && credit.has(s.card_id)));

/** This cycle's money: what's left until salary day, savings rate and coach nudges, shared by every screen. */
export function useMoney() {
  const { cycle, summary, spends, planItems, settlements, goals, cards, categories, today } = useStore();
  const { data: hist } = useMoneyHistory(cycle?.id);
  if (!cycle || !summary) return null;

  const salary = Number(cycle.salary);
  const dailyBudget = Number(cycle.daily_budget);
  const { start, end } = summary.cycle;
  const days = diffDays(start, end) + 1;
  const elapsed = Math.min(days, Math.max(1, diffDays(start, today) + 1));
  const credit = new Set([...cards.filter((c) => c.monthly_cap > 0).map((c) => c.id), ...(hist?.creditIds ?? [])]);
  const past = hist?.cycles ?? [];
  const prev = past.at(-1);
  const prevContiguous = prev && prev.ends_on === addDays(start, -1) ? prev : undefined;

  const inCycle = spends.filter((s) => s.spent_on >= start && s.spent_on <= end);
  const variance = planVsActual(planItems, settlements, goals, { budgetToDate: dailyBudget * elapsed, spent: summary.cycle.spent });
  const month = monthSummary(salary, dailyBudget * days, planItems, settlements);
  const left = moneyLeft(salary, planItems, settlements, goals, summary.cycle.spent);
  // Today's spending for the daily share: money back today adds to what's left instead.
  const todayGross = inCycle.filter((s) => s.spent_on === today && isDailyType(s) && s.amount > 0).reduce((t, s) => t + Number(s.amount), 0);
  const plans = pacePlans(left.left, todayGross, summary.cycle.daysLeft);

  // Every limit gone over this month, with what's behind it (net of money back).
  const sumBy = (list: typeof inCycle, key: (s: (typeof inCycle)[number]) => string | null) =>
    list.reduce<Record<string, number>>((acc, s) => {
      const k = key(s);
      if (k) acc[k] = (acc[k] ?? 0) + Number(s.amount);
      return acc;
    }, {});
  const over = overLimits({
    funds: goals,
    fundSpent: sumBy(inCycle.filter((s) => !isDailyType(s)), (s) => s.goal_id ?? null),
    cards,
    cardSpent: sumBy(inCycle, (s) => s.card_id),
    daily: { spent: summary.cycle.spent, budgetToDate: dailyBudget * elapsed },
    bills: planItems
      .filter((i) => (i.kind === "loan" || i.kind === "fixed") && i.actual != null)
      .map((i) => ({ name: i.name, planned: Number(i.planned), actual: Number(i.actual) })),
  });

  const pastRates = past.slice(-5).map((c) => (c.salary > 0 ? salaryUtilisation(c.salary, 0, 0, c.items, c.settlements, goals).saved / c.salary : 0));
  const savedRow = variance.find((r) => r.key === "saved");
  const savedPlan = savedRow?.plan ?? 0;
  const target = savingsTarget(pastRates, salary > 0 ? savedPlan / salary : 0);
  // Savings net of any shortfall: if this salary ran short, the gap comes out of what was saved.
  const saved = left.rows.find((r) => r.key === "saved")!.amount;
  const netSaved = Math.max(0, saved - Math.max(0, -left.left));
  const rate = salary > 0 ? netSaved / salary : 0;
  // Everything on credit cards this cycle (any type): the bill the next salary pays.
  const onCards = inCycle.filter((s) => !!s.card_id && credit.has(s.card_id)).reduce((t, s) => t + Number(s.amount), 0);

  // Same point last cycle: card spends and categories over the first `elapsed` days.
  const prevSameDay = prevContiguous?.spends.filter((s) => s.spent_on <= addDays(prevContiguous.starts_on, elapsed - 1));
  const catName = (id: string | null) => {
    const c = categories.find((x) => x.id === id);
    return c ? `${c.icon ?? ""} ${c.name}`.trim() : "Uncategorised";
  };
  const byCat = (list: { amount: number; category_id: string | null; spend_type?: string }[]) => {
    const m = new Map<string, number>();
    list.filter(isDailyType).forEach((s) => m.set(catName(s.category_id), (m.get(catName(s.category_id)) ?? 0) + Number(s.amount)));
    return m;
  };
  const catsNow = byCat(inCycle);
  const catsBefore = prevSameDay ? byCat(prevSameDay) : null;
  const categoryUp = catsBefore
    ? ([...catsNow].map(([name, v]) => ({ name, now: v, before: catsBefore.get(name) ?? 0 })).sort((a, b) => b.now - b.before - (a.now - a.before))[0] ?? null)
    : null;
  const top = [...catsNow].sort((a, b) => b[1] - a[1])[0];

  const nudges = coachNudges({
    salary,
    saved: netSaved,
    savedPlan,
    target,
    pastRates,
    // Money "with no job": unplanned salary beyond what the daily budget still needs, after any fund overspend.
    unallocated: month.result - left.rows.find((r) => r.key === "overspent")!.amount,
    daily: { dailyBudget, budgetToDate: dailyBudget * elapsed, spent: summary.cycle.spent, daysLeft: summary.cycle.daysLeft, budget: summary.cycle.budget },
    overPlan: month.variances.filter((v) => v.diff > 0 && ["loan", "fixed"].includes(planItems.find((i) => i.name === v.name)?.kind ?? "")),
    nextCardBill: onCards,
    overspentFunds: left.overspent,
    lastCardBillSameDay: prevSameDay ? onCardDaily(prevSameDay, credit) : null,
    categoryUp,
    topCategory: top ? { name: top[0], amount: top[1] } : null,
    lastCycle: prevContiguous
      ? { dailySpent: total(prevContiguous.spends.filter(isDailyType)), days: diffDays(prevContiguous.starts_on, prevContiguous.ends_on) + 1, dailyBudget: prevContiguous.daily_budget }
      : null,
    // Salary has landed (cycle not rolled yet), or the first days of a cycle with savings still to move.
    salaryDay: salaryPromptDue(cycle.starts_on, today) || (elapsed <= 3 && planItems.some((i) => i.kind === "savings" && !i.done)),
  });

  return {
    cycleId: cycle.id,
    salary,
    start,
    end,
    days,
    elapsed,
    nextSalaryOn: addDays(end, 1),
    daysLeft: summary.cycle.daysLeft,
    todaySpent: todayGross,
    /** what's left of this salary until salary day, and how it was used */
    left,
    /** save half / a quarter / nothing of what's left, per day */
    plans,
    /** limits gone over this month, biggest first */
    over,
    budgetToDate: dailyBudget * elapsed,
    /** saved & invested from this salary, and the same net of any shortfall */
    saved,
    netSaved,
    nextCardBill: onCards,
    rate,
    lastRate: pastRates.at(-1) ?? null,
    target,
    nudges,
  };
}
