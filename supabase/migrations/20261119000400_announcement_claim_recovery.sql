-- Announcement claim recovery for BOTH order and waiter calls
-- Existing waiter-call recovery already handles stale 'claimed' via API polling (announcement-events re-queues claimed>2min).
-- Orders lacked DB-level recovery: a device that claimed then crashed held the claim forever (ON CONFLICT DO NOTHING).
-- This migration adds stale-claim expiry to the order claim RPC so any device can re-claim after 2 minutes.

-- Allow recovery of order claims older than 2 minutes
create or replace function public.claim_kitchen_order_announcement(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_rows bigint := 0;
begin
  if v_actor is null then
    raise exception 'Sign in to claim a kitchen announcement.' using errcode = '42501';
  end if;

  select o.restaurant_id into v_restaurant_id
    from public.orders o
   where o.id = p_order_id
     and o.prep_status = 'new'
     and not (o.hold_required and o.confirmed_at is null)
   for update;

  if not found then
    return false;
  end if;

  if not exists (
    select 1
      from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only kitchen staff may claim an announcement.' using errcode = '42501';
  end if;

  -- Stale-claim recovery: a claim held longer than 2 minutes is considered abandoned (crash/network loss)
  -- and is reclaimed here so the announcement is not lost. This mirrors the waiter-call path where
  -- announcement-events re-queues claimed>2min as pending.
  delete from public.kitchen_announcement_claims
   where order_id = p_order_id
     and claimed_at < statement_timestamp() - interval '2 minutes';

  insert into public.kitchen_announcement_claims (order_id, restaurant_id, claimed_by)
  values (p_order_id, v_restaurant_id, v_actor)
  on conflict (order_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_kitchen_order_announcement(uuid) from public, anon;
grant execute on function public.claim_kitchen_order_announcement(uuid) to authenticated;

-- Waiter-call claim already enforces pending-only; stale recovery is handled in the API layer
-- (announcement-events re-queues claimed with announcement_claimed_at >2min ago).
-- No DDL change needed for waiter calls, but we ensure the read index exists for efficient polling:
create index if not exists table_waiter_calls_announcement_claimed_idx
  on public.table_waiter_calls (announcement_claimed_at) where announcement_status = 'claimed';
