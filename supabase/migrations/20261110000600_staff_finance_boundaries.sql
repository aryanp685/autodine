-- Staff boundaries the application already enforces, now enforced by the
-- database as well. Independent of the application version: no screen relies
-- on the access removed here.

-- 1. The payment audit ledger is finance data.
--    20261107080000 let every member read it, kitchen staff included. Payments
--    themselves are already owner/manager/cashier only (payments_money_read),
--    and 20261108009000 narrowed invoices and receipts the same way.
drop policy if exists payment_audit_events_staff_read on public.payment_audit_events;
drop policy if exists payment_audit_events_finance_read on public.payment_audit_events;
create policy payment_audit_events_finance_read on public.payment_audit_events
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'cashier']));

-- 2. Moving a ticket through preparation is a kitchen action.
--    The policy from 20261026001100 also admitted cashiers, while the kitchen
--    server action refuses them. 20261109000400 already limits this direct
--    write to forward-only changes of prep_status; payment and cancellation
--    run through their own RPCs and are unaffected.
drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders
  for update to authenticated
  using (
    public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen'])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen']));

-- 3. Plan and trial state belongs to the restaurant's own staff.
--    restaurant_access(), restaurant_trial_ends_at(), restaurant_features() and
--    restaurant_has_feature() were SECURITY DEFINER and executable by anon, so
--    anyone holding a restaurant id could read its plan, trial end and feature
--    tier. No policy and no other function depends on them: the write gate
--    restaurant_can_write() is self-contained and is not touched. As SECURITY
--    INVOKER they read public.restaurants under the caller's own row security,
--    so members see their restaurant and everyone else gets "not found".
--    Signatures are enumerated rather than assumed.
do $$
declare
  plan_reader regprocedure;
begin
  for plan_reader in
    select p.oid::regprocedure
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('restaurant_access', 'restaurant_trial_ends_at', 'restaurant_features', 'restaurant_has_feature')
  loop
    execute format('alter function %s security invoker', plan_reader);
    execute format('revoke all on function %s from public, anon', plan_reader);
    execute format('grant execute on function %s to authenticated, service_role', plan_reader);
  end loop;
end;
$$;
