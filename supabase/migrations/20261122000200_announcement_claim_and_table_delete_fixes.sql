-- ============================================================================
-- AutoDine — migration: announcement claim recovery and safe table delete fixes
--
-- * delete_table_safe (20261118002300) is SECURITY DEFINER but skipped the
--   restaurant_can_write() gate, so a read-only (expired) account could still
--   delete or disable tables. It also ignored waiter-call history, so an
--   orderless table with past waiter calls hit the table_waiter_calls FK
--   (ON DELETE RESTRICT) instead of being archived.
-- * claim_kitchen_order_announcement (20261119000400) expired stale claims even
--   for orders already announced, letting a reconnecting device repeat them.
-- * claim_table_waiter_call_announcement only accepted 'pending', so the
--   stale-claim (>2 min) recovery the feed advertises could never win a claim.
--
-- Forward-only; grants are unchanged. No table or row is touched.
-- ============================================================================

create or replace function public.delete_table_safe(p_table_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_has_history boolean;
begin
  if p_table_id is null then
    raise exception 'A table is required.' using errcode = '22023';
  end if;

  select t.restaurant_id into v_restaurant_id
  from public.dining_tables t where t.id = p_table_id;
  if not found then
    raise exception 'That table does not exist.' using errcode = 'P0002';
  end if;

  if not public.has_restaurant_role(v_restaurant_id, array['owner','manager']) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'This restaurant is read-only right now.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_table_id::text));

  -- Check for historical orders or active sessions referencing this table
  select exists (
    select 1 from public.orders o where o.table_id = p_table_id
    union all
    select 1 from public.table_waiter_calls c where c.table_id = p_table_id
    union all
    select 1 from public.table_verification_sessions s where s.table_id = p_table_id and s.expires_at > now() and s.revoked_at is null
  ) into v_has_history;

  if v_has_history then
    -- Archive: disable, do not delete. Preserve QR history for audit.
    update public.dining_tables set is_active = false where id = p_table_id;
    return 'archived';
  else
    -- No history: safe to remove. QR codes cascade via FK, or revoke first.
    update public.table_qr_codes set revoked_at = now() where table_id = p_table_id and revoked_at is null;
    delete from public.dining_tables where id = p_table_id;
    return 'deleted';
  end if;
end;
$$;

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

  if not found then
    return false;
  end if;

  if not exists (
    select 1
      from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only kitchen staff may claim an announcement.' using errcode = '42501';
  end if;

  -- Stale-claim recovery: a claim held longer than 2 minutes is considered abandoned (crash/network loss)
  -- and is reclaimed here so the announcement is not lost. This mirrors the waiter-call path where
  -- announcement-events re-queues claimed>2min as pending.
  delete from public.kitchen_announcement_claims
   where order_id = p_order_id
     and claimed_at < statement_timestamp() - interval '2 minutes'
     and not exists (
       select 1 from public.orders o
        where o.id = p_order_id and o.kitchen_announcement_status = 'announced'
     );

  insert into public.kitchen_announcement_claims (order_id, restaurant_id, claimed_by)
  values (p_order_id, v_restaurant_id, v_actor)
  on conflict (order_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

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
   where c.id = p_call_id and c.status = 'open'
     and (c.announcement_status = 'pending'
          or (c.announcement_status = 'claimed'
              and c.announcement_claimed_at < statement_timestamp() - interval '2 minutes'))
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
   where id = p_call_id
     and (announcement_status = 'pending'
          or (announcement_status = 'claimed'
              and announcement_claimed_at < statement_timestamp() - interval '2 minutes'));
  return found;
end;
$$;

revoke all on function public.delete_table_safe(uuid) from public, anon;
grant execute on function public.delete_table_safe(uuid) to authenticated;
revoke all on function public.claim_kitchen_order_announcement(uuid) from public, anon;
grant execute on function public.claim_kitchen_order_announcement(uuid) to authenticated;
revoke all on function public.claim_table_waiter_call_announcement(uuid) from public, anon;
grant execute on function public.claim_table_waiter_call_announcement(uuid) to authenticated;
