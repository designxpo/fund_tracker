-- Budget planning never marks a payment done or changes an actual amount.
alter table public.plan_months add column if not exists salary numeric check (salary >= 0 and salary < 'Infinity'::numeric);

create table if not exists public.category_month_caps (
  user_id uuid not null default auth.uid() references auth.users,
  month date not null check (extract(day from month) = 1),
  category_id uuid not null references public.categories on delete cascade,
  amount numeric not null check (amount >= 0 and amount < 'Infinity'::numeric),
  primary key (user_id, month, category_id)
);
alter table public.category_month_caps enable row level security;
drop policy if exists category_caps_read on public.category_month_caps;
drop policy if exists category_caps_write on public.category_month_caps;
create policy category_caps_read on public.category_month_caps for select using (user_id = auth.uid());
create policy category_caps_write on public.category_month_caps for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.categories c where c.id = category_id and c.user_id = auth.uid()));
grant select, insert, update, delete on public.category_month_caps to authenticated;

create or replace function public.save_budget(p_month date, p_salary numeric, p_daily numeric, p_items jsonb, p_cards jsonb, p_categories jsonb)
returns void language plpgsql set search_path = public as $$
declare
  uid uuid := auth.uid();
  cyc cycles%rowtype;
  row jsonb;
  item_id uuid;
  position integer := 0;
begin
  if uid is null then raise exception 'Sign in to save your budget'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select * into cyc from cycles where user_id = uid and ends_on is null order by starts_on desc limit 1 for update;
  if cyc.id is null or p_month is null or extract(day from p_month) <> 1 or p_month < date_trunc('month',cyc.starts_on)::date then
    raise exception 'Choose the current month or a future month';
  end if;
  if p_salary is null or p_salary < 0 or p_salary >= 'Infinity'::numeric or p_daily is null or p_daily < 0 or p_daily >= 'Infinity'::numeric then
    raise exception 'Salary and daily cap must be finite, non-negative amounts';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_cards) is distinct from 'array' or jsonb_typeof(p_categories) is distinct from 'array' then
    raise exception 'Invalid budget';
  end if;

  if p_month = date_trunc('month',cyc.starts_on)::date then
    update cycles set salary = p_salary, daily_budget = p_daily where id = cyc.id;
  end if;
  insert into plan_months(user_id,month,daily_budget,salary) values(uid,p_month,p_daily,p_salary)
    on conflict(user_id,month) do update set daily_budget=excluded.daily_budget,salary=excluded.salary;

  -- Future templates are a snapshot. Current paid items keep their actuals and status.
  if p_month > date_trunc('month',cyc.starts_on)::date then
    delete from plan_templates where user_id=uid and month=p_month;
  end if;
  for row in select value from jsonb_array_elements(p_items) loop
    position := position + 1;
    if nullif(trim(row->>'name'),'') is null or length(row->>'name') > 120
      or (row->>'kind') is null or (row->>'kind') not in ('fixed','loan','buffer','savings','prepayment')
      or (row->>'planned') is null or (row->>'planned')::numeric < 0 or (row->>'planned')::numeric >= 'Infinity'::numeric then
      raise exception 'Each plan item needs a name and a valid amount';
    end if;
    if nullif(row->>'goal_id','') is not null and not exists(select 1 from goals where id=(row->>'goal_id')::uuid and user_id=uid) then
      raise exception 'Goal not found';
    end if;
    if nullif(row->>'loan_id','') is not null and not exists(select 1 from loan where id=(row->>'loan_id')::uuid and user_id=uid) then
      raise exception 'Loan not found';
    end if;
    if p_month = date_trunc('month',cyc.starts_on)::date then
      item_id := (row->>'id')::uuid;
      if exists(select 1 from plan_items where id=item_id and user_id=uid and cycle_id=cyc.id) then
        update plan_items set planned=(row->>'planned')::numeric where id=item_id and planned is distinct from (row->>'planned')::numeric;
      else
        insert into plan_items(id,user_id,cycle_id,name,kind,goal_id,loan_id,planned)
          values(item_id,uid,cyc.id,row->>'name',row->>'kind',nullif(row->>'goal_id','')::uuid,nullif(row->>'loan_id','')::uuid,(row->>'planned')::numeric);
      end if;
    else
      insert into plan_templates(user_id,month,name,kind,goal_id,loan_id,planned,sort_order)
        values(uid,p_month,row->>'name',row->>'kind',nullif(row->>'goal_id','')::uuid,nullif(row->>'loan_id','')::uuid,(row->>'planned')::numeric,position);
    end if;
  end loop;

  for row in select value from jsonb_array_elements(p_cards) loop
    if (row->>'amount') is null or (row->>'amount')::numeric <= 0 or (row->>'amount')::numeric >= 'Infinity'::numeric then raise exception 'Credit card caps must be greater than zero'; end if;
    update cards set monthly_cap=(row->>'amount')::numeric where id=(row->>'id')::uuid and user_id=uid and monthly_cap > 0;
    if not found then raise exception 'Card not found'; end if;
  end loop;
  delete from category_month_caps where user_id=uid and month=p_month;
  for row in select value from jsonb_array_elements(p_categories) loop
    if not exists(select 1 from categories where id=(row->>'id')::uuid and user_id=uid) then raise exception 'Category not found'; end if;
    insert into category_month_caps(user_id,month,category_id,amount) values(uid,p_month,(row->>'id')::uuid,(row->>'amount')::numeric);
  end loop;
end $$;
revoke all on function public.save_budget(date,numeric,numeric,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.save_budget(date,numeric,numeric,jsonb,jsonb,jsonb) to authenticated;
