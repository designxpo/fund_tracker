import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, cycleEnd } from "@/lib/budget";
import { project } from "@/lib/loan";
import { addMonths, recurringExtra, simulate, type PlanLine, type PlannerInputs, type PlanTemplate } from "@/lib/planner";
import { ok } from "@/lib/use-data";
import type { Cycle } from "@/lib/types";

export type GoalRow = {
  id: string;
  name: string;
  role: string | null;
  target: number | null;
  opening_balance: number;
  is_custom: boolean;
  icon: string | null;
  target_date: string | null;
  priority: number;
  balance: number;
};

export type TemplateRow = PlanLine & { id: string; month: string };
export type IncomeRow = { id: string; amount: number; source: string; received_on: string; recurring: boolean; note: string | null };
export type PlanItemRow = PlanLine & { id: string; loan_id: string | null };
export type Split = { goal_id: string; pct: number }[];

/** Everything the planner screens need, plus a ready-made `inputs` for `simulate`. */
export async function loadPlanner(sb: SupabaseClient, cycle: Cycle, today: string) {
  const [goals, txs, items, tplRows, loans, income, settings] = await Promise.all([
    sb.from("goals").select("*").then(ok),
    sb.from("goal_transactions").select("goal_id, amount").then(ok),
    sb.from("plan_items").select("id, name, kind, planned, goal_id, loan_id").eq("cycle_id", cycle.id).then(ok),
    sb.from("plan_templates").select("id, month, name, kind, goal_id, planned, sort_order").order("month").order("sort_order").then(ok),
    sb.from("loan").select("*").limit(1).then(ok),
    sb.from("income").select("*").order("received_on", { ascending: false }).limit(200).then(ok),
    sb.from("settings").select("income_split").maybeSingle().then(ok),
  ]);

  const txSum = new Map<string, number>();
  (txs as { goal_id: string; amount: number }[]).forEach((t) => txSum.set(t.goal_id, (txSum.get(t.goal_id) ?? 0) + Number(t.amount)));

  const goalRows: GoalRow[] = (goals as Record<string, unknown>[]).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    role: (g.role as string) ?? null,
    target: g.target == null ? null : Number(g.target),
    opening_balance: Number(g.opening_balance ?? 0),
    is_custom: Boolean(g.is_custom),
    icon: (g.icon as string) ?? null,
    target_date: (g.target_date as string) ?? null,
    priority: Number(g.priority ?? 2),
    balance: Number(g.opening_balance ?? 0) + (txSum.get(g.id as string) ?? 0),
  }));

  const lines: PlanItemRow[] = (items as Record<string, unknown>[]).map((i) => ({
    id: i.id as string,
    name: i.name as string,
    kind: i.kind as string,
    planned: Number(i.planned),
    goal_id: (i.goal_id as string) ?? null,
    loan_id: (i.loan_id as string) ?? null,
  }));
  // Month-specific plans, grouped by month ("YYYY-MM").
  const templateRows: TemplateRow[] = (tplRows as Record<string, unknown>[]).map((t) => ({
    id: t.id as string,
    month: String(t.month).slice(0, 7),
    name: t.name as string,
    kind: t.kind as string,
    goal_id: (t.goal_id as string) ?? null,
    planned: Number(t.planned),
  }));
  const templates: PlanTemplate[] = [...new Set(templateRows.map((t) => t.month))].map((month) => ({
    month,
    lines: templateRows.filter((t) => t.month === month),
  }));
  const incomeRows: IncomeRow[] = (income as IncomeRow[]).map((i) => ({ ...i, amount: Number(i.amount) }));

  // Projection starts at the next salary.
  const start = addDays(cycleEnd(cycle.starts_on, cycle.ends_on), 1).slice(0, 7);

  // Which plan lines belong to the loan (its EMI + prepayments), and when do they stop?
  // Close date comes from the loan inputs if filled in, else the original end date.
  const loan = (loans as Record<string, unknown>[])[0];
  // Plan lines linked to the loan (its EMI and prepayment) stop once it closes.
  const loanLines = lines.filter((l) => l.kind === "prepayment" || (l.kind === "loan" && l.loan_id)).map((l) => l.name);
  const prepayLines = lines.filter((l) => l.kind === "prepayment");
  let loanFreeFrom: string | null = null;
  if (loan) {
    const P = Number(loan.outstanding ?? 0);
    const rate = loan.annual_rate == null ? null : Number(loan.annual_rate);
    const prepay = Math.max(
      0,
      ...prepayLines.map((l) => l.planned),
      ...templateRows.filter((t) => t.kind === "prepayment").map((t) => t.planned),
    );
    const p = P > 0 && rate != null ? project(P, rate, Number(loan.emi), prepay) : null;
    loanFreeFrom = p?.feasible
      ? addMonths(start, Math.ceil(p.months))
      : loan.original_end
        ? addMonths(String(loan.original_end).slice(0, 7), 1)
        : null;
  }

  const extraMonthly = recurringExtra(incomeRows, today);

  const inputs: PlannerInputs = {
    start,
    cycleStart: cycle.starts_on,
    salary: Number(cycle.salary),
    dailyBudget: Number(cycle.daily_budget),
    extraMonthly,
    lines,
    templates,
    loanFreeFrom,
    loanLines,
  };

  const custom = goalRows.filter((g) => g.is_custom);
  const plannerGoals = custom.map((g) => ({ id: g.id, remaining: (g.target ?? 0) - g.balance, priority: g.priority, target_date: g.target_date }));

  return {
    inputs,
    goals: goalRows,
    custom,
    plannerGoals,
    results: simulate(inputs, plannerGoals),
    lines,
    templateRows,
    income: incomeRows,
    extraMonthly,
    split: ((settings as { income_split: Split | null } | null)?.income_split ?? null) as Split | null,
  };
}

export type PlannerData = Awaited<ReturnType<typeof loadPlanner>>;

export const GOAL_ICONS = ["📱", "💻", "🏍️", "🚗", "✈️", "🏠", "💍", "🎓", "🎮", "📷", "🎁", "🎯"];
export const PRIORITY = { 1: "High", 2: "Medium", 3: "Low" } as const;
