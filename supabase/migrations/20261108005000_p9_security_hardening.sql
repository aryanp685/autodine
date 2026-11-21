-- P9 security hardening: invitation attempt budgets, append-only staff audit
-- records, and idempotent invitation redemption after a lost response.

-- ---------------------------------------------------------------------------
-- Join-code attempt budgets
--
-- This migration depends on hit_rate_limit() from
-- 20261108000000_guest_rate_limits.sql. Limits are keyed by auth.uid() and a
-- SHA-256 of the normalised code; they remain effective for direct PostgREST
-- calls, not only requests that pass through the Next.js page.
-- ---------------------------------------------------------------------------

create or replace function public.preview_staff_invite(p_code text)
returns table (
  status          text,
  restaurant_id   uuid,
  restaurant_name text,
  role            public.member_role,
  expires_at      timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invite public.restaurant_invites%rowtype;
  v_name text;
  v_allowed boolean;
  v_retry integer;
  v_code_hash text := public.hash_invite_code(p_code);
begin
  if v_actor is null then
    raise exception 'Sign in to open this invitation.' using errcode = '42501';
  end if;

  select h.allowed, h.retry_after_seconds into v_allowed, v_retry
    from public.hit_rate_limit('staff-invite:preview:user:' || v_actor::text, 30, 3600) h;
  if not coalesce(v_allowed, false) then
    return query select 'rate_limited'::text, null::uuid, null::text, null::public.member_role, null::timestamptz;
    return;
  end if;
  select h.allowed, h.retry_after_seconds into v_allowed, v_retry
    from public.hit_rate_limit('staff-invite:preview:code:' || v_actor::text || ':' || v_code_hash, 12, 3600) h;
  if not coalesce(v_allowed, false) then
    return query select 'rate_limited'::text, null::uuid, null::text, null::public.member_role, null::timestamptz;
    return;
  end if;

  select * into v_invite
    from public.restaurant_invites i
   where i.code_hash = v_code_hash;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::public.member_role, null::timestamptz;
    return;
  end if;

  select r.name into v_name
    from public.restaurants r
   where r.id = v_invite.restaurant_id and r.is_active;
  if not found then
    return query select 'closed'::text, v_invite.restaurant_id, null::text, v_invite.role, v_invite.expires_at;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif v_invite.expires_at <= statement_timestamp() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_invite.restaurant_id and m.user_id = v_actor
  ) then
    return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  else
    return query select 'ok'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  end if;
end;
$$;

revoke all on function public.preview_staff_invite(text) from public, anon;
grant execute on function public.preview_staff_invite(text) to authenticated;

create or replace function public.redeem_staff_invite(p_code text)
returns table (
  status          text,
  restaurant_id   uuid,
  restaurant_name text,
  role            public.member_role
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invite public.restaurant_invites%rowtype;
  v_name text;
  v_allowed boolean;
  v_retry integer;
  v_invite_found boolean := false;
  v_code_hash text := public.hash_invite_code(p_code);
begin
  if v_actor is null then
    raise exception 'Sign in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_invite
    from public.restaurant_invites i
   where i.code_hash = v_code_hash
   for update;
  v_invite_found := found;

  -- A retry after the commit must be safe even if the response was lost. Only
  -- the same actor who redeemed the link, and still has that membership, gets
  -- this idempotent success; everybody else sees the single-use status below.
  if found and v_invite.redeemed_at is not null and v_invite.redeemed_by = v_actor
     and exists (
       select 1 from public.memberships m
        where m.restaurant_id = v_invite.restaurant_id and m.user_id = v_actor
     ) then
    select r.name into v_name from public.restaurants r
     where r.id = v_invite.restaurant_id and r.is_active;
    if found then
      return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role;
      return;
    end if;
  end if;

  select h.allowed, h.retry_after_seconds into v_allowed, v_retry
    from public.hit_rate_limit('staff-invite:redeem:user:' || v_actor::text, 12, 3600) h;
  if not coalesce(v_allowed, false) then
    return query select 'rate_limited'::text, null::uuid, null::text, null::public.member_role;
    return;
  end if;
  select h.allowed, h.retry_after_seconds into v_allowed, v_retry
    from public.hit_rate_limit('staff-invite:redeem:code:' || v_actor::text || ':' || v_code_hash, 5, 3600) h;
  if not coalesce(v_allowed, false) then
    return query select 'rate_limited'::text, null::uuid, null::text, null::public.member_role;
    return;
  end if;

  if not v_invite_found then
    return query select 'not_found'::text, null::uuid, null::text, null::public.member_role;
    return;
  end if;

  select r.name into v_name
    from public.restaurants r
   where r.id = v_invite.restaurant_id and r.is_active;
  if not found then
    return query select 'closed'::text, v_invite.restaurant_id, null::text, v_invite.role;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role;
  elsif v_invite.expires_at <= statement_timestamp() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role;
  elsif exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_invite.restaurant_id and m.user_id = v_actor
  ) then
    -- An existing team member does not consume somebody else's link.
    return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  end if;

  insert into public.profiles (id) values (v_actor)
  on conflict (id) do nothing;

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_invite.restaurant_id, v_actor, v_invite.role);

  update public.restaurant_invites
     set redeemed_by = v_actor, redeemed_at = statement_timestamp()
   where id = v_invite.id;

  return query select 'ok'::text, v_invite.restaurant_id, v_name, v_invite.role;
end;
$$;

revoke all on function public.redeem_staff_invite(text) from public, anon;
grant execute on function public.redeem_staff_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only staff/security audit records
--
-- Do not store invitation codes, hashes, emails, IP addresses, or request
-- payloads. Trigger rows cover invite lifecycle and team membership changes.
-- The read RPC is restricted to owners/managers; there is no direct table
-- access or client write path.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_security_audit_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  actor_id uuid,
  event_type text not null check (event_type in (
    'staff_invite.created',
    'staff_invite.redeemed',
    'staff_invite.revoked',
    'staff_invite.deleted',
    'staff_member.added',
    'staff_member.removed',
    'staff_member.role_changed'
  )),
  target_type text not null check (target_type in ('staff_invite', 'membership')),
  target_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists staff_security_audit_log_restaurant_time_idx
  on public.staff_security_audit_log (restaurant_id, created_at desc, id desc);

alter table public.staff_security_audit_log enable row level security;
revoke all on public.staff_security_audit_log from public, anon, authenticated, service_role;

create or replace function public.reject_staff_security_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Staff security audit records are append-only.' using errcode = '42501';
end;
$$;
revoke all on function public.reject_staff_security_audit_mutation() from public, anon, authenticated;

drop trigger if exists staff_security_audit_log_immutable on public.staff_security_audit_log;
create trigger staff_security_audit_log_immutable
before update or delete on public.staff_security_audit_log
for each row execute function public.reject_staff_security_audit_mutation();

create or replace function public.audit_staff_invite_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event text;
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_id uuid;
  v_role public.member_role;
  v_expires_at timestamptz;
begin
  if tg_op = 'INSERT' then
    v_event := 'staff_invite.created';
    v_actor := coalesce(v_actor, new.created_by);
    v_restaurant_id := new.restaurant_id;
    v_id := new.id;
    v_role := new.role;
    v_expires_at := new.expires_at;
  elsif tg_op = 'DELETE' then
    v_event := 'staff_invite.deleted';
    v_restaurant_id := old.restaurant_id;
    v_id := old.id;
    v_role := old.role;
    v_expires_at := old.expires_at;
  elsif old.redeemed_at is null and new.redeemed_at is not null then
    v_event := 'staff_invite.redeemed';
    v_actor := coalesce(v_actor, new.redeemed_by);
    v_restaurant_id := new.restaurant_id;
    v_id := new.id;
    v_role := new.role;
    v_expires_at := new.expires_at;
  elsif old.revoked_at is null and new.revoked_at is not null then
    v_event := 'staff_invite.revoked';
    v_restaurant_id := new.restaurant_id;
    v_id := new.id;
    v_role := new.role;
    v_expires_at := new.expires_at;
  else
    return new;
  end if;

  insert into public.staff_security_audit_log (
    restaurant_id, actor_id, event_type, target_type, target_id, metadata
  ) values (
    v_restaurant_id, v_actor, v_event, 'staff_invite', v_id,
    jsonb_build_object('role', v_role, 'expires_at', v_expires_at)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_staff_invite_change() from public, anon, authenticated;

drop trigger if exists restaurant_invites_security_audit on public.restaurant_invites;
create trigger restaurant_invites_security_audit
after insert or update or delete on public.restaurant_invites
for each row execute function public.audit_staff_invite_change();

create or replace function public.audit_staff_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event text;
  v_restaurant_id uuid;
  v_membership_id uuid;
  v_member_user_id uuid;
  v_actor uuid := auth.uid();
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_event := 'staff_member.added';
    v_restaurant_id := new.restaurant_id;
    v_membership_id := new.id;
    v_member_user_id := new.user_id;
    v_metadata := jsonb_build_object('role', new.role, 'member_user_id', new.user_id);
  elsif tg_op = 'DELETE' then
    v_event := 'staff_member.removed';
    v_restaurant_id := old.restaurant_id;
    v_membership_id := old.id;
    v_member_user_id := old.user_id;
    v_metadata := jsonb_build_object('role', old.role, 'member_user_id', old.user_id);
  elsif old.role is distinct from new.role then
    v_event := 'staff_member.role_changed';
    v_restaurant_id := new.restaurant_id;
    v_membership_id := new.id;
    v_member_user_id := new.user_id;
    v_metadata := jsonb_build_object('old_role', old.role, 'new_role', new.role, 'member_user_id', new.user_id);
  else
    return new;
  end if;

  insert into public.staff_security_audit_log (
    restaurant_id, actor_id, event_type, target_type, target_id, metadata
  ) values (
    v_restaurant_id, v_actor, v_event, 'membership', v_membership_id, v_metadata
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_staff_membership_change() from public, anon, authenticated;

drop trigger if exists memberships_security_audit on public.memberships;
create trigger memberships_security_audit
after insert or update or delete on public.memberships
for each row execute function public.audit_staff_membership_change();

create or replace function public.list_staff_security_audit(
  p_restaurant_id uuid,
  p_limit integer default 50
) returns table (
  id uuid,
  actor_id uuid,
  event_type text,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view staff security history.' using errcode = '42501';
  end if;
  if p_restaurant_id is null
     or not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can view staff security history.' using errcode = '42501';
  end if;

  return query
    select a.id, a.actor_id, a.event_type, a.target_type, a.target_id, a.metadata, a.created_at
      from public.staff_security_audit_log a
     where a.restaurant_id = p_restaurant_id
     order by a.created_at desc, a.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;
revoke all on function public.list_staff_security_audit(uuid, integer) from public, anon;
grant execute on function public.list_staff_security_audit(uuid, integer) to authenticated;
