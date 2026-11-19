-- Guest quote source for the approved GST modes.
--
-- The storefront projection deliberately exposes no GST configuration, and
-- gst_pricing() is staff-only. The guest cart still has to price the same way
-- the order RPC will, so this read-only projection returns exactly the two
-- public pricing facts: the mode and, for Regular GST, the closed profile's
-- rate (5% or 18%). It cannot list restaurants, and it returns nothing for an
-- unknown slug. No GSTIN, legal name, turnover, or configuration history.

create or replace function public.public_restaurant_gst(p_slug text)
returns table (mode text, rate_bps integer)
language sql
stable
security definer
set search_path = public, pg_temp
rows 1
as $$
  select coalesce(c.mode, 'off')::text,
         case
           when c.mode = 'regular' then
             case c.regular_profile
               when 'specified_premises' then 1800
               else 500
             end
           else null
         end
    from public.restaurants r
    left join public.restaurant_gst_config c on c.restaurant_id = r.id
   where r.slug = nullif(btrim(p_slug), '')
   limit 1;
$$;

comment on function public.public_restaurant_gst(text) is
  'Guest cart quote: GST mode and closed-profile rate for one storefront slug. Returns no tenant identity and no configuration beyond the public pricing facts.';

revoke all on function public.public_restaurant_gst(text) from public, anon, authenticated;
grant execute on function public.public_restaurant_gst(text) to anon, authenticated, service_role;
