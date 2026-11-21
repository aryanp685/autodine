-- Kitchen announcement claim recovery (order and waiter calls).
--
-- Ported from the two hosted applications of the same correction
-- (production ledger 20261119101116_announcement_claim_recovery, candidate
-- 20261119101121_announcement_claim_recovery) which had no repository file.
-- Without it a device that claims an order announcement and then crashes keeps
-- the claim forever: the insert below is ON CONFLICT DO NOTHING, so every later
-- claim by another device returns false and the ticket is never announced.
--
-- The fix expires a claim after two minutes before inserting, so any device can
-- re-claim a claim that nobody is working on. Everything else about the RPC is
-- unchanged: same signature, same SECURITY DEFINER, same search_path pin, same
-- kitchen membership gate, same grants.
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
  if not found then return false; end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only kitchen staff may claim an announcement.' using errcode = '42501';
  end if;

  -- Release claims whose holder stopped reporting. statement_timestamp() keeps
  -- the window relative to the caller's statement, not the transaction.
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

-- The waiter board polls claimed announcements; without this the poll is a
-- sequential scan on table_waiter_calls.
create index if not exists table_waiter_calls_announcement_claimed_idx
  on public.table_waiter_calls (announcement_claimed_at)
  where announcement_status = 'claimed';
