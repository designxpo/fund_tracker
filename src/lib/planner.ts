// Month-by-month goal planner. Pure, no imports, so it can be unit-tested directly.
//
// Free money each month = salary + recurring extra income − daily spending − plan commitments.
// Commitments follow month-specific plan templates and drop the loan's lines once it closes.
// Custom goals receive their own committed plan lines, then free money in priority order.

export type YM = string; // "YYYY-MM"

export type PlanLine = { name: string; kind: string; planned: number; goal_id: string | null };
/** A month's plan; applies from `month` until a later template takes over. */
export type PlanTemplate = { month: YM; lines: PlanLine[] };

export type PlannerInputs = {
  start: YM;                    // first month to project (the next salary)
  cycleStart: string;           // current cycle start; only templates for later months are "scheduled"
  salary: number;
  dailyBudget: number;
  extraMonthly: number;         // recurring extra income
  lines: PlanLine[];            // the current cycle's plan
  templates: PlanTemplate[];
  loanFreeFrom: YM | null;      // first month with no loan EMI/prepayment
  loanLines: string[];          // plan lines that stop when the loan closes
};

export type PlannerGoal = { id: string; remaining: number; priority: number; target_date: string | null };

export type GoalResult = { readyBy: YM | null; months: number | null; needPerMonth: number | null };

export const HORIZON = 240;
const DAYS_PER_MONTH = 365 / 12;

export const addMonths = (ym: YM, n: number): YM => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const monthsBetween = (a: YM, b: YM) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};

export const ymLabel = (ym: YM) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

/** The plan in force in month `ym`: the latest template that starts after the current cycle, else the current plan. */
export function linesFor(ym: YM, inp: PlannerInputs): PlanLine[] {
  const cycleMonth = inp.cycleStart.slice(0, 7);
  const t = inp.templates
    .filter((x) => x.month > cycleMonth && x.month <= ym)
    .sort((a, b) => (a.month < b.month ? 1 : -1))[0];
  return t ? t.lines : inp.lines;
}

export function lineAmount(line: PlanLine, ym: YM, inp: PlannerInputs): number {
  if (inp.loanFreeFrom && inp.loanLines.includes(line.name) && ym >= inp.loanFreeFrom) return 0;
  return line.planned;
}

const isCommitment = (l: PlanLine) => l.kind !== "bills" && l.kind !== "unspent" && l.kind !== "adjustment";

export function commitments(ym: YM, inp: PlannerInputs) {
  return linesFor(ym, inp).filter(isCommitment).reduce((s, l) => s + lineAmount(l, ym, inp), 0);
}

export function freeMoney(ym: YM, inp: PlannerInputs) {
  return inp.salary + inp.extraMonthly - inp.dailyBudget * DAYS_PER_MONTH - commitments(ym, inp);
}

export function simulate(inp: PlannerInputs, goals: PlannerGoal[]): Record<string, GoalResult> {
  const order = [...goals].sort((a, b) => a.priority - b.priority || (a.target_date ?? "9999") .localeCompare(b.target_date ?? "9999"));
  const left = new Map(order.map((g) => [g.id, Math.max(0, g.remaining)]));
  const done = new Map<string, YM>();
  order.forEach((g) => left.get(g.id)! <= 0 && done.set(g.id, addMonths(inp.start, -1)));

  for (let i = 0; i < HORIZON && done.size < order.length; i++) {
    const ym = addMonths(inp.start, i);
    let pool = Math.max(0, freeMoney(ym, inp));
    for (const g of order) {
      if (done.has(g.id)) continue;
      const own = linesFor(ym, inp).filter((l) => l.goal_id === g.id).reduce((s, l) => s + lineAmount(l, ym, inp), 0);
      left.set(g.id, left.get(g.id)! - own);
    }
    for (const g of order) {
      if (done.has(g.id)) continue;
      const give = Math.min(pool, Math.max(0, left.get(g.id)!));
      pool -= give;
      left.set(g.id, left.get(g.id)! - give);
      if (left.get(g.id)! <= 0.005) done.set(g.id, ym);
    }
  }

  const out: Record<string, GoalResult> = {};
  for (const g of order) {
    const readyBy = done.get(g.id) ?? null;
    let needPerMonth: number | null = null;
    if (g.target_date) {
      const n = monthsBetween(inp.start, g.target_date.slice(0, 7)) + 1;
      needPerMonth = n > 0 ? Math.max(0, g.remaining) / n : Infinity;
    }
    out[g.id] = { readyBy, months: readyBy ? monthsBetween(inp.start, readyBy) + 1 : null, needPerMonth };
  }
  return out;
}

/** Standard reducing-balance EMI. */
export function emiFor(principal: number, annualRate: number, months: number) {
  if (principal <= 0 || months <= 0) return { emi: 0, interest: 0 };
  const r = annualRate / 12;
  const emi = r === 0 ? principal / months : (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
  return { emi, interest: emi * months - principal };
}

/** Expected monthly extra income: latest amount per recurring source, if seen in the last ~2 months. */
export function recurringExtra(
  income: { amount: number; source: string; received_on: string; recurring: boolean }[],
  today: string,
) {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 62);
  const iso = cutoff.toISOString().slice(0, 10);
  const latest = new Map<string, { amount: number; received_on: string }>();
  for (const i of income) {
    if (!i.recurring || i.received_on < iso) continue;
    const key = i.source.trim().toLowerCase();
    const cur = latest.get(key);
    if (!cur || i.received_on > cur.received_on) latest.set(key, i);
  }
  return [...latest.values()].reduce((s, i) => s + Number(i.amount), 0);
}
