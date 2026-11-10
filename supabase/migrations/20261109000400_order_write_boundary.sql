-- Restrict direct REST writes to the one column the kitchen actually needs.
-- Previously an authenticated kitchen member could use the table UPDATE grant
-- to mark a bill paid or overwrite financial snapshots, bypassing payment RPCs.
revoke insert, update, delete on public.orders from public, anon, authenticated;
revoke insert, update, delete on public.order_items from public, anon, authenticated;
grant update (prep_status) on public.orders to authenticated;

drop policy if exists orders_staff_insert on public.orders;
drop policy if exists order_items_insert on public.order_items;

-- Direct kitchen state changes are forward-only and cannot confirm held food.
-- Financial/cancellation RPCs run as their owner and retain their explicit
-- authorization and transitions. The trigger is deliberately SECURITY INVOKER.
create or replace function public.guard_direct_order_progress()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if old.hold_required and old.confirmed_at is null then
      raise exception 'Confirm this table before preparing its order.' using errcode = '42501';
    end if;
    if new.prep_status is distinct from old.prep_status and not (
      (old.prep_status = 'new' and new.prep_status = 'preparing') or
      (old.prep_status = 'preparing' and new.prep_status = 'ready') or
      (old.prep_status = 'ready' and new.prep_status = 'served')
    ) then
      raise exception 'That preparation transition is not allowed.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.guard_direct_order_progress() from public, anon, authenticated;
drop trigger if exists orders_guard_direct_progress on public.orders;
create trigger orders_guard_direct_progress before update on public.orders
for each row execute function public.guard_direct_order_progress();

-- The retired token-less-era entrypoint bypasses the modern verification,
-- rate budget and sitting attachment. No application caller uses it.
-- Hosted histories also contain a three-argument overload, or no legacy
-- function. Enumerate the retired name rather than assuming one signature.
do $$
declare
  legacy_function regprocedure;
begin
  for legacy_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'place_order'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', legacy_function);
  end loop;
end;
$$;
-- A public caller must not choose arbitrary budgets/windows for internal keys.
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
