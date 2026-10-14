-- Locked funds: money set aside (e.g. cash kept at home) that the app never spends or borrows from.
-- Month budgets: a month-specific plan can carry its own daily budget, picked up on salary day.

-- Locked funds -----------------------------------------------------------------------------------
alter table goals add column locked boolean not null default false;

-- Money can still go in; nothing comes out until the fund is unlocked.
create function guard_locked_goal() returns trigger
language plpgsql set search_path = public as $$
declare g goals%rowtype;
begin
  select * into g from goals where id = new.goal_id;
  if new.amount < 0 and g.locked then
    raise exception '% is locked. Unlock it on the Goals screen to use this money.', g.name;
  end if;
  return new;
end $$;

create trigger goal_transactions_locked before insert or update on goal_transactions
  for each row execute function guard_locked_goal();

-- Month budgets ----------------------------------------------------------------------------------
-- Applies from `month` until a later one takes over, like plan_templates.
create table plan_months (
  user_id uuid references auth.users not null default auth.uid(),
  month date not null check (extract(day from month) = 1),
  daily_budget numeric not null check (daily_budget >= 0),
  primary key (user_id, month)
);

alter table plan_months enable row level security;
create policy plan_months_select on plan_months for select using (user_id = auth.uid());
create policy plan_months_insert on plan_months for insert with check (user_id = auth.uid());
create policy plan_months_update on plan_months for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy plan_months_delete on plan_months for delete using (user_id = auth.uid());

-- Salary day: the new cycle takes the latest month budget scheduled after the current cycle,
-- else it keeps the current cycle's daily budget (so a manual change in Settings carries on).
create or replace function start_cycle(p_starts_on date, p_salary numeric) returns uuid
language plpgsql set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur cycles%rowtype;
  new_id uuid;
  last_daily numeric := 0;
  last_cards numeric := 0;
  last_budget numeric := 0;
  result numeric;
  new_month date := date_trunc('month', p_starts_on)::date;
  tpl_month date;
  new_daily numeric;
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

  select daily_budget into new_daily from plan_months
    where user_id = uid and month <= new_month
      and (cur.id is null or month > date_trunc('month', cur.starts_on)::date)
    order by month desc limit 1;

  insert into cycles (user_id, starts_on, salary, daily_budget)
    values (uid, p_starts_on, p_salary, coalesce(new_daily, cur.daily_budget, 500)) returning id into new_id;

  select max(month) into tpl_month from plan_templates where user_id = uid and month <= new_month;
  if tpl_month is not null and (cur.id is null or tpl_month > date_trunc('month', cur.starts_on)::date) then
    insert into plan_items (user_id, cycle_id, name, kind, goal_id, loan_id, planned)
      select uid, new_id, name, kind, goal_id, loan_id, planned
      from plan_templates where user_id = uid and month = tpl_month order by sort_order;
  elsif cur.id is not null then
    insert into plan_items (user_id, cycle_id, name, kind, goal_id, loan_id, planned)
      select uid, new_id, name, kind, goal_id, loan_id, planned from plan_items where cycle_id = cur.id;
  end if;

  if cur.id is not null then
    insert into cycle_settlements (cycle_id, kind, amount, note)
      values (new_id, 'card_bills', last_cards, 'Card bills (last cycle)');
    result := last_budget - last_daily;
    insert into cycle_settlements (cycle_id, kind, goal_id, amount, note)
      values (new_id, 'daily_result',
              case when result >= 0 then (select id from goals where user_id = uid and role = 'trip') end,
              result,
              case when result >= 0 then 'Unspent daily budget' else 'Daily budget overspent' end);
  end if;

  return new_id;
end $$;

-- "Take it from the daily budget" now also lowers the upcoming months' daily budgets.
create or replace function add_goal_contribution(p_goal uuid, p_amount numeric, p_source_item uuid default null, p_from_daily boolean default false) returns void
language plpgsql set search_path = public as $$
declare
  cyc cycles%rowtype;
  g goals%rowtype;
  src_name text;
  m date;
begin
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  select * into cyc from cycles where user_id = auth.uid() and ends_on is null order by starts_on desc limit 1;
  select * into g from goals where id = p_goal;
  if cyc.id is null or g.id is null then raise exception 'Goal or cycle not found'; end if;

  update plan_items set planned = planned + p_amount where cycle_id = cyc.id and goal_id = p_goal;
  if not found then
    insert into plan_items (cycle_id, name, kind, goal_id, planned) values (cyc.id, g.name, 'savings', p_goal, p_amount);
  end if;

  if p_from_daily then
    update cycles set daily_budget = round(daily_budget - p_amount * 12 / 365) where id = cyc.id;
    update plan_months set daily_budget = greatest(0, round(daily_budget - p_amount * 12 / 365))
      where user_id = auth.uid() and month > date_trunc('month', cyc.starts_on)::date;
  elsif p_source_item is not null then
    update plan_items set planned = greatest(0, planned - p_amount) where id = p_source_item returning name into src_name;
  end if;

  for m in select distinct month from plan_templates
           where user_id = auth.uid() and month > date_trunc('month', cyc.starts_on)::date loop
    update plan_templates set planned = planned + p_amount where user_id = auth.uid() and month = m and goal_id = p_goal;
    if not found then
      insert into plan_templates (month, name, kind, goal_id, planned, sort_order) values (m, g.name, 'savings', p_goal, p_amount, 50);
    end if;
    if src_name is not null then
      update plan_templates set planned = greatest(0, planned - p_amount) where user_id = auth.uid() and month = m and name = src_name;
    end if;
  end loop;
end $$;
