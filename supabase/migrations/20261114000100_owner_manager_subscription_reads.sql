-- Owner/Manager-only subscription state, history, amounts and receipts.
--
-- Owner and Manager have approved access to the account's subscription record.
-- Cashier and Kitchen still need the plan's operational gates, so those stay
-- available as a membership-checked entitlement projection; the operational
-- projection omits plan/status dates, account identifiers, outlet allowances,
-- payment details and receipt data.
--
-- This is a database boundary. The subscription route's RoleGate is only an
-- additional UI layer: every direct table read and every billing read RPC is
-- restricted here as well.

-- The old per-restaurant account link and plan columns are retained for
-- historical compatibility, not as the Model C source of truth. Do not let
-- them become a staff-side route around accounts_read. Revoke table-level
-- SELECT, then grant the currently existing non-billing columns back to
-- authenticated staff. The dynamic list keeps future-added columns closed by
-- default until a migration grants them.
revoke select on table public.restaurants from public, anon, authenticated;

-- A table-level REVOKE does not remove individual column-level ACL entries.
-- Clear every existing column grant from API roles before rebuilding the
-- authenticated allow-list below, including any historical grant not known to
-- this migration. Trusted service-role privileges remain unchanged.
do $$
declare
  v_all_columns text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_all_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.restaurants'::regclass
     and a.attnum > 0
     and not a.attisdropped;

  if v_all_columns is null then
    raise exception 'Could not enumerate public.restaurants columns for privilege cleanup';
  end if;

  execute format(
    'revoke select (%s) on table public.restaurants from public, anon, authenticated',
    v_all_columns
  );
end;
$$;

do $$
declare
  v_safe_columns text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_safe_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.restaurants'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in (
       'account_id', 'plan', 'plan_status', 'trial_started_at', 'plan_started_at', 'plan_expires_at'
     );

  if v_safe_columns is null then
    raise exception 'Could not enumerate safe public.restaurants columns';
  end if;

  execute format(
    'grant select (%s) on table public.restaurants to authenticated',
    v_safe_columns
  );
end;
$$;

-- RLS policies on account-scoped tables must not read restaurants.account_id
-- as the caller: that column is deliberately withheld from the direct staff
-- projection above. Resolve the relationship under a fixed-search_path definer
-- function, while binding every answer to the JWT user and requested roles.
create or replace function public.has_account_role(
  p_account_id uuid,
  p_roles text[]
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.restaurants r
      join public.memberships m on m.restaurant_id = r.id
     where r.account_id = p_account_id
       and m.user_id = auth.uid()
       and m.role::text = any (p_roles)
  );
$$;

comment on function public.has_account_role(uuid, text[]) is
  'True when the JWT user has one of the requested roles on any outlet attached to the account; used by account-scoped RLS without granting direct SELECT on restaurants.account_id.';
revoke all on function public.has_account_role(uuid, text[]) from public, anon;
grant execute on function public.has_account_role(uuid, text[]) to authenticated, service_role;

-- Preserve the existing member-visible count semantics without requiring
-- direct SELECT on account_id. Owners/Managers can see the account total;
-- operational staff see only outlets where they themselves hold a membership.
-- Definer callers such as restaurant_access can still compute the full count,
-- and trusted service-role callers without a user subject retain the operator
-- result.
create or replace function public.account_outlet_count(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.restaurants r
   where r.account_id = p_account_id
     and (
       auth.uid() is null
       or public.has_account_role(p_account_id, array['owner', 'manager'])
       or public.has_restaurant_role(r.id, array['owner', 'manager', 'cashier', 'kitchen'])
     );
$$;

comment on function public.account_outlet_count(uuid) is
  'Counts the whole account for Owner/Manager and trusted no-user callers; other staff see only the outlets they belong to.';
revoke all on function public.account_outlet_count(uuid) from public, anon;
grant execute on function public.account_outlet_count(uuid) to authenticated, service_role;

-- Direct account rows (plan, state and dates) are visible only to an Owner or
-- Manager of at least one outlet on that account. The role check is based on
-- memberships, not on the caller-supplied account id alone.
drop policy if exists accounts_read on public.accounts;
drop policy if exists accounts_owner_manager_read on public.accounts;
create policy accounts_owner_manager_read on public.accounts
  for select
  using (public.has_account_role(public.accounts.id, array['owner', 'manager']));

-- Subscription event history, payment amounts and immutable receipts have the
-- same Owner/Manager-only direct-RLS boundary.
drop policy if exists subscription_payments_member_read on public.subscription_payments;
drop policy if exists subscription_payments_owner_manager_read on public.subscription_payments;
create policy subscription_payments_owner_manager_read on public.subscription_payments
  for select
  using (public.has_account_role(public.subscription_payments.account_id, array['owner', 'manager']));

drop policy if exists subscription_receipts_member_read on public.subscription_receipts;
drop policy if exists subscription_receipts_owner_manager_read on public.subscription_receipts;
create policy subscription_receipts_owner_manager_read on public.subscription_receipts
  for select
  using (public.has_account_role(public.subscription_receipts.account_id, array['owner', 'manager']));

drop policy if exists subscription_events_member_read on public.subscription_events;
drop policy if exists subscription_events_owner_manager_read on public.subscription_events;
create policy subscription_events_owner_manager_read on public.subscription_events
  for select
  using (public.has_account_role(public.subscription_events.account_id, array['owner', 'manager']));

-- One account's current operational feature matrix. Staff may call this only
-- for a restaurant they belong to. It is SECURITY DEFINER because accounts_read
-- is now narrower; the explicit membership predicate is the authorization.
create or replace function public.restaurant_features(p_restaurant_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select public.plan_features(coalesce(a.plan, r.plan, 'trial'))
        from public.restaurants r
        join public.memberships m on m.restaurant_id = r.id
        left join public.accounts a on a.id = r.account_id
       where r.id = p_restaurant_id
         and m.user_id = auth.uid()
       limit 1
    ),
    array[]::text[]
  );
$$;

-- A trial end is subscription state, not an operational gate. Keep it
-- Owner/Manager-only even for legacy unlinked restaurants.
create or replace function public.restaurant_trial_ends_at(p_restaurant_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
             (
               select coalesce(
                        a.trial_ends_at,
                        a.trial_started_at + interval '21 days',
                        r.trial_started_at + interval '21 days'
                      )
                 from public.restaurants r
                 left join public.accounts a on a.id = r.account_id
                where r.id = p_restaurant_id
             )
           else null
         end;
$$;

-- Keep feature and write gates useful to every staff role, without returning
-- subscription state to Cashier or Kitchen. Owner/Manager retain the detailed
-- plan/trial/outlet presentation used on owner-facing screens.
create or replace function public.restaurant_access(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_account uuid;
  v_role    text;
  v_plan    text;
  v_status  text;
  v_trial   timestamptz;
  v_expires timestamptz;
  v_can     boolean;
  v_used    integer;
  v_limit   integer;
begin
  if v_user is null then
    return null;
  end if;

  select r.account_id, m.role::text
    into v_account, v_role
    from public.restaurants r
    join public.memberships m on m.restaurant_id = r.id
   where r.id = p_restaurant_id
     and m.user_id = v_user;

  if not found then
    return null;
  end if;

  select a.plan, a.plan_status,
         coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days'),
         a.plan_expires_at
    into v_plan, v_status, v_trial, v_expires
    from public.accounts a
   where a.id = v_account;

  if not found then
    -- An unlinked legacy restaurant keeps the old gate and feature fallback.
    select r.plan, coalesce(r.plan_status, 'trialing'),
           r.trial_started_at + interval '21 days', r.plan_expires_at
      into v_plan, v_status, v_trial, v_expires
      from public.restaurants r
     where r.id = p_restaurant_id;
  end if;

  v_can := public.restaurant_can_write(p_restaurant_id);

  if v_role not in ('owner', 'manager') then
    return jsonb_build_object(
      'can_write', v_can,
      'read_only', not v_can,
      'features', to_jsonb(public.restaurant_features(p_restaurant_id))
    );
  end if;

  v_used := case when v_account is null then 1 else public.account_outlet_count(v_account) end;
  v_limit := public.account_outlet_limit(v_plan);

  return jsonb_build_object(
    'plan',            v_plan,
    'status',          v_status,
    'account_id',      v_account,
    'trial_ends_at',   v_trial,
    'plan_expires_at', v_expires,
    'days_remaining',
      case
        when v_can and v_plan not in ('starter', 'professional', 'business')
          then greatest(ceil(extract(epoch from (v_trial - now())) / 86400.0), 0)::int
        else 0
      end,
    'can_write',       v_can,
    'read_only',       not v_can,
    'features',        to_jsonb(public.restaurant_features(p_restaurant_id)),
    'outlets', jsonb_build_object(
      'used',      v_used,
      'limit',     v_limit,
      'unlimited', v_limit is null,
      'remaining', case when v_limit is null then null else greatest(v_limit - v_used, 0) end
    )
  );
end;
$$;

comment on function public.restaurant_access(uuid) is
  'Membership-checked operational entitlement read. Owner/Manager receive plan and trial details; Cashier/Kitchen receive only write-gate and feature data.';
comment on function public.restaurant_features(uuid) is
  'Membership-checked feature matrix for operational gating; available to all restaurant staff roles.';
comment on function public.restaurant_trial_ends_at(uuid) is
  'Owner/Manager-only trial end read. Returns null to other roles and non-members.';

-- Every SECURITY DEFINER read above has an explicit role or membership check.
-- Preserve the existing authenticated/service-role API, while keeping anon out.
revoke all on function public.restaurant_access(uuid) from public, anon;
revoke all on function public.restaurant_features(uuid) from public, anon;
revoke all on function public.restaurant_trial_ends_at(uuid) from public, anon;
grant execute on function public.restaurant_access(uuid) to authenticated, service_role;
grant execute on function public.restaurant_features(uuid) to authenticated, service_role;
grant execute on function public.restaurant_trial_ends_at(uuid) to authenticated, service_role;

-- Billing read RPCs. All remain executable by the shared authenticated role,
-- so each function enforces its own Owner/Manager membership check. Non-owners,
-- non-managers and non-members get the same null result.
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
    'expired', a.plan_status in ('expired', 'cancelled'),
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

create or replace function public.account_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row  jsonb;
begin
  if v_user is null then
    return null;
  end if;

  select jsonb_build_object(
           'id', rc.id,
           'receiptNumber', rc.receipt_number,
           'plan', rc.plan,
           'planLabel', rc.plan_label,
           'amountPaise', rc.amount_paise,
           'currency', rc.currency,
           'periodStart', rc.period_start,
           'periodEnd', rc.period_end,
           'paidAt', rc.paid_at,
           'issuedAt', rc.issued_at,
           'provider', rc.provider,
           'accountId', rc.account_id,
           'restaurantName', (
             select r.name from public.restaurants r
              where r.account_id = rc.account_id order by r.created_at, r.id limit 1
           )
         )
    into v_row
    from public.subscription_receipts rc
   where rc.id = p_receipt_id
     and exists (
       select 1
         from public.restaurants r
        where r.account_id = rc.account_id
          and public.has_restaurant_role(r.id, array['owner', 'manager'])
     );

  return v_row;
end;
$$;

comment on function public.account_subscription_state(uuid) is
  'Owner/Manager-only subscription state read. Other roles and non-members receive null.';
comment on function public.account_subscription_history(uuid, integer) is
  'Owner/Manager-only history read. Applies the caller-requested limit, clamped to 1..50, before JSON aggregation.';
comment on function public.account_payment_history(uuid, integer) is
  'Owner/Manager-only payment history read. Applies the caller-requested limit, clamped to 1..50, before JSON aggregation.';
comment on function public.account_receipt(uuid) is
  'Owner/Manager-only immutable receipt read. Other roles, non-members and missing receipts all receive null.';

revoke all on function public.account_subscription_state(uuid) from public, anon;
revoke all on function public.account_subscription_history(uuid, integer) from public, anon;
revoke all on function public.account_payment_history(uuid, integer) from public, anon;
revoke all on function public.account_receipt(uuid) from public, anon;
grant execute on function public.account_subscription_state(uuid) to authenticated, service_role;
grant execute on function public.account_subscription_history(uuid, integer) to authenticated, service_role;
grant execute on function public.account_payment_history(uuid, integer) to authenticated, service_role;
grant execute on function public.account_receipt(uuid) to authenticated, service_role;
