-- One pricing contract for checkout quotes, ticket creation and tax documents.
-- Nothing is backfilled: NULL line classifications identify pre-upgrade data.

alter table public.order_items add column is_alcoholic_snapshot boolean;

create or replace function public.gst_pricing(p_restaurant_id uuid)
returns table(mode text, rate_bps integer, config_version integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_config public.restaurant_gst_config%rowtype;
  v_rate integer;
begin
  select c.* into v_config from public.restaurant_gst_config c where c.restaurant_id = p_restaurant_id;
  if not found or v_config.mode = 'off' then
    return query select 'off'::text, null::integer, coalesce(v_config.config_version, 0);
    return;
  end if;
  v_rate := case when v_config.mode = 'composition' then 0 else public.gst_profile_rate(v_config.regular_profile) end;
  if not public.gst_valid_gstin(v_config.gstin)
     or v_config.state_code is distinct from substr(v_config.gstin, 1, 2)
     or (v_config.pan is not null and v_config.pan <> substr(v_config.gstin, 3, 10))
     or v_config.registration_type is distinct from v_config.mode
     or coalesce(char_length(btrim(v_config.legal_name)), 0) < 2
     or coalesce(char_length(btrim(v_config.address)), 0) < 5
     or v_rate is null
     or (v_config.mode = 'composition' and (not v_config.composition_acknowledged or exists (
       select 1 from public.items i where i.restaurant_id = p_restaurant_id and i.is_alcoholic
     )))
     or (v_rate = 1800 and (not v_config.specified_premises_attested
       or v_config.specified_premises_effective_from is null
       or v_config.specified_premises_effective_from not between date '2025-04-01'
         and (statement_timestamp() at time zone 'Asia/Kolkata')::date)) then
    raise exception 'This outlet needs to review its GST settings before pricing new orders. Please ask staff.' using errcode = 'P0001';
  end if;
  return query select v_config.mode, v_rate, v_config.config_version;
end;
$$;

revoke all on function public.gst_pricing(uuid) from public, anon, authenticated, service_role;

-- A deliberately narrow storefront quote, not a public tenant config read.
create or replace function public.public_order_pricing(p_slug text)
returns table(tax_treatment text, tax_rate_bps integer)
language sql
stable
security definer
set search_path = public, pg_temp
rows 1
as $$
  select case p.mode when 'regular' then 'inclusive' when 'composition' then 'none' else 'exclusive' end,
         coalesce(p.rate_bps, r.tax_rate_bps)
    from (select id, tax_rate_bps from public.restaurants where slug = nullif(btrim(p_slug), '') and is_active limit 1) r
    cross join lateral public.gst_pricing(r.id) p;
$$;

revoke all on function public.public_order_pricing(text) from public, anon, authenticated, service_role;
grant execute on function public.public_order_pricing(text) to anon, authenticated;

create or replace function public.gst_inclusive_taxable(p_total_paise bigint, p_rate_bps integer)
returns bigint
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select round(p_total_paise::numeric * 10000 / (10000 + p_rate_bps))::bigint;
$$;

create or replace function public.guard_order_gst_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pricing record;
  v_tax_rate integer;
  v_mode text := coalesce(new.gst_mode_snapshot, 'off');
begin
  if tg_op = 'INSERT' and new.gst_mode_snapshot is not null then
    -- Shared across writers: independent tickets still submit concurrently.
    -- Held until the *outer* order RPC has written lines and attached its
    -- sitting. A setting saved between quote/pricing and insertion trips the
    -- version check instead of charging the wrong amount.
    perform pg_advisory_xact_lock_shared(hashtextextended('gst-outlet:' || new.restaurant_id::text, 0));
    select * into v_pricing from public.gst_pricing(new.restaurant_id);
    select coalesce(v_pricing.rate_bps, r.tax_rate_bps) into v_tax_rate
      from public.restaurants r where r.id = new.restaurant_id;
    if (v_pricing.mode, v_pricing.config_version, v_tax_rate)
       is distinct from (new.gst_mode_snapshot, new.gst_config_version, new.tax_rate_bps_snapshot) then
      raise exception 'Billing settings changed while this order was being priced. Refresh and try again.' using errcode = 'P0001';
    end if;
    if new.discount_paise <> 0 then
      raise exception 'Discounts are disabled.' using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' then
    if (new.gst_mode_snapshot, new.gst_config_version, new.discount_paise)
       is distinct from (old.gst_mode_snapshot, old.gst_config_version, old.discount_paise)
       or (old.tax_rate_bps_snapshot is not null and new.tax_rate_bps_snapshot is distinct from old.tax_rate_bps_snapshot)
       or (v_mode <> 'off' and new.restaurant_id is distinct from old.restaurant_id) then
      raise exception 'Ticket GST pricing and discounts cannot be changed in place.' using errcode = '23514';
    end if;
  end if;

  if v_mode = 'composition' and (new.tax_paise <> 0 or new.tax_rate_bps_snapshot is distinct from 0) then
    raise exception 'Composition tickets cannot collect GST.' using errcode = '23514';
  elsif v_mode = 'regular' and (
    new.tax_rate_bps_snapshot is null or new.tax_rate_bps_snapshot not in (500, 1800)
    or new.tax_paise <> new.total_paise - public.gst_inclusive_taxable(new.total_paise, new.tax_rate_bps_snapshot)
  ) then
    raise exception 'Regular GST ticket amounts do not match the saved inclusive rate.' using errcode = '23514';
  end if;

  -- The placement RPC already locks the sitting before attachment. Refuse a
  -- mixed sitting at attachment, not after the customer has paid. Off/legacy
  -- receipts preserve their mix of existing ticket rates.
  if new.order_session_id is not null and (tg_op = 'INSERT' or new.order_session_id is distinct from old.order_session_id)
    and new.prep_status <> 'cancelled' and exists (
      select 1 from public.orders o
       where o.order_session_id = new.order_session_id and o.restaurant_id = new.restaurant_id
         and o.id <> new.id and o.prep_status <> 'cancelled'
         and (coalesce(o.gst_mode_snapshot, 'off') <> v_mode
           or (v_mode <> 'off' and (o.gst_config_version, o.tax_rate_bps_snapshot)
               is distinct from (new.gst_config_version, new.tax_rate_bps_snapshot)))
    ) then
    raise exception 'This sitting already has tickets under a different GST configuration. Ask staff to finish it before adding more tickets.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger orders_guard_gst_snapshot
  before insert or update of gst_mode_snapshot, gst_config_version, tax_rate_bps_snapshot, discount_paise,
    subtotal_paise, tax_paise, total_paise, restaurant_id, order_session_id on public.orders
  for each row execute function public.guard_order_gst_snapshot();

create or replace function public.snapshot_order_item_gst_classification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  if tg_op = 'UPDATE' then
    if new.is_alcoholic_snapshot is distinct from old.is_alcoholic_snapshot or new.item_id is distinct from old.item_id then
      -- A deleted item can null its FK; its classification stays immutable.
      if new.is_alcoholic_snapshot is distinct from old.is_alcoholic_snapshot or new.item_id is not null then
        raise exception 'Ticket item classification cannot be changed in place.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  select o.gst_mode_snapshot, i.is_alcoholic into v_mode, new.is_alcoholic_snapshot
    from public.orders o
    left join public.items i on i.id = new.item_id and i.restaurant_id = o.restaurant_id
    where o.id = new.order_id;
  if v_mode in ('regular', 'composition') and new.is_alcoholic_snapshot is distinct from false then
    raise exception 'Alcoholic or unclassified items cannot be ordered under this outlet''s GST mode. Remove the item or ask staff.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger order_items_snapshot_gst_classification
  before insert or update of is_alcoholic_snapshot, item_id on public.order_items
  for each row execute function public.snapshot_order_item_gst_classification();

revoke all on function public.gst_inclusive_taxable(bigint, integer), public.guard_order_gst_snapshot(),
  public.snapshot_order_item_gst_classification() from public, anon, authenticated, service_role;

-- Append only, preserving the role-scoped security barrier and ACL.
create or replace view public.orders_finance
with (security_barrier = true)
as
select
  o.id,
  o.restaurant_id,
  o.table_id,
  o.code,
  o.customer_note,
  o.prep_status,
  o.payment_status,
  o.subtotal_paise,
  o.discount_paise,
  o.tax_paise,
  o.total_paise,
  o.placed_at,
  o.updated_at,
  o.tax_rate_bps_snapshot,
  o.hold_required,
  o.confirmed_at,
  o.table_session_id,
  o.order_session_id,
  o.kitchen_announcement_status,
  o.kitchen_announcement_at,
  o.kitchen_announcement_error,
  o.gst_mode_snapshot
from public.orders o
where public.has_restaurant_role(
  o.restaurant_id,
  array['owner', 'manager', 'cashier']
);
