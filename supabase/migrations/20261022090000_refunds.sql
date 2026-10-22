-- Refunds: money back on a card or account is a spend with a negative amount. Totals, card caps,
-- card bills and the daily budget all net it out; a refund of a planned/unplanned spend goes back
-- into its fund through the same trigger.

alter table spends drop constraint spends_amount_check;
alter table spends add constraint spends_amount_check check (amount <> 0);

-- Same as before, except a refund doesn't move a sinking fund's due date (only a purchase does).
create or replace function spend_goal_sync() returns trigger
language plpgsql set search_path = public as $$
declare
  old_sink uuid;
  new_sink uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from goal_transactions where spend_id = old.id;
    if old.spend_type = 'planned' and old.amount > 0 then
      select id into old_sink from goals where id = old.goal_id and kind = 'sinking';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    -- money only leaves the fund once settled (a refund puts it back)
    if new.spend_type in ('planned', 'unplanned') and new.goal_id is not null and new.fund_settle = 'now' then
      insert into goal_transactions (user_id, goal_id, amount, note, happened_on, spend_id)
      values (
        new.user_id, new.goal_id, -new.amount,
        (case when new.amount < 0 then 'Refund' when new.spend_type = 'planned' then 'Planned spend' else 'Unplanned spend' end)
          || coalesce(': ' || new.note, ''),
        coalesce(new.fund_settled_on, new.spent_on), new.id
      );
    end if;
    -- the purchase happened, so the sinking fund's cycle moves on regardless of settlement
    if new.spend_type = 'planned' and new.amount > 0 then
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
