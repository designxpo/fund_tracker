// Pure date + budget maths. No imports so it can be unit-tested directly.

const pad = (n: number) => String(n).padStart(2, "0");

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const todayStr = () => ymd(new Date());

export const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/** b - a in whole days (DST-safe). */
export const diffDays = (a: string, b: string) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

/** Inclusive last day of a cycle. Open cycles run one month from their start. */
export function cycleEnd(startsOn: string, endsOn: string | null): string {
  if (endsOn) return endsOn;
  const [y, m, d] = startsOn.split("-").map(Number);
  const dim = new Date(y, m + 1, 0).getDate(); // days in the following month
  return addDays(ymd(new Date(y, m, Math.min(d, dim))), -1);
}

type SpendLike = { amount: number; spent_on: string; card_id?: string | null };

export const sumBetween = (spends: SpendLike[], from: string, to: string, cardId?: string) =>
  spends.reduce(
    (t, s) =>
      s.spent_on >= from && s.spent_on <= to && (cardId === undefined || s.card_id === cardId)
        ? t + Number(s.amount)
        : t,
    0,
  );

export type Summary = {
  todaySpent: number;
  leftToday: number;
  week: { start: string; end: string; budget: number; spent: number; left: number; daysLeft: number };
  cycle: { start: string; end: string; budget: number; spent: number; left: number; daysLeft: number };
};

export function summarize(
  spends: SpendLike[],
  cycle: { starts_on: string; ends_on: string | null; daily_budget: number },
  today: string,
): Summary {
  const daily = Number(cycle.daily_budget);
  const start = cycle.starts_on;
  const end = cycleEnd(start, cycle.ends_on);

  const todaySpent = sumBetween(spends, today, today);

  // Weeks run in 7-day blocks from the cycle start; the last block may be shorter.
  const idx = Math.max(0, Math.floor(diffDays(start, today) / 7));
  const wStart = addDays(start, idx * 7);
  const wEndFull = addDays(wStart, 6);
  const wEnd = wEndFull > end && today <= end ? end : wEndFull;
  const wBudget = daily * (diffDays(wStart, wEnd) + 1);
  const wSpent = sumBetween(spends, wStart, wEnd);

  const cBudget = daily * (diffDays(start, end) + 1);
  const cSpent = sumBetween(spends, start, end);

  return {
    todaySpent,
    leftToday: daily - todaySpent,
    week: {
      start: wStart,
      end: wEnd,
      budget: wBudget,
      spent: wSpent,
      left: wBudget - wSpent,
      daysLeft: Math.max(0, diffDays(today, wEnd) + 1),
    },
    cycle: {
      start,
      end,
      budget: cBudget,
      spent: cSpent,
      left: cBudget - cSpent,
      daysLeft: Math.max(0, diffDays(today, end) + 1),
    },
  };
}

export type CapLevel = "ok" | "amber" | "red";
export function capLevel(spent: number, cap: number): CapLevel {
  if (cap <= 0) return "ok";
  const r = spent / cap;
  return r >= 1 ? "red" : r >= 0.8 ? "amber" : "ok";
}

export const SMALL_AMOUNT_LIMIT = 200;

/** Birthday ±1 day (month/day only, year ignored). */
export function isBirthdayWindow(birthday: string | null | undefined, today: string): boolean {
  if (!birthday) return false;
  const [, bm, bd] = birthday.split("-").map(Number);
  const t = parseYmd(today);
  return [-1, 0, 1].some((off) => {
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + off);
    return d.getMonth() + 1 === bm && d.getDate() === bd;
  });
}

export function suggestCardId(
  category: { suggested_card_id: string | null; small_card_id: string | null } | undefined,
  amount: number,
  birthdayCardId?: string | null,
): string | null {
  if (!category) return null;
  if (birthdayCardId) return birthdayCardId;
  if (category.small_card_id && amount > 0 && amount < SMALL_AMOUNT_LIMIT) return category.small_card_id;
  return category.suggested_card_id;
}

export const ordinal = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
};

/** Cards whose bill is due within `within` days (today included). */
export function billsDueSoon(
  cards: { nickname: string; due_day: number | null }[],
  today: string,
  within = 3,
) {
  const [y, m] = today.split("-").map(Number);
  const out: { nickname: string; day: number; inDays: number }[] = [];
  for (const c of cards) {
    if (!c.due_day) continue;
    const dim = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
    let due = ymd(new Date(y, m - 1, Math.min(c.due_day, dim(y, m))));
    if (due < today) due = ymd(new Date(y, m, Math.min(c.due_day, dim(y, m + 1))));
    const inDays = diffDays(today, due);
    if (inDays >= 0 && inDays <= within) out.push({ nickname: c.nickname, day: c.due_day, inDays });
  }
  return out;
}

/** True when it's salary window (day 1–3) but the open cycle still started in an earlier month. */
export function salaryPromptDue(cycleStart: string, today: string): boolean {
  const day = Number(today.slice(8, 10));
  return day >= 1 && day <= 3 && cycleStart.slice(0, 7) < today.slice(0, 7);
}
