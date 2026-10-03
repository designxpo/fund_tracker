// Loan payoff maths. Pure, no imports.
// months to close: n = -ln(1 - P·r/A) / ln(1 + r), with r = annual/12, A = EMI + extra.

export type Projection = { months: number; interest: number; feasible: boolean };

export function project(P: number, annualRate: number, emi: number, extra = 0): Projection {
  const A = emi + extra;
  const r = annualRate / 12;
  if (P <= 0) return { months: 0, interest: 0, feasible: true };
  if (r === 0) return A > 0 ? { months: P / A, interest: 0, feasible: true } : { months: Infinity, interest: Infinity, feasible: false };
  const x = (P * r) / A;
  if (A <= 0 || x >= 1) return { months: Infinity, interest: Infinity, feasible: false };
  const months = -Math.log(1 - x) / Math.log(1 + r);
  return { months, interest: A * months - P, feasible: true };
}

export function addMonthsISO(from: string, months: number): string {
  const [y, m, d] = from.split("-").map(Number);
  const dt = new Date(y, m - 1 + Math.ceil(months), d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
