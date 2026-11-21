-- P5: durable kitchen announcement outcomes and table-scoped waiter calls.
-- Guest writes are bearer-session checked in SECURITY DEFINER RPCs; staff
-- reads are membership-scoped by RLS; all mutations go through guarded RPCs.

-- Order announcements are sound, not order state. Keep the latest delivered
-- outcome on the order without changing its prep/payment state machines.
alter table public.orders
  add column if not exists kitchen_announcement_status text,
  add column if not exists kitchen_announcement_at timestamptz,
  add column if not exists kitchen_announcement_error text;

alter table public.orders
  drop constraint if exists orders_kitchen_announcement_status_check;
alter table public.orders
  add constraint orders_kitchen_announcement_status_check
  check (kitchen_announcement_status is null or kitchen_announcement_status in ('announced', 'failed'));

create or replace function public.record_kitchen_announcement_result(
  p_order_id uuid,
  p_status text,
  p_failure_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_reason text := left(nullif(btrim(p_failure_reason), ''), 200);
begin
  if auth.uid() is null then
    raise exception 'Sign in to record a kitchen announcement.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('announced', 'failed') then
    raise exception 'That announcement result is not valid.' using errcode = '22023';
  end if;
  if p_status = 'announced' then
    v_reason := null;
  elsif v_reason is null then
    v_reason := 'Speech did not complete.';
  end if;

  select o.restaurant_id into v_restaurant_id
    from public.orders o
   where o.id = p_order_id;
  if not found then
    return false;
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only kitchen staff may record an announcement.' using errcode = '42501';
  end if;

  update public.orders
     set kitchen_announcement_status = p_status,
         kitchen_announcement_at = statement_timestamp(),
         kitchen_announcement_error = v_reason
   where id = p_order_id and restaurant_id = v_restaurant_id;
  return found;
end;
$$;

revoke all on function public.record_kitchen_announcement_result(uuid, text, text) from public, anon;
grant execute on function public.record_kitchen_announcement_result(uuid, text, text) to authenticated;

-- The cross-device auto-announcement winner is distinct from the persisted
-- outcome: a device that cannot speak must not consume another device's claim.
create table if not exists public.kitchen_announcement_claims (
  order_id uuid primary key references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz not null default statement_timestamp()
);
create index if not exists kitchen_announcement_claims_restaurant_idx
  on public.kitchen_announcement_claims (restaurant_id, claimed_at desc);
alter table public.kitchen_announcement_claims enable row level security;
revoke all on public.kitchen_announcement_claims from public, anon, authenticated;

create or replace function public.claim_kitchen_order_announcement(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_rows bigint := 0;
begin
  if v_actor is null then
    raise exception 'Sign in to claim a kitchen announcement.' using errcode = '42501';
  end if;

  select o.restaurant_id into v_restaurant_id
    from public.orders o
   where o.id = p_order_id
     and o.prep_status = 'new'
     and not (o.hold_required and o.confirmed_at is null)
   for update;
  if not found then return false; end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only kitchen staff may claim an announcement.' using errcode = '42501';
  end if;

  insert into public.kitchen_announcement_claims (order_id, restaurant_id, claimed_by)
  values (p_order_id, v_restaurant_id, v_actor)
  on conflict (order_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;
revoke all on function public.claim_kitchen_order_announcement(uuid) from public, anon;
grant execute on function public.claim_kitchen_order_announcement(uuid) to authenticated;

-- A waiter call is tied to the live QR verification session by its stored
-- token hash (the verification table deliberately has no surrogate id). The
-- board keeps its table-label snapshot when an expired session is purged.
create table if not exists public.table_waiter_calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  table_id uuid not null references public.dining_tables(id) on delete restrict,
  table_session_hash text references public.table_verification_sessions(token_hash) on delete set null,
  table_label_snapshot text not null,
  request_key uuid not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  announcement_status text not null default 'pending'
    check (announcement_status in ('pending', 'claimed', 'announced', 'failed')),
  announcement_claimed_at timestamptz,
  announcement_at timestamptz,
  announcement_error text,
  constraint table_waiter_calls_request_unique unique (table_session_hash, request_key),
  constraint table_waiter_calls_resolution_check check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

create unique index if not exists table_waiter_calls_one_open_per_table
  on public.table_waiter_calls (table_id) where status = 'open';
create index if not exists table_waiter_calls_board_idx
  on public.table_waiter_calls (restaurant_id, created_at) where status = 'open';

alter table public.table_waiter_calls enable row level security;
revoke all on public.table_waiter_calls from public, anon, authenticated;
grant select on public.table_waiter_calls to authenticated;
create policy table_waiter_calls_staff_read on public.table_waiter_calls
  for select to authenticated
  using (public.is_member(restaurant_id));

create or replace function public.call_waiter(
  p_session_token text,
  p_request_key uuid
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_hash text;
  v_restaurant_id uuid;
  v_table_id uuid;
  v_table_label text;
  v_existing_status text;
  v_open_id uuid;
  v_recent boolean;
begin
  if p_request_key is null or p_session_token is null
     or p_session_token !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'Verify your table before calling a waiter.' using errcode = 'P0001';
  end if;

  -- Lock the table row to serialize double-taps and the cooldown check.
  select s.token_hash, s.restaurant_id, s.table_id, t.label
    into v_session_hash, v_restaurant_id, v_table_id, v_table_label
    from public.table_verification_sessions s
    join public.restaurants r on r.id = s.restaurant_id and r.is_active
    join public.dining_tables t on t.id = s.table_id
         and t.restaurant_id = s.restaurant_id and t.is_active
    join public.table_qr_codes q on q.id = s.qr_code_id and q.revoked_at is null
   where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
     and s.expires_at > statement_timestamp()
     and s.revoked_at is null
   for update of t;
  if not found then
    raise exception 'Your table session has expired. Scan the code on your table again.' using errcode = 'P0001';
  end if;

  select c.status into v_existing_status
    from public.table_waiter_calls c
   where c.table_session_hash = v_session_hash and c.request_key = p_request_key;
  if found then
    return case when v_existing_status = 'open' then 'already_open' else 'already_handled' end;
  end if;

  select c.id into v_open_id
    from public.table_waiter_calls c
   where c.table_id = v_table_id and c.status = 'open'
   limit 1;
  if found then return 'already_open'; end if;

  select exists (
    select 1 from public.table_waiter_calls c
     where c.table_id = v_table_id
       and c.created_at > statement_timestamp() - interval '30 seconds'
  ) into v_recent;
  if v_recent then return 'wait_a_moment'; end if;

  insert into public.table_waiter_calls (
    restaurant_id, table_id, table_session_hash, table_label_snapshot, request_key
  ) values (
    v_restaurant_id, v_table_id, v_session_hash, v_table_label, p_request_key
  );
  return 'created';
exception
  when unique_violation then
    -- A concurrent call for this table is already open; treat the retry as a
    -- successful acknowledgement rather than creating a second alert.
    return 'already_open';
end;
$$;
revoke all on function public.call_waiter(text, uuid) from public;
revoke all on function public.call_waiter(text, uuid) from authenticated;
grant execute on function public.call_waiter(text, uuid) to anon, authenticated;

create or replace function public.claim_table_waiter_call_announcement(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
begin
  if v_actor is null then raise exception 'Sign in to announce a waiter call.' using errcode = '42501'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open' and c.announcement_status = 'pending'
   for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen', 'cashier')
  ) then raise exception 'You cannot access waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set announcement_status = 'claimed', announcement_claimed_at = statement_timestamp()
   where id = p_call_id and announcement_status = 'pending';
  return found;
end;
$$;
revoke all on function public.claim_table_waiter_call_announcement(uuid) from public, anon;
grant execute on function public.claim_table_waiter_call_announcement(uuid) to authenticated;

create or replace function public.record_table_waiter_call_announcement(
  p_call_id uuid,
  p_status text,
  p_failure_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_reason text := left(nullif(btrim(p_failure_reason), ''), 200);
begin
  if v_actor is null then raise exception 'Sign in to record a waiter-call announcement.' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('announced', 'failed') then raise exception 'That announcement result is not valid.' using errcode = '22023'; end if;
  if p_status = 'announced' then v_reason := null; elsif v_reason is null then v_reason := 'Speech did not complete.'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open';
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen', 'cashier')
  ) then raise exception 'You cannot access waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set announcement_status = p_status,
         announcement_at = statement_timestamp(),
         announcement_error = v_reason
   where id = p_call_id and restaurant_id = v_restaurant_id and status = 'open';
  return found;
end;
$$;
revoke all on function public.record_table_waiter_call_announcement(uuid, text, text) from public, anon;
grant execute on function public.record_table_waiter_call_announcement(uuid, text, text) to authenticated;

create or replace function public.resolve_table_waiter_call(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
begin
  if v_actor is null then raise exception 'Sign in to clear a waiter call.' using errcode = '42501'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open'
   for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen', 'cashier')
  ) then raise exception 'You cannot clear waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set status = 'resolved', resolved_at = statement_timestamp(), resolved_by = v_actor
   where id = p_call_id and status = 'open';
  return found;
end;
$$;
revoke all on function public.resolve_table_waiter_call(uuid) from public, anon;
grant execute on function public.resolve_table_waiter_call(uuid) to authenticated;

-- Service calls are a high-signal event like an order INSERT. RLS on the
-- staff SELECT policy scopes the realtime payload to the restaurant.
alter table public.table_waiter_calls replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_waiter_calls') then
    alter publication supabase_realtime add table public.table_waiter_calls;
  end if;
end $$;
