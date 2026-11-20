-- Table QR lifecycle: prove the caller belongs to the outlet.
--
-- Forward-only security correction from the 2026-11-19 privileged-function
-- review. Both RPCs are SECURITY DEFINER and were granted to `authenticated`,
-- but their only guard was restaurant_can_write(), which is a subscription
-- entitlement check (plan/trial), not a membership check. Any signed-in
-- account could therefore:
--
--   * retire_table_qr_code(<another outlet's table id>)  -> revoke that outlet's
--     printed cards (guest ordering stops until staff re-provision), and
--   * rotate_table_qr_code(<another outlet's table id>)  -> revoke the cards AND
--     receive the replacement public_token, so the attacker could open guest
--     sessions and place orders on the victim's table.
--
-- A guest learns a table's uuid from current_table_session(), so the id was not
-- a secret. The dining_tables write policy already limits table management to
-- owner/manager; these functions now enforce the same roles before they touch
-- table_qr_codes. Signatures, return types, grants and the entitlement check
-- are unchanged, so no client call site changes.
--
-- NOT AUTHORIZED for any hosted application; local implementation and tests
-- only.

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

  -- Lock the table row first. Two concurrent rotations would otherwise both
  -- pass the checks, each fail to see the other's uncommitted card, and leave
  -- TWO live cards for the same table; a retire racing a rotate could return
  -- success while a fresh card stays live. Serialising on the dining_tables row
  -- makes the second caller wait and then observe the first caller's result.
  select t.restaurant_id
    into v_restaurant_id
  from public.dining_tables t
  where t.id = p_table_id
    for update;

  if not found then
    raise exception 'That table does not exist.' using errcode = 'P0002';
  end if;

  -- RLS is suspended inside this SECURITY DEFINER function, so membership is
  -- proved here. restaurant_can_write() below answers whether the outlet's plan
  -- allows writes; it does not answer who is calling, and on its own it let any
  -- signed-in account retire or rotate another outlet's codes by table id
  -- (2026-11-19 security review, findings QR-01 and QR-02). The role set
  -- matches the dining_tables write policy: owner and manager.
  if not public.has_restaurant_role(v_restaurant_id, array['owner', 'manager']) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  v_token := public.new_qr_public_token();

  -- Revoke before inserting. The trigger on table_qr_codes that ends sessions
  -- for a revoked code fires here, so anyone sitting at this table under the
  -- old code is signed out of it at once.
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

  -- Lock the table row first. Two concurrent rotations would otherwise both
  -- pass the checks, each fail to see the other's uncommitted card, and leave
  -- TWO live cards for the same table; a retire racing a rotate could return
  -- success while a fresh card stays live. Serialising on the dining_tables row
  -- makes the second caller wait and then observe the first caller's result.
  select t.restaurant_id
    into v_restaurant_id
  from public.dining_tables t
  where t.id = p_table_id
    for update;

  if not found then
    raise exception 'That table does not exist.' using errcode = 'P0002';
  end if;

  -- RLS is suspended inside this SECURITY DEFINER function, so membership is
  -- proved here. restaurant_can_write() answers whether the outlet's plan
  -- allows writes; it does not answer who is calling, and on its own it let any
  -- signed-in account retire or rotate another outlet's codes by table id
  -- (2026-11-19 security review, finding QR-01/QR-02). The role set matches the
  -- dining_tables write policy: owner and manager.
  if not public.has_restaurant_role(v_restaurant_id, array['owner', 'manager']) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  update public.table_qr_codes
     set revoked_at = now()
   where table_id = p_table_id
     and revoked_at is null;
end;
$$;

revoke all on function public.rotate_table_qr_code(uuid) from public, anon, authenticated;
revoke all on function public.retire_table_qr_code(uuid) from public, anon, authenticated;

grant execute on function public.rotate_table_qr_code(uuid) to authenticated;
grant execute on function public.retire_table_qr_code(uuid) to authenticated;
