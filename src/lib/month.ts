// Month (salary cycle) maths: plan vs actual, leftover/shortfall, and where the salary went. Pure, no imports.

export type MonthItem = { name: string; kind: string; planned: number; actual: number | null; goal_id: string | null };
/** Leftover (+) moved to a goal/loan, or shortfall (−) borrowed from a goal, this cycle. */
export type MonthSettlement = { kind: string; amount: number; goal_id: string | null };

const amountOf = (i: MonthItem) => Number(i.actual ?? i.planned);
const isMove = (s: MonthSettlement) => s.kind === "leftover" || s.kind === "borrow";

export type MonthSummary = {
  salary: number;
  plannedTotal: number;    // what the plan said
  actualTotal: number;     // what was actually entered (falls back to planned)
  dailyReserve: number;    // daily budget × days in cycle
  adjustments: number;     // already moved (+) to goals or borrowed (−) from them
  /** > 0: money left over to move somewhere · < 0: shortfall to cover */
  result: number;
  variances: { name: string; diff: number }[]; // diff > 0 overspent, < 0 saved vs plan
};

export function monthSummary(salary: number, dailyReserve: number, items: MonthItem[], settlements: MonthSettlement[] = []): MonthSummary {
  const lines = items;
  const plannedTotal = lines.reduce((t, i) => t + Number(i.planned), 0);
  const actualTotal = lines.reduce((t, i) => t + amountOf(i), 0);
  const adjustments = settlements.filter(isMove).reduce((t, s) => t + Number(s.amount), 0);
  const variances = lines
    .filter((i) => i.actual != null && Number(i.actual) !== Number(i.planned))
    .map((i) => ({ name: i.name, diff: Number(i.actual) - Number(i.planned) }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return {
    salary,
    plannedTotal,
    actualTotal,
    dailyReserve,
    adjustments,
    result: salary - actualTotal - dailyReserve - adjustments,
    variances,
  };
}

/** Where a plan line goes: sinking funds and the Surprise buffer are money set aside to spend later. */
export type Bucket = "emis" | "fixed" | "saved" | "setAside";
export type GoalKindRef = { id: string; kind?: string | null };

export function bucketOf(i: { kind: string; goal_id: string | null }, goals: GoalKindRef[] = []): Bucket {
  if (i.kind === "loan" || i.kind === "prepayment") return "emis";
  if (i.kind === "fixed") return "fixed";
  if (i.kind === "buffer") return "setAside";
  const g = goals.find((x) => x.id === i.goal_id);
  return g?.kind === "sinking" || g?.kind === "buffer" ? "setAside" : "saved";
}

/** A leftover/borrow move counts in the bucket of where it went (no goal = loan prepayment). */
const moveBucket = (s: MonthSettlement, goals: GoalKindRef[]) => (s.goal_id ? bucketOf({ kind: "savings", goal_id: s.goal_id }, goals) : "emis");

export const BUCKET_LABELS: Record<Bucket | "daily", string> = {
  emis: "EMIs & loan",
  fixed: "Fixed costs",
  saved: "Saved & invested",
  setAside: "Set aside (funds & buffer)",
  daily: "Daily spending",
};

export type UtilRow = { key: Bucket | "daily" | "dailyLeft"; label: string; amount: number };

/** Where the salary is going this cycle, whatever the payment mode. */
export function salaryUtilisation(
  salary: number,
  dailyReserve: number,
  dailySpent: number,
  items: MonthItem[],
  settlements: MonthSettlement[] = [],
  goals: GoalKindRef[] = [],
) {
  const total = (b: Bucket) =>
    items.filter((i) => bucketOf(i, goals) === b).reduce((t, i) => t + amountOf(i), 0) +
    settlements.filter((s) => isMove(s) && moveBucket(s, goals) === b).reduce((t, s) => t + Number(s.amount), 0);
  const rows: UtilRow[] = [
    ...(["emis", "fixed", "saved", "setAside"] as const).map((key) => ({ key, label: BUCKET_LABELS[key], amount: total(key) })),
    { key: "daily", label: "Daily spending so far", amount: dailySpent },
    { key: "dailyLeft", label: "Daily budget still available", amount: Math.max(0, dailyReserve - dailySpent) },
  ];
  const used = rows.reduce((t, r) => t + r.amount, 0);
  const by = (k: UtilRow["key"]) => rows.find((r) => r.key === k)!.amount;
  return {
    rows,
    used,
    left: salary - used,
    /** money that has left for good: EMIs, fixed costs and daily spending */
    spent: by("emis") + by("fixed") + by("daily"),
    saved: by("saved"),
    setAside: by("setAside"),
  };
}

export type VarianceRow = {
  key: Bucket | "daily";
  label: string;
  plan: number;
  actual: number;
  /** savings: more than plan is good; spending: less than plan is good */
  moreIsBetter: boolean;
};

/**
 * Plan vs actual per bucket. Plan lines compare what Salary Day planned with what was entered
 * (leftover moves count as unplanned extra); daily spending compares against the budget up to today.
 */
export function planVsActual(
  items: MonthItem[],
  settlements: MonthSettlement[],
  goals: GoalKindRef[],
  daily: { budgetToDate: number; spent: number },
): VarianceRow[] {
  const rows: VarianceRow[] = (["emis", "fixed", "saved", "setAside"] as const).map((key) => {
    const lines = items.filter((i) => bucketOf(i, goals) === key);
    const moves = settlements.filter((s) => isMove(s) && moveBucket(s, goals) === key).reduce((t, s) => t + Number(s.amount), 0);
    return {
      key,
      label: BUCKET_LABELS[key],
      plan: lines.reduce((t, i) => t + Number(i.planned), 0),
      actual: lines.reduce((t, i) => t + amountOf(i), 0) + moves,
      moreIsBetter: key === "saved" || key === "setAside",
    };
  });
  rows.push({ key: "daily", label: BUCKET_LABELS.daily, plan: daily.budgetToDate, actual: daily.spent, moreIsBetter: false });
  return rows.filter((r) => r.plan !== 0 || r.actual !== 0);
}
