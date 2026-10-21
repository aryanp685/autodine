-- Keep the single entitlement predicate aligned with the server-owned rules:
-- inactive and expired workspaces are read-only, unless an active subscription
-- grants write access. Membership remains required for authenticated callers;
-- trusted service-role order paths retain their existing server checks.
create or replace function public.restaurant_can_write(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active
      and (
        auth.uid() is null
        or exists (
          select 1
          from public.memberships m
          where m.restaurant_id = r.id
            and m.user_id = auth.uid()
        )
      )
      and (
        r.trial_started_at + interval '10 days' > statement_timestamp()
        or exists (
          select 1
          from public.restaurant_subscriptions s
          where s.restaurant_id = r.id
            and s.status = 'active'
            and s.current_period_end > statement_timestamp()
        )
      )
  );
$$;

revoke all on function public.restaurant_can_write(uuid) from public, anon;
grant execute on function public.restaurant_can_write(uuid) to authenticated, service_role;

-- The owner-only tax RPC is a controlled write surface outside ordinary table
-- RLS. Apply the same entitlement predicate so trial expiry really is
-- read-only, while preserving existing rates and historical order totals.
create or replace function public.set_restaurant_tax_rate(
  p_restaurant_id uuid,
  p_tax_rate_bps integer
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.member_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in as the restaurant owner to update tax settings.'
      using errcode = '42501';
  end if;

  if p_tax_rate_bps is null or p_tax_rate_bps < 0 or p_tax_rate_bps > 3000 then
    raise exception 'Tax rate must be between 0%% and 30%%.' using errcode = '22023';
  end if;

  select m.role into v_role
  from public.memberships m
  where m.restaurant_id = p_restaurant_id
    and m.user_id = auth.uid();

  if not found or v_role <> 'owner' then
    raise exception 'Only the restaurant owner may update tax settings.'
      using errcode = '42501';
  end if;

  if not public.restaurant_can_write(p_restaurant_id) then
    raise exception 'This workspace is inactive or read-only.' using errcode = 'P0001';
  end if;

  update public.restaurants
  set tax_rate_bps = p_tax_rate_bps
  where id = p_restaurant_id and is_active;

  if not found then
    raise exception 'Active restaurant not found.' using errcode = 'P0002';
  end if;

  return p_tax_rate_bps;
end;
$$;

revoke all on function public.set_restaurant_tax_rate(uuid, integer) from public, anon;
grant execute on function public.set_restaurant_tax_rate(uuid, integer) to authenticated;

-- These QR functions are callable only with the service role and are used by
-- authenticated server actions. Keep the database-side entitlement check as
-- defense in depth against accidental service-action bypasses.
create or replace function public.issue_table_qr_code(
  p_restaurant_id uuid,
  p_table_id uuid,
  p_public_token text,
  p_actor_id uuid
) returns public.table_qr_codes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.table_qr_codes%rowtype;
begin
  if not public.restaurant_can_write(p_restaurant_id) then
    raise exception 'This workspace is inactive or read-only.' using errcode = 'P0001';
  end if;
  if p_public_token is null or p_public_token !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid table QR token.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.restaurants r
    join public.dining_tables t on t.restaurant_id = r.id
    where r.id = p_restaurant_id and r.is_active
      and t.id = p_table_id and t.is_active
  ) then
    raise exception 'Restaurant or table is inactive or unavailable.' using errcode = 'P0002';
  end if;

  update public.table_qr_codes
  set revoked_at = statement_timestamp()
  where restaurant_id = p_restaurant_id and table_id = p_table_id and revoked_at is null;
  insert into public.table_qr_codes(restaurant_id, table_id, public_token, created_by)
  values (p_restaurant_id, p_table_id, p_public_token, p_actor_id)
  returning * into v_result;
  return v_result;
end;
$$;

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
  if not public.restaurant_can_write(p_restaurant_id) then
    raise exception 'This workspace is inactive or read-only.' using errcode = 'P0001';
  end if;
  update public.table_qr_codes
    set revoked_at = coalesce(revoked_at, statement_timestamp())
    where id = p_qr_code_id and restaurant_id = p_restaurant_id;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.issue_table_qr_code(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_table_qr_code(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_table_qr_code(uuid, uuid, text, uuid) to service_role;
grant execute on function public.revoke_table_qr_code(uuid, uuid) to service_role;
