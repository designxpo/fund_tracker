// Savings coach: savings-rate target, future value, and nudges toward saving more. Pure, no imports.

/** Assumed yearly return for "what this becomes" figures (illustrative, long-term equity-like). */
export const RETURN = 0.12;

const rs = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
/** ₹2.3 lakh / ₹1.2 crore for big future amounts. */
export const big = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(1)} crore` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} lakh` : rs(n));

/** What investing `monthly` every month for `years` grows to. */
export function futureValue(monthly: number, years: number, rate = RETURN): number {
  const r = rate / 12;
  const n = years * 12;
  return monthly * ((Math.pow(1 + r, n) - 1) / r);
}

/** What a one-time `amount` grows to in `years`. */
export const lumpValue = (amount: number, years: number, rate = RETURN) => amount * Math.pow(1 + rate, years);

/**
 * This cycle's savings-rate target: one point more than last cycle (small steps stick), at least 10%,
 * at most 60%. Without history: the plan's own rate, or 20%.
 */
export function savingsTarget(pastRates: number[], planRate: number): number {
  const last = pastRates.at(-1);
  const t = last == null ? Math.max(0.2, planRate) : last + 0.01;
  return Math.round(Math.min(0.6, Math.max(0.1, t)) * 100) / 100;
}

/** Cycles in a row (ending with the latest) whose savings rate held or grew vs the one before. */
export function savingsStreak(rates: number[]): number {
  let n = 0;
  for (let i = rates.length - 1; i > 0 && rates[i] >= rates[i - 1] - 0.0005; i--) n++;
  return n;
}

export type Nudge = { id: string; tone: "win" | "warn" | "tip"; title: string; body: string; href?: string; priority: number };

export type CoachInput = {
  salary: number;
  /** saved & invested this cycle, and what the plan said */
  saved: number;
  savedPlan: number;
  target: number;
  /** savings rates of closed cycles, oldest first */
  pastRates: number[];
  /** salary − plan − daily budget: > 0 means money with no job yet */
  unallocated: number;
  daily: { dailyBudget: number; budgetToDate: number; spent: number; daysLeft: number; budget: number };
  /** plan lines (not savings) that cost more than planned */
  overPlan: { name: string; diff: number }[];
  /** daily spends on credit cards this cycle (next salary pays them), and last cycle's by the same day */
  nextCardBill: number;
  lastCardBillSameDay: number | null;
  /** biggest category increase vs the same point last cycle */
  categoryUp: { name: string; now: number; before: number } | null;
  topCategory: { name: string; amount: number } | null;
  lastCycle: { dailySpent: number; days: number; dailyBudget: number } | null;
  salaryDay: boolean;
};

export function coachNudges(i: CoachInput): Nudge[] {
  const out: Nudge[] = [];
  const add = (n: Nudge) => out.push(n);
  const { daily } = i;

  if (i.salaryDay && i.savedPlan > 0)
    add({
      id: "pay-first",
      tone: "tip",
      priority: 100,
      title: "Salary day: pay yourself first",
      body: `Move ${rs(i.savedPlan)} into savings and investments today, before paying for anything else. Spend what's left, not the other way round.`,
      href: "/salary",
    });

  if (i.unallocated >= 500)
    add({
      id: "no-job",
      tone: "warn",
      priority: 90,
      title: `${rs(i.unallocated)} of this salary has no job yet`,
      body: `Money left idle in your account gets spent. Invest it now: in 10 years it could be ${big(lumpValue(i.unallocated, 10))}.`,
      href: "/salary",
    });

  if (i.savedPlan - i.saved >= 1)
    add({
      id: "saved-short",
      tone: "warn",
      priority: 85,
      title: `${rs(i.savedPlan - i.saved)} less saved than you planned`,
      body: "Top up your savings before any extra spending. Your future self is counting on this month too.",
      href: "/salary",
    });

  const over = daily.spent - daily.budgetToDate;
  if (over >= 100) {
    const perDay = daily.daysLeft > 0 ? Math.max(0, daily.budget - daily.spent) / daily.daysLeft : 0;
    add({
      id: "daily-over",
      tone: "warn",
      priority: 80,
      title: `Daily spending is ${rs(over)} over budget`,
      body: `${daily.daysLeft > 0 ? `Keep to ${rs(perDay)}/day for the last ${daily.daysLeft} days. ` : ""}Invested instead, that ${rs(over)} would grow to ${big(lumpValue(over, 10))} in 10 years.`,
    });
  } else if (-over >= 100)
    add({
      id: "daily-under",
      tone: "win",
      priority: 40,
      title: `${rs(-over)} under your daily budget 👏`,
      body: "Keep going. On Salary Day, move what's left to investments instead of letting it drift into spending.",
    });

  const up = i.categoryUp;
  if (up && up.now - up.before >= Math.max(500, up.before * 0.15))
    add({
      id: `cat-up-${up.name}`,
      tone: "warn",
      priority: 70,
      title: `${up.name} is up ${rs(up.now - up.before)} vs last month`,
      body: `${rs(up.now)} so far, against ${rs(up.before)} by the same day last month. Bringing it back frees ${rs(up.now - up.before)} to invest.`,
    });

  const creep = i.overPlan[0];
  if (creep && creep.diff >= 100)
    add({
      id: `creep-${creep.name}`,
      tone: "warn",
      priority: 65,
      title: `${creep.name} costs ${rs(creep.diff)} more than planned`,
      body: `A cost that creeps up costs you every month. ${rs(creep.diff)}/month invested instead = ${big(futureValue(creep.diff, 10))} in 10 years.`,
      href: "/salary",
    });

  if (i.nextCardBill > 0) {
    const rising = i.lastCardBillSameDay != null && i.nextCardBill > i.lastCardBillSameDay * 1.1;
    add({
      id: "next-bill",
      tone: rising ? "warn" : "tip",
      priority: rising ? 75 : 30,
      title: `${rs(i.nextCardBill)} of next salary is already spent`,
      body: `That's your credit card spending this cycle; next salary pays it first.${
        i.lastCardBillSameDay != null ? ` Last month by this day: ${rs(i.lastCardBillSameDay)}.` : ""
      } Every ₹1,000 less on cards is ₹1,000 more to invest next month.`,
    });
  }

  const lc = i.lastCycle;
  if (lc && lc.days > 0 && lc.dailyBudget > 0) {
    const avg = lc.dailySpent / lc.days;
    const suggested = Math.ceil(avg / 50) * 50;
    const monthly = (daily.dailyBudget - suggested) * 30;
    if (avg < lc.dailyBudget * 0.9 && monthly >= 1000)
      add({
        id: "lower-daily",
        tone: "tip",
        priority: 55,
        title: `Lower your daily budget to ${rs(suggested)}?`,
        body: `Last month you spent ${rs(avg)}/day on a ${rs(lc.dailyBudget)} budget. Lock in the habit and invest the difference: about ${rs(monthly)} a month = ${big(futureValue(monthly, 10))} in 10 years.`,
        href: "/more/settings",
      });
  }

  if (i.topCategory && i.topCategory.amount >= 1000) {
    const cut = Math.round((i.topCategory.amount * 0.1) / 100) * 100;
    add({
      id: `challenge-${i.topCategory.name}`,
      tone: "tip",
      priority: 50,
      title: `Challenge: 10% less on ${i.topCategory.name}`,
      body: `Your biggest daily category so far (${rs(i.topCategory.amount)}). Cutting ${rs(cut)} a month and investing it = ${big(futureValue(cut, 10))} in 10 years.`,
    });
  }

  const rate = i.salary > 0 ? i.saved / i.salary : 0;
  if (i.salary > 0 && rate >= i.target)
    add({
      id: "target-hit",
      tone: "win",
      priority: 45,
      title: `You hit your ${Math.round(i.target * 100)}% savings target 🎯`,
      body: `${rs(i.saved)} working for you this month. Next month the target steps up by one point.`,
    });

  const streak = savingsStreak(i.pastRates);
  if (streak >= 2)
    add({
      id: "streak",
      tone: "win",
      priority: 42,
      title: `${streak} months in a row of steady or growing savings`,
      body: `Don't break the streak: save at least ${Math.round((i.pastRates.at(-1) ?? 0) * 100)}% this month.`,
    });

  return out.sort((a, b) => b.priority - a.priority);
}
