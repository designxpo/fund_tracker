-- Baseline: the full public schema as of 2026-10-05 (replaces the hand-applied files in supabase/archive/).
-- Generated with pg_dump from the live project, then made non-personal:
--   * seed_defaults() seeds the example persona (personal version: supabase/personal/seed_defaults.sql)
--   * the owner-only sign-up lock lives in supabase/personal/only_my_account.sql
-- New changes go in new migrations: `npm run db:new <name>`, then `npm run db:push`.

-- Functions reference tables created further down; validate bodies at call time.
SET check_function_bodies = false;



--
-- Name: _sync_plan_item_money(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._sync_plan_item_money(p_item uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: _sync_settlement_money(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._sync_settlement_money(p_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: add_goal_contribution(uuid, numeric, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_goal_contribution(p_goal uuid, p_amount numeric, p_source_item uuid DEFAULT NULL::uuid, p_from_daily boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: app_today(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_today() RETURNS date
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select (now() at time zone coalesce((select timezone from settings where user_id = auth.uid()), 'Asia/Kolkata'))::date
$$;


--
-- Name: cover_shortfall(uuid, numeric, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cover_shortfall(p_buffer uuid, p_amount numeric, p_item uuid DEFAULT NULL::uuid, p_goal uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: delete_goal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_goal(p_goal uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  delete from plan_items where goal_id = p_goal and cycle_id in (select id from cycles where user_id = auth.uid() and ends_on is null);
  delete from plan_templates where goal_id = p_goal;
  delete from goals where id = p_goal;
  if not found then raise exception 'Goal not found'; end if;
end $$;


--
-- Name: goal_balance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.goal_balance(p_goal uuid) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select balance from goal_balances where goal_id = p_goal
$$;


--
-- Name: log_income(numeric, text, date, boolean, text, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_income(p_amount numeric, p_source text, p_date date, p_recurring boolean, p_note text, p_split jsonb DEFAULT '[]'::jsonb, p_remember boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: seed_defaults(); Type: FUNCTION; Schema: public
-- Example persona. Personal defaults: supabase/personal/seed_defaults.sql (git-ignored).
--

CREATE FUNCTION public.seed_defaults() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rewards uuid; shopping uuid; upi uuid; cash uuid;
  g_emergency uuid; g_trip uuid; g_long uuid; g_buffer uuid; g_sink uuid;
  cyc uuid;
  m0 date := date_trunc('month', public.app_today())::date;
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

  insert into goals (user_id, name, target, role) values (uid, 'Emergency fund', 100000, 'emergency') returning id into g_emergency;
  insert into goals (user_id, name, target, role) values (uid, 'Trip fund', 50000, 'trip') returning id into g_trip;
  insert into goals (user_id, name, target, role) values (uid, 'Long-term invested', null, 'long_term') returning id into g_long;
  insert into goals (user_id, name, target, kind, role) values (uid, 'Surprise buffer', null, 'buffer', 'buffer') returning id into g_buffer;
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


--
-- Name: set_plan_item(uuid, boolean, numeric, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_plan_item(p_item uuid, p_done boolean DEFAULT NULL::boolean, p_actual numeric DEFAULT NULL::numeric, p_clear_actual boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_settlement(uuid, boolean, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_settlement(p_id uuid, p_done boolean DEFAULT NULL::boolean, p_goal uuid DEFAULT NULL::uuid, p_set_goal boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: settle_month(uuid, numeric, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_month(p_cycle uuid, p_amount numeric, p_goal uuid DEFAULT NULL::uuid, p_to_loan boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: spend_goal_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.spend_goal_sync() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
    -- money only leaves the fund once settled
    if new.spend_type in ('planned', 'unplanned') and new.goal_id is not null and new.fund_settle = 'now' then
      insert into goal_transactions (user_id, goal_id, amount, note, happened_on, spend_id)
      values (
        new.user_id, new.goal_id, -new.amount,
        (case new.spend_type when 'planned' then 'Planned spend' else 'Unplanned spend' end) || coalesce(': ' || new.note, ''),
        coalesce(new.fund_settled_on, new.spent_on), new.id
      );
    end if;
    -- the purchase happened, so the sinking fund's cycle moves on regardless of settlement
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


--
-- Name: start_cycle(date, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_cycle(p_starts_on date, p_salary numeric) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: undo_settlement(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_settlement(p_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  delete from cycle_settlements where id = p_id and kind in ('leftover', 'borrow');
  if not found then raise exception 'Only leftover/borrow entries can be undone'; end if;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    nickname text NOT NULL,
    monthly_cap numeric DEFAULT 0 NOT NULL,
    statement_day integer,
    due_day integer,
    sort_order integer DEFAULT 0,
    active boolean DEFAULT true,
    CONSTRAINT cards_due_day_check CHECK (((due_day >= 1) AND (due_day <= 31))),
    CONSTRAINT cards_statement_day_check CHECK (((statement_day >= 1) AND (statement_day <= 31)))
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    suggested_card_id uuid,
    small_card_id uuid,
    icon text,
    sort_order integer DEFAULT 0
);


--
-- Name: cycle_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cycle_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    cycle_id uuid NOT NULL,
    kind text NOT NULL,
    goal_id uuid,
    loan_id uuid,
    amount numeric NOT NULL,
    done boolean DEFAULT false NOT NULL,
    settled_on date,
    note text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cycle_settlements_kind_check CHECK ((kind = ANY (ARRAY['card_bills'::text, 'daily_result'::text, 'leftover'::text, 'borrow'::text])))
);


--
-- Name: cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    salary numeric NOT NULL,
    daily_budget numeric DEFAULT 500 NOT NULL
);


--
-- Name: goal_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.goal_balances AS
SELECT
    NULL::uuid AS goal_id,
    NULL::uuid AS user_id,
    NULL::numeric AS balance;


--
-- Name: goal_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    goal_id uuid NOT NULL,
    amount numeric NOT NULL,
    note text,
    happened_on date DEFAULT public.app_today() NOT NULL,
    plan_item_id uuid,
    income_id uuid,
    spend_id uuid,
    settlement_id uuid
);


--
-- Name: goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    target numeric,
    opening_balance numeric DEFAULT 0,
    is_custom boolean DEFAULT false NOT NULL,
    icon text,
    target_date date,
    priority integer DEFAULT 2 NOT NULL,
    kind text DEFAULT 'savings'::text NOT NULL,
    monthly_contribution numeric,
    cycle_months integer,
    next_due_date date,
    role text,
    CONSTRAINT goals_cycle_months_check CHECK ((cycle_months > 0)),
    CONSTRAINT goals_kind_check CHECK ((kind = ANY (ARRAY['savings'::text, 'sinking'::text, 'buffer'::text]))),
    CONSTRAINT goals_role_check CHECK ((role = ANY (ARRAY['emergency'::text, 'trip'::text, 'buffer'::text, 'long_term'::text])))
);


--
-- Name: income; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.income (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    amount numeric NOT NULL,
    source text NOT NULL,
    received_on date DEFAULT public.app_today() NOT NULL,
    recurring boolean DEFAULT false NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT income_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: loan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    name text DEFAULT 'Loan'::text,
    outstanding numeric,
    annual_rate numeric,
    emi numeric DEFAULT 0,
    emis_remaining integer,
    prepay_charge_pct numeric DEFAULT 0,
    original_end date
);


--
-- Name: loan_prepayments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_prepayments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    loan_id uuid NOT NULL,
    amount numeric NOT NULL,
    paid_on date DEFAULT public.app_today() NOT NULL,
    plan_item_id uuid,
    settlement_id uuid
);


--
-- Name: plan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    cycle_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    goal_id uuid,
    planned numeric NOT NULL,
    actual numeric,
    done boolean DEFAULT false,
    loan_id uuid,
    CONSTRAINT plan_items_kind_check CHECK ((kind = ANY (ARRAY['loan'::text, 'fixed'::text, 'buffer'::text, 'savings'::text, 'prepayment'::text])))
);


--
-- Name: plan_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    month date NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    goal_id uuid,
    planned numeric DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    loan_id uuid,
    CONSTRAINT plan_templates_kind_check CHECK ((kind = ANY (ARRAY['loan'::text, 'fixed'::text, 'buffer'::text, 'savings'::text, 'prepayment'::text]))),
    CONSTRAINT plan_templates_month_check CHECK ((EXTRACT(day FROM month) = (1)::numeric))
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    user_id uuid DEFAULT auth.uid() NOT NULL,
    birthday date,
    birthday_card_id uuid,
    income_split jsonb,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL
);


--
-- Name: spends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    amount numeric NOT NULL,
    category_id uuid,
    card_id uuid,
    note text,
    spent_on date DEFAULT public.app_today() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    spend_type text DEFAULT 'daily'::text NOT NULL,
    goal_id uuid,
    fund_settle text DEFAULT 'now'::text NOT NULL,
    fund_settled_on date,
    CONSTRAINT spends_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT spends_fund_settle_check CHECK ((fund_settle = ANY (ARRAY['now'::text, 'bill'::text]))),
    CONSTRAINT spends_goal_required CHECK (((spend_type = 'daily'::text) OR (goal_id IS NOT NULL))),
    CONSTRAINT spends_spend_type_check CHECK ((spend_type = ANY (ARRAY['daily'::text, 'planned'::text, 'unplanned'::text])))
);


--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: cycle_settlements cycle_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cycle_settlements
    ADD CONSTRAINT cycle_settlements_pkey PRIMARY KEY (id);


--
-- Name: cycles cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cycles
    ADD CONSTRAINT cycles_pkey PRIMARY KEY (id);


--
-- Name: goal_transactions goal_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transactions
    ADD CONSTRAINT goal_transactions_pkey PRIMARY KEY (id);


--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);


--
-- Name: income income_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income
    ADD CONSTRAINT income_pkey PRIMARY KEY (id);


--
-- Name: loan loan_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan
    ADD CONSTRAINT loan_pkey PRIMARY KEY (id);


--
-- Name: loan_prepayments loan_prepayments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_prepayments
    ADD CONSTRAINT loan_prepayments_pkey PRIMARY KEY (id);


--
-- Name: plan_items plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_items
    ADD CONSTRAINT plan_items_pkey PRIMARY KEY (id);


--
-- Name: plan_templates plan_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_templates
    ADD CONSTRAINT plan_templates_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (user_id);


--
-- Name: spends spends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spends
    ADD CONSTRAINT spends_pkey PRIMARY KEY (id);


--
-- Name: cycle_settlements_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cycle_settlements_cycle_idx ON public.cycle_settlements USING btree (cycle_id);


--
-- Name: goal_tx_goal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_tx_goal_idx ON public.goal_transactions USING btree (goal_id, happened_on DESC);


--
-- Name: goal_tx_spend_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goal_tx_spend_idx ON public.goal_transactions USING btree (spend_id);


--
-- Name: goals_user_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX goals_user_role_idx ON public.goals USING btree (user_id, role) WHERE (role IS NOT NULL);


--
-- Name: income_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX income_user_date_idx ON public.income USING btree (user_id, received_on DESC);


--
-- Name: plan_templates_user_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_templates_user_month_idx ON public.plan_templates USING btree (user_id, month);


--
-- Name: spends_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spends_user_date_idx ON public.spends USING btree (user_id, spent_on DESC);


--
-- Name: goal_balances _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.goal_balances WITH (security_invoker='true') AS
 SELECT g.id AS goal_id,
    g.user_id,
    (g.opening_balance + COALESCE(sum(t.amount), (0)::numeric)) AS balance
   FROM (public.goals g
     LEFT JOIN public.goal_transactions t ON ((t.goal_id = g.id)))
  GROUP BY g.id;


--
-- Name: spends spends_goal_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER spends_goal_sync AFTER INSERT OR DELETE OR UPDATE ON public.spends FOR EACH ROW EXECUTE FUNCTION public.spend_goal_sync();


--
-- Name: cards cards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: categories categories_small_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_small_card_id_fkey FOREIGN KEY (small_card_id) REFERENCES public.cards(id) ON DELETE SET NULL;


--
-- Name: categories categories_suggested_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_suggested_card_id_fkey FOREIGN KEY (suggested_card_id) REFERENCES public.cards(id) ON DELETE SET NULL;


--
-- Name: categories categories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: cycle_settlements cycle_settlements_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cycle_settlements
    ADD CONSTRAINT cycle_settlements_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.cycles(id) ON DELETE CASCADE;


--
-- Name: cycle_settlements cycle_settlements_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cycle_settlements
    ADD CONSTRAINT cycle_settlements_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE SET NULL;


--
-- Name: cycle_settlements cycle_settlements_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cycle_settlements
    ADD CONSTRAINT cycle_settlements_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loan(id) ON DELETE SET NULL;


--
-- Name: cycle_settlements cycle_settlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cycle_settlements
    ADD CONSTRAINT cycle_settlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: cycles cycles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cycles
    ADD CONSTRAINT cycles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: goal_transactions goal_transactions_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transactions
    ADD CONSTRAINT goal_transactions_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE CASCADE;


--
-- Name: goal_transactions goal_transactions_income_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transactions
    ADD CONSTRAINT goal_transactions_income_id_fkey FOREIGN KEY (income_id) REFERENCES public.income(id) ON DELETE CASCADE;


--
-- Name: goal_transactions goal_transactions_plan_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transactions
    ADD CONSTRAINT goal_transactions_plan_item_id_fkey FOREIGN KEY (plan_item_id) REFERENCES public.plan_items(id) ON DELETE CASCADE;


--
-- Name: goal_transactions goal_transactions_settlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transactions
    ADD CONSTRAINT goal_transactions_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.cycle_settlements(id) ON DELETE CASCADE;


--
-- Name: goal_transactions goal_transactions_spend_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transactions
    ADD CONSTRAINT goal_transactions_spend_id_fkey FOREIGN KEY (spend_id) REFERENCES public.spends(id) ON DELETE CASCADE;


--
-- Name: goal_transactions goal_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_transactions
    ADD CONSTRAINT goal_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: goals goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: income income_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.income
    ADD CONSTRAINT income_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: loan_prepayments loan_prepayments_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_prepayments
    ADD CONSTRAINT loan_prepayments_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loan(id) ON DELETE CASCADE;


--
-- Name: loan_prepayments loan_prepayments_plan_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_prepayments
    ADD CONSTRAINT loan_prepayments_plan_item_id_fkey FOREIGN KEY (plan_item_id) REFERENCES public.plan_items(id) ON DELETE CASCADE;


--
-- Name: loan_prepayments loan_prepayments_settlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_prepayments
    ADD CONSTRAINT loan_prepayments_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES public.cycle_settlements(id) ON DELETE CASCADE;


--
-- Name: loan_prepayments loan_prepayments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_prepayments
    ADD CONSTRAINT loan_prepayments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: loan loan_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan
    ADD CONSTRAINT loan_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: plan_items plan_items_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_items
    ADD CONSTRAINT plan_items_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.cycles(id) ON DELETE CASCADE;


--
-- Name: plan_items plan_items_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_items
    ADD CONSTRAINT plan_items_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE SET NULL;


--
-- Name: plan_items plan_items_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_items
    ADD CONSTRAINT plan_items_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loan(id) ON DELETE SET NULL;


--
-- Name: plan_items plan_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_items
    ADD CONSTRAINT plan_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: plan_templates plan_templates_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_templates
    ADD CONSTRAINT plan_templates_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE SET NULL;


--
-- Name: plan_templates plan_templates_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_templates
    ADD CONSTRAINT plan_templates_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loan(id) ON DELETE SET NULL;


--
-- Name: plan_templates plan_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_templates
    ADD CONSTRAINT plan_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: settings settings_birthday_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_birthday_card_id_fkey FOREIGN KEY (birthday_card_id) REFERENCES public.cards(id) ON DELETE SET NULL;


--
-- Name: settings settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: spends spends_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spends
    ADD CONSTRAINT spends_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE SET NULL;


--
-- Name: spends spends_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spends
    ADD CONSTRAINT spends_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: spends spends_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spends
    ADD CONSTRAINT spends_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE SET NULL;


--
-- Name: spends spends_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spends
    ADD CONSTRAINT spends_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

--
-- Name: cards cards_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cards_delete ON public.cards FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: cards cards_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cards_insert ON public.cards FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: cards cards_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cards_select ON public.cards FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: cards cards_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cards_update ON public.cards FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_delete ON public.categories FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: categories categories_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_insert ON public.categories FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: categories categories_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_select ON public.categories FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: categories categories_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_update ON public.categories FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: cycle_settlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cycle_settlements ENABLE ROW LEVEL SECURITY;

--
-- Name: cycle_settlements cycle_settlements_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cycle_settlements_delete ON public.cycle_settlements FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: cycle_settlements cycle_settlements_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cycle_settlements_insert ON public.cycle_settlements FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: cycle_settlements cycle_settlements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cycle_settlements_select ON public.cycle_settlements FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: cycle_settlements cycle_settlements_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cycle_settlements_update ON public.cycle_settlements FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: cycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: cycles cycles_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cycles_delete ON public.cycles FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: cycles cycles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cycles_insert ON public.cycles FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: cycles cycles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cycles_select ON public.cycles FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: cycles cycles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cycles_update ON public.cycles FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: goal_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.goal_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_transactions goal_transactions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goal_transactions_delete ON public.goal_transactions FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: goal_transactions goal_transactions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goal_transactions_insert ON public.goal_transactions FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: goal_transactions goal_transactions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goal_transactions_select ON public.goal_transactions FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: goal_transactions goal_transactions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goal_transactions_update ON public.goal_transactions FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

--
-- Name: goals goals_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goals_delete ON public.goals FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: goals goals_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goals_insert ON public.goals FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: goals goals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goals_select ON public.goals FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: goals goals_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goals_update ON public.goals FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: income; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.income ENABLE ROW LEVEL SECURITY;

--
-- Name: income income_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY income_delete ON public.income FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: income income_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY income_insert ON public.income FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: income income_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY income_select ON public.income FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: income income_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY income_update ON public.income FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: loan; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan ENABLE ROW LEVEL SECURITY;

--
-- Name: loan loan_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loan_delete ON public.loan FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: loan loan_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loan_insert ON public.loan FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: loan_prepayments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_prepayments ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_prepayments loan_prepayments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loan_prepayments_delete ON public.loan_prepayments FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: loan_prepayments loan_prepayments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loan_prepayments_insert ON public.loan_prepayments FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: loan_prepayments loan_prepayments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loan_prepayments_select ON public.loan_prepayments FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: loan_prepayments loan_prepayments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loan_prepayments_update ON public.loan_prepayments FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: loan loan_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loan_select ON public.loan FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: loan loan_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loan_update ON public.loan FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: plan_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plan_items ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_items plan_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_items_delete ON public.plan_items FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: plan_items plan_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_items_insert ON public.plan_items FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: plan_items plan_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_items_select ON public.plan_items FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: plan_items plan_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_items_update ON public.plan_items FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: plan_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plan_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: plan_templates plan_templates_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_templates_delete ON public.plan_templates FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: plan_templates plan_templates_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_templates_insert ON public.plan_templates FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: plan_templates plan_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_templates_select ON public.plan_templates FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: plan_templates plan_templates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plan_templates_update ON public.plan_templates FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: settings settings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_delete ON public.settings FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: settings settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_insert ON public.settings FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: settings settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_select ON public.settings FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: settings settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_update ON public.settings FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: spends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spends ENABLE ROW LEVEL SECURITY;

--
-- Name: spends spends_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spends_delete ON public.spends FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: spends spends_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spends_insert ON public.spends FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: spends spends_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spends_select ON public.spends FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: spends spends_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spends_update ON public.spends FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _sync_plan_item_money(p_item uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._sync_plan_item_money(p_item uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._sync_plan_item_money(p_item uuid) TO authenticated;
GRANT ALL ON FUNCTION public._sync_plan_item_money(p_item uuid) TO service_role;


--
-- Name: FUNCTION _sync_settlement_money(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._sync_settlement_money(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._sync_settlement_money(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public._sync_settlement_money(p_id uuid) TO service_role;


--
-- Name: FUNCTION add_goal_contribution(p_goal uuid, p_amount numeric, p_source_item uuid, p_from_daily boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_goal_contribution(p_goal uuid, p_amount numeric, p_source_item uuid, p_from_daily boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_goal_contribution(p_goal uuid, p_amount numeric, p_source_item uuid, p_from_daily boolean) TO authenticated;
GRANT ALL ON FUNCTION public.add_goal_contribution(p_goal uuid, p_amount numeric, p_source_item uuid, p_from_daily boolean) TO service_role;


--
-- Name: FUNCTION app_today(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.app_today() FROM PUBLIC;
GRANT ALL ON FUNCTION public.app_today() TO authenticated;
GRANT ALL ON FUNCTION public.app_today() TO service_role;


--
-- Name: FUNCTION cover_shortfall(p_buffer uuid, p_amount numeric, p_item uuid, p_goal uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cover_shortfall(p_buffer uuid, p_amount numeric, p_item uuid, p_goal uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cover_shortfall(p_buffer uuid, p_amount numeric, p_item uuid, p_goal uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cover_shortfall(p_buffer uuid, p_amount numeric, p_item uuid, p_goal uuid) TO service_role;


--
-- Name: FUNCTION delete_goal(p_goal uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_goal(p_goal uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_goal(p_goal uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_goal(p_goal uuid) TO service_role;


--
-- Name: FUNCTION goal_balance(p_goal uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.goal_balance(p_goal uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.goal_balance(p_goal uuid) TO authenticated;
GRANT ALL ON FUNCTION public.goal_balance(p_goal uuid) TO service_role;


--
-- Name: FUNCTION log_income(p_amount numeric, p_source text, p_date date, p_recurring boolean, p_note text, p_split jsonb, p_remember boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_income(p_amount numeric, p_source text, p_date date, p_recurring boolean, p_note text, p_split jsonb, p_remember boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_income(p_amount numeric, p_source text, p_date date, p_recurring boolean, p_note text, p_split jsonb, p_remember boolean) TO authenticated;
GRANT ALL ON FUNCTION public.log_income(p_amount numeric, p_source text, p_date date, p_recurring boolean, p_note text, p_split jsonb, p_remember boolean) TO service_role;


--
--



--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION seed_defaults(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.seed_defaults() FROM PUBLIC;
GRANT ALL ON FUNCTION public.seed_defaults() TO authenticated;
GRANT ALL ON FUNCTION public.seed_defaults() TO service_role;


--
-- Name: FUNCTION set_plan_item(p_item uuid, p_done boolean, p_actual numeric, p_clear_actual boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_plan_item(p_item uuid, p_done boolean, p_actual numeric, p_clear_actual boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_plan_item(p_item uuid, p_done boolean, p_actual numeric, p_clear_actual boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_plan_item(p_item uuid, p_done boolean, p_actual numeric, p_clear_actual boolean) TO service_role;


--
-- Name: FUNCTION set_settlement(p_id uuid, p_done boolean, p_goal uuid, p_set_goal boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_settlement(p_id uuid, p_done boolean, p_goal uuid, p_set_goal boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_settlement(p_id uuid, p_done boolean, p_goal uuid, p_set_goal boolean) TO authenticated;
GRANT ALL ON FUNCTION public.set_settlement(p_id uuid, p_done boolean, p_goal uuid, p_set_goal boolean) TO service_role;


--
-- Name: FUNCTION settle_month(p_cycle uuid, p_amount numeric, p_goal uuid, p_to_loan boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_month(p_cycle uuid, p_amount numeric, p_goal uuid, p_to_loan boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_month(p_cycle uuid, p_amount numeric, p_goal uuid, p_to_loan boolean) TO authenticated;
GRANT ALL ON FUNCTION public.settle_month(p_cycle uuid, p_amount numeric, p_goal uuid, p_to_loan boolean) TO service_role;


--
-- Name: FUNCTION spend_goal_sync(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.spend_goal_sync() TO anon;
GRANT ALL ON FUNCTION public.spend_goal_sync() TO authenticated;
GRANT ALL ON FUNCTION public.spend_goal_sync() TO service_role;


--
-- Name: FUNCTION start_cycle(p_starts_on date, p_salary numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.start_cycle(p_starts_on date, p_salary numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.start_cycle(p_starts_on date, p_salary numeric) TO authenticated;
GRANT ALL ON FUNCTION public.start_cycle(p_starts_on date, p_salary numeric) TO service_role;


--
-- Name: FUNCTION undo_settlement(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.undo_settlement(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.undo_settlement(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.undo_settlement(p_id uuid) TO service_role;


--
-- Name: TABLE cards; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cards TO anon;
GRANT ALL ON TABLE public.cards TO authenticated;
GRANT ALL ON TABLE public.cards TO service_role;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.categories TO anon;
GRANT ALL ON TABLE public.categories TO authenticated;
GRANT ALL ON TABLE public.categories TO service_role;


--
-- Name: TABLE cycle_settlements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cycle_settlements TO anon;
GRANT ALL ON TABLE public.cycle_settlements TO authenticated;
GRANT ALL ON TABLE public.cycle_settlements TO service_role;


--
-- Name: TABLE cycles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cycles TO anon;
GRANT ALL ON TABLE public.cycles TO authenticated;
GRANT ALL ON TABLE public.cycles TO service_role;


--
-- Name: TABLE goal_balances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.goal_balances TO anon;
GRANT ALL ON TABLE public.goal_balances TO authenticated;
GRANT ALL ON TABLE public.goal_balances TO service_role;


--
-- Name: TABLE goal_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.goal_transactions TO anon;
GRANT ALL ON TABLE public.goal_transactions TO authenticated;
GRANT ALL ON TABLE public.goal_transactions TO service_role;


--
-- Name: TABLE goals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.goals TO anon;
GRANT ALL ON TABLE public.goals TO authenticated;
GRANT ALL ON TABLE public.goals TO service_role;


--
-- Name: TABLE income; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.income TO anon;
GRANT ALL ON TABLE public.income TO authenticated;
GRANT ALL ON TABLE public.income TO service_role;


--
-- Name: TABLE loan; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.loan TO anon;
GRANT ALL ON TABLE public.loan TO authenticated;
GRANT ALL ON TABLE public.loan TO service_role;


--
-- Name: TABLE loan_prepayments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.loan_prepayments TO anon;
GRANT ALL ON TABLE public.loan_prepayments TO authenticated;
GRANT ALL ON TABLE public.loan_prepayments TO service_role;


--
-- Name: TABLE plan_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plan_items TO anon;
GRANT ALL ON TABLE public.plan_items TO authenticated;
GRANT ALL ON TABLE public.plan_items TO service_role;


--
-- Name: TABLE plan_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plan_templates TO anon;
GRANT ALL ON TABLE public.plan_templates TO authenticated;
GRANT ALL ON TABLE public.plan_templates TO service_role;


--
-- Name: TABLE settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.settings TO anon;
GRANT ALL ON TABLE public.settings TO authenticated;
GRANT ALL ON TABLE public.settings TO service_role;


--
-- Name: TABLE spends; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.spends TO anon;
GRANT ALL ON TABLE public.spends TO authenticated;
GRANT ALL ON TABLE public.spends TO service_role;


--
-- PostgreSQL database dump complete
--


