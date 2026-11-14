-- Only the restaurant owner may change billing configuration.
--
-- This is a permission boundary only. It does not enable GST invoices, alter
-- receipt issuance, change tax calculations, or rewrite existing order
-- snapshots. The app action/UI checks are backed by this database guard so a
-- direct authenticated database update cannot bypass the owner-only rule.

create or replace function public.guard_restaurant_billing_configuration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.tax_rate_bps is distinct from old.tax_rate_bps
     or new.gstin is distinct from old.gstin then
    if v_actor is null or not public.has_restaurant_role(new.id, array['owner']) then
      raise exception 'Only the restaurant owner can change billing or tax configuration.'
        using errcode = '42501';
    end if;
  end if;

  if new.tax_rate_bps is distinct from old.tax_rate_bps
     and (new.tax_rate_bps is null or new.tax_rate_bps < 0 or new.tax_rate_bps > 3000) then
    raise exception 'Enter a valid tax rate between 0 and 30 percent.'
      using errcode = '23514';
  end if;

  if new.gstin is distinct from old.gstin
     and new.gstin is not null
     and new.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Enter a GSTIN in the 15-character format or leave it blank.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_restaurant_billing_configuration() from public, anon, authenticated;

drop trigger if exists restaurants_billing_configuration_guard on public.restaurants;
create trigger restaurants_billing_configuration_guard
  before update of tax_rate_bps, gstin on public.restaurants
  for each row execute function public.guard_restaurant_billing_configuration();

comment on function public.guard_restaurant_billing_configuration() is
  'Restricts tax-rate and GSTIN changes to the restaurant owner; does not alter order snapshots or GST invoice availability.';
