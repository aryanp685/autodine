-- ============================================================================
-- Compatible Operating Paths: Mode A (Alongside Existing POS) & Mode B (Primary OS)
-- + Defined KOT Handoff & POS Webhook Integration
-- ============================================================================
-- 1. public.restaurants:
--    - operating_mode ('mode_a' | 'mode_b', default 'mode_b' for full OS)
--    - pos_integration_name (e.g. 'Petpooja', 'Posist', 'Tally', optional)
-- 2. public.restaurant_pos_integrations:
--    - Owner/Manager-only table storing optional HTTPS KOT handoff webhook URL
--      and signing secret so cashiers/kitchen/anon never see webhook credentials.
-- 3. public.orders:
--    - kot_handoff_status ('pending' | 'entered_in_pos' | 'webhook_sent' | 'webhook_failed')
--    - kot_handoff_at, kot_handoff_by, kot_handoff_ref
-- 4. RPCs:
--    - save_restaurant_operating_mode(...) (owner / manager only)
--    - record_order_kot_handoff(...) (owner / manager / cashier / waiter / kitchen)

alter table public.restaurants
  add column if not exists operating_mode text not null default 'mode_b'
    check (operating_mode in ('mode_a', 'mode_b')),
  add column if not exists pos_integration_name text
    check (pos_integration_name is null or char_length(btrim(pos_integration_name)) between 1 and 60);

grant select (operating_mode, pos_integration_name) on table public.restaurants to authenticated;

create table if not exists public.restaurant_pos_integrations (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  webhook_url text check (webhook_url is null or webhook_url ~ '^https://[^[:space:]]+$'),
  webhook_secret text,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid
);

alter table public.restaurant_pos_integrations enable row level security;
revoke all on public.restaurant_pos_integrations from anon, authenticated, service_role;

drop policy if exists restaurant_pos_integrations_manage_read on public.restaurant_pos_integrations;
create policy restaurant_pos_integrations_manage_read on public.restaurant_pos_integrations
  for select to authenticated
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager']));

grant select on table public.restaurant_pos_integrations to authenticated;

alter table public.orders
  add column if not exists kot_handoff_status text not null default 'pending'
    check (kot_handoff_status in ('pending', 'entered_in_pos', 'webhook_sent', 'webhook_failed')),
  add column if not exists kot_handoff_at timestamptz,
  add column if not exists kot_handoff_by uuid,
  add column if not exists kot_handoff_ref text
    check (kot_handoff_ref is null or char_length(btrim(kot_handoff_ref)) <= 60);

grant select (kot_handoff_status, kot_handoff_at, kot_handoff_by, kot_handoff_ref)
  on table public.orders to authenticated;

create or replace function public.save_restaurant_operating_mode(
  p_restaurant_id uuid,
  p_operating_mode text,
  p_pos_integration_name text default null,
  p_webhook_url text default null,
  p_webhook_secret text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_mode text := lower(btrim(coalesce(p_operating_mode, '')));
  v_pos_name text := nullif(btrim(coalesce(p_pos_integration_name, '')), '');
  v_webhook text := nullif(btrim(coalesce(p_webhook_url, '')), '');
  v_secret text := nullif(btrim(coalesce(p_webhook_secret, '')), '');
begin
  if v_actor is null then
    raise exception 'Sign in with an owner or manager account to change the operating mode.' using errcode = '42501';
  end if;
  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can change the restaurant operating mode.' using errcode = '42501';
  end if;
  if v_mode not in ('mode_a', 'mode_b') then
    raise exception 'Operating mode must be mode_a or mode_b.' using errcode = '22023';
  end if;
  if v_pos_name is not null and char_length(v_pos_name) > 60 then
    raise exception 'Existing POS name must be 60 characters or fewer.' using errcode = '22023';
  end if;
  if v_webhook is not null and v_webhook !~ '^https://[^[:space:]]+$' then
    raise exception 'KOT handoff webhook URL must start with https://.' using errcode = '22023';
  end if;
  if v_secret is not null and char_length(v_secret) > 120 then
    raise exception 'Webhook signing secret must be 120 characters or fewer.' using errcode = '22023';
  end if;

  update public.restaurants
     set operating_mode = v_mode,
         pos_integration_name = v_pos_name,
         updated_at = statement_timestamp()
   where id = p_restaurant_id;

  insert into public.restaurant_pos_integrations (
    restaurant_id, webhook_url, webhook_secret, updated_at, updated_by
  ) values (
    p_restaurant_id,
    v_webhook,
    coalesce(v_secret, (select webhook_secret from public.restaurant_pos_integrations where restaurant_id = p_restaurant_id)),
    statement_timestamp(),
    v_actor
  )
  on conflict (restaurant_id) do update
    set webhook_url = excluded.webhook_url,
        webhook_secret = case
          when v_webhook is null then null
          when v_secret is not null then v_secret
          else public.restaurant_pos_integrations.webhook_secret
        end,
        updated_at = statement_timestamp(),
        updated_by = v_actor;

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'operating_mode', v_mode,
    'pos_integration_name', v_pos_name,
    'webhook_configured', (v_webhook is not null)
  );
end;
$$;

revoke all on function public.save_restaurant_operating_mode(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_restaurant_operating_mode(uuid, text, text, text, text) to authenticated;

create or replace function public.record_order_kot_handoff(
  p_order_id uuid,
  p_status text,
  p_pos_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_ref text := nullif(left(btrim(coalesce(p_pos_ref, '')), 60), '');
begin
  if v_actor is null then
    raise exception 'Sign in to update KOT handoff status.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if not public.has_restaurant_role(v_order.restaurant_id, array['owner', 'manager', 'cashier', 'waiter', 'kitchen']) then
    raise exception 'You do not have permission to record KOT handoff for this restaurant.' using errcode = '42501';
  end if;

  if v_status not in ('pending', 'entered_in_pos', 'webhook_sent', 'webhook_failed') then
    raise exception 'Invalid KOT handoff status %.', v_status using errcode = '22023';
  end if;

  update public.orders
     set kot_handoff_status = v_status,
         kot_handoff_at = case when v_status = 'pending' then null else statement_timestamp() end,
         kot_handoff_by = case when v_status = 'pending' then null else v_actor end,
         kot_handoff_ref = case when v_status = 'pending' then null else coalesce(v_ref, kot_handoff_ref) end,
         updated_at = statement_timestamp()
   where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'kot_handoff_status', v_status,
    'kot_handoff_ref', v_ref
  );
end;
$$;

revoke all on function public.record_order_kot_handoff(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_order_kot_handoff(uuid, text, text) to authenticated;
