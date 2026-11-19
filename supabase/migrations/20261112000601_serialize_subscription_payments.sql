-- 20261112000600 — Serialize subscription payment events per account.
--
-- Three defects, one root cause: payment events were recorded after an
-- unlocked read of the replay ledger and the account row.
--
--   1. Two concurrent deliveries of the same provider event could both pass
--      the replay check, and both reach the insert. The unique index on
--      (provider, provider_event_id) stopped the second insert at the table
--      level, but the caller got a raw constraint violation instead of the
--      documented duplicate result.
--   2. Two concurrent payments with DIFFERENT event ids (a retry racing the
--      original, or two periods bought together) both computed the period as
--      greatest(plan_expires_at, now()) from the same pre-payment view. The
--      second commit then overwrote plan_expires_at with a period ending a
--      month after the ORIGINAL expiry, silently discarding the first
--      payment's month. Consecutive renewals must stack.
--   3. The 'renewed'/'plan_changed' event read the account's plan AFTER the
--      UPDATE had already set it to the new plan, so from_plan was recorded
--      as the plan just paid for and the case expression always yielded
--      'renewed'. The history must name the plan the account was on before
--      the payment.
--
-- This migration keeps every signature, the SECURITY DEFINER mode, the fixed
-- search_path and the existing EXECUTE grants. It changes only the locking
-- and the bookkeeping:
--
--   * After the account is resolved (an account name is still how an operator
--     and a provider refer to a customer), the account row is locked FOR
--     UPDATE before the replay check runs.
--   * The replay check is re-run inside the lock, so a second delivery of the
--     same event returns the duplicate result instead of an error.
--   * The period is computed from the locked row, so consecutive renewals
--     extend the previous period end instead of replacing it.
--   * The prior plan is captured before the UPDATE and recorded as from_plan.
--
-- Nothing about amounts, currencies, prices, receipts, the failure rules or
-- the refund semantics changes. No money moves and no provider is called.

create or replace function public.record_subscription_payment(
  p_restaurant_name  text,
  p_provider         text,
  p_provider_event_id text,
  p_plan             text,
  p_amount_paise     bigint,
  p_currency         text default 'INR',
  p_months           integer default 1,
  p_occurred_at      timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account    uuid;
  v_found      integer;
  v_expected   bigint;
  v_months     integer := greatest(coalesce(p_months, 1), 1);
  v_start      timestamptz;
  v_end        timestamptz;
  v_payment    uuid;
  v_receipt    text;
  v_existing   jsonb;
  v_prior_plan text;
begin
  if coalesce(btrim(coalesce(p_provider, '')), '') = '' then
    raise exception 'provider_required' using errcode = 'P0001';
  end if;
  if coalesce(btrim(coalesce(p_provider_event_id, '')), '') = '' then
    raise exception 'provider_event_required' using errcode = 'P0001';
  end if;

  if public.plan_price_paise(p_plan) is null then
    raise exception 'plan_invalid' using errcode = 'P0001';
  end if;

  if coalesce(p_currency, 'INR') <> 'INR' then
    raise exception 'currency_mismatch' using errcode = 'P0001';
  end if;

  v_expected := public.plan_price_paise(p_plan) * v_months;
  if coalesce(p_amount_paise, 0) <> v_expected then
    raise exception 'amount_mismatch' using errcode = 'P0001';
  end if;

  -- Which account? By the name of one of its restaurants, which is how an
  -- operator and a provider both refer to a customer.
  select count(distinct r.account_id), min(r.account_id::text)::uuid
    into v_found, v_account
    from public.restaurants r
   where lower(btrim(r.name)) = lower(btrim(coalesce(p_restaurant_name, '')))
     and r.account_id is not null;

  if v_found = 0 then
    raise exception 'restaurant_not_found' using errcode = 'P0001';
  end if;
  if v_found > 1 then
    raise exception 'restaurant_ambiguous' using errcode = 'P0001';
  end if;

  -- Serialize payment events for this account: concurrent deliveries of the
  -- same event re-read the ledger inside the lock, and consecutive renewals
  -- see each other's periods.
  perform 1 from public.accounts a where a.id = v_account for update;

  -- Replay protection, re-checked after the lock. The same provider event is
  -- recorded exactly once.
  select jsonb_build_object('payment_id', p.id, 'receipt_number', rc.receipt_number)
    into v_existing
    from public.subscription_payments p
    left join public.subscription_receipts rc on rc.payment_id = p.id
   where p.provider = p_provider
     and p.provider_event_id = p_provider_event_id;

  if v_existing is not null then
    return jsonb_build_object('status', 'duplicate', 'payment', v_existing);
  end if;

  -- The prior plan, captured before the account is updated, so the history
  -- records the plan the account is leaving — not the one just paid for.
  -- The period starts when the current one ends, or now if none is running.
  select a.plan,
         case when a.plan_status in ('active', 'past_due', 'cancel_requested')
              then greatest(coalesce(a.plan_expires_at, now()), now())
              else null end
    into v_prior_plan, v_start
    from public.accounts a
   where a.id = v_account;

  if v_start is null then
    v_start := coalesce(p_occurred_at, now());
  end if;
  v_end := v_start + make_interval(months => v_months);

  insert into public.subscription_payments (
    account_id, plan, amount_paise, currency, status,
    period_start, period_end, provider, provider_event_id, occurred_at
  ) values (
    v_account, p_plan, p_amount_paise, 'INR', 'succeeded',
    v_start, v_end, p_provider, p_provider_event_id, coalesce(p_occurred_at, now())
  )
  returning id into v_payment;

  update public.accounts a
     set plan             = p_plan,
         plan_status      = 'active',
         plan_started_at  = coalesce(a.plan_started_at, v_start),
         plan_expires_at  = v_end,
         -- Paying cancels a pending cancellation: the owner changed their mind
         -- by paying for the next period.
         cancel_requested_at = null,
         cancel_effective_at = null,
         updated_at       = now()
   where a.id = v_account;

  v_receipt := 'AD-SUB-' || to_char(now(), 'YYYY') || '-' ||
               lpad(nextval('public.subscription_receipt_seq')::text, 6, '0');

  insert into public.subscription_receipts (
    receipt_number, account_id, payment_id, plan, plan_label,
    amount_paise, currency, period_start, period_end, paid_at, provider
  ) values (
    v_receipt, v_account, v_payment, p_plan, initcap(p_plan),
    p_amount_paise, 'INR', v_start, v_end, coalesce(p_occurred_at, now()), p_provider
  );

  insert into public.subscription_events (
    account_id, kind, from_plan, to_plan, amount_paise, currency, provider, actor, note
  )
  values (v_account,
          case when v_prior_plan = p_plan then 'renewed' else 'plan_changed' end,
          v_prior_plan, p_plan, p_amount_paise, 'INR', p_provider, 'provider',
          'Period ' || to_char(v_start, 'DD Mon YYYY') || ' to ' || to_char(v_end, 'DD Mon YYYY'));

  insert into public.subscription_events (
    account_id, kind, to_plan, amount_paise, currency, provider, actor, note
  ) values (v_account, 'payment_succeeded', p_plan, p_amount_paise, 'INR', p_provider, 'provider', v_receipt);

  return jsonb_build_object(
    'status', 'recorded',
    'account_id', v_account,
    'payment_id', v_payment,
    'receipt_number', v_receipt,
    'period_start', v_start,
    'period_end', v_end
  );
end;
$$;

revoke all on function public.record_subscription_payment(text, text, text, text, bigint, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.record_subscription_payment(text, text, text, text, bigint, text, integer, timestamptz) to service_role;

-- A failed payment: the plan keeps working until its period ends, and the
-- dashboard says so. This never removes access on its own.
create or replace function public.record_subscription_payment_failure(
  p_restaurant_name   text,
  p_provider          text,
  p_provider_event_id text,
  p_plan              text,
  p_amount_paise      bigint,
  p_reason            text default null,
  p_occurred_at       timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid;
  v_found   integer;
  v_payment uuid;
begin
  if coalesce(btrim(coalesce(p_provider_event_id, '')), '') = '' then
    raise exception 'provider_event_required' using errcode = 'P0001';
  end if;

  select count(distinct r.account_id), min(r.account_id::text)::uuid
    into v_found, v_account
    from public.restaurants r
   where lower(btrim(r.name)) = lower(btrim(coalesce(p_restaurant_name, '')))
     and r.account_id is not null;

  if v_found = 0 then
    raise exception 'restaurant_not_found' using errcode = 'P0001';
  end if;
  if v_found > 1 then
    raise exception 'restaurant_ambiguous' using errcode = 'P0001';
  end if;

  -- Serialize against payments being recorded for the same account, then
  -- re-check the replay ledger inside the lock.
  perform 1 from public.accounts a where a.id = v_account for update;

  if exists (
    select 1 from public.subscription_payments p
     where p.provider = p_provider and p.provider_event_id = p_provider_event_id
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.subscription_payments (
    account_id, plan, amount_paise, currency, status,
    provider, provider_event_id, failure_reason, occurred_at
  ) values (
    v_account, coalesce(p_plan, (select a.plan from public.accounts a where a.id = v_account)),
    coalesce(p_amount_paise, 0), 'INR', 'failed',
    p_provider, p_provider_event_id, p_reason, coalesce(p_occurred_at, now())
  )
  returning id into v_payment;

  -- Only a paid plan that is still inside its period can go past due: a failed
  -- charge on an expired trial changes nothing, because there was nothing to
  -- take away.
  update public.accounts a
     set plan_status = 'past_due',
         updated_at  = now()
   where a.id = v_account
     and a.plan in ('starter', 'professional', 'business')
     and coalesce(a.plan_expires_at, now()) > now();

  insert into public.subscription_events (
    account_id, kind, amount_paise, currency, provider, actor, note
  ) values (
    v_account, 'payment_failed', coalesce(p_amount_paise, 0), 'INR', p_provider, 'provider',
    left(coalesce(p_reason, 'The payment did not go through.'), 300)
  );

  return jsonb_build_object('status', 'recorded', 'account_id', v_account, 'payment_id', v_payment);
end;
$$;

revoke all on function public.record_subscription_payment_failure(text, text, text, text, bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_subscription_payment_failure(text, text, text, text, bigint, text, timestamptz) to service_role;

-- A refund is recorded as its own event, never as an edit of the payment it
-- refunds. Same serialization: lock the account, then re-check the replay
-- ledger inside the lock.
create or replace function public.record_subscription_refund(
  p_restaurant_name   text,
  p_provider          text,
  p_provider_event_id text,
  p_reference         text default null,
  p_occurred_at       timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid;
  v_found   integer;
  v_original public.subscription_payments;
  v_payment uuid;
begin
  if coalesce(btrim(coalesce(p_provider_event_id, '')), '') = '' then
    raise exception 'provider_event_required' using errcode = 'P0001';
  end if;

  select count(distinct r.account_id), min(r.account_id::text)::uuid
    into v_found, v_account
    from public.restaurants r
   where lower(btrim(r.name)) = lower(btrim(coalesce(p_restaurant_name, '')))
     and r.account_id is not null;

  if v_found = 0 then
    raise exception 'restaurant_not_found' using errcode = 'P0001';
  end if;
  if v_found > 1 then
    raise exception 'restaurant_ambiguous' using errcode = 'P0001';
  end if;

  -- Serialize against payments and refunds for the same account, then
  -- re-check the replay ledger inside the lock.
  perform 1 from public.accounts a where a.id = v_account for update;

  if exists (
    select 1 from public.subscription_payments p
     where p.provider = p_provider and p.provider_event_id = p_provider_event_id
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  select * into v_original
    from public.subscription_payments p
   where p.account_id = v_account
     and (p.provider_reference = p_reference or p.provider_event_id = p_reference)
     and p.status = 'succeeded'
   order by p.occurred_at desc
   limit 1;

  if v_original.id is null then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;

  insert into public.subscription_payments (
    account_id, plan, amount_paise, currency, status,
    provider, provider_event_id, provider_reference, occurred_at
  ) values (
    v_account, v_original.plan, v_original.amount_paise, v_original.currency, 'refunded',
    p_provider, p_provider_event_id, v_original.provider_reference, coalesce(p_occurred_at, now())
  )
  returning id into v_payment;

  insert into public.subscription_events (account_id, kind, amount_paise, currency, provider, actor, note)
  values (v_account, 'payment_failed', v_original.amount_paise, v_original.currency, p_provider, 'provider',
          'Refund recorded. Access is unchanged: ending a subscription for a refund is decided with the owner.');

  return jsonb_build_object('status', 'recorded', 'account_id', v_account, 'payment_id', v_payment);
end;
$$;

revoke all on function public.record_subscription_refund(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_subscription_refund(text, text, text, text, timestamptz) to service_role;
