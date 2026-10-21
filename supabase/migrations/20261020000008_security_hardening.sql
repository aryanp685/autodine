-- Tighten production RLS to match the documented staff role matrix.
-- Reads remain tenant-scoped; only owner/manager roles can edit restaurant,
-- menu, table, and QR administration. Kitchen can update preparation status;
-- cashier can use the trusted counter/cash RPCs but cannot edit menu settings.

create or replace function public.has_restaurant_role(
  p_restaurant_id uuid,
  p_roles public.member_role[]
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m
    where m.restaurant_id = p_restaurant_id
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

revoke all on function public.has_restaurant_role(uuid, public.member_role[]) from public, anon;
grant execute on function public.has_restaurant_role(uuid, public.member_role[]) to authenticated, service_role;

-- Public menu reads must resolve through a published menu, active restaurant,
-- and the matching restaurant/category relationship. 0002 intentionally fixed
-- the restaurant policy dependency but left these direct reads too broad.
drop policy if exists categories_public on public.categories;
create policy categories_public on public.categories
  for select to public
  using (exists (
    select 1 from public.menus m
    where m.id = categories.menu_id
      and m.restaurant_id = categories.restaurant_id
      and m.is_published
      and public.restaurant_is_active(m.restaurant_id)
  ));

drop policy if exists items_public on public.items;
create policy items_public on public.items
  for select to public
  using (
    is_available
    and public.restaurant_is_active(restaurant_id)
    and exists (
      select 1
      from public.categories c
      join public.menus m on m.id = c.menu_id
      where c.id = items.category_id
        and c.restaurant_id = items.restaurant_id
        and m.restaurant_id = items.restaurant_id
        and m.is_published
    )
  );

drop policy if exists variants_public on public.item_variants;
create policy variants_public on public.item_variants
  for select to public
  using (exists (
    select 1
    from public.items i
    join public.categories c on c.id = i.category_id and c.restaurant_id = i.restaurant_id
    join public.menus m on m.id = c.menu_id and m.restaurant_id = i.restaurant_id
    where i.id = item_variants.item_id
      and i.is_available
      and m.is_published
      and public.restaurant_is_active(i.restaurant_id)
  ));

-- Membership listing and workspace reads require an authenticated member.
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));

drop policy if exists restaurants_read on public.restaurants;
create policy restaurants_read on public.restaurants
  for select to authenticated
  using (id in (select public.current_restaurant_ids()));

-- Restaurant profile and subscription data: owner/manager only for writes and
-- subscription reads. The existing public active-restaurant display policy is
-- intentionally retained.
drop policy if exists restaurants_update on public.restaurants;
create policy restaurants_update on public.restaurants
  for update to authenticated
  using (
    public.has_restaurant_role(id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(id)
  )
  with check (
    public.has_restaurant_role(id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(id)
  );

drop policy if exists restaurant_subscriptions_read on public.restaurant_subscriptions;
create policy restaurant_subscriptions_read on public.restaurant_subscriptions
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[]));

-- Menus, categories, items, and variants: all staff may read their workspace;
-- only owners/managers may mutate them.
drop policy if exists menus_staff_read on public.menus;
drop policy if exists menus_staff_insert on public.menus;
drop policy if exists menus_staff_update on public.menus;
drop policy if exists menus_staff_delete on public.menus;
create policy menus_staff_read on public.menus
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy menus_staff_insert on public.menus
  for insert to authenticated
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy menus_staff_update on public.menus
  for update to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy menus_staff_delete on public.menus
  for delete to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );

drop policy if exists categories_staff_read on public.categories;
drop policy if exists categories_staff_insert on public.categories;
drop policy if exists categories_staff_update on public.categories;
drop policy if exists categories_staff_delete on public.categories;
create policy categories_staff_read on public.categories
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy categories_staff_insert on public.categories
  for insert to authenticated
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy categories_staff_update on public.categories
  for update to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy categories_staff_delete on public.categories
  for delete to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );

drop policy if exists items_staff_read on public.items;
drop policy if exists items_staff_insert on public.items;
drop policy if exists items_staff_update on public.items;
drop policy if exists items_staff_delete on public.items;
create policy items_staff_read on public.items
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy items_staff_insert on public.items
  for insert to authenticated
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy items_staff_update on public.items
  for update to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy items_staff_delete on public.items
  for delete to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );

drop policy if exists variants_staff_read on public.item_variants;
drop policy if exists variants_staff_insert on public.item_variants;
drop policy if exists variants_staff_update on public.item_variants;
drop policy if exists variants_staff_delete on public.item_variants;
create policy variants_staff_read on public.item_variants
  for select to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and i.restaurant_id in (select public.current_restaurant_ids())
  ));
create policy variants_staff_insert on public.item_variants
  for insert to authenticated
  with check (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and public.has_restaurant_role(i.restaurant_id, array['owner','manager']::public.member_role[])
      and public.restaurant_can_write(i.restaurant_id)
  ));
create policy variants_staff_update on public.item_variants
  for update to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and public.has_restaurant_role(i.restaurant_id, array['owner','manager']::public.member_role[])
      and public.restaurant_can_write(i.restaurant_id)
  ))
  with check (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and public.has_restaurant_role(i.restaurant_id, array['owner','manager']::public.member_role[])
      and public.restaurant_can_write(i.restaurant_id)
  ));
create policy variants_staff_delete on public.item_variants
  for delete to authenticated
  using (exists (
    select 1 from public.items i
    where i.id = item_variants.item_id
      and public.has_restaurant_role(i.restaurant_id, array['owner','manager']::public.member_role[])
      and public.restaurant_can_write(i.restaurant_id)
  ));

-- Tables and legacy QR identifiers are management-only. QR sessions and the
-- new QR settings remain service-role-only by design.
drop policy if exists tables_staff_read on public.dining_tables;
drop policy if exists tables_staff_insert on public.dining_tables;
drop policy if exists tables_staff_update on public.dining_tables;
drop policy if exists tables_staff_delete on public.dining_tables;
create policy tables_staff_read on public.dining_tables
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));
create policy tables_staff_insert on public.dining_tables
  for insert to authenticated
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy tables_staff_update on public.dining_tables
  for update to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy tables_staff_delete on public.dining_tables
  for delete to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );

drop policy if exists qr_tokens_staff_read on public.qr_tokens;
drop policy if exists qr_tokens_staff_insert on public.qr_tokens;
drop policy if exists qr_tokens_staff_update on public.qr_tokens;
drop policy if exists qr_tokens_staff_delete on public.qr_tokens;
create policy qr_tokens_staff_read on public.qr_tokens
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[]));
create policy qr_tokens_staff_insert on public.qr_tokens
  for insert to authenticated
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy qr_tokens_staff_update on public.qr_tokens
  for update to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
create policy qr_tokens_staff_delete on public.qr_tokens
  for delete to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );

-- Orders: all staff may read. Kitchen, owner, and manager may advance prep;
-- only trusted RPCs handle order creation and cash settlement.
drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders
  for select to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));

drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders
  for update to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner','manager','kitchen']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    public.has_restaurant_role(restaurant_id, array['owner','manager','kitchen']::public.member_role[])
    and public.restaurant_can_write(restaurant_id)
  );
revoke update on public.orders from public, anon, authenticated;
grant update (prep_status) on public.orders to authenticated;

drop policy if exists order_items_staff on public.order_items;
create policy order_items_staff on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.restaurant_id in (select public.current_restaurant_ids())
  ));

-- Cashiers can view and collect cash; kitchen staff cannot view payment data.
drop policy if exists payments_staff_read on public.payments;
create policy payments_staff_read on public.payments
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner','manager','cashier']::public.member_role[]));

drop policy if exists payment_audit_events_read on public.payment_audit_events;
create policy payment_audit_events_read on public.payment_audit_events
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner','manager','cashier']::public.member_role[]));

-- Reject unpriced or client-invented add-ons. Modifier pricing is not in the
-- live schema, so only item/variant prices are billable until that is modeled.
create or replace function public.reject_unpriced_order_addons()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if cardinality(coalesce(new.addons_snapshot, '{}'::text[])) > 0 then
    raise exception 'Unpriced add-ons are not supported yet. Remove them and try again.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_unpriced_order_addons() from public, anon, authenticated;
drop trigger if exists order_items_reject_unpriced_addons on public.order_items;
create trigger order_items_reject_unpriced_addons
  before insert or update of addons_snapshot on public.order_items
  for each row execute function public.reject_unpriced_order_addons();
