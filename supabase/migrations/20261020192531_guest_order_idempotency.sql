-- Add an idempotent server-only entry point for QR guest orders.
-- The existing place_order() remains the single source of pricing and item
-- validation; this wrapper prevents a browser retry/double-submit from creating
-- a second order for the same form submission.

alter table public.orders
  add column if not exists idempotency_key text;

create unique index if not exists orders_idempotency_key_unique
  on public.orders(idempotency_key)
  where idempotency_key is not null;

create or replace function public.place_order_idempotent(
  p_session_token text,
  p_items jsonb,
  p_note text,
  p_request_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_order_id uuid;
begin
  if p_request_id is null then
    raise exception 'A request identifier is required.' using errcode = '22023';
  end if;

  v_key := 'guest:' || p_request_id::text;
  -- Serialize retries of the same request key, including concurrent submits.
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select o.id into v_order_id
  from public.orders o
  where o.idempotency_key = v_key;
  if found then
    return v_order_id;
  end if;

  v_order_id := public.place_order(p_session_token, p_items, p_note);
  update public.orders
  set idempotency_key = v_key
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.place_order_idempotent(text, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.place_order_idempotent(text, jsonb, text, uuid)
  to service_role;
