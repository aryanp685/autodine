-- Model C billing: payments, receipts, history, cancellation and trial grants.
--
-- WHAT THIS FILE ADDS, AND WHAT IT DELIBERATELY DOES NOT
--
-- It adds every provider-independent part of a subscription: a payment record,
-- an immutable receipt, a subscription event history, a cancellation request
-- and confirmation, one-trial-per-identity enforcement, and the reads the
-- owner dashboard needs.
--
-- It does NOT create a checkout session, charge anyone, or talk to a payment
-- provider. No provider has been approved, so nothing here can: the function
-- that records money is granted to the service role alone and refuses an
-- amount that is not the plan's price. Until a provider is configured, the
-- application layer fails closed before it reaches any of this.
--
-- MONEY IS INTEGER PAISE. Every amount in this file is a bigint of paise, the
-- currency is 'INR' and nothing else is accepted.
--
-- A subscription receipt is NOT a GST tax invoice. It records money received
-- for a subscription. The tax invoice a restaurant issues to its guest is a
-- different document (restaurant_invoices) and is never confused with this.

-- ---------------------------------------------------------------------------
-- 1. Plan prices, in paise, next to the plan limits.
--
--    The catalog is 999, 2699 and 3699 rupees a month. lib/plans.ts holds the
--    same three numbers, and lib/plans.test.ts parses this function out of the
--    file so the two cannot drift apart silently.
-- ---------------------------------------------------------------------------
create or replace function public.plan_price_paise(p_plan text)
returns bigint
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case p_plan
           -- Rupees times a hundred. The number written here is the one on the
           -- pricing page, so the two can be read against each other instead
           -- of one being a conversion nobody checks.
           when 'starter'      then (999 * 100)::bigint
           when 'professional' then (2699 * 100)::bigint
           when 'business'     then (3699 * 100)::bigint
           else null
         end;
$$;

comment on function public.plan_price_paise(text) is
  'The approved monthly price of a plan, in paise. Null for a plan that is not for sale (trial), so an unknown or unpaid plan cannot be priced at zero by accident.';

-- ---------------------------------------------------------------------------
-- 2. One trial per identity.
--
--    A trial is granted to a PERSON, not to an account. Without this row, an
--    owner who abandons an expired workspace and signs up again gets another
--    21 days, and the trial stops being a trial.
--
--    The grant is recorded when an account is created (signup, first outlet or
--    the backfill below). An account whose owner already holds a grant is
--    created with no trial at all: read-only, nothing deleted, and free to
--    choose a plan.
-- ---------------------------------------------------------------------------
create table if not exists public.trial_grants (
  owner_id    uuid primary key references public.profiles(id) on delete cascade,
  -- Which account used it, for the record. Null once that account is gone:
  -- the grant is a fact about the person, so deleting an account must not
  -- hand them a fresh trial.
  account_id  uuid references public.accounts(id) on delete set null,
  source      text not null default 'signup',
  granted_at  timestamptz not null default now()
);

comment on table public.trial_grants is
  'One row per person who has ever had a trial. The account that owns it is recorded, so the trial cannot be re-issued by creating another account.';

alter table public.trial_grants enable row level security;
revoke all on public.trial_grants from anon, authenticated;

-- Backfill: every account that already exists was created before this rule, so
-- its owner has already had a trial. One grant each, for the earliest account.
insert into public.trial_grants (owner_id, account_id, source)
select distinct on (a.owner_id) a.owner_id, a.id, 'backfill'
  from public.accounts a
 where a.owner_id is not null
 order by a.owner_id, a.created_at, a.id
on conflict (owner_id) do nothing;

-- Claim the trial for a new account. Returns true when this account gets one,
-- false when the owner has already had theirs.
create or replace function public.claim_account_trial(p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner  uuid;
  v_claims integer;
begin
  select a.owner_id into v_owner from public.accounts a where a.id = p_account_id;
  if v_owner is null then
    return false;
  end if;

  insert into public.trial_grants (owner_id, account_id, source)
  values (v_owner, p_account_id, 'signup')
  on conflict (owner_id) do nothing;
  get diagnostics v_claims = row_count;

  return v_claims = 1;
end;
$$;

revoke all on function public.claim_account_trial(uuid) from public, anon, authenticated;
grant execute on function public.claim_account_trial(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Cancellation state on the account.
--
--    Two dates, because a cancellation is a request before it is a fact: the
--    request is made by the owner, the confirmation comes from the provider
--    (or an operator). Until it is confirmed the plan keeps working, and the
--    effective date is the end of the period that was already paid for.
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_effective_at timestamptz;

-- Two more states a subscription can be in. Neither means "no access":
-- 'past_due' is a failed charge inside a period that was paid for, and
-- 'cancel_requested' is an owner's cancellation that still runs to the end of
-- it. The write gate reads the period, not the label.
alter table public.accounts
  drop constraint if exists accounts_plan_status_check;
alter table public.accounts
  add constraint accounts_plan_status_check
  check (plan_status in ('trialing', 'active', 'past_due', 'cancel_requested', 'expired', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 4. Payments.
--
--    One row per provider event. Insert-only: a payment that happened is a
--    fact, and a correction is a new row (a refund is its own event), never an
--    edit of the original.
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_payments (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  plan                text not null check (plan in ('starter', 'professional', 'business')),
  amount_paise        bigint not null check (amount_paise > 0),
  currency            text not null default 'INR' check (currency = 'INR'),
  status              text not null check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  period_start        timestamptz,
  period_end          timestamptz,
  provider            text not null,
  provider_event_id   text,
  provider_reference  text,
  failure_reason      text,
  occurred_at         timestamptz not null default now(),
  recorded_at         timestamptz not null default now()
);

-- Replay protection: one provider can only ever report one event with one id,
-- and the payment it produced is recorded once.
create unique index if not exists subscription_payments_event_key
  on public.subscription_payments (provider, provider_event_id)
  where provider_event_id is not null;

create index if not exists subscription_payments_account_idx
  on public.subscription_payments (account_id, occurred_at desc);

comment on table public.subscription_payments is
  'Money received or refused for a subscription. Insert-only: a refund or a retry is a new event, never an edit.';

-- ---------------------------------------------------------------------------
-- 5. Receipts.
--
--    An immutable snapshot of one succeeded payment, numbered for the owner to
--    quote. Not a tax invoice (see the header): it says so on its face.
-- ---------------------------------------------------------------------------
create sequence if not exists public.subscription_receipt_seq;

create table if not exists public.subscription_receipts (
  id             uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  payment_id     uuid not null references public.subscription_payments(id) on delete cascade,
  plan           text not null,
  plan_label     text not null,
  amount_paise   bigint not null check (amount_paise > 0),
  currency       text not null default 'INR',
  period_start   timestamptz,
  period_end     timestamptz,
  paid_at        timestamptz not null,
  provider       text not null,
  issued_at      timestamptz not null default now()
);

create index if not exists subscription_receipts_account_idx
  on public.subscription_receipts (account_id, issued_at desc);

comment on table public.subscription_receipts is
  'An immutable receipt for one subscription payment. Never updated and never deleted: it is the record of money received, not a tax invoice.';

-- ---------------------------------------------------------------------------
-- 6. Subscription history.
--
--    What happened to this subscription, in order: trial granted, upgraded,
--    downgraded, renewed, payment failed, cancellation requested, cancellation
--    confirmed, expired. The owner dashboard reads it, and so does anybody
--    trying to work out why a workspace went read-only.
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_events (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  kind         text not null check (kind in (
                 'trial_granted', 'trial_denied', 'trial_extended',
                 'plan_changed', 'renewed', 'payment_succeeded', 'payment_failed',
                 'cancellation_requested', 'cancellation_withdrawn',
                 'cancellation_confirmed',
                 'expired', 'provider_unavailable')),
  from_plan    text,
  to_plan      text,
  amount_paise bigint,
  currency     text,
  provider     text,
  actor        text not null default 'system' check (actor in ('system', 'owner', 'provider', 'admin')),
  note         text,
  occurred_at  timestamptz not null default now()
);

create index if not exists subscription_events_account_idx
  on public.subscription_events (account_id, occurred_at desc);

comment on table public.subscription_events is
  'The story of one subscription, append-only. Read by the owner dashboard; never a source of authority (the account row is).';

-- ---------------------------------------------------------------------------
-- 7. Webhook events: replay protection and an audit of what arrived.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  provider_event_id text not null,
  event_type        text,
  payload_digest    text not null,
  signature_ok      boolean not null default false,
  outcome           text not null,
  received_at       timestamptz not null default now()
);

create unique index if not exists billing_webhook_events_key
  on public.billing_webhook_events (provider, provider_event_id);

comment on table public.billing_webhook_events is
  'Every billing webhook that reached us, and what we did with it. The unique key is the replay protection: a second delivery of the same event inserts nothing.';

-- ---------------------------------------------------------------------------
-- 8. Row level security and privileges.
--
--    Every table is readable by a member of the account that owns it and by
--    nobody else. None of them is writable by an authenticated caller: money
--    is written by the service role, through the functions below, which
--    validate what they are told.
-- ---------------------------------------------------------------------------
alter table public.subscription_payments enable row level security;
alter table public.subscription_receipts enable row level security;
alter table public.subscription_events enable row level security;
alter table public.billing_webhook_events enable row level security;

revoke all on public.subscription_payments from anon, authenticated;
revoke all on public.subscription_receipts from anon, authenticated;
revoke all on public.subscription_events from anon, authenticated;
revoke all on public.billing_webhook_events from anon, authenticated;

-- The same test accounts_read uses: a member of any restaurant the account owns.
drop policy if exists subscription_payments_member_read on public.subscription_payments;
create policy subscription_payments_member_read on public.subscription_payments
  for select
  using (
    exists (
      select 1
        from public.restaurants r
        join public.memberships m on m.restaurant_id = r.id
       where r.account_id = public.subscription_payments.account_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists subscription_receipts_member_read on public.subscription_receipts;
create policy subscription_receipts_member_read on public.subscription_receipts
  for select
  using (
    exists (
      select 1
        from public.restaurants r
        join public.memberships m on m.restaurant_id = r.id
       where r.account_id = public.subscription_receipts.account_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists subscription_events_member_read on public.subscription_events;
create policy subscription_events_member_read on public.subscription_events
  for select
  using (
    exists (
      select 1
        from public.restaurants r
        join public.memberships m on m.restaurant_id = r.id
       where r.account_id = public.subscription_events.account_id
         and m.user_id = auth.uid()
    )
  );

grant select on public.subscription_payments to authenticated, service_role;
grant select on public.subscription_receipts to authenticated, service_role;
grant select on public.subscription_events to authenticated, service_role;
grant insert, select on public.billing_webhook_events to service_role;

-- ---------------------------------------------------------------------------
-- 9. Immutability, enforced where it matters.
--
--    A policy can be dropped by somebody with rights to drop it; a trigger on
--    the table cannot be worked around by a policy change. Payments, receipts
--    and webhook events are facts about money: they are inserted once and
--    never rewritten.
-- ---------------------------------------------------------------------------
create or replace function public.protect_billing_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'billing history is append-only: % on % is not allowed', tg_op, tg_table_name
    using errcode = '42501';
  return null;
end;
$$;

drop trigger if exists subscription_payments_append_only on public.subscription_payments;
create trigger subscription_payments_append_only
  before update or delete on public.subscription_payments
  for each row execute function public.protect_billing_history();

drop trigger if exists subscription_receipts_append_only on public.subscription_receipts;
create trigger subscription_receipts_append_only
  before update or delete on public.subscription_receipts
  for each row execute function public.protect_billing_history();

-- The webhook log is the one billing table that is finished rather than frozen:
-- a delivery is recorded when it arrives and its outcome is written when it has
-- been decided. What may never change is WHAT arrived -- the provider, the
-- event id, the digest and whether the signature was good -- because those are
-- the replay evidence.
create or replace function public.protect_webhook_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'billing webhook events are never deleted' using errcode = '42501';
  end if;
  if new.provider is distinct from old.provider
     or new.provider_event_id is distinct from old.provider_event_id
     or new.payload_digest is distinct from old.payload_digest
     or new.signature_ok is distinct from old.signature_ok then
    raise exception 'the record of what arrived cannot be rewritten' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_webhook_events_evidence on public.billing_webhook_events;
create trigger billing_webhook_events_evidence
  before update or delete on public.billing_webhook_events
  for each row execute function public.protect_webhook_evidence();

-- The plan guard, with one narrow exception.
--
-- An authenticated caller may not change their plan: that is the whole point of
-- the guard. But requesting a cancellation is the owner's right, and it is a
-- DOWNWARD change -- it can never grant entitlement. So the guard permits
-- exactly one transition: to 'cancel_requested', when the request columns are
-- being set by the cancellation function. Every other column stays frozen, and
-- a caller cannot ride this exception to a better plan: `plan` is still old.
create or replace function public.protect_account_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No authenticated actor: the service role and its RPCs, which are the only
  -- supported way to change a subscription.
  if auth.uid() is null then
    return new;
  end if;

  new.owner_id        := old.owner_id;
  new.plan            := old.plan;
  new.trial_started_at := old.trial_started_at;
  new.trial_ends_at   := old.trial_ends_at;
  new.plan_started_at := old.plan_started_at;
  new.plan_expires_at := old.plan_expires_at;
  new.updated_at      := old.updated_at;

  if new.plan_status = old.plan_status then
    return new;
  end if;

  -- Requesting a cancellation: the one status change an owner may make.
  if new.plan_status = 'cancel_requested'
     and old.cancel_requested_at is null
     and new.cancel_requested_at is not null
     and new.cancel_effective_at is not null then
    return new;
  end if;

  -- Withdrawing it: back to the status the account had before the request.
  if old.plan_status = 'cancel_requested'
     and new.cancel_requested_at is null
     and new.plan_status in ('trialing', 'active', 'expired') then
    return new;
  end if;

  -- Anything else is a plan change, and a plan change is the service role's.
  new.plan_status := old.plan_status;
  return new;
end;
$$;

drop trigger if exists accounts_plan_guard on public.accounts;
create trigger accounts_plan_guard
  before update on public.accounts
  for each row execute function public.protect_account_plan();

-- ---------------------------------------------------------------------------
-- 10. The write gate, now aware of cancellation and a failed payment.
--
--     A failed payment does not lock a restaurant out the moment it happens:
--     the plan keeps working until the period it was paid for ends, and the
--     dashboard says what is wrong. An expired or cancelled account is
--     read-only — and never deleted.
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
             -- The trial, measured from the date it was activated.
             when a.plan_status = 'trialing'
               then coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days') > now()
             else false
           end
      from public.accounts a
     where a.id = p_account_id
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 11. Recording money. Service role only, and it argues back.
--
--     record_subscription_payment refuses:
--       * an amount that is not the plan's price for the period bought;
--       * a currency that is not INR;
--       * an event it has already recorded (the same provider event id).
--
--     On success it extends the subscription from the END of the current
--     period, never from now: a renewal bought early does not shorten the
--     period already paid for.
-- ---------------------------------------------------------------------------
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
  v_account  uuid;
  v_found    integer;
  v_expected bigint;
  v_months   integer := greatest(coalesce(p_months, 1), 1);
  v_start    timestamptz;
  v_end      timestamptz;
  v_payment  uuid;
  v_receipt  text;
  v_existing jsonb;
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

  -- Replay protection: the same provider event is recorded exactly once.
  select jsonb_build_object('payment_id', p.id, 'receipt_number', rc.receipt_number)
    into v_existing
    from public.subscription_payments p
    left join public.subscription_receipts rc on rc.payment_id = p.id
   where p.provider = p_provider
     and p.provider_event_id = p_provider_event_id;

  if v_existing is not null then
    return jsonb_build_object('status', 'duplicate', 'payment', v_existing);
  end if;

  -- The period starts when the current one ends, or now if none is running.
  select greatest(coalesce(a.plan_expires_at, now()), now())
    into v_start
    from public.accounts a
   where a.id = v_account
     and a.plan_status in ('active', 'past_due', 'cancel_requested');

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
  select v_account,
         case when a.plan = p_plan then 'renewed' else 'plan_changed' end,
         a.plan, p_plan, p_amount_paise, 'INR', p_provider, 'provider',
         'Period ' || to_char(v_start, 'DD Mon YYYY') || ' to ' || to_char(v_end, 'DD Mon YYYY')
    from public.accounts a
   where a.id = v_account;

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

-- ---------------------------------------------------------------------------
-- 12. Cancellation: requested by the owner, confirmed by the provider.
-- ---------------------------------------------------------------------------
create or replace function public.request_subscription_cancellation(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_account uuid;
  v_ends    timestamptz;
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
  select case
           when a.plan in ('starter', 'professional', 'business')
                and a.plan_expires_at is not null then a.plan_expires_at
           else coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days')
         end
    into v_ends
    from public.accounts a
   where a.id = v_account;

  update public.accounts a
     set cancel_requested_at = now(),
         cancel_effective_at = v_ends,
         plan_status = case when a.plan_status in ('active', 'past_due', 'trialing')
                            then 'cancel_requested' else a.plan_status end,
         updated_at = now()
   where a.id = v_account;

  insert into public.subscription_events (account_id, kind, actor, note)
  values (v_account, 'cancellation_requested', 'owner',
          'Cancellation requested. Access runs until ' || to_char(v_ends, 'DD Mon YYYY') || '.');

  return jsonb_build_object('account_id', v_account, 'effective_at', v_ends);
end;
$$;

revoke all on function public.request_subscription_cancellation(uuid) from public, anon;
grant execute on function public.request_subscription_cancellation(uuid) to authenticated, service_role;

-- The confirmation: from the provider, or from an operator with the service
-- role. It never deletes anything and never ends access early.
create or replace function public.confirm_subscription_cancellation(
  p_restaurant_name   text,
  p_provider          text,
  p_provider_event_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid;
  v_found   integer;
  v_ends    timestamptz;
begin
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

  -- No request, no confirmation: an unrequested cancellation is not a thing
  -- this function does.
  select a.cancel_effective_at into v_ends
    from public.accounts a
   where a.id = v_account and a.cancel_requested_at is not null;

  if v_ends is null then
    raise exception 'cancellation_not_requested' using errcode = 'P0001';
  end if;

  update public.accounts a
     set plan_status    = 'cancelled',
         plan_expires_at = v_ends,
         updated_at     = now()
   where a.id = v_account;

  insert into public.subscription_events (account_id, kind, provider, actor, note)
  values (v_account, 'cancellation_confirmed', p_provider, 'provider',
          'Cancellation confirmed. Access ends ' || to_char(v_ends, 'DD Mon YYYY') || '; nothing is deleted.');

  return jsonb_build_object('account_id', v_account, 'effective_at', v_ends);
end;
$$;

revoke all on function public.confirm_subscription_cancellation(text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_subscription_cancellation(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 13. Expiry, run on a schedule. Marks an account read-only at the end of its
--     trial or its paid period. It deletes nothing and it never shortens a
--     period that is still running.
-- ---------------------------------------------------------------------------
create or replace function public.expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  v_count integer := 0;
begin
  for r in
    select a.id,
           case
             when a.plan in ('starter', 'professional', 'business') then a.plan_expires_at
             else coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days')
           end as ends_at
      from public.accounts a
     -- 'cancelled' belongs here too: it still gets the period it paid for, and
     -- when that period ends the account is expired, not merely cancelled.
     where a.plan_status in ('trialing', 'active', 'past_due', 'cancel_requested', 'cancelled')
       and case
             when a.plan in ('starter', 'professional', 'business') then a.plan_expires_at
             else coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days')
           end < now()
  loop
    update public.accounts a
       set plan_status        = 'expired',
           -- The requested cancellation has now happened: nothing left to run.
           cancel_effective_at = coalesce(a.cancel_effective_at, now()),
           updated_at         = now()
     where a.id = r.id;

    insert into public.subscription_events (account_id, kind, actor, note)
    values (r.id, 'expired', 'system',
            'The subscription period ended. Every outlet and every row of data is preserved and readable.');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_subscriptions() to service_role;

-- ---------------------------------------------------------------------------
-- 14. What the owner dashboard reads.
--
--    One call, one JSON document, and it is membership-checked inside the
--    function: an authenticated caller naming a restaurant they do not work
--    for gets nothing, not even an error that says it exists.
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

revoke all on function public.account_subscription_state(uuid) from public, anon;
grant execute on function public.account_subscription_state(uuid) to authenticated, service_role;

create or replace function public.account_subscription_history(p_restaurant_id uuid, p_limit integer default 50)
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
    from public.subscription_events e
   where e.account_id = v_account
   limit greatest(coalesce(p_limit, 50), 1);

  return v_rows;
end;
$$;

revoke all on function public.account_subscription_history(uuid, integer) from public, anon;
grant execute on function public.account_subscription_history(uuid, integer) to authenticated, service_role;

create or replace function public.account_payment_history(p_restaurant_id uuid, p_limit integer default 50)
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
           order by p.occurred_at desc, p.recorded_at desc
         ), '[]'::jsonb)
    into v_rows
    from public.subscription_payments p
    left join public.subscription_receipts rc on rc.payment_id = p.id
   where p.account_id = v_account
   limit greatest(coalesce(p_limit, 50), 1);

  return v_rows;
end;
$$;

revoke all on function public.account_payment_history(uuid, integer) from public, anon;
grant execute on function public.account_payment_history(uuid, integer) to authenticated, service_role;

-- One receipt, for the owner of the account it belongs to.
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
         join public.memberships m on m.restaurant_id = r.id
        where r.account_id = rc.account_id
          and m.user_id = v_user
     );

  return v_row;
end;
$$;

revoke all on function public.account_receipt(uuid) from public, anon;
grant execute on function public.account_receipt(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 15. Trial grants for accounts created from now on.
--
--    create_account_with_restaurant() (001000) and create_outlet() both start
--    a 21-day trial. From here, the trial is claimed once per person: a second
--    account gets no trial, and the reason is written to its history so the
--    owner dashboard can say why.
-- ---------------------------------------------------------------------------
create or replace function public.create_account_with_restaurant(
  p_name     text,
  p_slug     text,
  p_timezone text default 'Asia/Kolkata',
  p_owner    uuid default auth.uid()
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_slug    text := lower(btrim(coalesce(p_slug, '')));
  v_owner   uuid := p_owner;
  v_account uuid;
  v_id      uuid;
  v_trial   boolean;
begin
  if v_owner is null then
    raise exception 'unauthenticated' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'name_invalid' using errcode = 'P0001';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60 then
    raise exception 'slug_invalid' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.restaurants where slug = v_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;

  insert into public.profiles (id) values (v_owner)
    on conflict (id) do nothing;

  insert into public.accounts (owner_id, plan, plan_status, trial_started_at, trial_ends_at)
  values (v_owner, 'trial', 'trialing', now(), now() + interval '21 days')
  returning id into v_account;

  -- The trial is claimed here, once per person. A second account for the same
  -- owner gets no trial: read-only until a plan is chosen.
  v_trial := public.claim_account_trial(v_account);

  if not v_trial then
    update public.accounts a
       set plan_status   = 'expired',
           trial_ends_at = now(),
           updated_at    = now()
     where a.id = v_account;

    insert into public.subscription_events (account_id, kind, actor, note)
    values (v_account, 'trial_denied', 'system',
            'A trial has already been used by this account holder. Every outlet is preserved; choose a plan to start writing.');
  else
    insert into public.subscription_events (account_id, kind, to_plan, actor, note)
    values (v_account, 'trial_granted', 'trial', 'system',
            'Trial started: 21 days from activation, with every feature switched on.');
  end if;

  insert into public.restaurants (slug, name, timezone, account_id, trial_started_at)
  values (v_slug, v_name, coalesce(nullif(btrim(p_timezone), ''), 'Asia/Kolkata'), v_account, now())
  returning id into v_id;

  insert into public.menus (restaurant_id, name, is_published)
  values (v_id, 'Main menu', true);

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_owner, 'owner');

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. The newest state of the trial for an owner is the one that counts.
-- ---------------------------------------------------------------------------
create or replace function public.create_outlet(
  p_name text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_name    text := btrim(coalesce(p_name, ''));
  v_slug    text := lower(btrim(coalesce(p_slug, '')));
  v_account uuid;
  v_limit   integer;
  v_used    integer;
  v_id      uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'name_invalid' using errcode = 'P0001';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60 then
    raise exception 'slug_invalid' using errcode = 'P0001';
  end if;

  select r.account_id into v_account
    from public.restaurants r
    join public.memberships m on m.restaurant_id = r.id
   where m.user_id = v_user
     and m.role = 'owner'
     and r.account_id is not null
   order by r.created_at, r.id
   limit 1;

  if v_account is null then
    -- First outlet for this user: the account starts here, with one trial if
    -- the owner has not already had one.
    insert into public.accounts (owner_id, plan, plan_status, trial_started_at, trial_ends_at)
    values (v_user, 'trial', 'trialing', now(), now() + interval '21 days')
    returning id into v_account;

    if not public.claim_account_trial(v_account) then
      update public.accounts a
         set plan_status   = 'expired',
             trial_ends_at = now(),
             updated_at    = now()
       where a.id = v_account;

      insert into public.subscription_events (account_id, kind, actor, note)
      values (v_account, 'trial_denied', 'system',
              'A trial has already been used by this account holder. Every outlet is preserved; choose a plan to start writing.');
    else
      insert into public.subscription_events (account_id, kind, to_plan, actor, note)
      values (v_account, 'trial_granted', 'trial', 'system',
              'Trial started: 21 days from activation, with every feature switched on.');
    end if;
  end if;

  -- The plan caps how many outlets may exist. Existing outlets are never
  -- removed for being over a limit: a downgrade stops NEW creation only.
  v_limit := public.account_outlet_limit(
    (select a.plan from public.accounts a where a.id = v_account));
  v_used := public.account_outlet_count(v_account);

  if v_limit is not null and v_used >= v_limit then
    raise exception 'outlet_limit' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.restaurants where slug = v_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;

  insert into public.restaurants (slug, name, account_id)
  values (v_slug, v_name, v_account)
  returning id into v_id;

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_user, 'owner');

  insert into public.menus (restaurant_id, name, is_published)
  values (v_id, 'Main menu', true);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Changing your mind, and money going back.
--
--    A cancellation request can be withdrawn while the period is still
--    running. A refund is recorded as its own event, never as an edit of the
--    payment it refunds, and it never silently removes access: taking a
--    subscription away because money went back is an operator's decision,
--    made with the owner, not a side effect of a webhook.
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_subscription_cancellation(p_restaurant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_account uuid;
  v_plan    text;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = 'P0001';
  end if;

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

  if not exists (
    select 1 from public.accounts a
     where a.id = v_account and a.cancel_requested_at is not null
  ) then
    return false;
  end if;

  -- Back to whatever the account was doing before: a paid plan that is still
  -- inside its period is active again, a trial that has not ended is trialing.
  select case
           when a.plan in ('starter', 'professional', 'business')
                and coalesce(a.plan_expires_at, now()) > now() then 'active'
           when coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days') > now() then 'trialing'
           else 'expired'
         end
    into v_plan
    from public.accounts a
   where a.id = v_account;

  update public.accounts a
     set plan_status         = v_plan,
         cancel_requested_at = null,
         cancel_effective_at = null,
         updated_at          = now()
   where a.id = v_account;

  insert into public.subscription_events (account_id, kind, actor, note)
  values (v_account, 'cancellation_withdrawn', 'owner', 'Cancellation request withdrawn. The subscription continues.');

  return true;
end;
$$;

revoke all on function public.withdraw_subscription_cancellation(uuid) from public, anon;
grant execute on function public.withdraw_subscription_cancellation(uuid) to authenticated, service_role;

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
