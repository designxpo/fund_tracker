-- Integrity pass:
--  1. "today" in the user's time zone (server runs in UTC)
--  2. goal roles + plan lines linked to the loan explicitly (no name matching)
--  3. cycle_settlements: card bills / daily-budget result / leftover / borrow live outside plan_items
--  4. goal_balances view
--  5. every multi-step money action is one transactional function

-- 1. Time zone --------------------------------------------------------------------
alter table settings add column timezone text not null default 'Asia/Kolkata';

create or replace function app_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone coalesce((select timezone from settings where user_id = auth.uid()), 'Asia/Kolkata'))::date
$$;

alter table spends            alter column spent_on    set default app_today();
alter table goal_transactions alter column happened_on set default app_today();
alter table loan_prepayments  alter column paid_on     set default app_today();
alter table income            alter column received_on set default app_today();

-- 2. Roles and loan links -----------------------------------------------------------
alter table goals add column role text check (role in ('emergency', 'trip', 'buffer', 'long_term'));
create unique index goals_user_role_idx on goals (user_id, role) where role is not null;
update goals set role = 'emergency' where name = 'Emergency fund' and not is_custom;
update goals set role = 'trip'      where name = 'Trip fund' and not is_custom;
update goals set role = 'long_term' where name = 'Long-term invested' and not is_custom;
update goals set role = 'buffer'    where kind = 'buffer' and not is_custom;

alter table plan_items     add column loan_id uuid references loan on delete set null;
alter table plan_templates add column loan_id uuid references loan on delete set null;
update plan_items p set loan_id = l.id from loan l
  where l.user_id = p.user_id and p.kind in ('loan', 'prepayment') and lower(p.name) like lower(l.name) || '%';
update plan_templates p set loan_id = l.id from loan l
  where l.user_id = p.user_id and p.kind in ('loan', 'prepayment') and lower(p.name) like lower(l.name) || '%';

-- 3. Settlements ------------------------------------------------------------------------
create table cycle_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  cycle_id uuid references cycles on delete cascade not null,
  kind text not null check (kind in ('card_bills', 'daily_result', 'leftover', 'borrow')),
  goal_id uuid references goals on delete set null,   -- where money goes (+) / comes from (−)
  loan_id uuid references loan on delete set null,    -- leftover sent to a loan prepayment
  amount numeric not null,                            -- signed
  done boolean not null default false,
  settled_on date,
  note text,
  created_at timestamptz default now()
);
create index cycle_settlements_cycle_idx on cycle_settlements (cycle_id);
alter table cycle_settlements enable row level security;
create policy cycle_settlements_select on cycle_settlements for select using (user_id = auth.uid());
create policy cycle_settlements_insert on cycle_settlements for insert with check (user_id = auth.uid());
create policy cycle_settlements_update on cycle_settlements for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cycle_settlements_delete on cycle_settlements for delete using (user_id = auth.uid());

alter table goal_transactions add column settlement_id uuid references cycle_settlements on delete cascade;
alter table loan_prepayments  add column settlement_id uuid references cycle_settlements on delete cascade;

-- Move any bookkeeping rows out of plan_items (same id, so their money rows can be relinked).
insert into cycle_settlements (id, user_id, cycle_id, kind, goal_id, loan_id, amount, done, settled_on, note)
select id, user_id, cycle_id,
       case kind when 'bills' then 'card_bills' when 'unspent' then 'daily_result'
                 else case when planned >= 0 then 'leftover' else 'borrow' end end,
       goal_id, loan_id, coalesce(actual, planned), coalesce(done, false), case when done then app_today() end, name
from plan_items where kind in ('bills', 'unspent', 'adjustment');
update goal_transactions set settlement_id = plan_item_id, plan_item_id = null
  where plan_item_id in (select id from cycle_settlements);
update loan_prepayments set settlement_id = plan_item_id, plan_item_id = null
  where plan_item_id in (select id from cycle_settlements);
delete from plan_items where kind in ('bills', 'unspent', 'adjustment');

alter table plan_items drop constraint plan_items_kind_check;
alter table plan_items add constraint plan_items_kind_check
  check (kind in ('loan', 'fixed', 'buffer', 'savings', 'prepayment'));

drop table plan_changes;

-- 4. Balances -----------------------------------------------------------------------------
create view goal_balances with (security_invoker = true) as
  select g.id as goal_id, g.user_id, g.opening_balance + coalesce(sum(t.amount), 0) as balance
  from goals g left join goal_transactions t on t.goal_id = g.id
  group by g.id;

create or replace function goal_balance(p_goal uuid) returns numeric
language sql stable set search_path = public as $$
  select balance from goal_balances where goal_id = p_goal
$$;

-- 5. Money actions ---------------------------------------------------------------------------

-- Rebuild the deposit / prepayment a plan line produced (keeps the original date).
create or replace function _sync_plan_item_money(p_item uuid) returns void
language plpgsql set search_path = public as $$
declare
  it plan_items%rowtype;
  amt numeric;
  keep date;
  lid uuid;
begin
  select * into it from plan_items where id = p_item;
  if not found then raise exception 'Plan line not found'; end if;
  select coalesce((select min(happened_on) from goal_transactions where plan_item_id = p_item),
                  (select min(paid_on) from loan_prepayments where plan_item_id = p_item)) into keep;
  delete from goal_transactions where plan_item_id = p_item;
  delete from loan_prepayments where plan_item_id = p_item;
  if not it.done then return; end if;
  amt := coalesce(it.actual, it.planned);
  if amt = 0 then return; end if;
  if it.goal_id is not null and it.kind in ('buffer', 'savings') then
    insert into goal_transactions (goal_id, amount, note, happened_on, plan_item_id)
      values (it.goal_id, amt, it.name, coalesce(keep, app_today()), it.id);
  elsif it.kind = 'prepayment' and amt > 0 then
    lid := coalesce(it.loan_id, (select id from loan where user_id = it.user_id limit 1));
    if lid is not null then
      insert into loan_prepayments (loan_id, amount, paid_on, plan_item_id) values (lid, amt, coalesce(keep, app_today()), it.id);
    end if;
  end if;
end $$;

-- Tick / untick a checklist line and/or set its actual amount.
create or replace function set_plan_item(p_item uuid, p_done boolean default null, p_actual numeric default null, p_clear_actual boolean default false)
returns void language plpgsql set search_path = public as $$
begin
  if p_actual is not null and p_actual < 0 then raise exception 'Amount can''t be negative'; end if;
  update plan_items set
    done = coalesce(p_done, done),
    actual = case
      when p_clear_actual then null
      when p_actual is not null then p_actual
      when coalesce(p_done, done) and actual is null then planned
      else actual end
  where id = p_item;
  if not found then raise exception 'Plan line not found'; end if;
  perform _sync_plan_item_money(p_item);
end $$;

create or replace function _sync_settlement_money(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  s cycle_settlements%rowtype;
  label text;
begin
  select * into s from cycle_settlements where id = p_id;
  if not found then raise exception 'Settlement not found'; end if;
  delete from goal_transactions where settlement_id = p_id;
  delete from loan_prepayments where settlement_id = p_id;
  if not s.done or s.amount = 0 or s.kind = 'card_bills' then return; end if;
  label := coalesce(s.note, initcap(replace(s.kind, '_', ' ')));
  if s.goal_id is not null then
    insert into goal_transactions (goal_id, amount, note, happened_on, settlement_id)
      values (s.goal_id, s.amount, label, coalesce(s.settled_on, app_today()), s.id);
  elsif s.loan_id is not null and s.amount > 0 then
    insert into loan_prepayments (loan_id, amount, paid_on, settlement_id)
      values (s.loan_id, s.amount, coalesce(s.settled_on, app_today()), s.id);
  else
    raise exception 'Choose where this money goes';
  end if;
end $$;

-- Tick a settlement (card bills paid / daily result moved) and/or pick its goal.
create or replace function set_settlement(p_id uuid, p_done boolean default null, p_goal uuid default null, p_set_goal boolean default false)
returns void language plpgsql set search_path = public as $$
declare
  s cycle_settlements%rowtype;
begin
  update cycle_settlements set
    goal_id = case when p_set_goal then p_goal else goal_id end,
    done = coalesce(p_done, done),
    settled_on = case when coalesce(p_done, done) then coalesce(settled_on, app_today()) end
  where id = p_id returning * into s;
  if not found then raise exception 'Settlement not found'; end if;
  if s.done and s.amount < 0 and s.goal_id is not null and goal_balance(s.goal_id) < 0 then
    raise exception 'Not enough in that goal to cover %', -s.amount;
  end if;
  perform _sync_settlement_money(p_id);
end $$;

-- Balance the month: move a leftover (+) to a goal or the loan, or borrow a shortfall (−) from a goal.
create or replace function settle_month(p_cycle uuid, p_amount numeric, p_goal uuid default null, p_to_loan boolean default false)
returns uuid language plpgsql set search_path = public as $$
declare
  sid uuid;
  lid uuid;
  gname text;
begin
  if p_amount is null or p_amount = 0 then raise exception 'Nothing to settle'; end if;
  if p_to_loan then
    if p_amount < 0 then raise exception 'Can''t borrow from a loan'; end if;
    select id, name into lid, gname from loan where user_id = auth.uid() limit 1;
    if lid is null then raise exception 'No loan set up'; end if;
    gname := gname || ' prepayment';
  else
    select name into gname from goals where id = p_goal;
    if gname is null then raise exception 'Choose a goal'; end if;
    if p_amount < 0 and goal_balance(p_goal) < -p_amount then
      raise exception '% has only %', gname, goal_balance(p_goal);
    end if;
  end if;
  insert into cycle_settlements (cycle_id, kind, goal_id, loan_id, amount, done, settled_on, note)
    values (p_cycle, case when p_amount > 0 then 'leftover' else 'borrow' end,
            case when p_to_loan then null else p_goal end, lid, p_amount, true, app_today(),
            case when p_amount > 0 then 'Leftover → ' else 'Borrowed from ' end || gname)
    returning id into sid;
  perform _sync_settlement_money(sid);
  return sid;
end $$;

create or replace function undo_settlement(p_id uuid) returns void
language plpgsql set search_path = public as $$
begin
  delete from cycle_settlements where id = p_id and kind in ('leftover', 'borrow');
  if not found then raise exception 'Only leftover/borrow entries can be undone'; end if;
end $$;

-- Unplanned spend bigger than the buffer: take the shortfall from a plan line or (confirmed) a goal,
-- and put it in the buffer, in one go.
create or replace function cover_shortfall(p_buffer uuid, p_amount numeric, p_item uuid default null, p_goal uuid default null)
returns void language plpgsql set search_path = public as $$
declare
  it plan_items%rowtype;
  src text;
begin
  if p_amount <= 0 then raise exception 'Nothing to cover'; end if;
  if (p_item is null) = (p_goal is null) then raise exception 'Choose one source'; end if;
  if p_item is not null then
    select * into it from plan_items where id = p_item;
    if not found then raise exception 'Plan line not found'; end if;
    if coalesce(case when it.done then coalesce(it.actual, it.planned) else it.planned end, 0) < p_amount then
      raise exception '% only has %', it.name, case when it.done then coalesce(it.actual, it.planned) else it.planned end;
    end if;
    if it.done then
      update plan_items set actual = coalesce(actual, planned) - p_amount where id = p_item;
    else
      update plan_items set planned = planned - p_amount, actual = case when actual is null then null else greatest(0, actual - p_amount) end
        where id = p_item;
    end if;
    perform _sync_plan_item_money(p_item);
    src := it.name;
  else
    select name into src from goals where id = p_goal;
    if goal_balance(p_goal) < p_amount then raise exception '% has only %', src, goal_balance(p_goal); end if;
    insert into goal_transactions (goal_id, amount, note) values (p_goal, -p_amount, 'Moved to Surprise buffer');
  end if;
  insert into goal_transactions (goal_id, amount, note) values (p_buffer, p_amount, 'Covered from ' || src);
end $$;

-- Goal planner lever: set aside p_amount/month for a goal, taken from a plan line, the daily budget, or free money.
-- Applies to the current cycle and every upcoming month's plan.
create or replace function add_goal_contribution(p_goal uuid, p_amount numeric, p_source_item uuid default null, p_from_daily boolean default false)
returns void language plpgsql set search_path = public as $$
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

-- Log extra income and split it into goals; optionally remember the split.
create or replace function log_income(p_amount numeric, p_source text, p_date date, p_recurring boolean, p_note text,
                                      p_split jsonb default '[]', p_remember boolean default false)
returns uuid language plpgsql set search_path = public as $$
declare
  iid uuid;
  part jsonb;
  amt numeric;
begin
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if (select coalesce(sum((x->>'pct')::numeric), 0) from jsonb_array_elements(p_split) x) > 100 then
    raise exception 'Split adds up to more than 100%%';
  end if;
  insert into income (amount, source, received_on, recurring, note)
    values (p_amount, p_source, coalesce(p_date, app_today()), p_recurring, nullif(trim(p_note), ''))
    returning id into iid;
  for part in select * from jsonb_array_elements(p_split) loop
    amt := round(p_amount * (part->>'pct')::numeric / 100);
    if amt > 0 then
      insert into goal_transactions (goal_id, amount, note, happened_on, income_id)
        values ((part->>'goal_id')::uuid, amt, p_source || ' (extra income)', coalesce(p_date, app_today()), iid);
    end if;
  end loop;
  if p_remember then
    update settings set income_split = p_split where user_id = auth.uid();
    if not found then insert into settings (income_split) values (p_split); end if;
  end if;
  return iid;
end $$;

-- Delete a goal with its current and upcoming plan lines.
create or replace function delete_goal(p_goal uuid) returns void
language plpgsql set search_path = public as $$
begin
  delete from plan_items where goal_id = p_goal and cycle_id in (select id from cycles where user_id = auth.uid() and ends_on is null);
  delete from plan_templates where goal_id = p_goal;
  delete from goals where id = p_goal;
  if not found then raise exception 'Goal not found'; end if;
end $$;

-- Salary day: new cycle + settlements (card bills, daily-budget result).
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

-- Permissions: only signed-in users.
do $$
declare f text;
begin
  foreach f in array array[
    'app_today()', 'goal_balance(uuid)', '_sync_plan_item_money(uuid)', '_sync_settlement_money(uuid)',
    'set_plan_item(uuid, boolean, numeric, boolean)', 'set_settlement(uuid, boolean, uuid, boolean)',
    'settle_month(uuid, numeric, uuid, boolean)', 'undo_settlement(uuid)', 'cover_shortfall(uuid, numeric, uuid, uuid)',
    'add_goal_contribution(uuid, numeric, uuid, boolean)', 'log_income(numeric, text, date, boolean, text, jsonb, boolean)',
    'delete_goal(uuid)', 'start_cycle(date, numeric)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
