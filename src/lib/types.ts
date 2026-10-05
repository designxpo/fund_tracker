export type Card = {
  id: string;
  nickname: string;
  monthly_cap: number;
  statement_day: number | null;
  due_day: number | null;
  sort_order: number;
  active: boolean;
};

export type Category = {
  id: string;
  name: string;
  icon: string | null;
  suggested_card_id: string | null;
  small_card_id: string | null;
  sort_order: number;
};

export type Spend = {
  id: string;
  amount: number;
  category_id: string | null;
  card_id: string | null;
  note: string | null;
  spent_on: string; // YYYY-MM-DD, device-local date
  created_at: string;
  /** daily = counts toward the daily/weekly budget and card caps; planned = paid from a sinking fund;
   *  unplanned = paid from the Surprise buffer. Missing on old cached rows → treat as daily. */
  spend_type?: SpendType;
  goal_id?: string | null;
  /** planned/unplanned only: "now" takes it from the fund immediately; "bill" waits until the card bill is paid. */
  fund_settle?: FundSettle;
  fund_settled_on?: string | null;
};

export type FundSettle = "now" | "bill";
/** A planned/unplanned spend whose fund hasn't paid yet (it's on the card bill). */
export const isOwed = (s: Spend) => !isDaily(s) && !!s.goal_id && s.fund_settle === "bill";

export type SpendType = "daily" | "planned" | "unplanned";
export const isDaily = (s: { spend_type?: SpendType }) => (s.spend_type ?? "daily") === "daily";

export type GoalKind = "savings" | "sinking" | "buffer";
export type StoreGoal = {
  id: string;
  name: string;
  kind: GoalKind;
  is_custom: boolean;
  target: number | null;
  monthly_contribution: number | null;
  cycle_months: number | null;
  next_due_date: string | null;
  /** opening balance + all goal transactions, as last seen from the server */
  serverBalance: number;
  /** serverBalance adjusted for planned/unplanned spends still waiting to sync */
  balance: number;
  /** planned/unplanned card spends this fund will pay when the card bill is settled */
  owed: number;
  /** balance − owed: what's really free in the fund */
  available: number;
};

export type StorePlanItem = {
  id: string;
  name: string;
  kind: string;
  goal_id: string | null;
  planned: number;
  actual: number | null;
  done: boolean;
};

export type Cycle = {
  id: string;
  starts_on: string;
  ends_on: string | null;
  salary: number;
  daily_budget: number;
};

export type Settings = { birthday: string | null; birthday_card_id: string | null };
