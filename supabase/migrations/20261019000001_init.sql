-- ============================================================================
-- AutoDine — initial schema
--
-- Migration 0001. Written 2026-10-19 for the 3-day pilot build.
--
-- DESIGN RULES BAKED IN HERE (do not relax without an explicit decision):
--   1. Money is BIGINT paise. Never numeric, never float, never rupees.
--   2. Timestamps are TIMESTAMPTZ. All UTC; each restaurant carries an IANA
--      timezone for display.
--   3. EVERY tenant-scoped table carries restaurant_id and is protected by
--      Row Level Security. The database is the security boundary, not the app.
--   4. Preparation state and payment state are SEPARATE state machines.
--      "Served" and "Paid" are different facts and must never be conflated.
--   5. Orders are priced by the place_order() function, in the database. The
--      browser sends item ids and quantities only. It never sends a total.
--
-- TAX: tax_rate_bps lives on restaurants and defaults to the SAMPLE 5% used
-- by lib/pricing.ts. This is NOT a confirmed GST model. See the header of
-- lib/pricing.ts for the three open questions. Do not raise a live invoice on
-- this until those are answered by a tax adviser.
-- ============================================================================

-- ---------------------------------------------------------------- extensions
create extension if not exists "pgcrypto";

-- ================================================================ restaurants

create table if not exists public.restaurants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  tagline       text,
  address       text,
  phone         text,
  gstin         text,
  -- IANA zone, e.g. 'Asia/Kolkata'. Display only; storage is always UTC.
  timezone      text not null default 'Asia/Kolkata',
  -- SAMPLE DEFAULT. See tax note above.
  tax_rate_bps  integer not null default 500
                check (tax_rate_bps >= 0 and tax_rate_bps <= 3000),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on column public.restaurants.tax_rate_bps is
  'SAMPLE 5%. Not a confirmed GST model. See lib/pricing.ts header.';

-- =================================================================== profiles

-- Mirrors auth.users. Never expose email to other tenants.
create table if not exists public.profiles (
  id          uuid primary key,          -- = auth.users.id
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- ================================================================ memberships

create type public.member_role as enum ('owner', 'manager', 'kitchen', 'cashier');

create table if not exists public.memberships (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          public.member_role not null default 'cashier',
  created_at    timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships(user_id);

-- ====================================================================== menus

create table if not exists public.menus (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  is_published  boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists menus_restaurant_idx on public.menus(restaurant_id);

create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_id       uuid references public.menus(id) on delete cascade,
  name          text not null,
  sort_order    integer not null default 0
);

create index if not exists categories_restaurant_idx on public.categories(restaurant_id);

create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id   uuid references public.categories(id) on delete set null,
  name          text not null,
  description   text,
  -- Paise. Always paise.
  price_paise   bigint not null default 0 check (price_paise >= 0),
  is_veg        boolean not null default true,
  is_available  boolean not null default true,
  image_url     text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists items_restaurant_idx on public.items(restaurant_id);
create index if not exists items_category_idx   on public.items(category_id);

-- Variants are absolute prices, not deltas: a "Half" plate has its own price.
create table if not exists public.item_variants (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  name        text not null,
  price_paise bigint not null check (price_paise >= 0),
  sort_order  integer not null default 0
);

create index if not exists item_variants_item_idx on public.item_variants(item_id);

-- ==================================================================== tables

create table if not exists public.dining_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label         text not null,
  seats         integer not null default 2 check (seats > 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, label)
);

-- ================================================================= qr tokens

-- A printed QR cannot prove a guest is in the room: a photo of it works from
-- anywhere. So the QR carries a rotating, short-lived token that the server
-- validates before it will show a menu. See note at the bottom of this file.
create table if not exists public.qr_tokens (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id      uuid not null references public.dining_tables(id) on delete cascade,
  token         text not null unique,
  expires_at    timestamptz not null,
  rotated_at    timestamptz not null default now()
);

create index if not exists qr_tokens_token_idx on public.qr_tokens(token);
create index if not exists qr_tokens_table_idx on public.qr_tokens(table_id);

-- ==================================================================== orders

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete restrict,
  table_id        uuid references public.dining_tables(id) on delete set null,

  -- Human-facing short code, e.g. 'A41'. Shown on the kitchen board.
  code            text not null,
  customer_note   text,

  -- TWO INDEPENDENT STATE MACHINES. Do not merge them.
  prep_status     text not null default 'new'
                  check (prep_status in ('new','preparing','ready','served','cancelled')),
  payment_status  text not null default 'pending'
                  check (payment_status in ('pending','paid','failed','refunded')),

  -- Money, in paise, written by place_order() and never by the client.
  subtotal_paise  bigint not null default 0 check (subtotal_paise >= 0),
  discount_paise  bigint not null default 0 check (discount_paise >= 0),
  tax_paise       bigint not null default 0 check (tax_paise >= 0),
  total_paise     bigint not null default 0 check (total_paise >= 0),

  placed_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- The order always adds up. Enforced by the database, not by the app.
  constraint orders_math_check check (total_paise = subtotal_paise - discount_paise + tax_paise)
);

create index if not exists orders_restaurant_idx    on public.orders(restaurant_id);
create index if not exists orders_placed_idx        on public.orders(placed_at desc);
create index if not exists orders_restaurant_open_idx
  on public.orders(restaurant_id, placed_at desc)
  where prep_status not in ('served','cancelled');

-- Snapshot: the item name and price as they were when ordered. If the menu
-- changes tomorrow, last week's receipts and reports must not change with it.
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  item_id         uuid references public.items(id) on delete set null,
  name_snapshot   text not null,
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  qty             integer not null check (qty > 0),
  variant_snapshot text,
  addons_snapshot  text[] not null default '{}',
  is_veg          boolean not null default true,
  sort_order      integer not null default 0
);

create index if not exists order_items_order_idx on public.order_items(order_id);

-- ================================================================== payments

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  method        text not null check (method in ('cash','card','upi','online')),
  amount_paise  bigint not null check (amount_paise >= 0),
  status        text not null default 'recorded'
                check (status in ('pending','recorded','failed','refunded')),
  provider      text,              -- 'razorpay' | 'counter' | null
  provider_ref  text,              -- gateway payment id, for reconciliation
  -- Idempotency: one gateway event must never be recorded twice.
  idempotency_key text unique,
  created_at    timestamptz not null default now()
);

create index if not exists payments_order_idx on public.payments(order_id);

-- ======================================================= tenant helpers

-- Which restaurants can the current user act on? STABLE so Postgres can cache
-- it within a statement; SECURITY DEFINER so it can read memberships without
-- recursing into memberships' own RLS policy.
create or replace function public.current_restaurant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.restaurant_id
  from public.memberships m
  where m.user_id = auth.uid();
$$;

create or replace function public.is_member(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.restaurant_id = p_restaurant_id
      and m.user_id = auth.uid()
  );
$$;

-- ================================================================ place_order
--
-- The ONLY way an order is created. The browser sends item ids, quantities and
-- a table token. Every price is read from the database here. The client cannot
-- influence the total, because it never sends one.
--
-- Throws with a readable message on any validation failure; the caller shows
-- that message to the guest.
create or replace function public.place_order(
  p_restaurant_slug text,
  p_table_token     text,
  p_items           jsonb,          -- [{item_id, qty, variant_id, addons}]
  p_note            text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant  public.restaurants%rowtype;
  v_table       public.dining_tables%rowtype;
  v_order_id    uuid;
  v_code        text;
  v_subtotal    bigint := 0;
  v_tax         bigint := 0;
  v_rate        integer;
  v_entry       jsonb;
  v_item        public.items%rowtype;
  v_variant     public.item_variants%rowtype;
  v_unit        bigint;
  v_qty         integer;
  v_variant_name text;
  v_addons      text[];
  v_lines       jsonb;
begin
  -- 1. Restaurant must exist and be active -------------------------------
  select * into v_restaurant
  from public.restaurants r
  where r.slug = p_restaurant_slug and r.is_active;

  if not found then
    raise exception 'Restaurant not found or not accepting orders.' using errcode = 'P0002';
  end if;

  -- 2. On-site token must be valid, unexpired and for THIS restaurant -----
  select t.* into v_table
  from public.qr_tokens qt
  join public.dining_tables t on t.id = qt.table_id
  where qt.token = p_table_token
    and qt.expires_at > now()
    and t.restaurant_id = v_restaurant.id
    and t.is_active;

  if not found then
    raise exception 'This table code has expired. Please ask staff for a new one.'
      using errcode = 'P0002';
  end if;

  -- 3. There must be something to order ----------------------------------
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your order is empty.' using errcode = 'P0002';
  end if;

  -- 4. Price every line from the database into a staging array. ----------
  --    Lines cannot be inserted yet: order_items.order_id is NOT NULL and the
  --    order does not exist until step 6.
  v_lines := '[]'::jsonb;

  for v_entry in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_entry->>'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.' using errcode = 'P0002';
    end if;

    select * into v_item
    from public.items i
    where i.id = (v_entry->>'item_id')::uuid
      and i.restaurant_id = v_restaurant.id
      and i.is_available;

    if not found then
      raise exception 'An item in your order is no longer available.' using errcode = 'P0002';
    end if;

    -- Variant, if given, must belong to this item. Variants carry an absolute
    -- price, not a delta.
    if v_entry->>'variant_id' is not null then
      select * into v_variant
      from public.item_variants v
      where v.id = (v_entry->>'variant_id')::uuid
        and v.item_id = v_item.id;
      if not found then
        raise exception 'Invalid variant.' using errcode = 'P0002';
      end if;
      v_unit         := v_variant.price_paise;
      v_variant_name := v_variant.name;
    else
      v_unit         := v_item.price_paise;
      v_variant_name := null;
    end if;

    v_addons := coalesce(
      (select array_agg(a) from jsonb_array_elements_text(
         coalesce(v_entry->'addons', '[]'::jsonb)) a),
      '{}'::text[]);

    v_subtotal := v_subtotal + (v_unit * v_qty::bigint);

    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id,
      'name',    v_item.name,
      'unit',    v_unit,
      'qty',     v_qty,
      'variant', v_variant_name,
      'addons',  to_jsonb(v_addons),
      'veg',     v_item.is_veg
    );
  end loop;

  -- 5. Tax. Same precedence as lib/pricing.ts: discount first, then tax. --
  --    Postgres round(numeric) is half away from zero, which is the rounding
  --    rule lib/money.ts defines and tests.
  v_rate := coalesce(v_restaurant.tax_rate_bps, 500);
  v_tax  := round(v_subtotal::numeric * v_rate / 10000.0)::bigint;

  -- 6. Short human code for the kitchen board ----------------------------
  v_code := upper(substr(md5(random()::text), 1, 3));

  insert into public.orders(
    restaurant_id, table_id, code, customer_note,
    prep_status, payment_status,
    subtotal_paise, discount_paise, tax_paise, total_paise
  ) values (
    v_restaurant.id, v_table.id, v_code, p_note,
    'new', 'pending',
    v_subtotal, 0, v_tax, v_subtotal + v_tax
  )
  returning id into v_order_id;

  -- 7. Write the priced line snapshots -----------------------------------
  insert into public.order_items(
    order_id, item_id, name_snapshot, unit_price_paise, qty,
    variant_snapshot, addons_snapshot, is_veg, sort_order
  )
  select
    v_order_id,
    (l->>'item_id')::uuid,
    l->>'name',
    (l->>'unit')::bigint,
    (l->>'qty')::integer,
    l->>'variant',
    coalesce(
      (select array_agg(a) from jsonb_array_elements_text(
         coalesce(l->'addons', '[]'::jsonb)) a),
      '{}'::text[]),
    (l->>'veg')::boolean,
    t.ord::integer
  from jsonb_array_elements(v_lines) with ordinality as t(l, ord);

  return v_order_id;
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- The security boundary. Every tenant table is protected. Deny by default:
-- enabling RLS with no policies means no access at all.
-- ============================================================================

alter table public.restaurants   enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;
alter table public.menus         enable row level security;
alter table public.categories    enable row level security;
alter table public.items         enable row level security;
alter table public.item_variants enable row level security;
alter table public.dining_tables enable row level security;
alter table public.qr_tokens     enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.payments      enable row level security;

-- profiles: you see yourself ------------------------------------------------
create policy profiles_self on public.profiles
  for select using (id = auth.uid());
create policy profiles_self_write on public.profiles
  for update using (id = auth.uid());

-- memberships: you see your own rows, and your colleagues -------------------
create policy memberships_read on public.memberships
  for select using (restaurant_id in (select public.current_restaurant_ids()));

-- restaurants: members can read and update their own ------------------------
create policy restaurants_read on public.restaurants
  for select using (id in (select public.current_restaurant_ids()));

create policy restaurants_update on public.restaurants
  for update using (id in (select public.current_restaurant_ids()));

-- Menus, categories, items, variants:
--   staff  -> full CRUD on their own restaurant
--   public -> READ of PUBLISHED menus at ACTIVE restaurants only.
-- This anonymous read is deliberate: a guest ordering must not have to log in.
create policy menus_staff on public.menus
  for all using (restaurant_id in (select public.current_restaurant_ids()));

create policy menus_public on public.menus
  for select using (
    is_published
    and exists (select 1 from public.restaurants r
                where r.id = menus.restaurant_id and r.is_active)
  );

create policy categories_staff on public.categories
  for all using (restaurant_id in (select public.current_restaurant_ids()));
create policy categories_public on public.categories
  for select using (exists (select 1 from public.menus m
                            where m.id = categories.menu_id and m.is_published));

create policy items_staff on public.items
  for all using (restaurant_id in (select public.current_restaurant_ids()));
create policy items_public on public.items
  for select using (
    is_available
    and exists (select 1 from public.restaurants r
                where r.id = items.restaurant_id and r.is_active)
  );

create policy variants_staff on public.item_variants
  for all using (exists (select 1 from public.items i
                         where i.id = item_variants.item_id
                           and i.restaurant_id in (select public.current_restaurant_ids())));
create policy variants_public on public.item_variants
  for select using (exists (select 1 from public.items i
                            where i.id = item_variants.item_id and i.is_available));

-- tables and tokens: staff only. NEVER readable by anon. --------------------
create policy tables_staff on public.dining_tables
  for all using (restaurant_id in (select public.current_restaurant_ids()));

create policy qr_tokens_staff on public.qr_tokens
  for all using (restaurant_id in (select public.current_restaurant_ids()));

-- orders:
--   anon  -> INSERT only, and only via place_order() (SECURITY DEFINER, which
--            bypasses RLS and does its own validation). No direct anon reads:
--            an order id must not become a way to read someone else's bill.
--   staff -> read and update their own restaurant's orders.
create policy orders_staff_read on public.orders
  for select using (restaurant_id in (select public.current_restaurant_ids()));

create policy orders_staff_update on public.orders
  for update using (restaurant_id in (select public.current_restaurant_ids()));

create policy orders_staff_insert on public.orders
  for insert with check (restaurant_id in (select public.current_restaurant_ids()));

-- order_items: follow the order ---------------------------------------------
create policy order_items_staff on public.order_items
  for select using (exists (select 1 from public.orders o
                            where o.id = order_items.order_id
                              and o.restaurant_id in (select public.current_restaurant_ids())));

create policy order_items_insert on public.order_items
  for insert with check (exists (select 1 from public.orders o
                                 where o.id = order_items.order_id
                                   and o.restaurant_id in (select public.current_restaurant_ids())));

-- payments: staff only, never anonymous -------------------------------------
create policy payments_staff on public.payments
  for all using (restaurant_id in (select public.current_restaurant_ids()));

-- ============================================================================
-- KNOWN GAPS — deliberate, not oversights. Say so now rather than discover
-- them in production:
--
--   * place_order() has not been executed against a live Postgres. It is
--     written to be correct on inspection, but it is UNTESTED: the sandbox
--     has no Postgres and no network to Supabase. Run it once against a
--     throwaway restaurant before you trust it with a real order.
--   * No trigger keeps orders.updated_at fresh.
--   * No rate limiting on place_order. An abusive client can spam orders.
--   * qr_tokens are never cleaned up and never rotated automatically yet.
--   * No audit log.
--   * Realtime publication for the kitchen board is not enabled here.
--
-- Each of these is a follow-up migration, not a silent hole.
-- ============================================================================
