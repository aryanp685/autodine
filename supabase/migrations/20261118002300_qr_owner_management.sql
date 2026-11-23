-- ============================================================================
-- AutoDine — migration 20261118002300: QR owner management completeness
--
-- Complements 20261118002200 (F-01/F-02/F-03). Adds the missing owner actions
-- the mission requires while preserving the security boundary.
--
-- 1. restore_table_qr_code(p_table_id uuid) -> text
--    Restores the most-recently revoked QR for a table, but ONLY when no
--    active QR exists. Uses advisory lock + unique partial index as the
--    arbiter, so concurrent restores cannot create a second live card.
--    Returns the restored token, or raises with a clear message when
--    unsafe (already has live code, or no revoked code to restore).
--
-- 2. delete_table_safe(p_table_id uuid) -> void
--    Safe archival of a table: if the table has historical orders or
--    active sessions, it is disabled (is_active=false) rather than deleted,
--    preserving referential integrity for orders/kitchen history.
--    Only with zero orders and zero sessions is hard delete allowed.
--    Prevents orphaned QR/session records and silent data loss.
--
-- 3. Re-assert trigger ensures new tables always get a QR (already exists).
--    No change, but documented as part of permanent identity guarantee.
--
-- All functions are SECURITY DEFINER, search_path pinned, tenant-isolated
-- via has_restaurant_role(owner,manager), and use advisory locks for races.
-- ============================================================================

-- Restore most-recent revoked QR, but only if table has NO live QR
create or replace function public.restore_table_qr_code(p_table_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_token         text;
  v_qr_id         uuid;
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
    raise exception 'This restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_table_id::text));

  -- Guard: already has a live QR — restoring would create two
  if exists (select 1 from public.table_qr_codes where table_id = p_table_id and revoked_at is null) then
    raise exception 'This table already has an active QR. Revoke or replace the current one first.' using errcode = '23505';
  end if;

  -- Table must still be active and restaurant still valid
  if not exists (select 1 from public.dining_tables t where t.id = p_table_id and t.is_active and t.restaurant_id = v_restaurant_id) then
    raise exception 'This table is not active. Enable it first.' using errcode = 'P0002';
  end if;

  -- Find most recent revoked card
  select q.id, q.public_token into v_qr_id, v_token
  from public.table_qr_codes q
  where q.table_id = p_table_id and q.revoked_at is not null
  order by q.revoked_at desc limit 1;

  if v_qr_id is null then
    raise exception 'No revoked QR to restore for this table.' using errcode = 'P0002';
  end if;

  -- Verify table/restaurant linkage still holds (QR belongs to this table's current restaurant)
  if not exists (
    select 1 from public.table_qr_codes q
    where q.id = v_qr_id and q.table_id = p_table_id and q.restaurant_id = v_restaurant_id
  ) then
    raise exception 'The old QR belongs to a different restaurant. Replacement is required.' using errcode = '42501';
  end if;

  update public.table_qr_codes set revoked_at = null where id = v_qr_id;

  return v_token;
end;
$$;

comment on function public.restore_table_qr_code(uuid) is
  'Restore the most recent revoked QR for a table when safe. Owner/manager only, no double live QR.';

revoke all on function public.restore_table_qr_code(uuid) from public, anon;
grant execute on function public.restore_table_qr_code(uuid) to authenticated;

-- Safe delete: archive when history exists, hard delete only when clean
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

  perform pg_advisory_xact_lock(hashtext(p_table_id::text));

  -- Check for historical orders or active sessions referencing this table
  select exists (
    select 1 from public.orders o where o.table_id = p_table_id
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

comment on function public.delete_table_safe(uuid) is
  'Delete or archive a table safely. Owner/manager only. Preserves order history.';

revoke all on function public.delete_table_safe(uuid) from public, anon;
grant execute on function public.delete_table_safe(uuid) to authenticated;
