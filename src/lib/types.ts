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
};

export type Cycle = {
  id: string;
  starts_on: string;
  ends_on: string | null;
  salary: number;
  daily_budget: number;
};

export type Settings = { birthday: string | null; birthday_card_id: string | null };
