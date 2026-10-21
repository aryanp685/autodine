-- 0010 · Instant kitchen tickets over Supabase Realtime
--
-- THE PROBLEM THIS FIXES
--
-- The kitchen board polls. Every poll is a full round trip, and the gap
-- between a guest pressing "Place order" and the pass hearing about it is
-- whatever the interval happens to be -- fifteen seconds in the version this
-- follows. On a busy Friday that is a queue of tickets the kitchen does not
-- know about, and a voice that announces the fourth order while the first is
-- already cold.
--
-- Realtime pushes the row the instant it commits. Polling stays as the safety
-- net, because a websocket can drop and a kitchen cannot go silent.
--
-- WHY `orders` AND NOTHING ELSE
--
-- A ticket only ever changes for the kitchen in one direction (prep_status,
-- written by the same device that would already know). What must be pushed is
-- the INSERT: a new order, from a phone, that nobody has looked at yet.
--
-- REPLICA IDENTITY FULL
--
-- Realtime evaluates the row-level policy to decide whether this subscriber
-- may see a change. For INSERT the new row is enough, but for UPDATE and
-- DELETE the OLD row is what carries `restaurant_id`, and without FULL that
-- row holds only the primary key -- the policy cannot be evaluated and the
-- event is either dropped or, worse, evaluated as NULL. Cancelled tickets
-- must disappear from the board, so FULL it is. The cost is a slightly
-- larger WAL entry per order write, which at restaurant volume is nothing.
--
-- The `orders_staff_read` policy (authenticated, restaurant_id ∈
-- current_restaurant_ids()) is what scopes the stream. No new policy here:
-- adding a permissive one would widen the socket as well as the API.

alter table public.orders replica identity full;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

comment on table public.orders is
  'Bills. Published to Supabase Realtime so the kitchen board is pushed a new ticket instead of waiting for its next poll. RLS policy orders_staff_read scopes the stream to the caller''s own restaurants.';
