-- Coupon uses_count was a one-way counter: apply_coupon_to_order increments it
-- when a code lands on an order, and nothing ever gives the use back. After a
-- few removed or swapped codes, a promo code looks exhausted (or its max_uses
-- limit trips early) although no guest actually used it.
--
-- The release lives in one trigger rather than in each function, so every path
-- that drops a coupon from a bill gives the use back exactly once: clearing the
-- code, swapping to a different code, and cancelling the order. Paid bills keep
-- their use -- the discount was granted.

create or replace function public.release_coupon_use_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release uuid;
begin
  if old.coupon_id is null then
    return new;
  end if;

  if old.prep_status is distinct from 'cancelled' and new.prep_status = 'cancelled' then
    v_release := old.coupon_id;
  elsif new.coupon_id is null or new.coupon_id is distinct from old.coupon_id then
    v_release := old.coupon_id;
  end if;

  if v_release is not null then
    update public.restaurant_coupons
       set uses_count = greatest(uses_count - 1, 0),
           updated_at = statement_timestamp()
     where id = v_release;
  end if;

  return new;
end;
$$;

revoke all on function public.release_coupon_use_on_order_change() from public, anon, authenticated, service_role;

drop trigger if exists orders_release_coupon_use on public.orders;

create trigger orders_release_coupon_use
  after update of coupon_id, prep_status on public.orders
  for each row
  execute function public.release_coupon_use_on_order_change();
