-- Optional restaurant tax configuration.
-- Existing restaurant rates and historical order totals are intentionally
-- preserved; only the default for future restaurant rows changes to 0%.
alter table public.restaurants
  alter column tax_rate_bps set default 0;

comment on column public.restaurants.tax_rate_bps is
  'Owner-configured tax rate in basis points. Zero disables tax. Existing settings are not changed by migrations.';

-- Keep direct table writes blocked. This narrow RPC is the only API-role path
-- that may update the tax rate, and it is restricted to the restaurant owner.
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
