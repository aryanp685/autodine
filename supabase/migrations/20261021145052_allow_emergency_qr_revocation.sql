-- Trial expiry blocks restaurant-business writes, but an owner/manager must
-- retain the ability to revoke a potentially shared or compromised public QR.
-- The only callable path is a server action that rechecks workspace membership
-- and role; this function itself remains service-role-only.
create or replace function public.revoke_table_qr_code(
  p_restaurant_id uuid,
  p_qr_code_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.table_qr_codes
    set revoked_at = coalesce(revoked_at, statement_timestamp())
    where id = p_qr_code_id and restaurant_id = p_restaurant_id;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.revoke_table_qr_code(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_table_qr_code(uuid, uuid) to service_role;
