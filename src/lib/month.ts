// Month (salary cycle) maths: plan vs actual, leftover/shortfall, and where the salary went. Pure, no imports.

export type MonthItem = { name: string; kind: string; planned: number; actual: number | null; goal_id: string | null };

const amountOf = (i: MonthItem) => Number(i.actual ?? i.planned);
const isPlanLine = (i: MonthItem) => i.kind !== "bills" && i.kind !== "unspent" && i.kind !== "adjustment";

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

export function monthSummary(salary: number, dailyReserve: number, items: MonthItem[]): MonthSummary {
  const lines = items.filter(isPlanLine);
  const plannedTotal = lines.reduce((t, i) => t + Number(i.planned), 0);
  const actualTotal = lines.reduce((t, i) => t + amountOf(i), 0);
  const adjustments = items.filter((i) => i.kind === "adjustment").reduce((t, i) => t + Number(i.planned), 0);
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

export type UtilRow = { key: string; label: string; amount: number };

/** Where the salary is going this cycle, whatever the payment mode. */
export function salaryUtilisation(salary: number, dailyReserve: number, dailySpent: number, items: MonthItem[]) {
  const sum = (f: (i: MonthItem) => boolean) => items.filter(f).reduce((t, i) => t + amountOf(i), 0);
  const emis = sum((i) => i.kind === "loan" || i.kind === "prepayment" || (i.kind === "adjustment" && !i.goal_id));
  const fixed = sum((i) => i.kind === "fixed");
  const saved = sum((i) => i.kind === "savings" || i.kind === "buffer" || (i.kind === "adjustment" && !!i.goal_id));
  const dailyLeft = Math.max(0, dailyReserve - dailySpent);
  const rows: UtilRow[] = [
    { key: "emis", label: "EMIs & loan", amount: emis },
    { key: "fixed", label: "Fixed costs", amount: fixed },
    { key: "saved", label: "Saved & invested", amount: saved },
    { key: "daily", label: "Daily spending so far", amount: dailySpent },
    { key: "dailyLeft", label: "Daily budget still available", amount: dailyLeft },
  ];
  const used = rows.reduce((t, r) => t + r.amount, 0);
  return { rows, used, left: salary - used };
}
