-- 20261118000100 — merge reconciliation for PR #191 (main x branch).
--
-- main's 20261112000700 made set_order_line_quantities finance-scoped
-- (owner/manager/cashier, Kitchen denied with 42501, restaurant write
-- gate checked before payment-state guards). The branch's later
-- 20261113000100 GST two-mode rewrite replaced the function and
-- silently re-admitted Kitchen and dropped the write-gate ordering.
-- Neither applied migration is edited; this forward migration
-- re-asserts the boundary rules on top of the GST mode-aware body
-- (inclusive/composition tax math preserved verbatim), so the final
-- definition satisfies both lines of work. Grants are re-asserted to
-- match 20261112000700 exactly.
--
create or replace function public.set_order_line_quantities(
  p_order_id uuid,
  p_lines jsonb,
  p_guest_token uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_staff boolean := false;
  v_rate int;
  v_mode text;
  v_inclusive bigint;
  v_taxable bigint;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_lines_left int := 0;
begin
  -- Serialize source mutations with checkout before locking the ticket.
  perform s.id from public.order_sessions s
    join public.orders o on o.order_session_id = s.id
   where o.id = p_order_id and s.restaurant_id = o.restaurant_id
     and ((p_guest_token is not null and o.guest_token = p_guest_token)
       or (p_guest_token is null and exists (
         select 1 from public.memberships m where m.restaurant_id=o.restaurant_id
           and m.user_id=auth.uid() and m.role in ('owner','manager','cashier'))))
   for update of s;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;


  if p_guest_token is not null then
    if v_order.guest_token is distinct from p_guest_token then
      raise exception 'That order could not be found.' using errcode = 'P0001';
    end if;
  else
    select exists (
      select 1
        from public.memberships m
       where m.restaurant_id = v_order.restaurant_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'manager', 'cashier')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to change this order.' using errcode = '42501';
    end if;
  end if;

  -- A Security Definer function bypasses the write-gated RLS policy.
  -- Check the restaurant write gate after authenticating the caller, before
  -- testing payment or kitchen state so a read-only response does not leak it.
  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before changing orders.'
      using errcode = 'P0001';
  end if;

  -- A pending online attempt is money in flight. Cancelling or repricing the
  -- order underneath it would leave the provider capturing an amount that no
  -- longer matches the bill, and there is no refund path in this build.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Please wait for it to finish or ask staff.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order has been cancelled.' using errcode = 'P0001';
  end if;

  if v_order.prep_status <> 'new' then
    raise exception 'The kitchen has already started this order. Please ask the staff to change it.'
      using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. Ask the counter to change it.'
      using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  -- Validate the whole payload before changing any row. No silent unknown IDs,
  -- duplicate source rows, truncated decimals, or non-numeric quantities.
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'line_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(e->>'qty', '') !~ '^[0-9]{1,2}$'
  ) then
    raise exception 'Each change needs a valid line and a whole quantity from 0 to 99.' using errcode = '22023';
  end if;
  if (select count(distinct e->>'line_id') from jsonb_array_elements(p_lines) e) <> jsonb_array_length(p_lines)
     or exists (select 1 from jsonb_array_elements(p_lines) e
                where not exists (select 1 from public.order_items i
                                  where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id)) then
    raise exception 'One of those lines does not belong to this order, or was submitted twice.' using errcode = '22023';
  end if;

  -- Delete zero-quantity lines FIRST: writing qty=0 then deleting violates
  -- the order_items qty > 0 constraint before the DELETE can run.
  delete from public.order_items i using jsonb_array_elements(p_lines) e
   where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int = 0;
  update public.order_items i set qty = (e->>'qty')::int
    from jsonb_array_elements(p_lines) e
   where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int > 0;

  select count(*), coalesce(sum(unit_price_paise * qty), 0)
    into v_lines_left, v_subtotal
    from public.order_items
   where order_id = v_order.id;

  if v_lines_left = 0 then
    raise exception 'An order needs at least one dish. Cancel it instead.' using errcode = 'P0001';
  end if;

  -- Reprice under the configuration THIS order was priced under. Orders
  -- placed before the GST system, and orders in restaurants with GST off,
  -- keep the legacy exclusive formula with the order's snapshotted rate.
  v_mode := coalesce(v_order.gst_mode_snapshot, 'off');
  v_rate := coalesce(
    v_order.tax_rate_bps_snapshot,
    (select r.tax_rate_bps from public.restaurants r where r.id = v_order.restaurant_id),
    0
  );

  v_inclusive := greatest(v_subtotal - v_order.discount_paise, 0);
  if v_mode = 'composition' then
    v_taxable := v_inclusive;
    v_tax := 0;
    v_total := v_inclusive;
  elsif v_mode = 'regular' then
    v_taxable := round(v_inclusive::numeric * 10000 / (10000 + v_rate))::bigint;
    v_tax := v_inclusive - v_taxable;
    v_total := v_inclusive;
  else
    v_taxable := v_inclusive;
    v_tax := round(v_taxable::numeric * v_rate / 10000.0)::bigint;
    v_total := v_taxable + v_tax;
  end if;

  update public.orders
     set subtotal_paise = v_subtotal,
         tax_paise = v_tax,
         total_paise = v_total,
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'tax_paise', v_tax,
    'total_paise', v_total,
    'lines', v_lines_left
  );
end;
$$;

revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.set_order_line_quantities(uuid, jsonb, uuid) to anon, authenticated;
comment on function public.set_order_line_quantities(uuid, jsonb, uuid) is
  'Guest-token edit or Owner/Manager/Cashier staff edit of a new unpaid order (GST mode-aware totals). Applies the restaurant write gate and denies Kitchen before payment-state guards to prevent status disclosure.';
