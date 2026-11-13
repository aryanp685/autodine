-- Keep the account that owns and bills for an outlet immutable to client JWTs.
--
-- 20261021000500 grants authenticated a table-level UPDATE on restaurants so
-- owners and managers can edit settings. RLS limits which restaurant row they
-- may edit, but not which columns; 20261110001000 later added account_id
-- without narrowing that existing grant. Keep the grant and policy intact:
-- restaurant settings, tax, guest verification, branding, storefront and
-- operational controls continue to use ordinary authenticated UPDATEs.
--
-- The account association is different. It selects the subscription and the
-- account-scoped RLS boundary. Only the trusted migration/service path may
-- change an existing association. INSERTs used by initial signup and create_-
-- outlet are unaffected, as are nullable legacy rows and their write-gate
-- fallback. No transfer/linking RPC is introduced.

create or replace function public.prevent_restaurant_account_reassignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is populated by the signed PostgREST JWT for authenticated
  -- requests. Do not use a caller-settable application GUC as a bypass flag.
  -- The service role and migration runner have no end-user subject and remain
  -- the trusted paths for any future operator-approved repair.
  if old.account_id is distinct from new.account_id
     and auth.uid() is not null then
    raise exception 'restaurant account link cannot be changed by a client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.prevent_restaurant_account_reassignment() is
  'Rejects authenticated changes to restaurants.account_id; leaves other restaurant updates, initial inserts, trusted service/migration repairs, and nullable legacy links unchanged.';

-- Trigger functions are invoked by the trigger, not exposed as an RPC.
revoke all on function public.prevent_restaurant_account_reassignment()
  from public, anon, authenticated;

drop trigger if exists restaurants_account_id_immutable on public.restaurants;
create trigger restaurants_account_id_immutable
  before update on public.restaurants
  for each row
  execute function public.prevent_restaurant_account_reassignment();
