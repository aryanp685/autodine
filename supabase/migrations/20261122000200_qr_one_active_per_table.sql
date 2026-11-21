-- One live table QR at the database level, and serialised rotation.
--
-- Ported from the hosted applications of the same correction (production ledger
-- 20261120190546_qr_code_staff_boundary, candidate 20261120190508) which had no
-- repository file. 20261118002200 added the membership gates but relied on a
-- `for update` row lock alone; this migration adds the invariant that survives
-- a writer which never takes that lock, and the advisory lock that serialises
-- rotation on the table id.
--
-- Ordering note: this version is newer than every hosted ledger row, so a push
-- of this directory ends on these bodies. That matters because
-- 20261118002200 is still missing from both hosted ledgers and a push would run
-- it after their newer rows.
--
-- Re-running is safe: the cleanup is idempotent, the index is IF NOT EXISTS and
-- both functions are CREATE OR REPLACE.
--
-- 1. Collapse any duplicate live cards first, keeping the newest, so the unique
--    index can be created on a database that already drifted.
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

  select t.restaurant_id
    into v_restaurant_id
  from public.dining_tables t
  where t.id = p_table_id
    for update;

  if not found then
    raise exception 'That table does not exist.' using errcode = 'P0002';
  end if;

  -- RLS is suspended inside this SECURITY DEFINER function, so membership is
  -- proved here. restaurant_can_write() answers whether the outlet's plan allows
  -- writes; it does not answer who is calling.
  if not public.has_restaurant_role(v_restaurant_id, array['owner', 'manager']) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'This restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  -- Second serialisation point, on the table id: the row lock above covers
  -- callers of this function, this advisory lock also covers any writer that
  -- reaches table_qr_codes by another route.
  perform pg_advisory_xact_lock(hashtext(p_table_id::text));

  v_token := public.new_qr_public_token();

  update public.table_qr_codes
     set revoked_at = now()
   where table_id = p_table_id
     and revoked_at is null;

  insert into public.table_qr_codes (restaurant_id, table_id, public_token, created_by)
  values (v_restaurant_id, p_table_id, v_token, auth.uid());

  return v_token;
end;
$$;

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
  where t.id = p_table_id
    for update;

  if not found then
    raise exception 'That table does not exist.' using errcode = 'P0002';
  end if;

  if not public.has_restaurant_role(v_restaurant_id, array['owner', 'manager']) then
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

comment on function public.rotate_table_qr_code(uuid) is
  'F-01/F-02/F-03: rotate a table QR. Owner/manager of the owning restaurant only, atomic, one live QR per table.';
comment on function public.retire_table_qr_code(uuid) is
  'F-02: revoke a table QR. Owner/manager only, tenant-isolated.';

revoke all on function public.ensure_table_qr_code() from public, anon, authenticated;
revoke all on function public.rotate_table_qr_code(uuid) from public, anon;
revoke all on function public.retire_table_qr_code(uuid) from public, anon;
grant execute on function public.rotate_table_qr_code(uuid) to authenticated;
grant execute on function public.retire_table_qr_code(uuid) to authenticated;
