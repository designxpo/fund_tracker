-- Goal planner + extra income.

alter table goals
  add column is_custom boolean not null default false,   -- user-created purchase goals (planner)
  add column icon text,
  add column target_date date,
  add column priority int not null default 2;              -- 1 high, 2 medium, 3 low

create table income (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  amount numeric not null check (amount > 0),
  source text not null,
  received_on date not null default current_date,
  recurring boolean not null default false,              -- expected again every month
  note text,
  created_at timestamptz default now()
);
create index income_user_date_idx on income (user_id, received_on desc);

alter table income enable row level security;
create policy income_select on income for select using (user_id = auth.uid());
create policy income_insert on income for insert with check (user_id = auth.uid());
create policy income_update on income for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy income_delete on income for delete using (user_id = auth.uid());

-- Deposits created by splitting an income entry disappear with it.
alter table goal_transactions add column income_id uuid references income on delete cascade;

-- Default split for extra income: [{"goal_id": "...", "pct": 50}, ...]
alter table settings add column income_split jsonb;
