"use client";

import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { ok, useData } from "@/lib/use-data";
import { addDays, diffDays, salaryPromptDue } from "@/lib/budget";
import { monthSummary, planVsActual, salaryCashFlow, salaryUtilisation, type GoalKindRef, type MonthItem, type MonthSettlement } from "@/lib/month";
import { coachNudges, savingsTarget } from "@/lib/coach";

export type HistSpend = { amount: number; card_id: string | null; spend_type: string; category_id: string | null; spent_on: string };
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
    sb.from("cycles").select("id, starts_on, ends_on, salary, daily_budget").not("ends_on", "is", null).order("starts_on", { ascending: false }).limit(6).then(ok),
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
      sb.from("spends").select("amount, card_id, spend_type, category_id, spent_on").gte("spent_on", c.starts_on).lte("spent_on", c.ends_on).limit(5000).then(ok),
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
  return useData("money-history-v2", fetchHistory, cycleId);
}

type SpendLike = { amount: number; card_id: string | null; spend_type?: string };
const isDailyType = (s: { spend_type?: string }) => (s.spend_type ?? "daily") === "daily";
const total = (list: { amount: number }[]) => list.reduce((t, s) => t + Number(s.amount), 0);

/** Daily spends paid by credit card (on the card bill, paid from the next salary) vs by UPI/cash/debit. */
export function splitByCard(spends: SpendLike[], credit: Set<string>) {
  const daily = spends.filter(isDailyType);
  const onCard = daily.filter((s) => !!s.card_id && credit.has(s.card_id));
  return { card: total(onCard), cash: total(daily) - total(onCard) };
}

/** A closed cycle's numbers in the cash-flow view, given the cycle before it (for its card bill). */
export function pastFlow(c: PastCycle, before: PastCycle | undefined, credit: Set<string>, goals: GoalKindRef[]) {
  const bill = before && before.ends_on === addDays(c.starts_on, -1) ? splitByCard(before.spends, credit).card : 0;
  return salaryCashFlow(c.salary, c.items, c.settlements, goals, { cardBill: bill, cash: splitByCard(c.spends, credit).cash });
}

/** This cycle's money: cash flow, budget view, savings rate and coach nudges, shared by Home and Insights. */
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
  const now = splitByCard(inCycle, credit);
  const cardBill = prevContiguous ? splitByCard(prevContiguous.spends, credit).card : 0;
  const flow = salaryCashFlow(salary, planItems, settlements, goals, { cardBill, cash: now.cash });
  const util = salaryUtilisation(salary, dailyBudget * days, summary.cycle.spent, planItems, settlements, goals);
  const variance = planVsActual(planItems, settlements, goals, { budgetToDate: dailyBudget * elapsed, spent: summary.cycle.spent });
  const month = monthSummary(salary, dailyBudget * days, planItems, settlements);

  const pastRates = past.slice(-5).map((c, i, arr) => {
    const before = past[past.length - arr.length + i - 1];
    return c.salary > 0 ? pastFlow(c, before, credit, goals).saved / c.salary : 0;
  });
  const savedRow = variance.find((r) => r.key === "saved");
  const savedPlan = savedRow?.plan ?? 0;
  const target = savingsTarget(pastRates, salary > 0 ? savedPlan / salary : 0);
  const rate = salary > 0 ? flow.saved / salary : 0;

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
    saved: flow.saved,
    savedPlan,
    target,
    pastRates,
    unallocated: month.result,
    daily: { dailyBudget, budgetToDate: dailyBudget * elapsed, spent: summary.cycle.spent, daysLeft: summary.cycle.daysLeft, budget: summary.cycle.budget },
    overPlan: month.variances.filter((v) => v.diff > 0 && ["loan", "fixed"].includes(planItems.find((i) => i.name === v.name)?.kind ?? "")),
    nextCardBill: now.card,
    lastCardBillSameDay: prevSameDay ? splitByCard(prevSameDay, credit).card : null,
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
    flow,
    util,
    variance,
    cardBill,
    nextCardBill: now.card,
    rate,
    lastRate: pastRates.at(-1) ?? null,
    target,
    nudges,
    historyLoaded: !!hist,
  };
}
