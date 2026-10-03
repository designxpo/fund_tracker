-- Daily Spend Tracker: schema, RLS, and first-login seed.
-- Never store card numbers, CVV or bank details: cards are nicknames only.

create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  nickname text not null,
  monthly_cap numeric not null default 0,
  statement_day int check (statement_day between 1 and 31),
  due_day int check (due_day between 1 and 31),
  sort_order int default 0,
  active boolean default true
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  name text not null,
  suggested_card_id uuid references cards on delete set null,
  -- if set, spends below `small_amount_limit` suggest this card instead
  small_card_id uuid references cards on delete set null,
  icon text,
  sort_order int default 0
);

create table spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  amount numeric not null check (amount > 0),
  category_id uuid references categories on delete set null,
  card_id uuid references cards on delete set null,
  note text,
  spent_on date not null default current_date,
  created_at timestamptz default now()
);
create index spends_user_date_idx on spends (user_id, spent_on desc);

create table cycles (              -- salary-to-salary periods
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  starts_on date not null,
  ends_on date,                    -- null = current cycle
  salary numeric not null,
  daily_budget numeric not null default 500
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  name text not null,              -- Emergency fund, Trip fund, Long-term invested, Surprise buffer
  target numeric,
  opening_balance numeric default 0
);

create table plan_items (          -- monthly plan per cycle
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  cycle_id uuid references cycles on delete cascade not null,
  name text not null,
  kind text not null check (kind in ('loan','fixed','buffer','savings','prepayment')),
  goal_id uuid references goals on delete set null,
  planned numeric not null,
  actual numeric,
  done boolean default false
);

create table goal_transactions (   -- deposits (+) and withdrawals (-)
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  goal_id uuid references goals on delete cascade not null,
  amount numeric not null,
  note text,
  happened_on date not null default current_date
);

create table loan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  name text default 'Loan',
  outstanding numeric,
  annual_rate numeric,             -- e.g. 0.18
  emi numeric default 0,
  emis_remaining int,
  prepay_charge_pct numeric default 0,
  original_end date               -- scheduled close date before any prepayment
);

create table loan_prepayments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  loan_id uuid references loan on delete cascade not null,
  amount numeric not null,
  paid_on date not null default current_date
);

-- Row Level Security: every table, every verb, own rows only.
do $$
declare t text;
begin
  foreach t in array array[
    'cards','categories','spends','cycles','goals',
    'plan_items','goal_transactions','loan','loan_prepayments'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format(
      'create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format(
      'create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format(
      'create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

-- seed_defaults() is defined in 0002.
