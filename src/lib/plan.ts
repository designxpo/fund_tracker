export type PlanItem = {
  id: string;
  cycle_id: string;
  name: string;
  kind: "loan" | "fixed" | "buffer" | "savings" | "prepayment";
  goal_id: string | null;
  planned: number;
  actual: number | null;
  done: boolean;
};

export type Goal = {
  id: string;
  name: string;
  target: number | null;
  opening_balance: number;
  kind?: "savings" | "sinking" | "buffer";
  role?: "emergency" | "trip" | "buffer" | "long_term" | null;
};

export const amountOf = (i: Pick<PlanItem, "planned" | "actual">) => Number(i.actual ?? i.planned);

/**
 * Salary-day checklist step. Steps 1 (card bills), 10 (daily-budget result) and 11 (leftover/borrowed)
 * come from cycle_settlements; plan lines map to 2–9.
 */
export function stepOf(i: { kind: string; goal_id: string | null }, goals: Pick<Goal, "id" | "kind" | "role">[]): number {
  switch (i.kind) {
    case "loan": return 2;
    case "fixed": return 3;
    case "buffer": return 5;
    case "prepayment": return 9;
    default: {
      const g = goals.find((x) => x.id === i.goal_id);
      if (g?.kind === "sinking") return 4;
      return g?.role === "emergency" ? 6 : g?.role === "trip" ? 7 : 8;
    }
  }
}

export const STEP_TITLES: Record<number, string> = {
  1: "Pay last cycle's card bills in full",
  2: "Keep EMIs in account",
  3: "Fixed costs",
  4: "Sinking funds",
  5: "Surprise buffer → separate account",
  6: "Emergency fund",
  7: "Trip fund",
  8: "Long-term investing",
  9: "Loan prepayment",
  10: "Last cycle's daily budget: move what's left / cover the overspend",
  11: "This month's leftover / borrowed",
};

export const normalizePlan = (r: Record<string, unknown>): PlanItem =>
  ({ ...r, planned: Number(r.planned), actual: r.actual == null ? null : Number(r.actual) }) as PlanItem;
