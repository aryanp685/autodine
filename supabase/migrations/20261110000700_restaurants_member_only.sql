-- Restaurant rows are readable by their members only (CONTRACT step).
--
-- REQUIRES an application version that reads storefronts through
-- public_restaurant_profile() (lib/db/public-restaurant.ts). An older
-- application reads the table directly as a guest and would show every menu as
-- "not found" after this migration. Apply 20261110000500 first, deploy the
-- application, then apply this file.
--
-- After this migration a guest, or a signed-in user who is not a member, can
-- no longer select from public.restaurants at all. Members keep
-- `restaurants_read`; owners and managers keep `restaurants_update`.

do $$
begin
  if to_regprocedure('public.public_restaurant_profile(text)') is null then
    raise exception 'public_restaurant_profile(text) is missing: apply 20261110000500 first, or guests lose the storefront read.';
  end if;
end;
$$;

drop policy if exists restaurants_public on public.restaurants;

-- Guests never write this table. Row security already refused it; the
-- privilege is removed as well so a future permissive policy cannot open it.
revoke insert, update, delete on public.restaurants from anon;
