-- 20261112000600 — enforce an absolute history ceiling inside each RPC.
--
-- The UI requests 50 rows, but an authenticated account member can call the
-- RPC directly with any integer. Keep the existing minimum/default semantics
-- and newest-first ordering while preventing an oversized JSON aggregation.

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
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 50);
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
       limit v_limit
    ) e;

  return v_rows;
end;
$$;

revoke all on function public.account_subscription_history(uuid, integer) from public, anon;
grant execute on function public.account_subscription_history(uuid, integer) to authenticated, service_role;
comment on function public.account_subscription_history(uuid, integer) is
  'Account-member history read. Applies the caller-requested limit, clamped to 1..50, before JSON aggregation.';

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
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 50);
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
       limit v_limit
    ) p
    left join public.subscription_receipts rc on rc.payment_id = p.id;

  return v_rows;
end;
$$;

revoke all on function public.account_payment_history(uuid, integer) from public, anon;
grant execute on function public.account_payment_history(uuid, integer) to authenticated, service_role;
comment on function public.account_payment_history(uuid, integer) is
  'Account-member payment history read. Applies the caller-requested limit, clamped to 1..50, before JSON aggregation.';
