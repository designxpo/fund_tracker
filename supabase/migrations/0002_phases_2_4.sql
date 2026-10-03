-- Phases 2-4: settings, scheduled plan changes, salary-day cycle rollover.

alter table plan_items drop constraint plan_items_kind_check;
alter table plan_items add constraint plan_items_kind_check
  check (kind in ('loan','fixed','buffer','savings','prepayment','bills','unspent'));

alter table goal_transactions add column plan_item_id uuid references plan_items on delete cascade;
alter table loan_prepayments  add column plan_item_id uuid references plan_items on delete cascade;
create index goal_tx_goal_idx on goal_transactions (goal_id, happened_on desc);

create table settings (
  user_id uuid primary key references auth.users default auth.uid(),
  birthday date,
  birthday_card_id uuid references cards on delete set null
);

create table plan_changes (        -- "from this date, item X is planned at Y"
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null default auth.uid(),
  name text not null,
  effective_from date not null,
  planned numeric not null
);

do $$
declare t text;
begin
  foreach t in array array['settings','plan_changes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

-- Salary received: close the current cycle, open a new one, copy the plan
-- (applying any scheduled plan_changes), add the card-bills and unspent rows.
create or replace function start_cycle(p_starts_on date, p_salary numeric) returns uuid
language plpgsql set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur cycles%rowtype;
  new_id uuid;
  last_spent numeric := 0;
  last_budget numeric := 0;
  days_new int := (p_starts_on + interval '1 month')::date - p_starts_on;
  trip uuid;
begin
  select * into cur from cycles where user_id = uid and ends_on is null order by starts_on desc limit 1;

  if cur.id is not null then
    if p_starts_on <= cur.starts_on then
      raise exception 'New cycle must start after the current one (%)', cur.starts_on;
    end if;
    update cycles set ends_on = p_starts_on - 1 where id = cur.id;
    select coalesce(sum(amount), 0) into last_spent
      from spends where user_id = uid and spent_on between cur.starts_on and p_starts_on - 1;
    last_budget := cur.daily_budget * (p_starts_on - cur.starts_on);
  end if;

  insert into cycles (user_id, starts_on, salary, daily_budget)
    values (uid, p_starts_on, p_salary, coalesce(cur.daily_budget, 500)) returning id into new_id;

  if cur.id is not null then
    insert into plan_items (user_id, cycle_id, name, kind, goal_id, planned)
    select uid, new_id, pi.name, pi.kind, pi.goal_id,
      coalesce((select pc.planned from plan_changes pc
                where pc.user_id = uid and pc.name = pi.name
                  and pc.effective_from > cur.starts_on and pc.effective_from <= p_starts_on
                order by pc.effective_from desc limit 1), pi.planned)
    from plan_items pi where pi.cycle_id = cur.id and pi.kind not in ('bills', 'unspent');
  end if;

  insert into plan_items (user_id, cycle_id, name, kind, planned, actual)
    values (uid, new_id, 'Card bills (last cycle)', 'bills',
            coalesce(cur.daily_budget, 500) * days_new,
            case when cur.id is not null then last_spent end);

  if cur.id is not null then
    select id into trip from goals where user_id = uid and name = 'Trip fund';
    insert into plan_items (user_id, cycle_id, name, kind, goal_id, planned)
      values (uid, new_id, 'Unspent daily budget → Trip fund', 'unspent', trip, greatest(0, last_budget - last_spent));
  end if;

  return new_id;
end $$;

grant execute on function start_cycle(date, numeric) to authenticated;
revoke execute on function start_cycle(date, numeric) from public, anon;

-- Seed (example persona). Runs on first login. To use your own numbers, apply a
-- private override after the migrations, e.g. supabase/personal/seed_defaults.sql (git-ignored).
create or replace function seed_defaults() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rewards uuid; shopping uuid; upi uuid; cash uuid;
  g_emergency uuid; g_trip uuid; g_long uuid; g_buffer uuid;
  cyc uuid;
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
  insert into goals (user_id, name, target) values (uid, 'Surprise buffer', null) returning id into g_buffer;

  insert into cycles (user_id, starts_on, salary, daily_budget)
    values (uid, date_trunc('month', current_date)::date, 50000, 400) returning id into cyc;

  insert into plan_items (user_id, cycle_id, name, kind, goal_id, planned) values
    (uid, cyc, 'Card bills (last cycle)', 'bills', null,     12400),
    (uid, cyc, 'Loan EMI',         'loan',       null,        10000),
    (uid, cyc, 'Phone EMI',        'loan',       null,         3000),
    (uid, cyc, 'Gym',              'fixed',      null,         1000),
    (uid, cyc, 'Subscriptions',    'fixed',      null,         1000),
    (uid, cyc, 'Travel pass',      'fixed',      null,         1000),
    (uid, cyc, 'Surprise buffer',  'buffer',     g_buffer,     2000),
    (uid, cyc, 'Emergency fund',   'savings',    g_emergency,  8000),
    (uid, cyc, 'Trip fund',        'savings',    g_trip,       4600),
    (uid, cyc, 'Mutual fund SIP',  'savings',    g_long,       5000),
    (uid, cyc, 'Gold',             'savings',    g_long,       1000),
    (uid, cyc, 'Index fund',       'savings',    g_long,       1000),
    (uid, cyc, 'Loan prepayment',  'prepayment', null,            0);

  -- Example of a scheduled change: the phone EMI ends, that money goes to prepaying the loan.
  insert into plan_changes (user_id, name, effective_from, planned) values
    (uid, 'Phone EMI',       (date_trunc('month', current_date) + interval '3 months')::date, 0),
    (uid, 'Loan prepayment', (date_trunc('month', current_date) + interval '3 months')::date, 3000);

  insert into settings (user_id, birthday_card_id) values (uid, rewards);
  insert into loan (user_id, name, emi) values (uid, 'Loan', 10000);
end $$;

revoke all on function seed_defaults() from public, anon;
grant execute on function seed_defaults() to authenticated;
