// Budget alerts for day / week / cycle, plus a cycle pace projection. Pure, no imports.

export type Alert = { scope: "day" | "week" | "cycle" | "pace"; level: "warn" | "over"; text: string };

type Range = { budget: number; spent: number; left: number; daysLeft: number; start: string; end: string };
export type AlertInput = { todaySpent: number; leftToday: number; week: Range; cycle: Range };

export const WARN_AT = 0.8;
const fmt = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;

const dayDiff = (a: string, b: string) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

/** Per-day allowance for the rest of a range, counting from tomorrow. */
const perDayAfterToday = (r: Range) => (r.daysLeft > 1 ? Math.max(0, r.left) / (r.daysLeft - 1) : null);

export function budgetAlerts(s: AlertInput, daily: number, today: string): Alert[] {
  const out: Alert[] = [];

  // Day
  if (s.leftToday < 0) out.push({ scope: "day", level: "over", text: `${fmt(s.leftToday)} over today's budget` });
  else if (daily > 0 && s.todaySpent >= daily * WARN_AT)
    out.push({ scope: "day", level: "warn", text: `${Math.round((s.todaySpent / daily) * 100)}% of today's budget used · ${fmt(s.leftToday)} left` });

  // Week
  const wk = s.week;
  if (wk.left < 0) out.push({ scope: "week", level: "over", text: `${fmt(wk.left)} over this week's budget` });
  else if (wk.budget > 0 && wk.spent >= wk.budget * WARN_AT) {
    const per = perDayAfterToday(wk);
    out.push({
      scope: "week",
      level: "warn",
      text: `${Math.round((wk.spent / wk.budget) * 100)}% of this week used · ${fmt(wk.left)} left${per != null ? ` (${fmt(per)}/day for ${wk.daysLeft - 1} more days)` : ""}`,
    });
  }

  // Cycle
  const cy = s.cycle;
  if (cy.left < 0) out.push({ scope: "cycle", level: "over", text: `${fmt(cy.left)} over this cycle's budget` });
  else if (cy.budget > 0 && cy.spent >= cy.budget * WARN_AT)
    out.push({ scope: "cycle", level: "warn", text: `${Math.round((cy.spent / cy.budget) * 100)}% of this cycle used · ${fmt(cy.left)} left for ${cy.daysLeft} days` });
  else {
    // Pace: project the average daily spend so far over the whole cycle (needs a few days of data).
    const elapsed = dayDiff(cy.start, today) + 1;
    const total = dayDiff(cy.start, cy.end) + 1;
    if (elapsed >= 3 && elapsed < total) {
      const projected = (cy.spent / elapsed) * total;
      if (projected > cy.budget) {
        const spentBeforeToday = cy.spent - s.todaySpent;
        const allowance = Math.max(0, cy.budget - spentBeforeToday) / cy.daysLeft;
        out.push({
          scope: "pace",
          level: "warn",
          text: `At this pace you'll overshoot this cycle by ${fmt(projected - cy.budget)}. Keep to ${fmt(allowance)}/day to finish on budget.`,
        });
      }
    }
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "over" ? -1 : 1));
}

/** What a not-yet-saved spend would do, for Quick Add. Returns the most severe crossing, or the room left today. */
export function spendImpact(before: AlertInput, after: AlertInput) {
  const crossed: string[] = [];
  if (after.leftToday < 0) crossed.push(`${fmt(after.leftToday)} over today`);
  if (after.week.left < 0) crossed.push(`${fmt(after.week.left)} over this week`);
  if (after.cycle.left < 0) crossed.push(`${fmt(after.cycle.left)} over this cycle`);
  if (crossed.length) return { level: "over" as const, text: `Puts you ${crossed.join(" · ")}` };
  if (after.leftToday < before.leftToday) return { level: "ok" as const, text: `${fmt(after.leftToday)} left today after this` };
  return null;
}
