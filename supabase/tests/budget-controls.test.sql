-- All users, budgets and payments here are temporary and rolled back.
begin;
set local app.allow_test_users = 'on';
insert into auth.users(id,instance_id,aud,role,email) values
 ('d0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','budget-a@example.test'),
 ('d0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','budget-b@example.test');
select set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select seed_defaults();
select set_config('app.foreign_category',(select id::text from categories limit 1),true);
select set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select seed_defaults();

do $$ declare
 c cycles%rowtype; paid plan_items%rowtype; category uuid; payload jsonb; before_balance numeric;
begin
 select * into c from cycles where ends_on is null;
 select * into paid from plan_items where kind='savings' limit 1;
 perform set_plan_item(paid.id,p_done:=true,p_actual:=123);
 select sum(balance) into before_balance from goal_balances;
 select id into category from categories limit 1;
 payload := jsonb_build_array(jsonb_build_object('id',paid.id,'name',paid.name,'kind',paid.kind,'goal_id',paid.goal_id,'planned',500));
 perform save_budget(date_trunc('month',c.starts_on)::date,62000,400,payload,'[]',jsonb_build_array(jsonb_build_object('id',category,'amount',0)));
 assert (select actual=123 and done and planned=500 from plan_items where id=paid.id),'Paid actual/status must survive plan edits';
 assert (select sum(balance) from goal_balances)=before_balance,'Plan edit must not move savings';
 assert (select daily_budget from cycles where id=c.id)=400,'Current cap applied';
 assert (select amount from category_month_caps where category_id=category)=0,'Zero cap retained';

 perform save_budget((date_trunc('month',c.starts_on)+interval '1 month')::date,61000,350,payload,'[]','[]');
 assert (select salary from cycles where id=c.id)=62000,'Future salary must not change current salary';
 assert (select actual from plan_items where id=paid.id)=123,'Future plan must not touch payment';
 assert (select salary from plan_months where month=(date_trunc('month',c.starts_on)+interval '1 month')::date)=61000,'Expected salary saved';
 assert (select count(*) from plan_templates where month=(date_trunc('month',c.starts_on)+interval '1 month')::date)=1,'Future snapshot created';

 begin
   perform save_budget(date_trunc('month',c.starts_on)::date,1,1,payload,'[]',jsonb_build_array(jsonb_build_object('id',current_setting('app.foreign_category'),'amount',100)));
   raise exception 'Cross-user category accepted';
 exception when raise_exception then
   if sqlerrm <> 'Category not found' then raise; end if;
 end;
 assert (select salary from cycles where id=c.id)=62000,'Failed save must roll back salary and plan changes';
 assert (select amount from category_month_caps where category_id=category)=0,'Failed save must restore category caps';
 begin
   perform save_budget(date_trunc('month',c.starts_on)::date,62000,-1,payload,'[]','[]');
   raise exception 'Negative cap accepted';
 exception when raise_exception then
   if sqlerrm not like '%non-negative%' then raise; end if;
 end;
end $$;

select set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
do $$ begin assert (select count(*) from category_month_caps)=0,'Category caps isolated by user'; end $$;
select 'BUDGET CONTROLS PASSED';
rollback;
