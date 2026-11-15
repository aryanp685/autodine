-- ============================================================================
-- Redeem staff invitations: stop after a single-use status
--
-- Migration 20261108005000_p9_security_hardening.sql rewrote
-- public.redeem_staff_invite() and kept the already_member branch's explicit
-- `return;`, but the closed, revoked, used and expired status branches only
-- used RETURN QUERY. In plpgsql, RETURN QUERY appends a row; it does not
-- exit the function. Control therefore fell through the IF expression and
-- reached the membership insert:
--
--   * an existing member redeeming a used link received SQLSTATE 23505
--     (duplicate memberships row) instead of the single-use `used` status;
--   * a non-member could be inserted past a revoked / expired / used link
--     and the invite row could be rewritten, breaking the single-use
--     guarantee that the screen and the API contract promise.
--
-- This migration only replaces the function, adding the missing `return;`
-- statements and preserving the existing behaviour otherwise: same signature,
-- search_path, rate-limit keys and budgets, idempotent already_member
-- replay for the original redeemer, same grants.
-- ============================================================================

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
    return;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  elsif v_invite.expires_at <= statement_timestamp() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
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
