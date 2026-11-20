-- ============================================================================
-- AutoDine — migration 20261118002200: QR code staff boundary (F-01/F-02/F-03)
--
-- PRODUCTION VULNERABILITIES BEING CLOSED
--
--   F-01 Cross-tenant QR token exposure
--     Previous rotate_table_qr_code() checked restaurant_can_write() only.
--     That function checks is_active + trial/plan expiry, NOT membership.
--     Any authenticated user could rotate (and read back) any table's QR
--     token. Fixed: check has_restaurant_role(owner/manager) + is_member.
--
--   F-02 Cross-tenant QR denial of service
--     Same root cause allowed any authenticated user to retire/revoke any
--     table's QR. Fixed with same membership + role gate, plus tenant-isolated
--     SELECT for the lookup.
--
--   F-03 Concurrent QR rotation race
--     Two simultaneous rotate_table_qr_code() could both UPDATE revoked_at
--     on the same live rows (each seeing the other's uncommitted state via
--     snapshot isolation) and then both INSERT, leaving TWO live cards for
--     one table. Fixed with a database-level invariant + atomic lock.
--
-- WHAT THIS MIGRATION DOES
--
-- 1. Enforces exactly ONE active QR per table at the database level via a
--    unique partial index. This is the only guarantee that survives a
--    concurrent transaction, a retry, or a bug elsewhere.
--
-- 2. Replaces rotate_table_qr_code() and retire_table_qr_code() with variants
--    that:
--      - resolve restaurant_id from dining_tables using ONLY the caller
--        (no client-supplied restaurant id is trusted)
--      - check has_restaurant_role(restaurant_id, {owner,manager}) — not just
--        can_write — so cross-tenant and non-staff callers are rejected with
--        42501
--      - take an advisory transaction lock on the table's id (via
--        pg_advisory_xact_lock) so concurrent rotations serialize and cannot
--        both INSERT a second live row
--      - remain SECURITY DEFINER with search_path pinned to public,pg_temp
--
-- 3. Tightens table_qr_codes RLS: anon gets nothing, authenticated can SELECT
--    only rows for restaurants they are members of (existing policy is
--    re-asserted, anon revoke re-asserted). ensure_table_qr_code trigger
--    remains SECURITY DEFINER and relies on dining_tables RLS for the insert
--    path (dining_tables insert already requires membership).
--
-- 4. Grants: rotate/retire remain EXECUTE to authenticated only (anon/public
--    revoked). ensure_table_qr_code has no EXECUTE for client roles (trigger
--    only).
--
-- IDEMPOTENCY
--   All indexes use IF NOT EXISTS, all functions use CREATE OR REPLACE, all
--   policies are DROP IF EXISTS + CREATE. Re-running is safe. If an index
--   already exists but has a different name, the unique invariant will still
--   be created under the expected name; a duplicate with a different name is
--   harmless but the expected name is documented.
--
-- BACKWARD COMPATIBILITY
--   Same function signatures (uuid -> text / uuid -> void). Existing app calls
--   in app/(staff)/dashboard/tables/actions.ts continue to work for
--   authorized callers. Unauthorized callers now get 42501 instead of silent
--   success — which is the fix.
-- ============================================================================

-- 1. Exactly one live QR per table — the database is the final word.
-- Before creating the constraint, heal any violation that already exists:
-- keep the most recent live code per table, revoke older duplicates.
-- This makes the index creation succeed on a database that already drifted
-- due to F-03.

do $$
declare
  t uuid;
begin
  for t in
    select table_id
    from public.table_qr_codes
    where revoked_at is null
    group by table_id
    having count(*) > 1
  loop
    update public.table_qr_codes
       set revoked_at = now()
     where id in (
       select id from public.table_qr_codes
       where table_id = t and revoked_at is null
       order by created_at desc
       offset 1
     );
  end loop;
end;
$$;

create unique index if not exists table_qr_codes_one_active_per_table
  on public.table_qr_codes (table_id)
  where revoked_at is null;

comment on index public.table_qr_codes_one_active_per_table is
  'F-03: at most one live QR per table. Concurrent rotation cannot create a second live card.';

-- 2. Rotate — tenant-isolated, role-gated, race-safe
create or replace function public.rotate_table_qr_code(p_table_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_token         text;
begin
  if p_table_id is null then
    raise exception 'A table is required.' using errcode = '22023';
  end if;

  -- Tenant isolation: resolve restaurant_id directly, do not trust caller input
  select t.restaurant_id
    into v_restaurant_id
  from public.dining_tables t
  where t.id = p_table_id;

  if not found then
    raise exception 'That table does not exist.' using errcode = 'P0002';
  end if;

  -- F-01/F-02: must be owner or manager of THIS restaurant. RLS is suspended
  -- inside SECURITY DEFINER, so this is the only line that matters.
  if not public.has_restaurant_role(v_restaurant_id, array['owner','manager']) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  -- Also require the restaurant to be writable (trial/plan gate) — preserves
  -- existing business rule without using it as the sole auth check
  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'This restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  -- F-03: serialize concurrent rotations for the same table. Advisory lock is
  -- transaction-scoped (xact), so it auto-releases and cannot leak. Using
  -- hashtext of the table uuid as the key is collision-resistant for this use.
  perform pg_advisory_xact_lock(hashtext(p_table_id::text));

  v_token := public.new_qr_public_token();

  -- Revoke old live codes for this table
  update public.table_qr_codes
     set revoked_at = now()
   where table_id = p_table_id
     and revoked_at is null;

  -- Insert exactly one new live code
  insert into public.table_qr_codes (restaurant_id, table_id, public_token, created_by)
  values (v_restaurant_id, p_table_id, v_token, auth.uid());

  return v_token;
end;
$$;

comment on function public.rotate_table_qr_code(uuid) is
  'F-01/F-02/F-03: Rotate a table QR. Owner/manager of the owning restaurant only, atomic, at most one live QR per table.';

-- 3. Retire — same gates
create or replace function public.retire_table_qr_code(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
begin
  if p_table_id is null then
    raise exception 'A table is required.' using errcode = '22023';
  end if;

  select t.restaurant_id
    into v_restaurant_id
  from public.dining_tables t
  where t.id = p_table_id;

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

  update public.table_qr_codes
     set revoked_at = now()
   where table_id = p_table_id
     and revoked_at is null;
end;
$$;

comment on function public.retire_table_qr_code(uuid) is
  'F-02: Revoke a table QR. Owner/manager only, tenant-isolated.';

-- 4. Ensure table QR trigger function — re-assert trigger-only (no client EXECUTE)
-- The trigger itself is fine: dining_tables INSERT already requires membership via RLS.
-- We just ensure the function cannot be called directly by clients.

revoke all on function public.ensure_table_qr_code() from public, anon, authenticated, service_role;
revoke all on function public.rotate_table_qr_code(uuid) from public, anon;
revoke all on function public.retire_table_qr_code(uuid) from public, anon;
grant execute on function public.rotate_table_qr_code(uuid) to authenticated;
grant execute on function public.retire_table_qr_code(uuid) to authenticated;

-- Re-assert table_qr_codes RLS: anon none, authenticated only own restaurant
revoke all on public.table_qr_codes from anon;
grant select on public.table_qr_codes to authenticated;

drop policy if exists table_qr_codes_staff_select on public.table_qr_codes;
create policy table_qr_codes_staff_select on public.table_qr_codes
  for select to authenticated using (public.is_member(restaurant_id));

-- Also ensure table_verification_sessions cannot be read directly by clients
revoke all on public.table_verification_sessions from anon;
revoke all on public.table_verification_sessions from authenticated;
