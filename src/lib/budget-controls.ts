export type BudgetLine = {
  id: string; name: string; kind: string; goal_id: string | null; loan_id?: string | null;
  planned: number; actual?: number | null; done?: boolean;
};

export function budgetTotals(salary: number, daily: number, days: number, items: BudgetLine[]) {
  const commitments = items.reduce((total, item) => total + item.planned, 0);
  const spending = Math.round(daily * days * 100) / 100;
  return { commitments, spending, total: commitments + spending, remaining: salary - commitments - spending,
    affordableDaily: Math.max(0, Math.floor((salary - commitments) / days)) };
}

export function moneyValue(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter an amount of zero or more, with up to two decimal places.");
  const number = Number(value);
  if (!Number.isFinite(number) || number > 100_000_000) throw new Error("Enter an amount below ₹10 crore.");
  return number;
}

export function capUsage(cap: number, spent: number) {
  return { remaining: cap - spent, percent: cap > 0 ? Math.max(0, Math.min(100, spent / cap * 100)) : spent > 0 ? 100 : 0 };
}
