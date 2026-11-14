-- Bound subscription history rows before JSON aggregation.
--
-- The earlier functions placed LIMIT on the one-row jsonb_agg result, so it did
-- not bound the rows aggregated. Keep the existing caller-provided limit
-- semantics and membership boundary; select the newest rows first, then build
-- the same JSON response. No new product quota or provider behavior is added.

create or replace function public.account_subscription_history(
  p_restaurant_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_account uuid;
  v_rows    jsonb;
begin
  if v_user is null then
    return null;
  end if;

  select r.account_id into v_account
    from public.restaurants r
    join public.memberships m on m.restaurant_id = r.id
   where r.id = p_restaurant_id
     and m.user_id = v_user
     and r.account_id is not null;

  if v_account is null then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', e.id,
             'kind', e.kind,
             'fromPlan', e.from_plan,
             'toPlan', e.to_plan,
             'amountPaise', e.amount_paise,
             'currency', e.currency,
             'provider', e.provider,
             'actor', e.actor,
             'note', e.note,
             'occurredAt', e.occurred_at
           )
           order by e.occurred_at desc, e.id desc
         ), '[]'::jsonb)
    into v_rows
    from (
      select event.*
        from public.subscription_events event
       where event.account_id = v_account
       order by event.occurred_at desc, event.id desc
       limit greatest(coalesce(p_limit, 50), 1)
    ) e;

  return v_rows;
end;
$$;

revoke all on function public.account_subscription_history(uuid, integer) from public, anon;
grant execute on function public.account_subscription_history(uuid, integer) to authenticated, service_role;
comment on function public.account_subscription_history(uuid, integer) is
  'Account-member history read. Applies the caller-provided row limit before JSON aggregation.';

create or replace function public.account_payment_history(
  p_restaurant_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_account uuid;
  v_rows    jsonb;
begin
  if v_user is null then
    return null;
  end if;

  select r.account_id into v_account
    from public.restaurants r
    join public.memberships m on m.restaurant_id = r.id
   where r.id = p_restaurant_id
     and m.user_id = v_user
     and r.account_id is not null;

  if v_account is null then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', p.id,
             'plan', p.plan,
             'amountPaise', p.amount_paise,
             'currency', p.currency,
             'status', p.status,
             'periodStart', p.period_start,
             'periodEnd', p.period_end,
             'paidAt', p.occurred_at,
             'provider', p.provider,
             'failureReason', p.failure_reason,
             'receipt', rc.receipt_number,
             'receiptId', rc.id
           )
           order by p.occurred_at desc, p.recorded_at desc, p.id desc
         ), '[]'::jsonb)
    into v_rows
    from (
      select payment.*
        from public.subscription_payments payment
       where payment.account_id = v_account
       order by payment.occurred_at desc, payment.recorded_at desc, payment.id desc
       limit greatest(coalesce(p_limit, 50), 1)
    ) p
    left join public.subscription_receipts rc on rc.payment_id = p.id;

  return v_rows;
end;
$$;

revoke all on function public.account_payment_history(uuid, integer) from public, anon;
grant execute on function public.account_payment_history(uuid, integer) to authenticated, service_role;
comment on function public.account_payment_history(uuid, integer) is
  'Account-member payment read. Applies the caller-provided row limit before JSON aggregation.';

-- The read RPCs are intentionally account-member scoped; the screen, not the
-- receipt object, limits plan-changing controls to the account owner.
comment on function public.account_receipt(uuid) is
  'Returns an immutable receipt to a member of its account. Non-members and missing receipts both return null.';
