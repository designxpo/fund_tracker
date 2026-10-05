-- Spend types (daily / planned / unplanned), sinking funds, month-specific plans.
-- Keeps existing data: existing spends become 'daily'.

-- 1. Spend types --------------------------------------------------------------
alter table spends
  add column spend_type text not null default 'daily' check (spend_type in ('daily', 'planned', 'unplanned')),
  add column goal_id uuid references goals on delete set null;
-- planned/unplanned spends must say which fund pays for them
alter table spends add constraint spends_goal_required check (spend_type = 'daily' or goal_id is not null);

-- 2. Goal kinds + sinking-fund fields -------------------------------------------
alter table goals
  add column kind text not null default 'savings' check (kind in ('savings', 'sinking', 'buffer')),
  add column monthly_contribution numeric,
  add column cycle_months int check (cycle_months > 0),
  add column next_due_date date;
update goals set kind = 'buffer' where name = 'Surprise buffer';

-- Withdrawals created by a spend disappear with it (edit/delete re-syncs them).
alter table goal_transactions add column spend_id uuid references spends on delete cascade;
create index goal_tx_spend_idx on goal_transactions (spend_id);

-- 3. Month-specific plans -------------------------------------------------------
-- A template applies from its month until a later template takes over.
create table plan_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  month date not null check (extract(day from month) = 1),
  name text not null,
  kind text not null check (kind in ('loan','fixed','buffer','savings','prepayment')),
  goal_id uuid references goals on delete set null,
  planned numeric not null default 0,
  sort_order int not null default 0
);
create index plan_templates_user_month_idx on plan_templates (user_id, month);

alter table plan_templates enable row level security;
create policy plan_templates_select on plan_templates for select using (user_id = auth.uid());
create policy plan_templates_insert on plan_templates for insert with check (user_id = auth.uid());
create policy plan_templates_update on plan_templates for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy plan_templates_delete on plan_templates for delete using (user_id = auth.uid());

-- 4. Spend → fund sync ------------------------------------------------------------
-- Runs for every write (including offline spends synced later via upsert):
--  * planned/unplanned spends withdraw their amount from goal_id
--  * a planned spend against a sinking fund moves its next_due_date forward by cycle_months
--    (and back again if the spend is deleted or re-pointed)
create or replace function spend_goal_sync() returns trigger
language plpgsql set search_path = public as $$
declare
  old_sink uuid;
  new_sink uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from goal_transactions where spend_id = old.id;
    if old.spend_type = 'planned' then
      select id into old_sink from goals where id = old.goal_id and kind = 'sinking';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.spend_type in ('planned', 'unplanned') and new.goal_id is not null then
      insert into goal_transactions (user_id, goal_id, amount, note, happened_on, spend_id)
      values (
        new.user_id, new.goal_id, -new.amount,
        (case new.spend_type when 'planned' then 'Planned spend' else 'Unplanned spend' end) || coalesce(': ' || new.note, ''),
        new.spent_on, new.id
      );
    end if;
    if new.spend_type = 'planned' then
      select id into new_sink from goals where id = new.goal_id and kind = 'sinking';
    end if;
  end if;

  if old_sink is not null and old_sink is distinct from new_sink then
    update goals set next_due_date = (next_due_date - make_interval(months => coalesce(cycle_months, 1)))::date
      where id = old_sink and next_due_date is not null;
  end if;
  if new_sink is not null and new_sink is distinct from old_sink then
    update goals set next_due_date = (next_due_date + make_interval(months => coalesce(cycle_months, 1)))::date
      where id = new_sink and next_due_date is not null;
  end if;
  return null;
end $$;

create trigger spends_goal_sync after insert or update or delete on spends
  for each row execute function spend_goal_sync();

-- 5. Salary day rollover -------------------------------------------------------------
-- New plan = the template that newly applies this month, otherwise a copy of the current cycle.
-- Card bills row = FULL card total of the last cycle (all spend types).
-- Unspent row = last cycle's daily budget minus its DAILY spends only.
create or replace function start_cycle(p_starts_on date, p_salary numeric) returns uuid
language plpgsql set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur cycles%rowtype;
  new_id uuid;
  last_daily numeric := 0;
  last_cards numeric := 0;
  last_budget numeric := 0;
  new_month date := date_trunc('month', p_starts_on)::date;
  tpl_month date;
  trip uuid;
begin
  select * into cur from cycles where user_id = uid and ends_on is null order by starts_on desc limit 1;

  if cur.id is not null then
    if p_starts_on <= cur.starts_on then
      raise exception 'New cycle must start after the current one (%)', cur.starts_on;
    end if;
    update cycles set ends_on = p_starts_on - 1 where id = cur.id;
    select coalesce(sum(amount), 0) into last_daily
      from spends where user_id = uid and spend_type = 'daily' and spent_on between cur.starts_on and p_starts_on - 1;
    select coalesce(sum(s.amount), 0) into last_cards
      from spends s join cards c on c.id = s.card_id
      where s.user_id = uid and c.monthly_cap > 0 and s.spent_on between cur.starts_on and p_starts_on - 1;
    last_budget := cur.daily_budget * (p_starts_on - cur.starts_on);
  end if;

  insert into cycles (user_id, starts_on, salary, daily_budget)
    values (uid, p_starts_on, p_salary, coalesce(cur.daily_budget, 500)) returning id into new_id;

  select max(month) into tpl_month from plan_templates where user_id = uid and month <= new_month;
  if tpl_month is not null and (cur.id is null or tpl_month > date_trunc('month', cur.starts_on)::date) then
    insert into plan_items (user_id, cycle_id, name, kind, goal_id, planned)
      select uid, new_id, name, kind, goal_id, planned
      from plan_templates where user_id = uid and month = tpl_month order by sort_order;
  elsif cur.id is not null then
    insert into plan_items (user_id, cycle_id, name, kind, goal_id, planned)
      select uid, new_id, name, kind, goal_id, planned
      from plan_items where cycle_id = cur.id and kind not in ('bills', 'unspent');
  end if;

  if cur.id is not null then
    insert into plan_items (user_id, cycle_id, name, kind, planned)
      values (uid, new_id, 'Card bills (last cycle)', 'bills', last_cards);
    select id into trip from goals where user_id = uid and name = 'Trip fund' limit 1;
    insert into plan_items (user_id, cycle_id, name, kind, goal_id, planned)
      values (uid, new_id, 'Unspent daily budget → Trip fund', 'unspent', trip, greatest(0, last_budget - last_daily));
  end if;

  return new_id;
end $$;

-- 6. Example seed (public persona). Personal numbers live in supabase/personal/ (git-ignored).
create or replace function seed_defaults() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rewards uuid; shopping uuid; upi uuid; cash uuid;
  g_emergency uuid; g_trip uuid; g_long uuid; g_buffer uuid; g_sink uuid;
  cyc uuid;
  m0 date := date_trunc('month', current_date)::date;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text)); -- concurrent first-load calls must not double-seed
  if exists (select 1 from cards where user_id = uid) then return; end if;

  insert into cards (user_id, nickname, monthly_cap, sort_order) values (uid, 'Rewards card', 6000, 1) returning id into rewards;
  insert into cards (user_id, nickname, monthly_cap, sort_order) values (uid, 'Shopping card', 4000, 2) returning id into shopping;
  insert into cards (user_id, nickname, monthly_cap, sort_order) values (uid, 'UPI card', 2000, 3) returning id into upi;
  insert into cards (user_id, nickname, monthly_cap, sort_order) values (uid, 'Cash/Debit', 0, 4) returning id into cash;

  insert into categories (user_id, name, icon, suggested_card_id, small_card_id, sort_order) values
    (uid, 'Dining out',            '🍽️', rewards,  null, 1),
    (uid, 'Food delivery',         '🛵', shopping, null, 2),
    (uid, 'Groceries',             '🛒', rewards,  null, 3),
    (uid, 'Local travel',          '🚕', shopping, null, 4),
    (uid, 'Shopping',              '🛍️', shopping, null, 5),
    (uid, 'Entertainment',         '🎬', rewards,  null, 6),
    (uid, 'Health & fitness',      '💪', shopping, null, 7),
    (uid, 'Bills & subscriptions', '🧾', shopping, null, 8),
    (uid, 'Other',                 '✨', shopping, upi,  9);

  insert into goals (user_id, name, target) values (uid, 'Emergency fund', 100000) returning id into g_emergency;
  insert into goals (user_id, name, target) values (uid, 'Trip fund', 50000) returning id into g_trip;
  insert into goals (user_id, name, target) values (uid, 'Long-term invested', null) returning id into g_long;
  insert into goals (user_id, name, target, kind) values (uid, 'Surprise buffer', null, 'buffer') returning id into g_buffer;
  insert into goals (user_id, name, target, kind, monthly_contribution, cycle_months, next_due_date)
    values (uid, 'Annual insurance', 12000, 'sinking', 1000, 12, (m0 + interval '12 months')::date) returning id into g_sink;

  -- Example month: 37,600 plan + ₹400 × 31 days = 50,000
  insert into cycles (user_id, starts_on, salary, daily_budget) values (uid, m0, 50000, 400) returning id into cyc;

  insert into plan_items (user_id, cycle_id, name, kind, goal_id, planned) values
    (uid, cyc, 'Loan EMI',         'loan',       null,        10000),
    (uid, cyc, 'Phone EMI',        'loan',       null,         3000),
    (uid, cyc, 'Gym',              'fixed',      null,         1000),
    (uid, cyc, 'Subscriptions',    'fixed',      null,         1000),
    (uid, cyc, 'Travel pass',      'fixed',      null,         1000),
    (uid, cyc, 'Insurance fund',   'savings',    g_sink,       1000),
    (uid, cyc, 'Surprise buffer',  'buffer',     g_buffer,     2000),
    (uid, cyc, 'Emergency fund',   'savings',    g_emergency,  8000),
    (uid, cyc, 'Trip fund',        'savings',    g_trip,       4600),
    (uid, cyc, 'Mutual fund SIP',  'savings',    g_long,       5000),
    (uid, cyc, 'Gold',             'savings',    g_long,       1000),
    (uid, cyc, 'Loan prepayment',  'prepayment', null,            0);

  -- From 3 months on: the phone EMI ends and that money prepays the loan.
  insert into plan_templates (user_id, month, name, kind, goal_id, planned, sort_order)
    select uid, (m0 + interval '3 months')::date, name, kind, goal_id,
           case name when 'Phone EMI' then 0 when 'Loan prepayment' then 3000 else planned end,
           row_number() over ()
    from plan_items where cycle_id = cyc;

  insert into settings (user_id, birthday_card_id) values (uid, rewards);
  insert into loan (user_id, name, emi) values (uid, 'Loan', 10000);
end $$;

revoke all on function seed_defaults() from public, anon;
grant execute on function seed_defaults() to authenticated;
