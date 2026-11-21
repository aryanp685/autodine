-- ============================================================================
-- AutoDine — migration 20261109000100: get_public_order must report a hold
--
-- WHY THIS EXISTS
--
-- 20261028000900 added orders.hold_required / orders.confirmed_at and made
-- get_public_order return them, so the guest could be told "waiting for the
-- restaurant to confirm your table" instead of "confirmed".
--
-- 20261107000000 then replaced get_public_order to remove the r.is_active
-- filter (a deliberate storefront fix) but copied the older function body,
-- which did not have the two hold fields. The result is that the guest status
-- page and the live-status poller can never see a hold: awaitingConfirmation
-- is always false, and a held ticket is shown as "Confirmed".
--
-- 20261108000200_drift_reconcile re-applied the hold stamp to
-- place_public_order but explicitly did NOT re-assert get_public_order,
-- because it believed 20261107000000 was the latest word. It is the latest
-- word, but it is missing the hold fields. This migration keeps the
-- storefront fix (no is_active filter) and adds the two fields back.
--
-- This is the 20261107000000 body, unchanged except for the two keys.
-- ============================================================================

create or replace function public.get_public_order(
  p_slug text,
  p_code text,
  p_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'prep_status', o.prep_status,
    'payment_status', o.payment_status,
    'subtotal_paise', o.subtotal_paise,
    'tax_paise', o.tax_paise,
    'total_paise', o.total_paise,
    'customer_note', o.customer_note,
    'placed_at', o.placed_at,
    'hold_required', o.hold_required,
    'confirmed_at', o.confirmed_at,
    'table_label', t.label,
    'lines', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name_snapshot,
                 'qty', i.qty,
                 'unit_price_paise', i.unit_price_paise,
                 'is_veg', i.is_veg,
                 'variant', i.variant_snapshot,
                 'addons', i.addons_snapshot
               )
               order by i.sort_order
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.dining_tables t on t.id = o.table_id
  where r.slug = p_slug
    and o.code = p_code
    and p_token is not null
    and o.guest_token = p_token
  limit 1;
$$;

revoke all on function public.get_public_order(text, text, uuid) from public;
revoke all on function public.get_public_order(text, text, uuid) from anon;
revoke all on function public.get_public_order(text, text, uuid) from authenticated;
grant execute on function public.get_public_order(text, text, uuid) to anon;
grant execute on function public.get_public_order(text, text, uuid) to authenticated;
