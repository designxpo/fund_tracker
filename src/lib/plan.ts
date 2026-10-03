export type PlanItem = {
  id: string;
  cycle_id: string;
  name: string;
  kind: "loan" | "fixed" | "buffer" | "savings" | "prepayment" | "bills" | "unspent";
  goal_id: string | null;
  planned: number;
  actual: number | null;
  done: boolean;
};

export type Goal = { id: string; name: string; target: number | null; opening_balance: number };

export const amountOf = (i: Pick<PlanItem, "planned" | "actual">) => Number(i.actual ?? i.planned);

/** Salary-day checklist step (1-9) from the spec. */
export function stepOf(i: PlanItem, goals: Goal[]): number {
  switch (i.kind) {
    case "bills": return 1;
    case "loan": return 2;
    case "fixed": return 3;
    case "buffer": return 4;
    case "prepayment": return 8;
    case "unspent": return 9;
    case "savings": {
      const g = goals.find((x) => x.id === i.goal_id)?.name;
      return g === "Emergency fund" ? 5 : g === "Trip fund" ? 6 : 7;
    }
  }
}

export const STEP_TITLES: Record<number, string> = {
  1: "Pay last cycle's card bills in full",
  2: "Keep EMIs in account",
  3: "Fixed costs",
  4: "Surprise buffer → separate account",
  5: "Emergency fund",
  6: "Trip fund",
  7: "Long-term investing",
  8: "Loan prepayment",
  9: "Move unspent daily budget → Trip fund",
};

export const normalizePlan = (r: Record<string, unknown>): PlanItem =>
  ({ ...r, planned: Number(r.planned), actual: r.actual == null ? null : Number(r.actual) }) as PlanItem;
