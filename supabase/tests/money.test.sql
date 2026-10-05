-- Database behaviour tests. Run with `npm run test:db` (needs DATABASE_URL).
-- Everything happens inside one transaction that is rolled back, using throwaway users:
-- no real data is read or changed.

begin;

-- lets throwaway users past an owner-only sign-up lock, for this transaction only
set local app.allow_test_users = 'on';

insert into auth.users (id, instance_id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-a@example.test'),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-b@example.test');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.bal(r text) returns numeric language sql as $$
  select b.balance from public.goal_balances b join public.goals g on g.id = b.goal_id where g.role = r or g.name = r limit 1;
$$;

set local role authenticated;

-- Seed -----------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select seed_defaults();
select seed_defaults(); -- idempotent
do $$ begin
  assert (select count(*) from cards) = 4, 'seed: 4 cards';
  assert (select count(*) from goals where role is not null) = 4, 'seed: 4 goal roles';
  assert (select count(*) from goals where kind = 'sinking') = 1, 'seed: 1 sinking fund';
  assert (select count(*) from cycles where ends_on is null) = 1, 'seed: one open cycle';
end $$;

-- Row Level Security: user B sees nothing of A and can't write as A --------------------
select pg_temp.as_user('b0000000-0000-0000-0000-000000000002');
do $$ begin
  assert (select count(*) from cards) = 0, 'rls: B sees no cards';
  assert (select count(*) from goals) = 0, 'rls: B sees no goals';
  begin
    insert into spends (user_id, amount) values ('a0000000-0000-0000-0000-000000000001', 5);
    assert false, 'rls: B wrote a spend as A';
  exception when insufficient_privilege or check_violation then null;
           when others then if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');

-- Spend types ------------------------------------------------------------------------------
insert into spends (id, amount, spend_type, goal_id, fund_settle)
  select 'c0000000-0000-0000-0000-000000000001', 300, 'unplanned', id, 'now' from goals where role = 'buffer';
do $$ begin assert pg_temp.bal('buffer') = -300, 'unplanned now: buffer −300'; end $$;

insert into spends (id, amount, spend_type, goal_id, fund_settle)
  select 'c0000000-0000-0000-0000-000000000002', 200, 'unplanned', id, 'bill' from goals where role = 'buffer';
do $$ begin assert pg_temp.bal('buffer') = -300, 'unplanned on card bill: buffer untouched'; end $$;
update spends set fund_settle = 'now', fund_settled_on = app_today() where id = 'c0000000-0000-0000-0000-000000000002';
do $$ begin assert pg_temp.bal('buffer') = -500, 'settle: buffer −200 more'; end $$;
delete from spends where id = 'c0000000-0000-0000-0000-000000000002';
do $$ begin assert pg_temp.bal('buffer') = -300, 'delete spend: withdrawal reversed'; end $$;

do $$ declare d0 date; d1 date; g uuid; begin
  select id, next_due_date into g, d0 from goals where kind = 'sinking';
  insert into spends (id, amount, spend_type, goal_id) values ('c0000000-0000-0000-0000-000000000003', 1000, 'planned', g);
  select next_due_date into d1 from goals where id = g;
  assert d1 = (d0 + make_interval(months => (select cycle_months from goals where id = g)))::date, 'planned: due date moves forward';
  delete from spends where id = 'c0000000-0000-0000-0000-000000000003';
  assert (select next_due_date from goals where id = g) = d0, 'planned deleted: due date moves back';
end $$;

do $$ begin
  begin insert into spends (amount, spend_type) values (10, 'planned'); assert false, 'planned without fund accepted';
  exception when check_violation then null; end;
  assert (select column_default from information_schema.columns where table_name = 'spends' and column_name = 'spent_on') like '%app_today()%',
    'spend date defaults to local today';
end $$;

-- Checklist ------------------------------------------------------------------------------------
do $$ declare it uuid; lt0 numeric; begin
  select id into it from plan_items where goal_id = (select id from goals where role = 'emergency') limit 1;
  lt0 := pg_temp.bal('emergency');
  perform set_plan_item(it, true);
  assert pg_temp.bal('emergency') = lt0 + (select planned from plan_items where id = it), 'tick: deposit = planned';
  perform set_plan_item(it, null, 1234);
  assert pg_temp.bal('emergency') = lt0 + 1234, 'actual change: deposit follows';
  assert (select count(*) from goal_transactions where plan_item_id = it) = 1, 'one deposit per line';
  perform set_plan_item(it, false);
  assert pg_temp.bal('emergency') = lt0, 'untick: deposit removed';
end $$;

-- Settle the month ---------------------------------------------------------------------------------
do $$ declare cyc uuid; trip uuid; s uuid; begin
  select id into cyc from cycles where ends_on is null;
  select id into trip from goals where role = 'trip';
  s := settle_month(cyc, 1500, trip);
  assert pg_temp.bal('trip') = 1500, 'leftover moved to trip';
  begin perform settle_month(cyc, -99999, trip); assert false, 'over-borrow accepted';
  exception when raise_exception then null; end;
  perform undo_settlement(s);
  assert pg_temp.bal('trip') = 0, 'undo leftover';
end $$;

-- Cover a shortfall ---------------------------------------------------------------------------------
do $$ declare it uuid; p0 numeric; b0 numeric; begin
  select id, planned into it, p0 from plan_items where kind = 'fixed' and planned >= 500 and not done limit 1;
  b0 := pg_temp.bal('buffer');
  perform cover_shortfall((select id from goals where role = 'buffer'), 500, p_item := it);
  assert (select planned from plan_items where id = it) = p0 - 500, 'cover: plan line reduced';
  assert pg_temp.bal('buffer') = b0 + 500, 'cover: buffer topped up';
end $$;

-- Income split -------------------------------------------------------------------------------------------
do $$ declare e0 numeric; begin
  e0 := pg_temp.bal('emergency');
  perform log_income(10000, 'Test', null, false, null, jsonb_build_array(jsonb_build_object('goal_id', (select id from goals where role = 'emergency'), 'pct', 30)));
  assert pg_temp.bal('emergency') = e0 + 3000, 'income: 30% to emergency';
  delete from income where source = 'Test';
  assert pg_temp.bal('emergency') = e0, 'income deleted: split reversed';
end $$;

-- Salary day ------------------------------------------------------------------------------------------------
do $$ declare old_cyc uuid; nxt date; begin
  select id into old_cyc from cycles where ends_on is null;
  select (date_trunc('month', starts_on) + interval '1 month')::date into nxt from cycles where id = old_cyc;
  perform start_cycle(nxt, 50000);
  assert (select count(*) from cycles where ends_on is null) = 1, 'rollover: one open cycle';
  assert (select count(*) from cycle_settlements where cycle_id = (select id from cycles where ends_on is null) and kind in ('card_bills', 'daily_result')) = 2,
    'rollover: card bills + daily result settlements';
  assert (select count(*) from plan_items where cycle_id = (select id from cycles where ends_on is null)) > 0, 'rollover: plan copied';
end $$;

select 'ALL DATABASE TESTS PASSED' as result;
rollback;
