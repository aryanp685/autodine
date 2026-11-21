-- Aggregate server-side: a floor plan must not count only the first
-- PostgREST max_rows historical orders. SECURITY INVOKER preserves order RLS.
create or replace function public.table_order_activity(p_restaurant_id uuid)
returns table(table_id uuid, order_count bigint, last_order_at timestamptz)
language sql stable security invoker set search_path = public
as $$
  select o.table_id, count(*), max(o.placed_at)
  from public.orders o
  where o.restaurant_id = p_restaurant_id and o.table_id is not null
  group by o.table_id
$$;
revoke all on function public.table_order_activity(uuid) from public, anon;
grant execute on function public.table_order_activity(uuid) to authenticated;
