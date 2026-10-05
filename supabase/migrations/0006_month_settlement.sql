-- Month settlement: leftover/shortfall adjustments and a signed "daily budget result" row.

-- 'adjustment' = money moved to a goal (leftover, +) or borrowed from one (shortfall, −) to balance the month.
alter table plan_items drop constraint plan_items_kind_check;
alter table plan_items add constraint plan_items_kind_check
  check (kind in ('loan','fixed','buffer','savings','prepayment','bills','unspent','adjustment'));

-- Salary day: last cycle's daily-budget result can now be negative (overspent). Positive defaults to the
-- Trip fund; negative has no source until the user picks where to borrow it from.
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
      from plan_items where cycle_id = cur.id and kind not in ('bills', 'unspent', 'adjustment');
  end if;

  if cur.id is not null then
    insert into plan_items (user_id, cycle_id, name, kind, planned)
      values (uid, new_id, 'Card bills (last cycle)', 'bills', last_cards);
    result := last_budget - last_daily;
    select id into trip from goals where user_id = uid and name = 'Trip fund' limit 1;
    insert into plan_items (user_id, cycle_id, name, kind, goal_id, planned)
      values (
        uid, new_id,
        case when result >= 0 then 'Unspent daily budget' else 'Daily budget overspent' end,
        'unspent',
        case when result >= 0 then trip end,
        result
      );
  end if;

  return new_id;
end $$;
