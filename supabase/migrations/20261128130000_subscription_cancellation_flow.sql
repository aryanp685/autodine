-- The cancellation flow, made exact.
--
-- FIVE THINGS, ALL ABOUT A SUBSCRIPTION THAT IS STOPPING RATHER THAN STARTING
--
--   1. Cancelling a TRIAL no longer locks the restaurant out today. The write
--      gate knew 'cancel_requested' only for paid plans, so an owner who
--      cancelled during the free trial lost write access the moment they
--      pressed the button, while the screen told them the trial still ran.
--      The gate now measures the period that is actually running, whatever the
--      cancellation state says about the renewal.
--
--   2. Asking twice is one request. A second press returns the effective date
--      already recorded and writes nothing: no second history event, no date
--      moved under the owner's feet.
--
--   3. Asking to cancel something that is not running -- an expired account,
--      or a period that has already ended -- is refused with
--      'nothing_to_cancel' instead of recording a cancellation dated in the
--      past.
--
--   4. A cancellation is only ever effective in the future.
--
--   5. The read model tells "cancelled, still running" from "ended". A
--      provider-confirmed cancellation inside the paid period used to read as
--      expired (plan_status 'cancelled') while every screen still let the
--      owner work; now 'expired' means the period is over, which is exactly
--      what account_can_write already says.

-- ---------------------------------------------------------------------------
-- 1. The write gate: the period that runs, not the label on the renewal.
-- ---------------------------------------------------------------------------
create or replace function public.account_can_write(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
             -- Expired: read-only. Nothing is removed.
             when a.plan_status = 'expired' then false
             -- Cancelled: the period already paid for still runs. A
             -- cancellation stops the NEXT renewal, not today's service --
             -- which is why an owner is never billed for a day they lose.
             when a.plan_status = 'cancelled'
               then coalesce(a.cancel_effective_at, a.plan_expires_at, '-infinity'::timestamptz) > now()
             -- A paid plan, whatever its billing state, until its period ends.
             when a.plan in ('starter', 'professional', 'business')
              and a.plan_status in ('active', 'past_due', 'cancel_requested')
               then coalesce(a.plan_expires_at, 'infinity'::timestamptz) > now()
             -- The trial, measured from the date it was activated. A
             -- cancellation requested during the trial belongs here too: the
             -- 21 days were granted and they are spent, not forfeited.
             when a.plan_status in ('trialing', 'cancel_requested')
               then coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days') > now()
             else false
           end
      from public.accounts a
     where a.id = p_account_id
  ), false);
$$;

revoke all on function public.account_can_write(uuid) from public, anon;
grant execute on function public.account_can_write(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2-4. Requesting the cancellation: idempotent, future-dated, honest.
-- ---------------------------------------------------------------------------
create or replace function public.request_subscription_cancellation(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user         uuid := auth.uid();
  v_account      uuid;
  v_status       text;
  v_requested_at timestamptz;
  v_effective_at timestamptz;
  v_ends         timestamptz;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = 'P0001';
  end if;

  -- Only an owner of a restaurant on this account may cancel it.
  select r.account_id into v_account
    from public.restaurants r
    join public.memberships m on m.restaurant_id = r.id
   where r.id = p_restaurant_id
     and m.user_id = v_user
     and m.role = 'owner'
     and r.account_id is not null;

  if v_account is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- The end of what has been paid for: a paid plan runs to the end of its
  -- period, a trial to the end of its 21 days.
  select a.plan_status,
         a.cancel_requested_at,
         a.cancel_effective_at,
         case
           when a.plan in ('starter', 'professional', 'business')
                and a.plan_expires_at is not null then a.plan_expires_at
           else coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days')
         end
    into v_status, v_requested_at, v_effective_at, v_ends
    from public.accounts a
   where a.id = v_account;

  -- Already asked (or already confirmed): the same date, and nothing written.
  if v_requested_at is not null and v_status in ('cancel_requested', 'cancelled') then
    return jsonb_build_object(
      'account_id', v_account,
      'effective_at', coalesce(v_effective_at, v_ends),
      'status', 'already_requested'
    );
  end if;

  -- Nothing is running: nothing to cancel. A cancellation dated in the past is
  -- not a cancellation, it is a confusing history entry.
  if v_status is null
     or v_status not in ('active', 'past_due', 'trialing')
     or v_ends is null
     or v_ends <= now() then
    raise exception 'nothing_to_cancel' using errcode = 'P0001';
  end if;

  update public.accounts a
     set cancel_requested_at = now(),
         cancel_effective_at = v_ends,
         plan_status = 'cancel_requested',
         updated_at = now()
   where a.id = v_account;

  insert into public.subscription_events (account_id, kind, actor, note)
  values (v_account, 'cancellation_requested', 'owner',
          'Cancellation requested. Access runs until ' || to_char(v_ends, 'DD Mon YYYY') || '.');

  return jsonb_build_object('account_id', v_account, 'effective_at', v_ends, 'status', 'requested');
end;
$$;

revoke all on function public.request_subscription_cancellation(uuid) from public, anon;
grant execute on function public.request_subscription_cancellation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The read model: "ended" means the period is over.
--
--    Re-declared in full (last declared in 20261114000100) so the single
--    changed line cannot drift from the version the screens read.
-- ---------------------------------------------------------------------------
create or replace function public.account_subscription_state(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_account uuid;
  v_result  jsonb;
begin
  if v_user is null
     or not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    return null;
  end if;

  select r.account_id into v_account
    from public.restaurants r
   where r.id = p_restaurant_id
     and r.account_id is not null;

  if v_account is null then
    return null;
  end if;

  select jsonb_build_object(
    'accountId', a.id,
    'plan', a.plan,
    'status', a.plan_status,
    'pricePaise', public.plan_price_paise(a.plan),
    'trial', jsonb_build_object(
      'startedAt', a.trial_started_at,
      'endsAt', coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days'),
      'daysRemaining', case
        when a.plan_status <> 'trialing' then 0
        else greatest(ceil(extract(epoch from (
               coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days') - now())) / 86400)::int, 0)
      end,
      'running', a.plan_status = 'trialing'
                and coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days') > now()
    ),
    'period', jsonb_build_object(
      'startedAt', a.plan_started_at,
      'expiresAt', a.plan_expires_at,
      'endsAt', case
        when a.plan in ('starter', 'professional', 'business') then a.plan_expires_at
        else coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days')
      end
    ),
    'cancellation', case
      when a.cancel_requested_at is null then null
      else jsonb_build_object(
        'requestedAt', a.cancel_requested_at,
        'effectiveAt', a.cancel_effective_at,
        'confirmed', a.plan_status = 'cancelled'
      )
    end,
    'outlets', jsonb_build_object(
      'used', public.account_outlet_count(a.id),
      'limit', public.account_outlet_limit(a.plan),
      'unlimited', public.account_outlet_limit(a.plan) is null,
      'remaining', case
        when public.account_outlet_limit(a.plan) is null then null
        else greatest(public.account_outlet_limit(a.plan) - public.account_outlet_count(a.id), 0)
      end
    ),
    'canWrite', public.account_can_write(a.id),
    'readOnly', not public.account_can_write(a.id),
    'pastDue', a.plan_status = 'past_due',
    -- Ended, not "ending": a cancellation inside a running period still writes,
    -- and a period whose last day has passed reads as ended even between two
    -- runs of the daily sweep.
    'expired', case
      when a.plan_status in ('expired', 'cancelled', 'active', 'past_due', 'trialing', 'cancel_requested')
        then not public.account_can_write(a.id)
      else false
    end,
    'lastPayment', (
      select jsonb_build_object(
               'amountPaise', p.amount_paise,
               'status', p.status,
               'paidAt', p.occurred_at,
               'receipt', rc.receipt_number,
               'failureReason', p.failure_reason
             )
        from public.subscription_payments p
        left join public.subscription_receipts rc on rc.payment_id = p.id
       where p.account_id = a.id
       order by p.occurred_at desc, p.recorded_at desc
       limit 1
    )
  )
    into v_result
    from public.accounts a
   where a.id = v_account;

  return v_result;
end;
$$;

revoke all on function public.account_subscription_state(uuid) from public, anon;
grant execute on function public.account_subscription_state(uuid) to authenticated, service_role;
