-- STAGING ONLY: observed empty autodinetest, never production.
-- All changes are one transaction supplied by the migration connector.
select pg_advisory_xact_lock(3711,55001);
do $preflight$ begin
 if exists(select 1 from public.restaurants) or exists(select 1 from public.orders) then
 raise exception 'Staging baseline changed: refusing upgrade of populated tenant data'; end if;
 if to_regprocedure('public.place_public_order(text,jsonb,text,text)') is null then
 raise exception 'Observed staging baseline does not match'; end if;
end $preflight$;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.arena_staging_upgrade_manifest (filename text primary key, sha256 text not null, applied_at timestamptz not null default now());
do $manifest_guard$ begin if exists(select 1 from supabase_migrations.arena_staging_upgrade_manifest) then raise exception 'Upgrade already recorded: review before retrying'; end if; end $manifest_guard$;

-- SOURCE 20261021000004_missing_qr_tables.sql SHA256 78833752386271247b0e10e6aa5ffa320b682c199b3347352509568dc2379ce7
-- ============================================================================
-- AutoDine — migration 20261021000004: the two QR tables the ledger never had
--
-- WHY THIS EXISTS
--
-- `table_qr_codes` and `table_verification_sessions` are read and written by
-- migrations 0006, 0007, 20261023000900 and 20261028000900, but no migration
-- in this repository creates them. They exist in the live database (created
-- through the Supabase console) and in `scripts/local-pg/005_scaffold_missing_tables.sql`
-- (marked LOCAL HARNESS ONLY), so a fresh project built by replaying
-- `supabase/migrations` fails before it reaches the verification path.
--
-- This migration creates them with `if not exists`, so it is a no-op on a
-- database that already has them and a fix for one that does not. The column
-- definitions follow the local scaffold and the code that reads them; they
-- should be compared with `pg_dump --schema-only` on the live project before
-- this is applied to a new production project.
--
-- `qr_verification_attempts` and `table_session_opens` are created by
-- 20261108000200_drift_reconcile.sql; they are not repeated here.
-- ============================================================================

create table if not exists public.table_qr_codes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.dining_tables(id) on delete cascade,
  public_token text not null unique,
  source_qr_token_id uuid references public.qr_tokens(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists table_qr_codes_table_idx
  on public.table_qr_codes (table_id)
  where revoked_at is null;

create index if not exists table_qr_codes_restaurant_idx
  on public.table_qr_codes (restaurant_id)
  where revoked_at is null;

comment on table public.table_qr_codes is
  'The printed card for one table. public_token is what the QR encodes; a live card is one with revoked_at null.';

create table if not exists public.table_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.dining_tables(id) on delete cascade,
  qr_code_id uuid references public.table_qr_codes(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists table_verification_sessions_restaurant_idx
  on public.table_verification_sessions (restaurant_id, expires_at desc);

create index if not exists table_verification_sessions_qr_idx
  on public.table_verification_sessions (qr_code_id);

comment on table public.table_verification_sessions is
  'A short-lived table session. The raw token is never stored; only its SHA-256 hash.';

-- Session tokens remain private. Staff may read their own restaurant cards;
-- provisioning and revocation still go through SECURITY DEFINER functions.
alter table public.table_qr_codes enable row level security;
alter table public.table_verification_sessions enable row level security;

revoke all on public.table_qr_codes from anon;
revoke all on public.table_qr_codes from authenticated;
revoke all on public.table_verification_sessions from anon;
revoke all on public.table_verification_sessions from authenticated;

-- The tables screen reads card metadata directly under the authenticated role.
grant select on public.table_qr_codes to authenticated;
drop policy if exists table_qr_codes_staff_select on public.table_qr_codes;
create policy table_qr_codes_staff_select on public.table_qr_codes
  for select to authenticated using (public.is_member(restaurant_id));

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000004_missing_qr_tables.sql','78833752386271247b0e10e6aa5ffa320b682c199b3347352509568dc2379ce7');

-- SOURCE 20261021000008_charge_for_portions.sql SHA256 46a56e371c3627818089fd45a085b9640a9615ebae67a9f509b28c78196467d6
-- ============================================================================
-- AutoDine — migration 0008: a chosen portion is the price that gets charged
--
-- WHY THIS EXISTS
--
-- The dish sheet offered "Half Rs 250" and "Full Rs 469", let the guest pick
-- one, and charged the menu price either way. Underneath it a sentence said
-- so: "Portions and add-ons you pick here are not charged yet."
--
-- Read that from the guest's side. They are shown two prices, they choose
-- the cheaper one, they are charged the dearer one, and the screen tells
-- them that is what will happen. Nothing is hidden, so nothing here is fraud
-- -- but it is a till dispute on every dish with portions, and the person
-- who has to settle it is the person already run off their feet.
--
-- And from the kitchen's side it is worse than a pricing bug. A half and a
-- full plate are different amounts of food. If the bill does not carry the
-- choice, the ticket does not either, so the pass says "Butter Chicken" and
-- the cook has to ask. The portion picker exists so nobody has to ask.
--
-- WHAT THIS DOES
--
-- place_public_order learns to read a variant_id on a cart line. It looks
-- the portion up on that same dish -- not on any dish -- and uses its price.
-- If the id does not resolve, the line is still written, priced at the dish's
-- menu price, with no portion recorded. That is the same choice the cart
-- makes in lib/cart-pricing.ts: a portion deleted out from under an open
-- cart should not empty the cart.
--
-- The price is read here, in SQL, from item_variants. It is never taken from
-- the caller. A price that arrives from a browser is a price the browser
-- chose, and this function's entire reason for existing is that the caller
-- has no say in what anything costs.
--
-- The portion's NAME is snapshotted onto order_items, not looked up later. A
-- ticket printed tonight must still say "Half" after someone edits the menu
-- tomorrow.
-- ============================================================================

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_default_tax_bps constant int := 500;
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  v_session public.table_verification_sessions%rowtype;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_table_id uuid;
  v_menu_id uuid;
  v_tax_bps int;
  v_note text;
  v_line_count int;
  v_subtotal_paise bigint := 0;
  v_discount_paise bigint := 0;
  v_taxable_paise bigint := 0;
  v_tax_paise bigint := 0;
  v_total_paise bigint := 0;
  v_code text;
  v_prefix text;
  v_order_id uuid;
  v_written int := 0;
begin
  -- ---------------------------------------------------------------- session
  if p_session_token is not null then
    if p_session_token !~ '^[A-Fa-f0-9]{64}$' then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select s.* into v_session
      from public.table_verification_sessions s
     where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
       and s.expires_at > statement_timestamp()
       and s.revoked_at is null;

    if not found then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.table_qr_codes q
       where q.id = v_session.qr_code_id
         and q.revoked_at is null
         and q.table_id = v_session.table_id
         and q.restaurant_id = v_session.restaurant_id
    ) then
      raise exception 'Your table verification is no longer valid. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.id = v_session.restaurant_id
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
    end if;

    select t.id into v_table_id
      from public.dining_tables t
     where t.id = v_session.table_id
       and t.restaurant_id = v_restaurant_id
       and t.is_active = true;

    if v_table_id is null then
      raise exception 'This table is not taking orders right now. Please ask staff.'
        using errcode = 'P0001';
    end if;

    if p_slug is not null and btrim(p_slug) <> '' then
      if not exists (
        select 1 from public.restaurants r
         where r.id = v_restaurant_id and r.slug = btrim(p_slug)
      ) then
        raise exception 'This order is for a different restaurant. Please open the menu again.'
          using errcode = 'P0001';
      end if;
    end if;
  else
    if p_slug is null or btrim(p_slug) = '' then
      raise exception 'No restaurant was given.' using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.slug = btrim(p_slug)
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders.' using errcode = 'P0001';
    end if;

    v_table_id := null;
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  select m.id
    into v_menu_id
    from public.menus m
   where m.restaurant_id = v_restaurant_id
     and m.is_published = true
   order by m.is_published desc, m.created_at desc nulls last
   limit 1;

  if v_menu_id is null then
    raise exception 'That restaurant has no published menu.' using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------- input
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count = 0 then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  if v_line_count > k_max_lines then
    raise exception 'That is more than % dishes in one order.', k_max_lines
      using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > k_max_note then
    v_note := left(v_note, k_max_note);
  end if;

  -- ----------------------------------------------------------------- pricing
  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean not null,
    sort_order int not null,
    variant_id uuid,
    variant_snapshot text
  ) on commit drop;

  insert into tt_order_lines (
    item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_id, variant_snapshot
  )
  select
    i.id,
    i.name,
    -- The portion's price when one was chosen and it resolves; otherwise the
    -- dish's own. coalesce down to the dish price rather than failing the
    -- line: a portion removed from the menu while a cart sat open is not a
    -- reason to lose the order.
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord,
    v.id,
    v.name
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
       and c.menu_id = v_menu_id
     limit 1
  ) i on true
  -- LEFT, and scoped to this dish. A variant id is only a portion if it
  -- belongs to the item on the same line -- without v.item_id = i.id a
  -- hand-edited cart could name another dish's portion and be charged that
  -- dish's price for this dish. Not scoped to the restaurant separately:
  -- item_variants has no restaurant_id column, and the parent item has
  -- already been proven to belong to this restaurant through the published
  -- menu above.
  left join public.item_variants v
    on v.id = nullif(coalesce(line->>'variant_id', line->>'variantId'), '')::uuid
   and v.item_id = i.id
  where jsonb_typeof(line) = 'object'
    and (line->>'qty') ~ '^[0-9]+$'
    and (line->>'qty')::int > 0;

  select count(*) into v_written from tt_order_lines;

  if v_written = 0 then
    raise exception 'None of those dishes are available right now.' using errcode = 'P0001';
  end if;

  select coalesce(sum(unit_price_paise * qty), 0)::bigint
    into v_subtotal_paise
    from tt_order_lines;

  v_tax_bps := coalesce(v_restaurant_tax_bps, k_default_tax_bps);

  v_discount_paise := 0;
  v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
  v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
  v_total_paise := v_taxable_paise + v_tax_paise;

  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant_name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  v_code := v_prefix || '-' || (
    select string_agg(
             substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1),
             ''
           )
      from generate_series(1, 5)
  );

  -- -------------------------------------------------------------------- write
  insert into public.orders (
    restaurant_id,
    table_id,
    code,
    customer_note,
    prep_status,
    payment_status,
    subtotal_paise,
    discount_paise,
    tax_paise,
    total_paise
  ) values (
    v_restaurant_id,
    v_table_id,
    v_code,
    v_note,
    'new',
    'pending',
    v_subtotal_paise,
    v_discount_paise,
    v_tax_paise,
    v_total_paise
  )
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'The order could not be recorded.' using errcode = 'P0001';
  end if;

  insert into public.order_items (
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot, addons_snapshot
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    -- Snapshotted, not joined at read time. A ticket printed tonight has to
    -- go on saying "Half" after someone rewrites the menu tomorrow.
    variant_snapshot,
    -- Add-ons are not built yet. Written as an empty array rather than
    -- omitted because the column is NOT NULL, and because an empty array
    -- means "none were chosen" -- which is true -- where NULL would mean
    -- "unknown", which is a different and less useful answer.
    array[]::text[]
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text) is
  'Place an order as a signed-out diner. Takes a restaurant slug and an array '
  'of {item_id, qty, variant_id?}; prices and portion prices are read from the '
  'database, never from the caller. Migration 0008 adds variant_id.';

-- Signature unchanged, so the grants from 0005 still stand and are not
-- repeated here. Re-running this migration is therefore idempotent, and it
-- cannot accidentally widen who may call the function.

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000008_charge_for_portions.sql','46a56e371c3627818089fd45a085b9640a9615ebae67a9f509b28c78196467d6');

-- SOURCE 20261021000009_report_sales.sql SHA256 24140127cf0b3477020372c43771fb2362bad6bfb97176a85dd9fa4f075cbad6
-- 0009 · Sales reporting
--
-- WHY THIS IS A FUNCTION AND NOT A QUERY IN THE APP
--
-- A 30-day report at a busy venue is thousands of orders and tens of
-- thousands of lines. PostgREST has no joins, so the application would have to
-- fetch the orders first and then chunk every order id into `.in()` lists for
-- order_items and payments -- tens of round trips per page load, each one
-- capped by URL length, and the numbers would silently truncate the moment a
-- list got too long. Aggregating in the database is one round trip, integer
-- arithmetic throughout, and there is no row limit to quietly lose money from.
--
-- TWO DEFINITIONS THAT MUST NOT BE MIXED UP
--
--   billed     sum of order totals. What the restaurant sold.
--   collected  sum of payments actually recorded. What it was paid.
--
-- They are different numbers whenever a table has not settled yet, which in a
-- QR-ordering restaurant is most of the evening. Reporting one as the other is
-- the single easiest way to tell an owner their best day ever on a day they
-- have not been paid for.
--
-- CANCELLED ORDERS
--
-- Excluded from billed, from tax and from every item ranking. A cancelled
-- bill is not a sale and its dishes were not cooked. It is returned only as a
-- count, because a rising cancel count is worth seeing.
--
-- REPEATABLE CALLS
--
-- `stable`, not `volatile`: it only reads, so Postgres may inline it within a
-- statement. No writes, no side effects, no audit row.

create or replace function public.report_sales(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz,
  p_timezone      text    default 'Asia/Kolkata',
  p_bucket        text    default 'day',
  p_order_limit   integer default 200,
  p_include_lines boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz      text;
  v_limit   integer;
  v_result  jsonb;
begin
  -- Under SECURITY DEFINER, RLS is suspended inside the body, so this check is
  -- the tenant boundary. Without it any signed-in user could read any
  -- restaurant's takings by guessing a UUID.
  if not public.is_member(p_restaurant_id) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'The report range is not valid.' using errcode = '22023';
  end if;

  if p_bucket not in ('hour', 'day') then
    raise exception 'Bucket must be hour or day.' using errcode = '22023';
  end if;

  -- A range long enough to hide a mistake in the date picker is worth
  -- refusing rather than timing out on. One year is plenty.
  if p_to - p_from > interval '400 days' then
    raise exception 'Reports cover at most 400 days.' using errcode = '22023';
  end if;

  -- An unknown zone would make `at time zone` raise mid-report. Fall back to
  -- UTC rather than fail the whole screen over a bad restaurants.timezone row.
  v_tz := coalesce(nullif(p_timezone, ''), 'UTC');
  if not exists (select 1 from pg_timezone_names n where n.name = v_tz) then
    v_tz := 'UTC';
  end if;

  v_limit := greatest(coalesce(p_order_limit, 200), 0);

  with scoped as (
    select o.*
      from public.orders o
     where o.restaurant_id = p_restaurant_id
       and o.placed_at >= p_from
       and o.placed_at <  p_to
  ),
  -- Bills that count as sales.
  live as (
    select * from scoped where prep_status <> 'cancelled'
  ),
  paid as (
    select p.order_id,
           coalesce(sum(p.amount_paise) filter (where p.status = 'recorded'), 0) as recorded,
           coalesce(sum(p.amount_paise) filter (where p.status = 'refunded'), 0) as refunded
      from public.payments p
      join scoped s on s.id = p.order_id
     group by p.order_id
  ),
  lines as (
    select oi.name_snapshot,
           oi.variant_snapshot,
           oi.qty,
           oi.unit_price_paise,
           oi.item_id,
           sc.id            as order_id,
           sc.code,
           sc.placed_at,
           sc.prep_status
      from public.order_items oi
      join scoped sc on sc.id = oi.order_id
  ),
  totals as (
    select
      (select count(*)::int from live)                                          as bills,
      (select count(*)::int from scoped where prep_status = 'cancelled')         as cancelled,
      (select coalesce(sum(total_paise), 0)    from live)                        as billed,
      (select coalesce(sum(tax_paise), 0)      from live)                        as tax,
      (select coalesce(sum(discount_paise), 0) from live)                        as discount,
      (select coalesce(sum(recorded), 0)       from paid)                        as collected,
      (select coalesce(sum(refunded), 0)       from paid)                        as refunded,
      (select coalesce(sum(greatest(l.total_paise - coalesce(pd.recorded, 0), 0)), 0)
         from live l
         left join paid pd on pd.order_id = l.id)                                as unpaid
  ),
  bucket_rows as (
    select date_trunc(p_bucket, l.placed_at at time zone v_tz) as bucket,
           count(*)::int                        as bills,
           coalesce(sum(l.total_paise), 0)      as revenue
      from live l
     group by 1
  ),
  item_rows as (
    select case
             when l.variant_snapshot is null or l.variant_snapshot = ''
               then l.name_snapshot
             else l.name_snapshot || ' · ' || l.variant_snapshot
           end                                            as name,
           sum(l.qty)::int                                as qty,
           sum(l.qty * l.unit_price_paise)                as revenue
      from lines l
     where l.prep_status <> 'cancelled'
     group by 1
  ),
  category_rows as (
    select coalesce(c.name, 'Uncategorised')              as name,
           sum(l.qty)::int                                as qty,
           sum(l.qty * l.unit_price_paise)                as revenue
      from lines l
      left join public.items i      on i.id = l.item_id
      left join public.categories c on c.id = i.category_id
     where l.prep_status <> 'cancelled'
     group by 1
  ),
  method_rows as (
    select p.method,
           count(*)::int                                                    as payment_count,
           coalesce(sum(p.amount_paise) filter (where p.status = 'recorded'), 0) as recorded,
           coalesce(sum(p.amount_paise) filter (where p.status = 'refunded'), 0) as refunded
      from public.payments p
      join scoped s on s.id = p.order_id
     where p.status in ('recorded', 'refunded')
     group by p.method
  ),
  order_rows as (
    select o.id,
           o.code,
           o.placed_at,
           o.prep_status,
           o.payment_status,
           o.total_paise,
           o.tax_paise,
           o.subtotal_paise,
           o.discount_paise,
           coalesce(pd.recorded, 0) as paid_paise,
           coalesce(pd.refunded, 0) as refunded_paise,
           t.label                  as table_label
      from scoped o
      left join paid pd                 on pd.order_id = o.id
      left join public.dining_tables t  on t.id = o.table_id
     order by o.placed_at desc
     limit v_limit
  ),
  line_rows as (
    select l.code,
           l.placed_at,
           l.name_snapshot,
           l.variant_snapshot,
           l.qty,
           l.unit_price_paise
      from lines l
     where l.prep_status <> 'cancelled'
     order by l.placed_at, l.code
     limit 20000
  )
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'bucket', p_bucket,
    'timezone', v_tz,
    'totals', (
      select jsonb_build_object(
        'bills',          t.bills,
        'cancelled',      t.cancelled,
        'billed_paise',   t.billed,
        'tax_paise',      t.tax,
        'discount_paise', t.discount,
        'collected_paise', t.collected,
        'refunded_paise',  t.refunded,
        'unpaid_paise',    t.unpaid,
        -- Rounded to whole paise. `sum()` returns numeric, so an unrounded
        -- division hands back 200147.666666666667 -- a money figure with
        -- fifteen decimal places that the formatter cannot render honestly.
        'average_bill_paise',
          case when t.bills > 0 then round(t.billed / t.bills)::bigint else 0 end
      )
      from totals t
    ),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', to_char(b.bucket, 'YYYY-MM-DD HH24:MI'),
               'bills', b.bills,
               'revenue_paise', b.revenue
             ) order by b.bucket)
        from bucket_rows b
    ), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', r.name,
               'qty', r.qty,
               'revenue_paise', r.revenue
             ) order by r.revenue desc, r.name)
        from (select * from item_rows order by revenue desc, name limit 20) r
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', r.name,
               'qty', r.qty,
               'revenue_paise', r.revenue
             ) order by r.revenue desc, r.name)
        from category_rows r
    ), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method', r.method,
               'count', r.payment_count,
               'recorded_paise', r.recorded,
               'refunded_paise', r.refunded
             ) order by r.method)
        from method_rows r
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'code', r.code,
               'placed_at', r.placed_at,
               'prep_status', r.prep_status,
               'payment_status', r.payment_status,
               'subtotal_paise', r.subtotal_paise,
               'discount_paise', r.discount_paise,
               'tax_paise', r.tax_paise,
               'total_paise', r.total_paise,
               'paid_paise', r.paid_paise,
               'refunded_paise', r.refunded_paise,
               'table_label', r.table_label
             ) order by r.placed_at desc)
        from order_rows r
    ), '[]'::jsonb),
    'lines', case when p_include_lines then coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code,
               'placed_at', r.placed_at,
               'name', r.name_snapshot,
               'variant', r.variant_snapshot,
               'qty', r.qty,
               'unit_price_paise', r.unit_price_paise
             ) order by r.placed_at, r.code)
        from line_rows r
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.report_sales(uuid, timestamptz, timestamptz, text, text, integer, boolean) is
  'Aggregated sales for one restaurant and one time range. Members only. Billed and collected are reported separately on purpose.';

-- Signed-in staff only. A guest has no business reading takings, and anon
-- calling this with a guessed restaurant id would only get the 42501 above.
revoke all on function public.report_sales(uuid, timestamptz, timestamptz, text, text, integer, boolean)
  from public, anon;
grant execute on function public.report_sales(uuid, timestamptz, timestamptz, text, text, integer, boolean)
  to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000009_report_sales.sql','24140127cf0b3477020372c43771fb2362bad6bfb97176a85dd9fa4f075cbad6');

-- SOURCE 20261021000010_realtime_orders.sql SHA256 c5ffabaee008a6470b34139fb949c81d115f72a1a09b2911c633dbc45ee98c59
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

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000010_realtime_orders.sql','c5ffabaee008a6470b34139fb949c81d115f72a1a09b2911c633dbc45ee98c59');

-- SOURCE 20261021000200_item_spoken_name.sql SHA256 4f81ec41bb60e9351441f1c5c4f0493ec889e1ad779112843c9d145c9c528c5c
-- How a dish is SAID, when the algorithm's guess is wrong.
--
-- The kitchen board turns a menu name into Devanagari (lib/hindi.ts) so that
-- every Hindi voice can read it. A dictionary of Indian menu vocabulary plus
-- rules for imported food gets most names right and never leaves Latin script
-- in front of the voice -- but "right" for a dish nobody has heard of is a
-- guess, and the person who knows the answer is the owner.
--
-- So an item may carry its own written pronunciation. Whatever is stored here
-- is what the kitchen hears; the name keeps being what the guest reads on the
-- menu. Both are needed: renaming a dish to make the voice happy would be a
-- strange thing to force on a restaurant.
--
-- Null is the normal state -- it means "say the name, the way the board
-- already does". The column is text rather than a lookup table because it is
-- one string per item, edited next to the name it replaces.

alter table public.items
  add column if not exists spoken_name text;

-- Bounded to what a person can hear in one breath, and the same bound the
-- editor enforces. A pronunciation is a phrase, not a paragraph.
alter table public.items
  drop constraint if exists items_spoken_name_length;

alter table public.items
  add constraint items_spoken_name_length
  check (spoken_name is null or (char_length(btrim(spoken_name)) between 1 and 120));

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000200_item_spoken_name.sql','4f81ec41bb60e9351441f1c5c4f0493ec889e1ad779112843c9d145c9c528c5c');

-- SOURCE 20261021000300_item_addons.sql SHA256 18c48261e7acf87fc0e5718edf756afadb19d672be800a039bc99aa661d495ed
-- ============================================================================
-- AutoDine — migration 0011: add-ons that cost money
--
-- WHY THIS EXISTS
--
-- The dish sheet has always shown a "Pair it with / Butter naan +79" group and
-- a spice group. Neither reached the kitchen and neither reached the bill.
-- Underneath, a sentence admitted it: "Spice level and any bread you add are
-- passed to the kitchen but not charged". The first half of that sentence was
-- not even true -- cart.add() was called with the item, the quantity and the
-- portion, and nothing else, so the kitchen never learned the guest wanted no
-- onion. The screen said one thing and the system did another, which is worse
-- than the feature not existing.
--
-- So add-ons are real now: an owner defines them against a dish, the guest
-- picks from that dish's own list, and the price of every pick is read here,
-- from these tables, when the order is written.
--
-- WHAT AN OWNER CAN SAY
--
--   item_addon_groups   a heading on the sheet -- "Add a little extra",
--                       "Jain / no onion". min_select = 0 means the guest may
--                       skip the group; min_select >= 1 means the sheet shows
--                       it as required and starts with a default chosen.
--                       max_select = 1 is a radio list (pick one), anything
--                       higher is a set of toggles (pick up to that many).
--
--   item_addons         the actual choices: "Extra cheese" at Rs 40, "Jain"
--                       at Rs 0. A zero price is a real and common case -- an
--                       instruction the kitchen must see that costs nothing --
--                       so price_paise is not nullable and not a sentinel.
--
-- HOW THE PRICE REACHES THE BILL
--
-- place_public_order reads addon_ids off each cart line, proves every id
-- belongs to that same dish (through its group), drops anything inactive or
-- beyond max_select, adds the surviving prices to the line's UNIT price --
-- add-ons are per plate, not per order -- and snapshots the NAMES onto
-- order_items.addons_snapshot.
--
-- Names, not ids: a ticket printed tonight must still say "Extra cheese" after
-- someone deletes the add-on tomorrow, and the kitchen board reads the
-- snapshot, so it keeps working.
--
-- WHAT DOES NOT CHANGE
--
-- A line with no addon_ids is priced exactly as it is today. Every order
-- placed before this migration keeps its own snapshot and its own total. An
-- add-on deleted from the menu does not rewrite history.
-- ============================================================================

create table if not exists public.item_addon_groups (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  name        text not null,
  -- 0 = the guest may skip this group. >= 1 = the sheet shows it as required
  -- and starts with a choice already made.
  min_select  integer not null default 0 check (min_select >= 0),
  -- 1 = choose one (radio). > 1 = choose up to this many (toggles).
  max_select  integer not null default 1 check (max_select >= 1),
  sort_order  integer not null default 0,
  constraint item_addon_groups_range check (max_select >= min_select)
);

create index if not exists item_addon_groups_item_idx
  on public.item_addon_groups(item_id);

create table if not exists public.item_addons (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.item_addon_groups(id) on delete cascade,
  name         text not null,
  -- Paise, like everything else that is money. 0 is legitimate: "Jain" is an
  -- instruction, not an upsell.
  price_paise  bigint not null default 0 check (price_paise >= 0),
  is_available boolean not null default true,
  sort_order   integer not null default 0
);

create index if not exists item_addons_group_idx on public.item_addons(group_id);

comment on table public.item_addon_groups is
  'A heading of choices against one dish, e.g. "Add a little extra". max_select 1 = pick one, higher = pick up to that many.';
comment on table public.item_addons is
  'One choice inside an add-on group. price_paise is per plate; the order function adds it to the line unit price.';

-- ------------------------------------------------------------------ security
-- Same shape as item_variants in 0001: staff own their restaurant's rows, and
-- an anonymous guest may read the add-ons of an available dish -- a guest
-- ordering must not have to log in to see what "Extra cheese" costs.

alter table public.item_addon_groups enable row level security;
alter table public.item_addons       enable row level security;

create policy addon_groups_staff on public.item_addon_groups
  for all using (exists (
    select 1 from public.items i
     where i.id = item_addon_groups.item_id
       and i.restaurant_id in (select public.current_restaurant_ids())
  ));

create policy addon_groups_public on public.item_addon_groups
  for select using (exists (
    select 1 from public.items i
     where i.id = item_addon_groups.item_id and i.is_available
  ));

create policy addons_staff on public.item_addons
  for all using (exists (
    select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
     where g.id = item_addons.group_id
       and i.restaurant_id in (select public.current_restaurant_ids())
  ));

create policy addons_public on public.item_addons
  for select using (exists (
    select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
     where g.id = item_addons.group_id and i.is_available
  ));

-- ============================================================================
-- place_public_order: price the add-ons, in the database, from these tables
-- ============================================================================

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_max_addons_per_line constant int := 20;
  k_default_tax_bps constant int := 500;
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  k_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  v_session public.table_verification_sessions%rowtype;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_table_id uuid;
  v_menu_id uuid;
  v_tax_bps int;
  v_note text;
  v_line_count int;
  v_subtotal_paise bigint := 0;
  v_discount_paise bigint := 0;
  v_taxable_paise bigint := 0;
  v_tax_paise bigint := 0;
  v_total_paise bigint := 0;
  v_code text;
  v_prefix text;
  v_order_id uuid;
  v_written int := 0;
begin
  -- ---------------------------------------------------------------- session
  if p_session_token is not null then
    if p_session_token !~ '^[A-Fa-f0-9]{64}$' then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select s.* into v_session
      from public.table_verification_sessions s
     where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
       and s.expires_at > statement_timestamp()
       and s.revoked_at is null;

    if not found then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.table_qr_codes q
       where q.id = v_session.qr_code_id
         and q.revoked_at is null
         and q.table_id = v_session.table_id
         and q.restaurant_id = v_session.restaurant_id
    ) then
      raise exception 'Your table verification is no longer valid. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.id = v_session.restaurant_id
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
    end if;

    select t.id into v_table_id
      from public.dining_tables t
     where t.id = v_session.table_id
       and t.restaurant_id = v_restaurant_id
       and t.is_active = true;

    if v_table_id is null then
      raise exception 'This table is not taking orders right now. Please ask staff.'
        using errcode = 'P0001';
    end if;

    if p_slug is not null and btrim(p_slug) <> '' then
      if not exists (
        select 1 from public.restaurants r
         where r.id = v_restaurant_id and r.slug = btrim(p_slug)
      ) then
        raise exception 'This order is for a different restaurant. Please open the menu again.'
          using errcode = 'P0001';
      end if;
    end if;
  else
    if p_slug is null or btrim(p_slug) = '' then
      raise exception 'No restaurant was given.' using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.slug = btrim(p_slug)
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders.' using errcode = 'P0001';
    end if;

    v_table_id := null;
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  select m.id
    into v_menu_id
    from public.menus m
   where m.restaurant_id = v_restaurant_id
     and m.is_published = true
   order by m.is_published desc, m.created_at desc nulls last
   limit 1;

  if v_menu_id is null then
    raise exception 'That restaurant has no published menu.' using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------- input
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count = 0 then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  if v_line_count > k_max_lines then
    raise exception 'That is more than % dishes in one order.', k_max_lines
      using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > k_max_note then
    v_note := left(v_note, k_max_note);
  end if;

  -- ----------------------------------------------------------------- pricing
  -- Truncated, not merely created: a function called twice inside one
  -- transaction (a retry) would otherwise find yesterday's leftover rows and
  -- charge for them.
  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean not null,
    sort_order int not null,
    variant_id uuid,
    variant_snapshot text,
    addon_ids uuid[] not null default '{}'
  ) on commit drop;

  create temporary table if not exists tt_line_addons (
    sort_order int not null,
    pick int not null,
    name text not null,
    price_paise bigint not null
  ) on commit drop;

  truncate tt_order_lines;
  truncate tt_line_addons;

  insert into tt_order_lines (
    item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_id, variant_snapshot, addon_ids
  )
  select
    i.id,
    i.name,
    -- The portion's price when one was chosen and it resolves; otherwise the
    -- dish's own. coalesce down to the dish price rather than failing the
    -- line: a portion removed from the menu while a cart sat open is not a
    -- reason to lose the order.
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord,
    v.id,
    v.name,
    -- Only well-formed uuids survive. The cart is the guest's to edit, so a
    -- junk value must be ignored here rather than raising a cast error that
    -- takes the whole order down with it. Duplicates are collapsed: the same
    -- add-on twice is one add-on.
    coalesce((
      select array_agg(ids.v)
        from (
          select distinct t.v
            from jsonb_array_elements_text(
                   case
                     when jsonb_typeof(line->'addon_ids') = 'array' then line->'addon_ids'
                     when jsonb_typeof(line->'addonIds') = 'array' then line->'addonIds'
                     else '[]'::jsonb
                   end
                 ) as t(v)
           where t.v ~ k_uuid_pattern
           limit k_max_addons_per_line
        ) ids
    ), '{}')::uuid[]
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
       and c.menu_id = v_menu_id
     limit 1
  ) i on true
  -- LEFT, and scoped to this dish. A variant id is only a portion if it
  -- belongs to the item on the same line -- without v.item_id = i.id a
  -- hand-edited cart could name another dish's portion and be charged that
  -- dish's price for this dish.
  left join public.item_variants v
    on v.id = nullif(coalesce(line->>'variant_id', line->>'variantId'), '')::uuid
   and v.item_id = i.id
  where jsonb_typeof(line) = 'object'
    and (line->>'qty') ~ '^[0-9]+$'
    and (line->>'qty')::int > 0;

  select count(*) into v_written from tt_order_lines;

  if v_written = 0 then
    raise exception 'None of those dishes are available right now.' using errcode = 'P0001';
  end if;

  -- An add-on counts only when it is on THIS dish: the group is joined by
  -- g.item_id = l.item_id, so an id belonging to another dish, another
  -- restaurant, or a deleted group resolves to nothing and is not charged.
  --
  -- Beyond max_select the extra picks are dropped rather than rejected: the
  -- same line might be a cart saved before the owner lowered the limit, and
  -- silently charging for a fourth pick the owner has since disallowed is
  -- worse than charging for the three that are allowed.
  insert into tt_line_addons (sort_order, pick, name, price_paise)
  select line_ord, pick, name, price_paise
    from (
      select l.sort_order as line_ord,
             a.name,
             a.price_paise,
             row_number() over (partition by l.sort_order, g.id order by want.ord) as pick,
             g.max_select
        from tt_order_lines l
        cross join lateral unnest(l.addon_ids) with ordinality as want(id, ord)
        join public.item_addons a
          on a.id = want.id
         and a.is_available = true
        join public.item_addon_groups g
          on g.id = a.group_id
         and g.item_id = l.item_id
    ) picked
   where pick <= max_select
   order by line_ord, pick;

  -- Per plate, not per order: two plates with extra cheese is two extras.
  update tt_order_lines l
     set unit_price_paise = l.unit_price_paise
       + coalesce((select sum(x.price_paise) from tt_line_addons x
                    where x.sort_order = l.sort_order), 0);

  select coalesce(sum(unit_price_paise * qty), 0)::bigint
    into v_subtotal_paise
    from tt_order_lines;

  v_tax_bps := coalesce(v_restaurant_tax_bps, k_default_tax_bps);

  v_discount_paise := 0;
  v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
  v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
  v_total_paise := v_taxable_paise + v_tax_paise;

  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant_name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  v_code := v_prefix || '-' || (
    select string_agg(
             substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1),
             ''
           )
      from generate_series(1, 5)
  );

  -- -------------------------------------------------------------------- write
  insert into public.orders (
    restaurant_id,
    table_id,
    code,
    customer_note,
    prep_status,
    payment_status,
    subtotal_paise,
    discount_paise,
    tax_paise,
    total_paise
  ) values (
    v_restaurant_id,
    v_table_id,
    v_code,
    v_note,
    'new',
    'pending',
    v_subtotal_paise,
    v_discount_paise,
    v_tax_paise,
    v_total_paise
  )
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'The order could not be recorded.' using errcode = 'P0001';
  end if;

  insert into public.order_items (
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot, addons_snapshot
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    -- Snapshotted, not joined at read time. A ticket printed tonight has to
    -- go on saying "Half" and "Extra cheese" after someone rewrites the menu
    -- tomorrow.
    variant_snapshot,
    coalesce((
      select array_agg(x.name order by x.pick)
        from tt_line_addons x
       where x.sort_order = tt_order_lines.sort_order
    ), array[]::text[])
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text) is
  'Place an order as a signed-out diner. Takes a restaurant slug and an array '
  'of {item_id, qty, variant_id?, addon_ids?}; prices, portion prices and '
  'add-on prices are read from the database, never from the caller. Migration '
  '0011 adds addon_ids.';

-- Signature unchanged, so the grants from 0006 still stand and are not
-- repeated here. Re-running this migration is therefore idempotent, and it
-- cannot accidentally widen who may call the function.

-- ============================================================================
-- The old guard, which is now wrong
--
-- Production carries a trigger, order_items_reject_unpriced_addons, that
-- raises "Unpriced add-ons are not supported yet." on any order_items row with
-- a non-empty addons_snapshot. It was applied out of band: there is no
-- migration for it in this repository, and nothing in this repository creates
-- it. It did its job while add-ons were display-only -- the till could not
-- record one it had not charged for.
--
-- They are charged now, in place_public_order above, so the guard protects
-- nothing and instead makes every add-on order fail at the last step, after
-- the guest has already pressed Place order. Found by calling the function
-- against the real database, not by reading it.
--
-- Dropped with a note rather than silently: the next person to see add-ons
-- missing from a bill should not go looking for a trigger that is no longer
-- there, and the next person to see this migration should know what went.
-- ============================================================================

drop trigger if exists order_items_reject_unpriced_addons on public.order_items;
-- No argument list: the function takes none, and the schema check tolerates
-- that form but not an empty pair of brackets.
drop function if exists public.reject_unpriced_order_addons;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000300_item_addons.sql','18c48261e7acf87fc0e5718edf756afadb19d672be800a039bc99aa661d495ed');

-- SOURCE 20261021000400_multiple_menus.sql SHA256 01a5c07088792858cce2af31f2187ed6b20bab1fd87912273841f0e58543c3a9
-- ============================================================================
-- More than one menu
--
-- WHAT WAS WRONG
--
-- The menus table has always allowed a restaurant to publish several menus,
-- and the schema puts categories (and therefore dishes) under a menu. Nothing
-- downstream agreed on which menu was "the" menu:
--
--   * the guest menu screen took the lowest sort_order but loaded every
--     category and dish in the restaurant, so two menus were merged into one
--     list;
--   * this function took the newest created menu and rejected any line whose
--     dish was not on it.
--
-- So a guest at a two-menu restaurant saw dishes that could not be ordered,
-- and got "None of those dishes are available right now" after pressing Place
-- order. Restaurant owners worked around it by publishing one menu and keeping
-- the other one as a draft, which is not what the product promises.
--
-- WHAT THIS DOES
--
-- A dish is orderable when its category belongs to any PUBLISHED menu of the
-- restaurant. A dish on a draft menu is not orderable, which is the point of a
-- draft. The menu a guest picked is still respected on screen (see
-- lib/menu-select.ts and lib/db/menu.ts); ordering no longer needs to know
-- which one, because a cart can legitimately hold a breakfast dish and a
-- dinner dish at 4pm.
--
-- The signature is unchanged, so the existing grants still stand.
-- ============================================================================

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_max_addons_per_line constant int := 20;
  k_default_tax_bps constant int := 500;
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  k_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  v_session public.table_verification_sessions%rowtype;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_table_id uuid;
  v_tax_bps int;
  v_note text;
  v_line_count int;
  v_subtotal_paise bigint := 0;
  v_discount_paise bigint := 0;
  v_taxable_paise bigint := 0;
  v_tax_paise bigint := 0;
  v_total_paise bigint := 0;
  v_code text;
  v_prefix text;
  v_order_id uuid;
  v_written int := 0;
begin
  -- ---------------------------------------------------------------- session
  if p_session_token is not null then
    if p_session_token !~ '^[A-Fa-f0-9]{64}$' then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select s.* into v_session
      from public.table_verification_sessions s
     where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
       and s.expires_at > statement_timestamp()
       and s.revoked_at is null;

    if not found then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.table_qr_codes q
       where q.id = v_session.qr_code_id
         and q.revoked_at is null
         and q.table_id = v_session.table_id
         and q.restaurant_id = v_session.restaurant_id
    ) then
      raise exception 'Your table verification is no longer valid. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.id = v_session.restaurant_id
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
    end if;

    select t.id into v_table_id
      from public.dining_tables t
     where t.id = v_session.table_id
       and t.restaurant_id = v_restaurant_id
       and t.is_active = true;

    if v_table_id is null then
      raise exception 'This table is not taking orders right now. Please ask staff.'
        using errcode = 'P0001';
    end if;

    if p_slug is not null and btrim(p_slug) <> '' then
      if not exists (
        select 1 from public.restaurants r
         where r.id = v_restaurant_id and r.slug = btrim(p_slug)
      ) then
        raise exception 'This order is for a different restaurant. Please open the menu again.'
          using errcode = 'P0001';
      end if;
    end if;
  else
    if p_slug is null or btrim(p_slug) = '' then
      raise exception 'No restaurant was given.' using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.slug = btrim(p_slug)
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders.' using errcode = 'P0001';
    end if;

    v_table_id := null;
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  -- A restaurant may publish more than one menu -- breakfast, lunch, the
  -- evening card. A dish is orderable when its category sits on ANY published
  -- menu of this restaurant.
  --
  -- The old version picked exactly one menu (the most recently created) and
  -- refused every other line, while the guest's own menu screen had been
  -- built from a different pick again: whichever had the lowest sort_order.
  -- The two disagreed, so a dish the guest could see and add failed at the
  -- last step with "None of those dishes are available right now" -- after
  -- they had pressed Place order. Which menu a dish lives on is the
  -- restaurant's business. That it is published is ours.
  if not exists (
    select 1
      from public.menus m
     where m.restaurant_id = v_restaurant_id
       and m.is_published = true
  ) then
    raise exception 'That restaurant has no published menu.' using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------- input
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count = 0 then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  if v_line_count > k_max_lines then
    raise exception 'That is more than % dishes in one order.', k_max_lines
      using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > k_max_note then
    v_note := left(v_note, k_max_note);
  end if;

  -- ----------------------------------------------------------------- pricing
  -- Truncated, not merely created: a function called twice inside one
  -- transaction (a retry) would otherwise find yesterday's leftover rows and
  -- charge for them.
  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean not null,
    sort_order int not null,
    variant_id uuid,
    variant_snapshot text,
    addon_ids uuid[] not null default '{}'
  ) on commit drop;

  create temporary table if not exists tt_line_addons (
    sort_order int not null,
    pick int not null,
    name text not null,
    price_paise bigint not null
  ) on commit drop;

  truncate tt_order_lines;
  truncate tt_line_addons;

  insert into tt_order_lines (
    item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_id, variant_snapshot, addon_ids
  )
  select
    i.id,
    i.name,
    -- The portion's price when one was chosen and it resolves; otherwise the
    -- dish's own. coalesce down to the dish price rather than failing the
    -- line: a portion removed from the menu while a cart sat open is not a
    -- reason to lose the order.
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord,
    v.id,
    v.name,
    -- Only well-formed uuids survive. The cart is the guest's to edit, so a
    -- junk value must be ignored here rather than raising a cast error that
    -- takes the whole order down with it. Duplicates are collapsed: the same
    -- add-on twice is one add-on.
    coalesce((
      select array_agg(ids.v)
        from (
          select distinct t.v
            from jsonb_array_elements_text(
                   case
                     when jsonb_typeof(line->'addon_ids') = 'array' then line->'addon_ids'
                     when jsonb_typeof(line->'addonIds') = 'array' then line->'addonIds'
                     else '[]'::jsonb
                   end
                 ) as t(v)
           where t.v ~ k_uuid_pattern
           limit k_max_addons_per_line
        ) ids
    ), '{}')::uuid[]
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
      -- The menu has to be published, but it does not have to be the one
      -- another request happened to choose. An item with no category belongs
      -- to no menu and stays unorderable: it is reachable from no menu screen.
      join public.menus m
        on m.id = c.menu_id
       and m.restaurant_id = v_restaurant_id
       and m.is_published = true
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
     limit 1
  ) i on true
  -- LEFT, and scoped to this dish. A variant id is only a portion if it
  -- belongs to the item on the same line -- without v.item_id = i.id a
  -- hand-edited cart could name another dish's portion and be charged that
  -- dish's price for this dish.
  left join public.item_variants v
    on v.id = nullif(coalesce(line->>'variant_id', line->>'variantId'), '')::uuid
   and v.item_id = i.id
  where jsonb_typeof(line) = 'object'
    and (line->>'qty') ~ '^[0-9]+$'
    and (line->>'qty')::int > 0;

  select count(*) into v_written from tt_order_lines;

  if v_written = 0 then
    raise exception 'None of those dishes are available right now.' using errcode = 'P0001';
  end if;

  -- An add-on counts only when it is on THIS dish: the group is joined by
  -- g.item_id = l.item_id, so an id belonging to another dish, another
  -- restaurant, or a deleted group resolves to nothing and is not charged.
  --
  -- Beyond max_select the extra picks are dropped rather than rejected: the
  -- same line might be a cart saved before the owner lowered the limit, and
  -- silently charging for a fourth pick the owner has since disallowed is
  -- worse than charging for the three that are allowed.
  insert into tt_line_addons (sort_order, pick, name, price_paise)
  select line_ord, pick, name, price_paise
    from (
      select l.sort_order as line_ord,
             a.name,
             a.price_paise,
             row_number() over (partition by l.sort_order, g.id order by want.ord) as pick,
             g.max_select
        from tt_order_lines l
        cross join lateral unnest(l.addon_ids) with ordinality as want(id, ord)
        join public.item_addons a
          on a.id = want.id
         and a.is_available = true
        join public.item_addon_groups g
          on g.id = a.group_id
         and g.item_id = l.item_id
    ) picked
   where pick <= max_select
   order by line_ord, pick;

  -- Per plate, not per order: two plates with extra cheese is two extras.
  update tt_order_lines l
     set unit_price_paise = l.unit_price_paise
       + coalesce((select sum(x.price_paise) from tt_line_addons x
                    where x.sort_order = l.sort_order), 0);

  select coalesce(sum(unit_price_paise * qty), 0)::bigint
    into v_subtotal_paise
    from tt_order_lines;

  v_tax_bps := coalesce(v_restaurant_tax_bps, k_default_tax_bps);

  v_discount_paise := 0;
  v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
  v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
  v_total_paise := v_taxable_paise + v_tax_paise;

  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant_name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  v_code := v_prefix || '-' || (
    select string_agg(
             substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1),
             ''
           )
      from generate_series(1, 5)
  );

  -- -------------------------------------------------------------------- write
  insert into public.orders (
    restaurant_id,
    table_id,
    code,
    customer_note,
    prep_status,
    payment_status,
    subtotal_paise,
    discount_paise,
    tax_paise,
    total_paise
  ) values (
    v_restaurant_id,
    v_table_id,
    v_code,
    v_note,
    'new',
    'pending',
    v_subtotal_paise,
    v_discount_paise,
    v_tax_paise,
    v_total_paise
  )
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'The order could not be recorded.' using errcode = 'P0001';
  end if;

  insert into public.order_items (
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot, addons_snapshot
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    -- Snapshotted, not joined at read time. A ticket printed tonight has to
    -- go on saying "Half" and "Extra cheese" after someone rewrites the menu
    -- tomorrow.
    variant_snapshot,
    coalesce((
      select array_agg(x.name order by x.pick)
        from tt_line_addons x
       where x.sort_order = tt_order_lines.sort_order
    ), array[]::text[])
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000400_multiple_menus.sql','01a5c07088792858cce2af31f2187ed6b20bab1fd87912273841f0e58543c3a9');

-- SOURCE 20261021000500_restaurant_settings.sql SHA256 a10a5583d3fa1833ed0a17e89219e57452bb7892d5a4b5e34b73b0f64aa9d919
-- ============================================================================
-- Restaurant settings: who is allowed to edit the restaurant row.
--
-- BEFORE THIS
--
-- The only UPDATE policy on public.restaurants was
--
--   for update using (id in (select public.current_restaurant_ids()));
--
-- which every member satisfies. A cashier could rename the restaurant, change
-- the tax rate, or point the public web address at something else. In
-- production the policy was missing entirely, and a missing policy under RLS
-- is a denial, not an error: an UPDATE from the dashboard matched zero rows
-- and returned no error at all. A Settings screen that trusted .update() would
-- have shown "Saved" over a row that never changed.
--
-- AFTER
--
-- Owner and manager only. Enforced on both the existing row (USING) and the
-- new one (WITH CHECK), because a tenant isolation bug that lets an update
-- move a row to another restaurant id has to be refused as well.
--
-- The app applies the same rule (lib/settings-input.ts) so a cashier sees a
-- disabled form and a sentence explaining why, rather than a Postgres error.
--
-- WHY NOT restaurant_can_write()
--
-- That function also refuses every workspace write once the trial has lapsed.
-- An expired workspace must still be able to correct its name, phone number
-- and GSTIN -- those are what an invoice and a payment are addressed to. The
-- gate belongs on the features that consume the workspace, where it already
-- is (menus, items, orders).
--
-- ALSO IN HERE: the default tax rate.
--
-- Migration 0001 shipped default 500 (the SAMPLE 5% used for layout review).
-- Production has 0. Repo and production disagreeing about a money column is
-- the kind of drift that ends with one environment charging a rate the owner
-- never set, so the repo is aligned to 0 here. Settings shows a 0% warning
-- until the owner sets a real rate; inventing one is worse than showing none.
-- Existing rows are untouched.
-- ============================================================================

-- ------------------------------------------------------------------ helpers

-- Does the caller manage this restaurant? SECURITY DEFINER so the membership
-- lookup inside a policy does not recurse through memberships' own RLS.
create or replace function public.can_manage_restaurant(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.restaurant_id = p_restaurant_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager')
  );
$$;

-- ------------------------------------------------------------------- policy

-- Dropped first so this migration can be re-run. The loose policy it replaces
-- is the one described in the header.
drop policy if exists restaurants_update on public.restaurants;

create policy restaurants_update on public.restaurants
  for update
  using (
    id in (select public.current_restaurant_ids())
    and public.can_manage_restaurant(id)
  )
  with check (
    id in (select public.current_restaurant_ids())
    and public.can_manage_restaurant(id)
  );

-- ------------------------------------------------------------------- grants

-- A policy is not a permission. This project grants table privileges per table
-- rather than relying on Supabase's default privileges -- public.restaurants
-- had SELECT for anon/authenticated and nothing else. Without this grant the
-- UPDATE above is refused with "permission denied for table restaurants"
-- (42501) before RLS is ever consulted, which is what a real owner hit while
-- this screen was being built.
--
-- anon deliberately gets nothing new: a guest reads the name and tagline of an
-- active restaurant and can never write to one.
grant update on public.restaurants to authenticated;

-- --------------------------------------------------------------- tax default

alter table public.restaurants
  alter column tax_rate_bps set default 0;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000500_restaurant_settings.sql','a10a5583d3fa1833ed0a17e89219e57452bb7892d5a4b5e34b73b0f64aa9d919');

-- SOURCE 20261021000600_cancel_and_change_order.sql SHA256 37cb01be25ae18fd368624d646c13ef7bbe4794d220d46105682a8804aec2280
-- ============================================================================
-- Cancel and change an order: the guest's own credential
--
-- WHY THIS EXISTS
--
-- Two things were wrong, and they had the same cause.
--
--   1. A guest could not see their order at all. The confirmation screen read
--      public.orders with the browser key, and the only policies on that table
--      are for signed-in staff -- so an anonymous guest saw ZERO rows and the
--      page said "Order not found" for every order ever placed. Verified
--      against the live database: anon reads 0 orders and 0 order_items.
--   2. Nothing could cancel or change an order once placed. A guest who
--      pressed Place order twice, or wanted one fewer naan, had to ask staff.
--
-- THE DESIGN
--
-- An order now carries its own unguessable guest_token, generated by the app
-- and stored on the row. The token is the guest's credential: it is handed
-- back ONLY in the redirect to the confirmation page, so
--
--   * seeing an order needs code + token -- a short code alone is guessable,
--     and it used to be the only thing between a stranger and someone's bill;
--   * changing it needs the same pair, and only while the ticket is still
--     'new' (nothing has been cooked) and unpaid;
--   * cancelling it needs the same pair, inside a ten minute window.
--
-- Staff do not need a token: any member with role owner/manager/cashier/
-- kitchen may cancel, because the person at the counter is the person a guest
-- walks up to. Changing line quantities is limited to a ticket the kitchen has
-- not started -- after that the food exists and a quantity edit is a lie.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- Adding NEW dishes to an existing order. That needs the menu-pricing path to
-- run again, and a second order is the same food with a cleaner trail: the
-- kitchen gets a ticket it can watch arrive, and the bill keeps both rounds.
-- Quantity and removal of what is already on the ticket are pure arithmetic
-- on the snapshots the order already holds, which is why they are safe here.
--
-- NOTHING IN THIS FILE TRUSTS THE CALLER WITH A PRICE. Quantities are clamped
-- to 0..99, line ids are matched against the order they claim to belong to,
-- and every amount is recomputed from unit_price_paise snapshots already on
-- the row.
-- ============================================================================

-- ---------------------------------------------------------------- new columns

alter table public.orders add column guest_token uuid;
alter table public.orders add column cancel_reason text;
alter table public.orders add column tax_rate_bps_snapshot integer;

comment on column public.orders.guest_token is
  'Unguessable guest credential for this order. Handed out once, in the confirmation link.';

-- ------------------------------------------------------- place_public_order
--
-- The existing function keeps doing the pricing -- it is the only place a
-- price is decided and it is not copied here. It is renamed and its EXECUTE is
-- taken away, so the wrapper below is the only door: the pricing body stays in
-- one place, and "a client that has not been redeployed" still works because
-- every new argument has a default.
--
-- The wrapper does one thing the pricing function cannot: it records the guest
-- token on the row it just created, and the tax rate the bill was priced at.
-- The rate travels with the order so that changing it in Settings never
-- reprices a bill somebody already agreed to.

alter function public.place_public_order(text, jsonb, text, text)
  rename to place_public_order_core;

revoke all on function public.place_public_order_core(text, jsonb, text, text) from public;
revoke all on function public.place_public_order_core(text, jsonb, text, text) from anon;
revoke all on function public.place_public_order_core(text, jsonb, text, text) from authenticated;

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  if p_guest_token is not null then
    -- Scoped by restaurant as well as code: order codes are not unique across
    -- restaurants, and updating the wrong venue's order would hand a stranger
    -- the credential for somebody else's bill.
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = (select r.id from public.restaurants r where r.slug = p_slug);
  end if;

  return v_code;
end;
$$;

revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from public;
revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from anon;
revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from authenticated;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid) to anon;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid) to authenticated;

-- ============================================================================
-- Reading one order as its guest
--
-- SECURITY DEFINER because the guest has no session: the token IS the
-- credential, and the function returns nothing at all without a match. It
-- returns one order, never a list, so a bad token cannot be used to fish.
-- ============================================================================

create or replace function public.get_public_order(
  p_slug text,
  p_code text,
  p_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'prep_status', o.prep_status,
    'payment_status', o.payment_status,
    'subtotal_paise', o.subtotal_paise,
    'tax_paise', o.tax_paise,
    'total_paise', o.total_paise,
    'customer_note', o.customer_note,
    'placed_at', o.placed_at,
    'table_label', t.label,
    'lines', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name_snapshot,
                 'qty', i.qty,
                 'unit_price_paise', i.unit_price_paise,
                 'is_veg', i.is_veg,
                 'variant', i.variant_snapshot,
                 'addons', i.addons_snapshot
               )
               order by i.sort_order
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.dining_tables t on t.id = o.table_id
  where r.slug = p_slug
    and r.is_active
    and o.code = p_code
    and p_token is not null
    and o.guest_token = p_token
  limit 1;
$$;

revoke all on function public.get_public_order(text, text, uuid) from public;
revoke all on function public.get_public_order(text, text, uuid) from anon;
revoke all on function public.get_public_order(text, text, uuid) from authenticated;
grant execute on function public.get_public_order(text, text, uuid) to anon;
grant execute on function public.get_public_order(text, text, uuid) to authenticated;

-- ============================================================================
-- Cancelling
--
-- One function, two ways in: the guest with their token, or any signed-in
-- member of the restaurant. The rules differ on purpose -- a guest can only
-- cancel before the kitchen starts, within ten minutes; staff can cancel
-- anything that has not been served and has not been paid for.
--
-- A PAID order is refused for everyone. The money has been taken; undoing it
-- is a refund, and this build has no refund path. Refusing loudly is the
-- honest behaviour -- silently marking a paid bill cancelled leaves the till
-- short by the amount of the order, and nobody notices until the day is
-- cashed up.
-- ============================================================================

create or replace function public.cancel_order(
  p_order_id uuid,
  p_guest_token uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_guest_window constant interval := interval '10 minutes';
  v_order public.orders%rowtype;
  v_staff boolean := false;
  v_reason text;
begin
  if p_order_id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id;

  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;

  -- Who is asking. This comes first because it decides whether the caller is
  -- even allowed to know this order exists.
  if p_guest_token is not null then
    -- Wrong token and no such order give the same answer: never confirm which.
    if v_order.guest_token is distinct from p_guest_token then
      raise exception 'That order could not be found.' using errcode = 'P0001';
    end if;
  else
    select exists (
      select 1
        from public.memberships m
       where m.restaurant_id = v_order.restaurant_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'manager', 'cashier', 'kitchen')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to cancel this order.' using errcode = 'P0001';
    end if;
  end if;

  -- Cancelling twice is not an error: two people can press the same button,
  -- and the second press should not raise "the kitchen has started" over a
  -- state that is already cancelled. This check has to come before the
  -- guests' "only while new" rule, or the second press of a button tells the
  -- guest something that is not true.
  if v_order.prep_status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'already', true);
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. A refund has to be handled at the counter.'
      using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'served' then
    raise exception 'This order has already been served.' using errcode = 'P0001';
  end if;

  -- A guest may only cancel before the kitchen starts, and only for ten
  -- minutes. Staff have no such limit: they are standing next to the guest.
  if p_guest_token is not null then
    if v_order.prep_status <> 'new' then
      raise exception 'The kitchen has already started this order. Please ask the staff.'
        using errcode = 'P0001';
    end if;

    if v_order.placed_at < statement_timestamp() - k_guest_window then
      raise exception 'This order is more than ten minutes old. Please ask the staff to cancel it.'
        using errcode = 'P0001';
    end if;
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    v_reason := case when p_guest_token is not null then 'guest' else 'staff' end;
  end if;

  update public.orders
     set prep_status = 'cancelled',
         cancel_reason = left(v_reason, 120),
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('status', 'cancelled', 'already', false);
end;
$$;

revoke all on function public.cancel_order(uuid, uuid, text) from public;
revoke all on function public.cancel_order(uuid, uuid, text) from anon;
revoke all on function public.cancel_order(uuid, uuid, text) from authenticated;
grant execute on function public.cancel_order(uuid, uuid, text) to anon;
grant execute on function public.cancel_order(uuid, uuid, text) to authenticated;

-- ============================================================================
-- Changing quantities on a ticket the kitchen has not started
--
-- Pure arithmetic on the snapshots the order already holds: qty x the unit
-- price that was charged when the order was placed. No menu is read, so a
-- price cannot be injected and a dish cannot be swapped. Removing every line
-- is refused -- that is a cancel, and it should be recorded as one.
-- ============================================================================

create or replace function public.set_order_line_quantities(
  p_order_id uuid,
  p_lines jsonb,
  p_guest_token uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_staff boolean := false;
  v_rate int;
  v_taxable bigint;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_lines_left int := 0;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;

  if p_guest_token is not null then
    if v_order.guest_token is distinct from p_guest_token then
      raise exception 'That order could not be found.' using errcode = 'P0001';
    end if;
  else
    select exists (
      select 1
        from public.memberships m
       where m.restaurant_id = v_order.restaurant_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'manager', 'cashier', 'kitchen')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to change this order.' using errcode = 'P0001';
    end if;
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order has been cancelled.' using errcode = 'P0001';
  end if;

  if v_order.prep_status <> 'new' then
    raise exception 'The kitchen has already started this order. Please ask the staff to change it.'
      using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. Ask the counter to change it.'
      using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  with wanted as (
    select (entry->>'line_id')::uuid as line_id,
           greatest(0, least(99, coalesce((entry->>'qty')::int, 0))) as qty
      from jsonb_array_elements(p_lines) as entry
     where (entry->>'line_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  )
  update public.order_items i
     set qty = w.qty
    from wanted w
   where i.id = w.line_id
     and i.order_id = v_order.id;

  -- A line taken to zero is removed, not kept at zero: a ticket that says
  -- "0 Butter Naan" is a ticket somebody has to read twice.
  delete from public.order_items i
   where i.order_id = v_order.id
     and i.qty <= 0;

  select count(*), coalesce(sum(unit_price_paise * qty), 0)
    into v_lines_left, v_subtotal
    from public.order_items
   where order_id = v_order.id;

  if v_lines_left = 0 then
    raise exception 'An order needs at least one dish. Cancel it instead.' using errcode = 'P0001';
  end if;

  -- The rate this order was priced at, falling back to the restaurant's
  -- current rate only for orders placed before the snapshot column existed.
  v_rate := coalesce(
    v_order.tax_rate_bps_snapshot,
    (select r.tax_rate_bps from public.restaurants r where r.id = v_order.restaurant_id),
    0
  );

  v_taxable := greatest(v_subtotal - v_order.discount_paise, 0);
  v_tax := round(v_taxable::numeric * v_rate / 10000.0)::bigint;
  v_total := v_taxable + v_tax;

  update public.orders
     set subtotal_paise = v_subtotal,
         tax_paise = v_tax,
         total_paise = v_total,
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'tax_paise', v_tax,
    'total_paise', v_total,
    'lines', v_lines_left
  );
end;
$$;

revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from public;
revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from anon;
revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from authenticated;
grant execute on function public.set_order_line_quantities(uuid, jsonb, uuid) to anon;
grant execute on function public.set_order_line_quantities(uuid, jsonb, uuid) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261021000600_cancel_and_change_order.sql','37cb01be25ae18fd368624d646c13ef7bbe4794d220d46105682a8804aec2280');

-- SOURCE 20261022000700_multi_outlet.sql SHA256 eb057bc4798278438d337fdacc74b8e9bbca78485ad4f6dbd84906dce0c5d6ab
-- ============================================================================
-- A second outlet on the same account
--
-- WHAT WAS MISSING
--
-- `memberships` has always been a join table, so one account belonging to
-- several restaurants was never a schema problem. The application was the
-- problem: every staff screen resolved "my restaurant" with `.limit(1)`, so
-- the second outlet could not be reached at all. The switcher (lib/outlets.ts,
-- lib/db/staff.ts) fixes the reading half.
--
-- Creating an outlet is the other half, and it cannot be an INSERT from the
-- dashboard: there is deliberately no INSERT policy on public.restaurants, so
-- an authenticated user cannot spin up workspaces in a loop. This function is
-- the single controlled path. SECURITY DEFINER, so it can write the three rows
-- that make a usable outlet -- restaurant, owner membership, starter menu --
-- in one transaction, and no half-created outlet is left behind if any of
-- them fails.
--
-- WHAT IT REFUSES
--
--   name_invalid    shorter than 2 or longer than 80 characters after trim
--   slug_invalid    not lowercase-hyphenated, or longer than 60
--   slug_taken      the address is already somebody's
--   outlet_limit    the caller already owns five restaurants
--   unauthenticated no session
--
-- The limit is here, not in the server action, because the action is not the
-- only way to call a function. Five is not a licensing rule: creating a
-- restaurant starts a fresh ten-day trial, so an uncapped "add outlet" button
-- is an uncapped free trial.
--
-- The new outlet starts at a 0% tax rate rather than inheriting the current
-- one. GST follows the state the outlet is in, and copying a rate across a
-- state line is a wrong bill, not a convenience.
-- ============================================================================

create or replace function public.create_outlet(
  p_name text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user  uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_slug  text := lower(btrim(coalesce(p_slug, '')));
  v_owned integer;
  v_id    uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'name_invalid';
  end if;

  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60 then
    raise exception 'slug_invalid';
  end if;

  select count(*) into v_owned
  from public.memberships
  where user_id = v_user
    and role = 'owner';

  if v_owned >= 5 then
    raise exception 'outlet_limit';
  end if;

  if exists (select 1 from public.restaurants where slug = v_slug) then
    raise exception 'slug_taken';
  end if;

  insert into public.restaurants (slug, name)
  values (v_slug, v_name)
  returning id into v_id;

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_user, 'owner');

  -- A published empty menu, because the menu editor and the guest page both
  -- need one to exist before the owner can add a category to it.
  insert into public.menus (restaurant_id, name, is_published)
  values (v_id, 'Main menu', true);

  return v_id;
end;
$$;

-- A policy is not a permission: the table grant is separate from the function
-- grant, and this project has been bitten by that before (see 00500).
revoke all on function public.create_outlet(text, text) from public;
revoke all on function public.create_outlet(text, text) from anon;
revoke all on function public.create_outlet(text, text) from authenticated;
grant execute on function public.create_outlet(text, text) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261022000700_multi_outlet.sql','eb057bc4798278438d337fdacc74b8e9bbca78485ad4f6dbd84906dce0c5d6ab');

-- SOURCE 20261022000800_online_payments.sql SHA256 f247d246f8a48f3e9c98dbd684314db15a4a4d4ba0670ff274697ed593c68bc7
-- ============================================================================
-- AutoDine — migration 20261022000800: take money online
--
-- WHY THIS EXISTS
--
-- Until now the payments table allowed method 'online', and nothing could
-- write it. Migration 0004 says so in its own header: a counter payment is
-- money a cashier watched arrive, an online payment is money a provider took
-- and told us about afterwards. Those are different paths and the second one
-- did not exist. A guest could place an order and then had to walk to the
-- counter.
--
-- THE ONE RULE THIS FILE IS BUILT AROUND
--
-- The only thing that may mark an order paid online is a verified payment
-- event from the provider: either the browser's checkout callback (signature
-- checked with the key secret) or the provider's webhook (signature checked
-- with the webhook secret). Neither the browser, nor a signed-out guest, nor
-- a signed-in cashier can reach these functions. They are granted to
-- service_role ONLY -- the role the server uses -- and every one of them
-- re-reads the amount from public.orders rather than believing a caller.
--
-- WHY A PENDING ROW BEFORE THE GUEST PAYS
--
-- The provider's own order id has to be mapped back to ours. If the browser
-- closes mid-payment, the webhook still arrives with that id, and there must
-- be a row that says which of our orders it belongs to. So:
--
--   begin_online_payment()   provider order created -> pending row, provider_ref
--   settle_online_payment()  payment captured       -> same row 'recorded'
--
-- A pending row is not money. Every total in the product sums status
-- 'recorded' only. An attempt that was abandoned stays visible as an attempt,
-- which is more honest than deleting it.
--
-- ON THE PER-RESTAURANT SWITCH
--
-- Online payments are OFF for every restaurant until its owner turns them on
-- in Settings. Somebody has to connect a merchant account and decide to take
-- card money; a product that starts accepting it because a deployment
-- acquired an API key would be taking a decision that is not its own. Both
-- the read and the write below check the switch.
-- ============================================================================

alter table public.restaurants
  add column if not exists online_payments_enabled boolean not null default false;

comment on column public.restaurants.online_payments_enabled is
  'Owner switched online (gateway) payments on for this outlet; false means pay at the counter.';

-- The provider's payment id, as distinct from its order id. Both are needed
-- for reconciliation: one identifies the attempt, the other the money.
alter table public.payments
  add column if not exists provider_payment_ref text;

create index if not exists payments_provider_ref_idx
  on public.payments(provider, provider_ref);

comment on column public.payments.provider_ref is
  'The provider''s id for the attempt (e.g. Razorpay order_...). Present while pending.';
comment on column public.payments.provider_payment_ref is
  'The provider''s id for the money (e.g. Razorpay pay_...). Written only on settlement.';

-- ============================================================================
-- What does this guest owe, and can they pay it online?
--
-- The guest credential is the order token, exactly as get_public_order()
-- uses it. No token, no answer: an order id alone is not a permission.
-- ============================================================================

create or replace function public.public_online_due(
  p_slug  text,
  p_code  text,
  p_token uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_enabled boolean;
  v_name    text;
  v_paid    bigint := 0;
begin
  if p_token is null or p_token = '00000000-0000-0000-0000-000000000000'::uuid then
    return null;
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.code = p_code
     and o.guest_token = p_token
     and r.slug = p_slug
     and r.is_active;

  if not found then
    return null;
  end if;

  select coalesce(r.online_payments_enabled, false), r.name
    into v_enabled, v_name
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  return jsonb_build_object(
    'order_id',      v_order.id,
    'code',          v_order.code,
    'restaurant_name', v_name,
    'enabled',       coalesce(v_enabled, false),
    'payment_status', v_order.payment_status,
    'prep_status',   v_order.prep_status,
    'total_paise',   v_order.total_paise,
    'due_paise',     greatest(v_order.total_paise - v_paid, 0)
  );
end;
$$;

-- ============================================================================
-- Record the attempt, after the provider has created its order.
--
-- Called by the server straight after the provider returns an id. The amount
-- must equal the outstanding balance, computed here: a provider order created
-- for a stale amount cannot be attached to the order it was made for.
-- ============================================================================

create or replace function public.begin_online_payment(
  p_provider            text,
  p_provider_order_ref  text,
  p_slug                text,
  p_order_id            uuid,
  p_guest_token         uuid,
  p_amount_paise        bigint
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_enabled boolean;
  v_paid    bigint := 0;
  v_due     bigint := 0;
  v_key     text;
  v_row     public.payments%rowtype;
  v_id      uuid;
begin
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'No payment provider was named.' using errcode = '22023';
  end if;

  if p_provider_order_ref is null or btrim(p_provider_order_ref) = '' then
    raise exception 'The provider did not return an order id.' using errcode = '22023';
  end if;

  if p_guest_token is null then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  -- Lock first, then prove the credential. Two statements on purpose: the
  -- lock has to be taken before the balance is computed, and it is taken on
  -- the row the token resolves to, so a wrong token locks nothing it should
  -- not.
  select o.id into v_order.id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id
     and o.guest_token = p_guest_token
     and r.slug = p_slug
     and r.is_active
   for update of o;

  if v_order.id is null then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id
     and o.guest_token = p_guest_token
     and r.slug = p_slug
     and r.is_active;

  if not found then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select coalesce(r.online_payments_enabled, false)
    into v_enabled
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  if not coalesce(v_enabled, false) then
    raise exception 'Online payment is not switched on for this restaurant.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is not taking payments right now.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order was cancelled.' using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order is already settled.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  v_due := greatest(v_order.total_paise - v_paid, 0);

  if v_due <= 0 then
    raise exception 'This order has no outstanding balance.' using errcode = 'P0001';
  end if;

  if p_amount_paise is null or p_amount_paise <> v_due then
    raise exception 'The amount offered does not match what this order owes.'
      using errcode = 'P0001';
  end if;

  -- Idempotent on the provider's order id: a retried request attaches to the
  -- attempt already recorded instead of creating a second one.
  v_key := 'online-intent:' || p_provider || ':' || p_provider_order_ref;

  select * into v_row from public.payments p where p.idempotency_key = v_key;
  if found then
    if v_row.order_id <> v_order.id or v_row.amount_paise <> v_due then
      raise exception 'That payment attempt belongs to a different order.'
        using errcode = 'P0001';
    end if;
    return v_row.id;
  end if;

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, provider_ref, idempotency_key
  ) values (
    v_order.id, v_order.restaurant_id, 'online', v_due, 'pending',
    p_provider, p_provider_order_ref, v_key
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ============================================================================
-- Settle: the money is real. Called by the verify route AND the webhook.
--
-- Idempotent on the provider's order id, because both will usually fire for
-- the same payment -- the browser callback when the guest returns, the webhook
-- a second later. Whichever arrives first settles; the second returns the
-- same payment row and writes nothing.
-- ============================================================================

create or replace function public.settle_online_payment(
  p_provider              text,
  p_provider_order_ref    text,
  p_provider_payment_ref  text,
  p_amount_paise          bigint default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.payments%rowtype;
  v_order public.orders%rowtype;
begin
  if p_provider is null or p_provider_order_ref is null or p_provider_payment_ref is null then
    raise exception 'A provider order and payment id are both required.' using errcode = '22023';
  end if;

  select * into v_row
    from public.payments p
   where p.provider = p_provider
     and p.provider_ref = p_provider_order_ref
   for update;

  if not found then
    -- Money we cannot account for is not something to guess at. The provider
    -- will retry the webhook; the server log says what arrived.
    raise exception 'No payment attempt matches that reference.' using errcode = 'P0002';
  end if;

  if v_row.status = 'recorded' then
    return v_row.id;
  end if;

  if v_row.status = 'refunded' then
    raise exception 'That payment was refunded.' using errcode = 'P0001';
  end if;

  -- The webhook states the amount and is held to it. The browser callback does
  -- not carry one, and a null means "the attempt's own amount" -- which was
  -- computed from public.orders when the attempt began, not by the caller.
  if p_amount_paise is not null and p_amount_paise <> v_row.amount_paise then
    raise exception 'The settled amount does not match the attempt (expected %, got %).',
      v_row.amount_paise, p_amount_paise
      using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'recorded',
         provider_payment_ref = p_provider_payment_ref
   where id = v_row.id;

  update public.orders
     set payment_status = 'paid',
         updated_at = statement_timestamp()
   where id = v_row.order_id
     and payment_status <> 'paid';

  select * into v_order from public.orders o where o.id = v_row.order_id;

  -- The same audit table counter payments write to, with its own event type,
  -- so "how was this order paid" is answerable for both paths.
  insert into public.payment_audit_events (
    restaurant_id, order_id, payment_id, actor_id,
    event_type, method, amount_paise
  ) values (
    v_row.restaurant_id, v_row.order_id, v_row.id, null,
    'online_collected', 'online', v_row.amount_paise
  );

  return v_row.id;
end;
$$;

comment on function public.settle_online_payment(text, text, text, bigint) is
  'Mark a verified online payment as recorded and settle its order. Idempotent '
  'on the provider order id; safe for the browser callback and the webhook to '
  'call for the same payment. service_role only.';

-- ============================================================================
-- Grants
--
-- All three are service_role only. The browser reaches them through server
-- routes that verify signatures first; a guest reaching settle_online_payment
-- directly would be a guest marking their own order paid.
--
-- 'from anon' and 'from authenticated' are listed explicitly: Supabase grants
-- EXECUTE on new functions in public to those roles automatically, so
-- revoking from PUBLIC alone leaves them executable. That mistake was found
-- the hard way on record_counter_payment.
-- ============================================================================

revoke all on function public.public_online_due(text, text, uuid) from public;
revoke all on function public.public_online_due(text, text, uuid) from anon;
revoke all on function public.public_online_due(text, text, uuid) from authenticated;
grant execute on function public.public_online_due(text, text, uuid) to service_role;

revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from public;
revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from anon;
revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from authenticated;
grant execute on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) to service_role;

revoke all on function public.settle_online_payment(text, text, text, bigint) from public;
revoke all on function public.settle_online_payment(text, text, text, bigint) from anon;
revoke all on function public.settle_online_payment(text, text, text, bigint) from authenticated;
grant execute on function public.settle_online_payment(text, text, text, bigint) to service_role;

-- ============================================================================
-- Switching it on is an ordinary UPDATE on public.restaurants.
--
-- No function is needed: the restaurants_update policy from migration 00500
-- already allows owner and manager, and only for a restaurant they belong to.
-- Adding a SECURITY DEFINER function here would have had to re-derive "which
-- restaurant" from the membership row, and the dashboard already knows that
-- from the outlet cookie -- the exact duplication that sent menu writes to the
-- wrong outlet in PR #41.
-- ============================================================================

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261022000800_online_payments.sql','f247d246f8a48f3e9c98dbd684314db15a4a4d4ba0670ff274697ed593c68bc7');

-- SOURCE 20261023000900_table_verification_code.sql SHA256 c0b4d7300c2e335922faea31456bfe96ca27b1bd6c6ba5e1367b33ed62c7896e
-- ============================================================================
-- AutoDine — migration 20261023000900: a table QR alone must not open the menu
--
-- WHY THIS EXISTS
--
-- Until now, scanning a table QR was the whole check. /t/<token> exchanged the
-- token for a one-hour table session immediately, so a photograph of a card
-- taken last week -- or forwarded on WhatsApp -- opened the ordering menu from
-- anywhere in the world. The card proves the bearer has SEEN the table, not
-- that they are sitting at it.
--
-- This migration adds the thing the card cannot carry: a short code that
-- changes every few minutes and is shown on a screen inside the restaurant.
-- The scan now proves "you have the table's card"; the code proves "somebody
-- in this room, right now, can read the board".
--
-- WHAT IS ADDED
--
--   restaurant_verification_codes   one secret per restaurant, from which the
--                                   current code is derived (never stored in
--                                   the clear, never written in a log).
--   public_qr_intro()               what the verification screen may know:
--                                   restaurant and table. Creates nothing.
--   verify_table_qr_with_code()     THE ONLY WAY a table session is minted.
--   current_table_session()         the read gate: does this token still name
--                                   a live session, live table, live QR, live
--                                   restaurant?
--   record_verification_failure()   counts wrong codes and rotates the secret
--                                   when somebody is guessing.
--
-- WHY THE CODE IS DERIVED AND NOT STORED
--
-- A stored plaintext code can be read by anyone who reaches the table, and a
-- stored hash cannot be displayed by the staff screen. Deriving it from a
-- per-restaurant secret and a time bucket solves both: the database holds only
-- the secret, the staff screen computes today's code from the same function
-- the verifier uses, and there is no window in which a code sits in a column
-- waiting to be read.
--
--   code(secret, window) = 6 digits of sha256(secret || ':' || window)
--
-- window = floor(epoch seconds / window_seconds), so it rolls on its own with
-- no cron, no scheduled job and no row to update. A code that was photographed
-- is dead within one window (ten minutes by default).
--
-- WHY THE CHECK MUST BE HERE AND NOT IN THE APP
--
-- verify_table_qr() was granted to anon, which means a browser could call it
-- directly through Supabase's REST API and skip the application entirely. Any
-- check written in a Next.js route would have been optional. So the old
-- function is revoked and DROPPED, and the only remaining way to mint a
-- session checks the code inside the same transaction that issues it.
--
-- BRUTE FORCE
--
-- Six digits is a million possibilities, so the defence is not the length:
--
--   * five attempts per table per address per fifteen minutes (the existing
--     qr_verification_attempts table, still cleared on success);
--   * twenty wrong codes across ALL addresses inside one window rotates the
--     secret immediately. A guesser who farms out addresses does not get more
--     guesses -- they force a rotation, which is to say they invalidate the
--     answer they were looking for.
--
-- THE LIMITATION THIS DOES NOT SOLVE
--
-- Somebody inside can read the code to somebody outside on the phone. A shared
-- code is a deterrent, not proof of presence, and no design that has to be
-- usable by a person sitting at a table can be proof. What this does buy is
-- that the leak has to be live and human, expires in minutes, and the session
-- it produced can be revoked.
--
-- STAFF SCREENS
--
-- Nothing in this migration changes how orders are taken by staff.
-- place_counter_order is untouched and does not need a table session.
--
-- APPLYING THIS
--
-- This file is additive and safe to run against the app that is currently
-- deployed: it adds functions and one required parameter check, and changes
-- nothing the old scan path calls. The old, code-less verify_table_qr() is
-- still present and still granted to anon on purpose, because the app that is
-- live on main calls it on every scan.
--
-- The second half is 20261024000900_drop_old_qr_scan.sql, which revokes and
-- drops it. That one goes on AFTER the build using
-- verify_table_qr_with_code is live. Section 8 explains the ordering.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The secret behind each restaurant's rotating code
-- ----------------------------------------------------------------------------

create table if not exists public.restaurant_verification_codes (
  restaurant_id             uuid primary key references public.restaurants(id) on delete cascade,
  -- 64 hex characters. The code itself is derived from this; it is never the
  -- code, and it never leaves the database.
  secret                    text not null check (secret ~ '^[0-9a-f]{64}$'),
  -- Ten minutes: long enough to walk to a table and type six digits, short
  -- enough that a screenshot forwarded to a friend is usually dead on arrival.
  window_seconds            integer not null default 600
                            check (window_seconds between 120 and 3600),
  rotated_at                timestamptz not null default statement_timestamp(),
  rotated_reason            text,
  -- Wrong codes seen in the CURRENT window, across every address.
  failure_window_started_at timestamptz,
  failure_count             integer not null default 0 check (failure_count >= 0),
  -- Guessing forces a rotation rather than a lockout: a lockout would let one
  -- person with a script stop every guest in the restaurant from ordering.
  max_failures              integer not null default 20
                            check (max_failures between 5 and 1000)
);

comment on table public.restaurant_verification_codes is
  'Per-restaurant secret behind the on-site verification code; read and written only through SECURITY DEFINER functions.';

alter table public.restaurant_verification_codes enable row level security;

-- Supabase grants table privileges to anon/authenticated by default in some
-- projects. Nothing but the functions below should ever touch this table.
revoke all on public.restaurant_verification_codes from anon;
revoke all on public.restaurant_verification_codes from authenticated;

-- ----------------------------------------------------------------------------
-- 2. The derivation
--
-- Pure and immutable so the staff screen and the verifier cannot disagree: one
-- function, one answer.
--
-- sha256(bytea) is a built-in here; pgcrypto is not on this instance and
-- gen_random_bytes() with it. The first eight hex characters of the digest are
-- read as a 32-bit integer, the sign bit cleared, and the result taken modulo a
-- million -- so the six digits are uniformly distributed and, crucially, cannot
-- be worked out from a window number alone without the secret.
-- ----------------------------------------------------------------------------

create or replace function public.verification_code_for(p_secret text, p_window bigint)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lpad(
    (
      (
        ('x' || substr(encode(sha256((p_secret || ':' || p_window::text)::bytea), 'hex'), 1, 8)
        )::bit(32)::int
        & 2147483647
      ) % 1000000
    )::text,
    6,
    '0'
  );
$$;

comment on function public.verification_code_for(text, bigint) is
  'Six-digit on-site code for one time window. Derived from the restaurant '
  'secret; the same call is used by the staff screen and the verifier.';

-- A fresh secret. Two UUIDs, because gen_random_bytes() is not available on
-- this instance and gen_random_uuid() is.
create or replace function public.new_verification_secret()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text)::bytea), 'hex');
$$;

-- Every restaurant that already exists gets a secret now.
--
-- Without this, the first guest to scan after this deployment would be told
-- the restaurant "has not set up on-site verification" and every table in
-- every venue would be dead until an owner happened to open the Tables screen.
-- A migration that introduces a code nobody can read is a migration that
-- closes the restaurant.
insert into public.restaurant_verification_codes (restaurant_id, secret)
select r.id, public.new_verification_secret()
  from public.restaurants r
on conflict (restaurant_id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Count a wrong code. Returns true when this failure rotated the secret.
--
-- Locked (for update) so two simultaneous wrong guesses cannot both read the
-- same count and land on seventeen instead of twenty.
-- ----------------------------------------------------------------------------

create or replace function public.record_verification_failure(p_restaurant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row            public.restaurant_verification_codes%rowtype;
  v_now            timestamptz := statement_timestamp();
  v_window_start   timestamptz;
begin
  select * into v_row
    from public.restaurant_verification_codes c
   where c.restaurant_id = p_restaurant_id
   for update;

  if not found then
    -- No code has been created, so the caller's failure cannot be measured
    -- against anything. Nothing to rotate.
    return false;
  end if;

  v_window_start := to_timestamp(
    (floor(extract(epoch from v_now) / v_row.window_seconds) * v_row.window_seconds)::double precision
  );

  if v_row.failure_window_started_at is null
     or v_row.failure_window_started_at <> v_window_start then
    update public.restaurant_verification_codes
       set failure_window_started_at = v_window_start,
           failure_count = 1
     where restaurant_id = p_restaurant_id;
    return false;
  end if;

  if v_row.failure_count + 1 >= v_row.max_failures then
    update public.restaurant_verification_codes
       set secret = public.new_verification_secret(),
           failure_count = 0,
           failure_window_started_at = v_window_start,
           rotated_at = v_now,
           rotated_reason = 'too many wrong codes'
     where restaurant_id = p_restaurant_id;
    return true;
  end if;

  update public.restaurant_verification_codes
     set failure_count = failure_count + 1
   where restaurant_id = p_restaurant_id;

  return false;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Staff side: what code is showing right now, and "give me a new one"
--
-- Both are SECURITY DEFINER with an explicit membership check, because
-- SECURITY DEFINER suspends RLS and the body then becomes the only thing
-- between a caller and another restaurant's secret.
-- ----------------------------------------------------------------------------

create or replace function public.current_verification_code(p_restaurant_id uuid)
returns table (code text, expires_at timestamptz, window_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.restaurant_verification_codes%rowtype;
  v_now    timestamptz := statement_timestamp();
  v_window bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in to see the verification code.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = p_restaurant_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'cashier', 'kitchen')
  ) then
    raise exception 'You do not have access to this restaurant.' using errcode = '42501';
  end if;

  -- Create on first read. A restaurant that has never opened this screen has
  -- no secret yet, and a guest scanning before that must not be able to verify
  -- against nothing.
  insert into public.restaurant_verification_codes (restaurant_id, secret)
  values (p_restaurant_id, public.new_verification_secret())
  on conflict (restaurant_id) do nothing;

  select * into v_row
    from public.restaurant_verification_codes c
   where c.restaurant_id = p_restaurant_id;

  v_window := floor(extract(epoch from v_now) / v_row.window_seconds)::bigint;

  return query
    select
      public.verification_code_for(v_row.secret, v_window),
      to_timestamp(((v_window + 1) * v_row.window_seconds)::double precision),
      v_row.window_seconds;
end;
$$;

create or replace function public.rotate_verification_code(p_restaurant_id uuid)
returns table (code text, expires_at timestamptz, window_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.restaurant_verification_codes%rowtype;
  v_now    timestamptz := statement_timestamp();
  v_window bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change the verification code.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = p_restaurant_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager')
  ) then
    raise exception 'Only an owner or manager can change the verification code.'
      using errcode = '42501';
  end if;

  insert into public.restaurant_verification_codes (restaurant_id, secret)
  values (p_restaurant_id, public.new_verification_secret())
  on conflict (restaurant_id) do nothing;

  update public.restaurant_verification_codes
     set secret = public.new_verification_secret(),
         failure_count = 0,
         failure_window_started_at = null,
         rotated_at = v_now,
         rotated_reason = 'rotated by staff'
   where restaurant_id = p_restaurant_id
   returning * into v_row;

  v_window := floor(extract(epoch from v_now) / v_row.window_seconds)::bigint;

  return query
    select
      public.verification_code_for(v_row.secret, v_window),
      to_timestamp(((v_window + 1) * v_row.window_seconds)::double precision),
      v_row.window_seconds;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. The guest's first call: what is this card for?
--
-- Creates nothing and proves nothing. It exists so the verification screen can
-- say "Maddi, Table T3" instead of asking a guest to type a code into a page
-- that does not know where they are.
-- ----------------------------------------------------------------------------

create or replace function public.public_qr_intro(p_public_token text)
returns table (
  restaurant_slug text,
  restaurant_name text,
  table_label     text,
  window_seconds  integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_qr         public.table_qr_codes%rowtype;
  v_table      public.dining_tables%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_window     integer;
begin
  if p_public_token is null
     or btrim(p_public_token) !~ '^[A-Za-z0-9_-]{8,128}$' then
    return;
  end if;

  select q.* into v_qr
    from public.table_qr_codes q
   where q.public_token = btrim(p_public_token)
     and q.revoked_at is null;

  if not found then
    return;
  end if;

  select t.* into v_table
    from public.dining_tables t
   where t.id = v_qr.table_id
     and t.restaurant_id = v_qr.restaurant_id
     and t.is_active = true;

  if not found then
    return;
  end if;

  select r.* into v_restaurant
    from public.restaurants r
   where r.id = v_qr.restaurant_id
     and r.is_active = true;

  if not found then
    return;
  end if;

  select c.window_seconds into v_window
    from public.restaurant_verification_codes c
   where c.restaurant_id = v_restaurant.id;

  return query
    select v_restaurant.slug, v_restaurant.name, v_table.label, coalesce(v_window, 600);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. THE DOOR. A session exists only if the code was right.
--
-- This replaces verify_table_qr() (section 8 drops it). Everything the old
-- function did is still done -- rate limiting, table active, restaurant
-- active, published menu, 59-minute session, hashed token -- with one addition
-- in the middle: the code check, which cannot be skipped from outside.
--
-- WHY THIS RETURNS A STATUS INSTEAD OF RAISING
--
-- The old function raised P0001 on every guest-caused failure, and that was
-- wrong in a way that was invisible until now: an exception aborts the
-- statement, so the attempt that reserve_qr_verification_attempt() had just
-- recorded was rolled back with it. Five wrong codes were supposed to block an
-- address for fifteen minutes; in practice a failed verification left no trace
-- at all, and the limiter could never fire.
--
-- The same applies to the new per-restaurant counter: a wrong code that raises
-- cannot rotate the secret, because the rotation is undone by the raise.
--
-- So guest-caused failures are RETURNED, not raised. The row commits, the
-- attempt stands, the failure count stands, and the caller maps a closed set of
-- status words to its own sentences:
--
--   ok          a session was minted; the token is in this row
--   unreadable  not a card token at all
--   revoked     the card or the table was taken out of service
--   notserving  restaurant paused, or read-only (billing)
--   nomenu      nothing published
--   nosetup     no on-site code exists for this restaurant
--   limited     too many attempts from this address
--   wrong       the six digits did not match
--
-- Anything genuinely unexpected -- a constraint, a permission error -- still
-- raises, and the caller turns that into one fixed failure sentence.
-- ----------------------------------------------------------------------------

create or replace function public.verify_table_qr_with_code(
  p_public_token text,
  p_code         text,
  p_ip_hash      text
) returns table (
  status              text,
  session_token       text,
  restaurant_slug     text,
  table_label         text,
  expires_at          timestamptz,
  retry_after_seconds integer,
  code_rotated        boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- One hour is the schema's ceiling (table_verification_sessions carries a
  -- CHECK that a session may not outlive created_at + 1 hour); 59 leaves room
  -- for the constraint's own clock and never tests the boundary.
  k_session_minutes constant int := 59;

  -- A code is typed from a screen that may tick over while the guest is
  -- typing. The previous window stays valid for this long into the new one.
  k_grace_seconds   constant int := 60;

  v_qr         public.table_qr_codes%rowtype;
  v_table      public.dining_tables%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_code_row   public.restaurant_verification_codes%rowtype;

  v_digits     text;
  v_window     bigint;
  v_expected   text;
  v_previous   text;
  v_in_grace   boolean;
  v_rotated    boolean := false;

  v_allowed    boolean;
  v_retry      int;
  v_token      text;
  v_expires    timestamptz;
begin
  if p_public_token is null
     or btrim(p_public_token) !~ '^[A-Za-z0-9_-]{8,128}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text,
                      null::timestamptz, null::integer, false;
    return;
  end if;

  select q.* into v_qr
    from public.table_qr_codes q
   where q.public_token = btrim(p_public_token)
     and q.revoked_at is null;

  if not found then
    return query select 'revoked', null::text, null::text, null::text,
                      null::timestamptz, null::integer, false;
    return;
  end if;

  -- Before anything else is checked, so probing is not free. This write is
  -- only meaningful because this function does not raise on a wrong code --
  -- see the note above.
  -- Aliased and qualified on purpose: this function's own OUT parameters are
  -- named retry_after_seconds and status, and a bare column reference that
  -- matches both a column and a parameter is an ambiguity plpgsql rejects.
  select a.allowed, a.retry_after_seconds
    into v_allowed, v_retry
    from public.reserve_qr_verification_attempt(v_qr.id, p_ip_hash) as a;

  if not coalesce(v_allowed, false) then
    return query select 'limited', null::text, null::text, null::text,
                      null::timestamptz, v_retry, false;
    return;
  end if;

  select t.* into v_table
    from public.dining_tables t
   where t.id = v_qr.table_id
     and t.restaurant_id = v_qr.restaurant_id
     and t.is_active = true;

  if not found then
    return query select 'revoked', null::text, null::text, null::text,
                      null::timestamptz, null::integer, false;
    return;
  end if;

  select r.* into v_restaurant
    from public.restaurants r
   where r.id = v_qr.restaurant_id
     and r.is_active = true;

  if not found then
    return query select 'notserving', null::text, null::text, null::text,
                      null::timestamptz, null::integer, false;
    return;
  end if;

  if not public.restaurant_can_write(v_restaurant.id) then
    return query select 'notserving', null::text, null::text, null::text,
                      null::timestamptz, null::integer, false;
    return;
  end if;

  if not exists (
    select 1 from public.menus m
     where m.restaurant_id = v_restaurant.id and m.is_published = true
  ) then
    return query select 'nomenu', null::text, null::text, null::text,
                      null::timestamptz, null::integer, false;
    return;
  end if;

  -- ------------------------------------------------------------ the code
  select * into v_code_row
    from public.restaurant_verification_codes c
   where c.restaurant_id = v_restaurant.id;

  if not found then
    -- No code has ever been shown inside this restaurant, so nobody can
    -- verify -- and minting a session would be the same hole this migration
    -- closes. The migration backfills every existing restaurant, so this is
    -- the state of a restaurant created between the migration and its first
    -- visit to the Tables screen.
    return query select 'nosetup', null::text, null::text, null::text,
                      null::timestamptz, null::integer, false;
    return;
  end if;

  -- Digits only, so "123 456" from a phone keyboard with a space works.
  v_digits := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');

  v_window   := floor(extract(epoch from statement_timestamp()) / v_code_row.window_seconds)::bigint;
  v_expected := public.verification_code_for(v_code_row.secret, v_window);
  v_previous := public.verification_code_for(v_code_row.secret, v_window - 1);
  v_in_grace := statement_timestamp() < to_timestamp(
    (v_window * v_code_row.window_seconds + k_grace_seconds)::double precision
  );

  -- Compare digests of equal length rather than the digits themselves; the
  -- window is minutes wide, but there is no reason to hand out a comparison
  -- whose timing depends on how much of the code was right.
  if not (
    char_length(v_digits) = 6
    and (
      encode(sha256(v_digits::bytea), 'hex') = encode(sha256(v_expected::bytea), 'hex')
      or (
        v_in_grace
        and encode(sha256(v_digits::bytea), 'hex') = encode(sha256(v_previous::bytea), 'hex')
      )
    )
  ) then
    -- Counted against the restaurant as well as the address. This write only
    -- survives because we return instead of raising.
    v_rotated := public.record_verification_failure(v_restaurant.id);

    -- code_rotated tells the guest something different happened: the digits
    -- the staff are looking at have just been replaced, so "read the screen
    -- again" is exactly right and the sentence can say so.
    return query select 'wrong', null::text, null::text, null::text,
                      null::timestamptz, null::integer, v_rotated;
    return;
  end if;

  -- A correct code means the guest is in the room; start the failure count
  -- again so one busy table fumbling a digit is not a step toward rotating
  -- the board.
  update public.restaurant_verification_codes
     set failure_count = 0,
         failure_window_started_at = null
   where restaurant_id = v_restaurant.id;

  -- 64 hex characters: two UUIDv4s, 244 random bits. Stored only as a hash.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_expires := statement_timestamp() + make_interval(mins => k_session_minutes);

  insert into public.table_verification_sessions (
    token_hash, restaurant_id, table_id, qr_code_id, expires_at
  ) values (
    encode(sha256(v_token::bytea), 'hex'),
    v_restaurant.id,
    v_table.id,
    v_qr.id,
    v_expires
  );

  -- A successful verification is not something to hold against the next guest
  -- on the same address.
  perform public.clear_qr_verification_attempts(v_qr.id, p_ip_hash);

  return query select 'ok'::text, v_token, v_restaurant.slug, v_table.label,
                    v_expires, 0, false;
end;
$$;

comment on function public.verify_table_qr_with_code(text, text, text) is
  'Exchange a scanned table QR token AND the restaurant''s current on-site code for a short-lived table session. The only function that mints a session. Returns a status word rather than raising for guest-caused failures, so attempts and failure counts commit. Rate limited per code and address; twenty wrong codes across all addresses in one window rotate the secret.';

-- ----------------------------------------------------------------------------
-- 7. The read gate
--
-- Every guest page asks one question: does this cookie still name a live
-- session on a live table, from a live card, in a live restaurant? The cookie
-- itself is not trusted for any of that -- it carries only the token.
-- ----------------------------------------------------------------------------

create or replace function public.current_table_session(p_token text)
returns table (
  restaurant_id   uuid,
  restaurant_slug text,
  table_id        uuid,
  table_label     text,
  expires_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{64}$' then
    return;
  end if;

  return query
    select s.restaurant_id, r.slug, s.table_id, t.label, s.expires_at
      from public.table_verification_sessions s
      join public.restaurants r
        on r.id = s.restaurant_id and r.is_active = true
      join public.dining_tables t
        on t.id = s.table_id and t.restaurant_id = s.restaurant_id and t.is_active = true
      join public.table_qr_codes q
        on q.id = s.qr_code_id and q.revoked_at is null
     where s.token_hash = encode(sha256(p_token::bytea), 'hex')
       and s.expires_at > statement_timestamp()
       and s.revoked_at is null;
end;
$$;

comment on function public.current_table_session(text) is
  'Resolve a guest table-session token against the live database: expiry, '
  'revocation, table, card and restaurant all have to agree. Returns no row '
  'for anything that does not. The gate every guest Ordering page reads.';

-- ----------------------------------------------------------------------------
-- 8. The old door is CLOSED LATER, not here.
--
-- verify_table_qr(token, ip) mints a session with no code at all, and anon
-- holds EXECUTE on it, so a browser can still call it through the REST API.
-- It has to stay callable until this migration's partner is live, because the
-- application currently deployed on main calls it on every scan.
--
-- Dropping it in this file would mean choosing which of the two windows to
-- break: apply the migration first and scans fail until the new build is
-- promoted; promote first and scans fail until the migration is applied.
-- Neither is acceptable in a restaurant mid-service.
--
-- So this migration is ADDITIVE and safe for the running app:
--
--   * the old scan path keeps working, unchanged;
--   * the new tables and functions simply exist;
--   * place_public_order now requires a session, which the old path already
--     supplies whenever the guest has one -- the only difference is that a
--     guest whose session expired is refused instead of being given a
--     tokenless counter order, which is the change we want anyway.
--
-- The closing move is migration 20261024000900_drop_old_qr_scan.sql, applied
-- AFTER this app is live. Until then the old hole is still open: a card
-- photograph alone can still order, which is what the deploy closes.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 9. An order without a verified table is a counter order, and the guest has
--    no way to say it is one.
--
-- place_public_order is the SIGNED-OUT guest path. Staff counter orders go
-- through place_counter_order, which is authenticated and untouched -- so
-- requiring a session here cannot break the counter, the kitchen board or the
-- cashier. Without this, a guest could skip the whole flow by posting straight
-- to the RPC with a slug and a cart.
--
-- The body is the migration-00600 wrapper with one guard added at the top. The
-- pricing stays in place_public_order_core, where it has always been.
-- ----------------------------------------------------------------------------

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  if p_guest_token is not null then
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = (select r.id from public.restaurants r where r.slug = p_slug);
  end if;

  return v_code;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text, uuid) is
  'Place an order as a signed-out diner. Requires a table session token from '
  'verify_table_qr_with_code: without one this raises, so the guest path never '
  'creates an untabled order. Prices are read from the database.';

-- ----------------------------------------------------------------------------
-- 10. Grants
--
-- The three guest functions: anon keeps EXECUTE because a guest has no account.
-- The two staff functions: authenticated only. The helpers: nobody.
--
-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- automatically, so each one is revoked explicitly rather than assumed.
-- ----------------------------------------------------------------------------

revoke all on function public.verification_code_for(text, bigint) from public;
revoke all on function public.verification_code_for(text, bigint) from anon;
revoke all on function public.verification_code_for(text, bigint) from authenticated;

revoke all on function public.new_verification_secret() from public;
revoke all on function public.new_verification_secret() from anon;
revoke all on function public.new_verification_secret() from authenticated;

revoke all on function public.record_verification_failure(uuid) from public;
revoke all on function public.record_verification_failure(uuid) from anon;
revoke all on function public.record_verification_failure(uuid) from authenticated;

revoke all on function public.public_qr_intro(text) from public;
revoke all on function public.public_qr_intro(text) from anon;
revoke all on function public.public_qr_intro(text) from authenticated;
grant execute on function public.public_qr_intro(text) to anon;
grant execute on function public.public_qr_intro(text) to authenticated;

revoke all on function public.verify_table_qr_with_code(text, text, text) from public;
revoke all on function public.verify_table_qr_with_code(text, text, text) from anon;
revoke all on function public.verify_table_qr_with_code(text, text, text) from authenticated;
grant execute on function public.verify_table_qr_with_code(text, text, text) to anon;
grant execute on function public.verify_table_qr_with_code(text, text, text) to authenticated;

revoke all on function public.current_table_session(text) from public;
revoke all on function public.current_table_session(text) from anon;
revoke all on function public.current_table_session(text) from authenticated;
grant execute on function public.current_table_session(text) to anon;
grant execute on function public.current_table_session(text) to authenticated;

revoke all on function public.current_verification_code(uuid) from public;
revoke all on function public.current_verification_code(uuid) from anon;
revoke all on function public.current_verification_code(uuid) from authenticated;
grant execute on function public.current_verification_code(uuid) to authenticated;

revoke all on function public.rotate_verification_code(uuid) from public;
revoke all on function public.rotate_verification_code(uuid) from anon;
revoke all on function public.rotate_verification_code(uuid) from authenticated;
grant execute on function public.rotate_verification_code(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. The Tables screen could not read its own QR codes
--
-- table_qr_codes has RLS on and no policy, and no table privilege for
-- authenticated, so lib/db/tables-screen.ts's read was refused outright and
-- the screen that manages printed cards errored instead of rendering them.
-- Staff need their own restaurant's public tokens to reprint a card; the
-- tokens are printed on tables already, so this exposes nothing to a guest.
-- anon still gets nothing: a guest must not be able to list every table token.
-- ----------------------------------------------------------------------------

grant select on public.table_qr_codes to authenticated;

drop policy if exists table_qr_codes_staff_read on public.table_qr_codes;
create policy table_qr_codes_staff_read on public.table_qr_codes
  for select
  to authenticated
  using (restaurant_id in (select public.current_restaurant_ids()));

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261023000900_table_verification_code.sql','c0b4d7300c2e335922faea31456bfe96ca27b1bd6c6ba5e1367b33ed62c7896e');

-- SOURCE 20261024000900_drop_old_qr_scan.sql SHA256 dac223c0a1cc046bf37e5b801b25ccdf8e7405b03166c8591322d8231f295059
-- ============================================================================
-- AutoDine — migration 20261024000900: remove the code-less way in
--
-- APPLY THIS ONLY AFTER the build that uses verify_table_qr_with_code is
-- live. It is the second half of 20261023000900_table_verification_code.sql,
-- split out for one reason: the application currently deployed on main calls
-- verify_table_qr() on every scan, so dropping it in the same migration that
-- introduces its replacement guarantees a window where scanning is broken --
-- either between migration and deploy, or between deploy and migration.
--
-- THE HOLE THIS CLOSES
--
-- verify_table_qr(token, ip) took a scanned card as sufficient proof and was
-- granted to anon. Anyone holding a photograph of a card could call it through
-- the Supabase REST API with the publishable key, ignoring the application
-- entirely, and receive an hour-long table session. No amount of checking
-- inside Next.js could have prevented that: the route was optional.
--
-- Its replacement checks the six digits showing inside the restaurant inside
-- the same transaction that mints the session, so there is nothing to skip.
--
-- WHAT IS DONE HERE
--
--   * revoke every grant, including service_role, so nothing can call it by
--     accident or by habit;
--   * drop the function, so it cannot be called at all.
--
-- Sessions already issued stay valid until they expire or their card is
-- revoked. Nothing else changes: staff counter orders go through
-- place_counter_order, which this migration does not touch.
--
-- CHECK BEFORE APPLYING
--
--   select proname from pg_proc
--    where proname = 'verify_table_qr_with_code'
--      and pronamespace = 'public'::regnamespace;
--
-- One row means the replacement exists and this migration is safe to run.
-- Zero rows means 20261023000900 has not been applied yet -- run that first.
-- ============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'verify_table_qr_with_code'
  ) then
    raise exception
      'verify_table_qr_with_code is missing: apply 20261023000900_table_verification_code.sql first.';
  end if;
end;
$$;

revoke all on function public.verify_table_qr(text, text) from public;
revoke all on function public.verify_table_qr(text, text) from anon;
revoke all on function public.verify_table_qr(text, text) from authenticated;
revoke all on function public.verify_table_qr(text, text) from service_role;

drop function if exists public.verify_table_qr(text, text);

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261024000900_drop_old_qr_scan.sql','dac223c0a1cc046bf37e5b801b25ccdf8e7405b03166c8591322d8231f295059');

-- SOURCE 20261025001000_restaurant_branding.sql SHA256 e9f683dc486f13a6777f2b646f5ecdcca5a50fce94fa5188a54ee10c87b28605
-- ============================================================================
-- Branding, and the first Storage bucket this project has ever had.
--
-- WHY
--
-- The guest menu could show a restaurant's name, tagline, address and dishes,
-- and nothing else. There was no column for a logo, a banner or an accent
-- colour anywhere in the schema, and `grep storage supabase/migrations` found
-- one hit -- the word "storage" in a comment about timezones. So "each
-- restaurant has its own branding" was not a UI problem, it was a schema and
-- infrastructure problem, and this migration is both.
--
-- WHAT IS ADDED
--
--   restaurants.logo_path    {restaurant_id}/logo.<ext>
--   restaurants.banner_path  {restaurant_id}/banner.<ext>
--   restaurants.accent       one of a curated set, see lib/branding/palette.ts
--   restaurants.updated_at   when branding last changed
--   items.image_url          ALREADY EXISTED and was already read by three
--                            screens, but no UI ever wrote it. No change here;
--                            its storage policy is created below so the dish
--                            photo field can finally use it.
--
-- PATHS ARE RELATIVE, NOT URLS
--
-- The columns store the object PATH, not a signed or public URL. A URL is a
-- deployment artefact: it embeds the project ref, it expires when signed, and
-- it would have to be rewritten the day a project is migrated. A path is the
-- durable fact. `lib/storage/public-url.ts` turns it into a URL at render time.
--
-- THE BUCKET IS PUBLIC-READ, PRIVATE-WRITE
--
-- Read has to be public: a diner's phone has no session, and a signed URL per
-- dish would be an extra round trip on every menu load. Write is restricted to
-- the restaurant's own owners and managers by policy, and by the path prefix --
-- see the comment above the policies for why BOTH checks are required.
-- ============================================================================

-- ---------------------------------------------------------------- columns

alter table public.restaurants
  add column if not exists logo_path   text,
  add column if not exists banner_path text,
  add column if not exists accent      text not null default 'forest',
  add column if not exists updated_at  timestamptz not null default now();

comment on column public.restaurants.logo_path is
  'Storage object path, e.g. "<restaurant_id>/logo.png". Null means no logo, and the guest menu draws an initials tile instead.';
comment on column public.restaurants.banner_path is
  'Storage object path for the optional menu banner. Null is the normal case and is a designed state, not missing data.';
comment on column public.restaurants.accent is
  'Key into the curated palette in lib/branding/palette.ts. Not a hex value: an owner cannot pick a colour that fails contrast because there is nothing to type.';

-- The CHECK is written as a constraint so a bad key cannot get in by any path,
-- including a future SQL import. It must match ACCENT_KEYS in
-- lib/branding/palette.ts; lib/branding/palette.test.ts asserts that the two
-- lists are identical, because a mismatch would mean an owner saving a colour
-- the database silently refuses.
alter table public.restaurants
  drop constraint if exists restaurants_accent_check;

alter table public.restaurants
  add constraint restaurants_accent_check
  check (accent in ('forest', 'terracotta', 'maroon', 'indigo', 'ochre', 'slate'));

-- A path always starts with the restaurant's own id. Enforced here as well as
-- in Storage so a row can never point at another tenant's folder, even if it
-- was written by a service-role script that bypasses RLS.
alter table public.restaurants
  drop constraint if exists restaurants_branding_path_check;

alter table public.restaurants
  add constraint restaurants_branding_path_check
  check (
    (logo_path is null or logo_path like id::text || '/%')
    and (banner_path is null or banner_path like id::text || '/%')
  );

create index if not exists restaurants_updated_at_idx
  on public.restaurants (updated_at desc);

-- ---------------------------------------------------------------- the bucket

-- `public = true` is the read half. It does NOT mean anyone can write: object
-- writes are governed by the policies below, and a public bucket with no
-- policy is read-only to every client key, including the publishable one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-assets',
  'restaurant-assets',
  true,
  -- 4 MB. The largest thing we accept is a dish photo; menu-card photographs
  -- for AI extraction never land in this bucket (they are processed and
  -- discarded), so this ceiling is about logos, banners and dishes only.
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- policies
--
-- Both halves of every write policy matter, and this is the part worth reading
-- twice:
--
--   1. `bucket_id = 'restaurant-assets'` -- without it the policy would apply
--      to every bucket in the project, including any added later.
--   2. `can_manage_restaurant(<first path segment>)` -- without it ANY signed
--      in user could write to ANY path in the bucket. Storage does not consult
--      the row a path belongs to; the path IS the only tenant signal there is.
--
-- (storage.foldername(name))[1] is the first directory of the object name.
-- Cast to uuid inside a case guard so a malformed path returns false instead
-- of raising 22P02 and turning a refusal into a 500.
--
-- `can_manage_restaurant` (owner|manager, independent of billing state) is used
-- rather than `restaurant_can_write` (which also refuses once a trial lapses):
-- a workspace whose trial has expired must still be able to fix its own logo
-- and dish photos, exactly as migration 000500 argues for the restaurant row.

drop policy if exists "restaurant assets are publicly readable" on storage.objects;
create policy "restaurant assets are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'restaurant-assets');

drop policy if exists "managers upload their own restaurant assets" on storage.objects;
create policy "managers upload their own restaurant assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'restaurant-assets'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers replace their own restaurant assets" on storage.objects;
create policy "managers replace their own restaurant assets"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  )
  with check (
    bucket_id = 'restaurant-assets'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers delete their own restaurant assets" on storage.objects;
create policy "managers delete their own restaurant assets"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- ------------------------------------------------------------------- note
--
-- This migration is UNVERIFIED against a real database. The sandbox has no
-- Postgres, and scripts/check-sql.mjs cannot parse CREATE POLICY, so
-- `npm run sql:check` proves only that the ALTER TABLE statements parse.
--
-- Before this touches a shared project, run it once against a throwaway
-- Supabase project and confirm, as an owner of tenant A:
--   * upload to  A/logo.png     -> allowed
--   * upload to  B/logo.png     -> refused (42501 / RLS)
--   * delete     B/logo.png     -> refused
--   * upload to  ../escape.png  -> refused (no uuid in the first segment)
--   * anon GET   A/logo.png     -> 200, because the bucket is public-read

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261025001000_restaurant_branding.sql','e9f683dc486f13a6777f2b646f5ecdcca5a50fce94fa5188a54ee10c87b28605');

-- SOURCE 20261026001100_trial_plans_and_write_gate.sql SHA256 03620cb6b0189962f6d49abc320dc39517c9ab7ec721b56a18841087d9f71eef
-- ============================================================================
-- AutoDine — migration 20261026001100: the trial clock, and the gate that reads
-- it.
--
-- THREE THINGS, AND ONE OF THEM IS A BUG FIX
--
-- 1. `public.restaurant_can_write(uuid)` is called by eleven functions in this
--    repository (place_public_order, place_order, place_counter_order,
--    record_counter_payment, verify_table_qr, ensure_table_qr_code,
--    begin_online_payment, set_order_line_quantities, ...) and by the kitchen
--    board in lib/db/kitchen-screen.ts. It was NEVER DEFINED in any migration
--    in this repository. A fresh database created from these migrations applies
--    cleanly — plpgsql only resolves function calls when they run — and then
--    every one of those paths fails with
--    `function public.restaurant_can_write(uuid) does not exist`.
--
--    The deployment's database has a version of it. The repository does not,
--    which means the repository cannot rebuild the deployment. This migration
--    creates it, so the schema in git is the schema in production.
--
--    `has_restaurant_role(uuid, text[])` had the same problem: the app's code
--    comments describe order policies that call it, no migration ever created
--    it, and the policies that shipped in migration 0001 do not call it either
--    (they only check membership). Both are created here and the order policies
--    are rewritten to use them — see §3.
--
-- 2. The trial becomes a real, server-side fact. Until now `lib/trial.ts`
--    computed a state nobody read: TRIAL_DAYS was imported by tests only. A
--    trial that is never checked is copy, not a policy. The start timestamp is
--    now a column, the length is SEVEN days, and every write path already calls
--    restaurant_can_write — so gating that one function gates orders, menus,
--    tables and payments.
--
-- 3. The plan a restaurant is on becomes a column rather than a paragraph on a
--    pricing page. It does not change any behaviour by itself: see the
--    entitlement migration that follows, and note that the trial carries every
--    feature, which is what the pricing page says.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * It does not charge anybody. There is no payment gateway in this
--     deployment and no plan can be bought.
--   * It does not delete anything on expiry. Read-only means writes are
--     refused and reads — menus, order history, reports — keep working. A
--     restaurant's records are not collateral for a subscription.
--   * It does not backdate trials for existing restaurants. Every existing row
--     starts its seven days when this migration runs (`default now()` on a new
--     column). Backdating would expire a working restaurant the moment the
--     migration landed.
--
-- UNVERIFIED ON A REAL DATABASE. The sandbox has no Postgres; `npm run
-- sql:check` parses only the ALTER TABLE statements. Run this against a
-- throwaway Supabase project first, and — before applying it to the shared
-- project — compare the deployment's existing function with
-- `select pg_get_functiondef('public.restaurant_can_write(uuid)'::regprocedure)`
-- so a stricter or looser definition there is not silently replaced.
-- ============================================================================

-- ------------------------------------------------------------ restaurants
alter table public.restaurants
  add column if not exists trial_started_at timestamptz not null default now(),
  add column if not exists plan text not null default 'trial',
  add column if not exists plan_status text not null default 'trialing',
  add column if not exists plan_started_at timestamptz,
  add column if not exists plan_expires_at timestamptz;

-- Constraints by name. Dropped and re-added rather than wrapped in a DO block:
-- the same result, one statement each, and `npm run sql:check` can still parse
-- the file around them (a DO block swallows the function that precedes it).
alter table public.restaurants drop constraint if exists restaurants_plan_check;
alter table public.restaurants
  add constraint restaurants_plan_check
  check (plan in ('trial', 'starter', 'professional', 'business'));

alter table public.restaurants drop constraint if exists restaurants_plan_status_check;
alter table public.restaurants
  add constraint restaurants_plan_status_check
  check (plan_status in ('trialing', 'active', 'expired', 'cancelled'));

comment on column public.restaurants.trial_started_at is
  'When the seven-day trial began. Written once, at row creation, and never moved by a client.';
comment on column public.restaurants.plan is
  'trial until a plan is bought. No plan is purchasable in this deployment.';
comment on column public.restaurants.plan_status is
  'trialing | active | expired | cancelled. Read by restaurant_can_write().';
comment on column public.restaurants.plan_expires_at is
  'End of a paid period. Null means no paid period has ever been set.';

-- ---------------------------------------------------------------------------
-- The trial start cannot be moved by the browser.
--
-- The owner is allowed to UPDATE its own restaurants row (Settings: name,
-- tax rate, address). Those writes arrive with the signed-in user's token, so
-- a column-level rule cannot tell "renaming the restaurant" from "restarting
-- the trial" — but this trigger can, because it sees the old row. A write that
-- arrives with a JWT (auth.uid() is not null) keeps the plan columns as they
-- were. Server-side code — the service role used by signup and, later, by a
-- billing webhook — arrives with auth.uid() null and may change them.
--
-- This is belt to RLS's braces: there is no billing UI to abuse yet, and this
-- keeps it that way when there is one.
-- ---------------------------------------------------------------------------
create or replace function public.protect_restaurant_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  new.trial_started_at := old.trial_started_at;
  new.plan             := old.plan;
  new.plan_status      := old.plan_status;
  new.plan_started_at  := old.plan_started_at;
  new.plan_expires_at  := old.plan_expires_at;
  return new;
end;
$$;

drop trigger if exists restaurants_plan_guard on public.restaurants;
create trigger restaurants_plan_guard
  before update on public.restaurants
  for each row execute function public.protect_restaurant_plan();

-- ---------------------------------------------------------------------------
-- The trial clock, in one place.
--
-- Read from restaurants.trial_started_at, compared against the DATABASE's
-- now(). The browser's clock is never consulted for this and neither is the
-- application server's: a laptop with the wrong date must not decide whether a
-- restaurant can take orders.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_trial_ends_at(p_restaurant_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select r.trial_started_at + interval '7 days'
    from public.restaurants r
   where r.id = p_restaurant_id;
$$;

comment on function public.restaurant_trial_ends_at(uuid) is
  'Seven days after the row was created. Null for a restaurant that does not exist.';

-- ---------------------------------------------------------------------------
-- Who may act, and on what.
-- ---------------------------------------------------------------------------
create or replace function public.has_restaurant_role(
  p_restaurant_id uuid,
  p_roles text[]
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.memberships m
     where m.restaurant_id = p_restaurant_id
       and m.user_id = auth.uid()
       and m.role::text = any (p_roles)
  );
$$;

comment on function public.has_restaurant_role(uuid, text[]) is
  'True when the signed-in user holds one of the given roles at this restaurant. Anon is always false.';

-- ---------------------------------------------------------------------------
-- THE GATE.
--
-- Every order, menu, table and payment write in the product goes through this
-- function (directly in SQL, or in an RLS policy). Its whole meaning is:
--
--   the restaurant is open for business
--   AND either a paid plan is current, or the seven-day trial has not ended.
--
-- A paid plan with plan_expires_at null is treated as current: that is what a
-- plan looks like before a billing provider is connected, and refusing it
-- would lock the very accounts this migration is meant to leave alone.
--
-- The interval is written here AND in restaurant_trial_ends_at. They must
-- agree; they are compared against each other in the app's tests by reading
-- the trial length from lib/trial.ts, which is 7.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_can_write(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select r.is_active
       and case
             when r.plan in ('starter', 'professional', 'business')
               then coalesce(r.plan_expires_at, 'infinity'::timestamptz) > now()
             else r.trial_started_at + interval '7 days' > now()
           end
      from public.restaurants r
     where r.id = p_restaurant_id
  ), false);
$$;

comment on function public.restaurant_can_write(uuid) is
  'The write gate: restaurant active, and a current paid period or a running seven-day trial. False for unknown ids.';

-- One jsonb for the app to render the plan line in the dashboard and Settings:
-- no second source of truth for "how long is left".
create or replace function public.restaurant_access(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan        text;
  v_status      text;
  v_started     timestamptz;
  v_expires     timestamptz;
  v_can_write   boolean;
  v_now         timestamptz := now();
begin
  select r.plan, r.plan_status, r.trial_started_at, r.plan_expires_at
    into v_plan, v_status, v_started, v_expires
    from public.restaurants r
   where r.id = p_restaurant_id;

  if not found then
    return null;
  end if;

  v_can_write := public.restaurant_can_write(p_restaurant_id);

  return jsonb_build_object(
    'plan',        v_plan,
    'status',      v_status,
    'started_at',  v_started,
    'trial_ends_at', v_started + interval '7 days',
    'plan_expires_at', v_expires,
    -- Whole days, rounded up, and never negative. The app formats the copy.
    'days_remaining',
      case
        when v_can_write and v_plan not in ('starter', 'professional', 'business')
          then greatest(
                 ceil(extract(epoch from (v_started + interval '7 days' - v_now)) / 86400.0),
                 0)::int
        else 0
      end,
    'can_write',   v_can_write,
    'read_only',   not v_can_write
  );
end;
$$;

comment on function public.restaurant_access(uuid) is
  'Plan, trial end, days remaining and the write gate for one restaurant. Null for an unknown id.';

-- ---------------------------------------------------------------------------
-- §3. Order policies, rewritten to say what the app says.
--
-- Migration 0001 let ANY member update an order row and any member insert one.
-- The application checks roles before it acts, but a check in the application
-- is a courtesy; the database is the boundary. Those two policies now require
-- the same roles the app uses, and the same write gate every function uses.
--
-- Reads are untouched: a cashier, a cook and an owner can all see the board.
-- ---------------------------------------------------------------------------
drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders
  for update
  using (
    public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen', 'cashier'])
    and public.restaurant_can_write(restaurant_id)
  )
  with check (
    public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen', 'cashier'])
  );

drop policy if exists orders_staff_insert on public.orders;
create policy orders_staff_insert on public.orders
  for insert
  with check (
    public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'kitchen', 'cashier'])
    and public.restaurant_can_write(restaurant_id)
  );

-- The kitchen board reads the gate through an RPC, so it needs EXECUTE.
-- restaurant_trial_ends_at is only read by the same screens.
grant execute on function public.restaurant_can_write(uuid) to authenticated, anon;
grant execute on function public.has_restaurant_role(uuid, text[]) to authenticated;
grant execute on function public.restaurant_trial_ends_at(uuid) to authenticated;
grant execute on function public.restaurant_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: existing rows already defaulted trial_started_at to now(). Nothing
-- to update. Recorded here so a reader does not go looking for one.
-- ---------------------------------------------------------------------------

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261026001100_trial_plans_and_write_gate.sql','03620cb6b0189962f6d49abc320dc39517c9ab7ec721b56a18841087d9f71eef');

-- SOURCE 20261026001200_plan_entitlements.sql SHA256 fca591050cb7499913138f51eb23ce9fd8215103614314920490f8e5c56c3b2f
-- ============================================================================
-- AutoDine — migration 20261026001200: what each plan actually includes.
--
-- WHY A FUNCTION AND NOT A TABLE
--
-- The plan matrix is six lines long, it changes with a deploy, and it must
-- never disagree between the pricing page, the server action that refuses a
-- request, and the database function that refuses a write. A table would need
-- a migration for every copy edit and would let the repo and the project drift
-- — which is exactly what happened to restaurant_can_write (see the previous
-- migration). Six lines of `case` in one function is the version that cannot
-- drift.
--
-- THE MATRIX, copied from lib/plans.ts (which the pricing page renders):
--
--   feature     | trial | starter | professional | business
--   ------------+-------+---------+--------------+---------
--   menus       |   ✓   |    ✓    |      ✓       |    ✓
--   qr          |   ✓   |    ✓    |      ✓       |    ✓
--   ordering    |   ✓   |    ✓    |      ✓       |    ✓
--   kitchen     |   ✓   |    ✓    |      ✓       |    ✓
--   cashier     |   ✓   |    ✓    |      ✓       |    ✓
--   reports     |   ✓   |    ✓    |      ✓       |    ✓
--   roles       |   ✓   |    —    |      ✓       |    ✓
--   import      |   ✓   |    —    |      ✓       |    ✓
--   outlets     |   ✓   |    —    |      —       |    ✓
--   support     |   ✓   |    —    |      —       |    ✓
--
-- Trial is the whole product on purpose: `lib/plans.ts` says so, the pricing
-- page says so, and a first-week restaurant that cannot import its menu is
-- not evaluating the product.
--
-- DEFAULTS ARE DENY. An unknown plan gets nothing. An unknown feature is not
-- in anybody's list. Both are the safe direction, and both are tested in
-- lib/plans.test.ts.
--
-- WHAT THIS DOES NOT DO
--
-- It does not sell anything. No plan is purchasable in this deployment; every
-- restaurant is on `trial`, so every restaurant has every feature. The gate
-- exists so that the day a plan is sold, the refusal happens on the server and
-- not in a hidden button.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The list, for one plan.
-- ---------------------------------------------------------------------------
create or replace function public.plan_features(p_plan text)
returns text[]
language sql
immutable
as $$
  select case p_plan
    when 'business' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports',
      'roles', 'import', 'outlets', 'support'
    ]
    when 'professional' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports',
      'roles', 'import'
    ]
    when 'starter' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports'
    ]
    -- A trial carries the whole product, and so does a row whose plan value
    -- this function does not recognise? No: unknown gets nothing. The trial
    -- row says 'trial' explicitly.
    when 'trial' then array[
      'menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports',
      'roles', 'import', 'outlets', 'support'
    ]
    else array[]::text[]
  end;
$$;

comment on function public.plan_features(text) is
  'The entitlement matrix. Unknown plan -> empty. Mirrors lib/plans.ts.';

-- ---------------------------------------------------------------------------
-- The list for one restaurant, as it stands right now.
--
-- An expired workspace keeps every capability it can still use read-only; what
-- it loses is the write gate, which is restaurant_can_write()'s job and not
-- this function's. A caller asking "may I import a menu" must ask both.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_features(p_restaurant_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.plan_features(coalesce(r.plan, 'starter'))
       from public.restaurants r
      where r.id = p_restaurant_id),
    array[]::text[]
  );
$$;

create or replace function public.restaurant_has_feature(
  p_restaurant_id uuid,
  p_feature text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_feature = any (public.restaurant_features(p_restaurant_id));
$$;

comment on function public.restaurant_has_feature(uuid, text) is
  'Deny-by-default entitlements check. Does NOT include the trial/expiry write gate.';

-- ---------------------------------------------------------------------------
-- One jsonb that the dashboard, Settings and the pricing-adjacent screens can
-- read: plan, trial clock, gate, features. restaurant_access() was created in
-- the previous migration; this replaces it with the feature list included, so
-- a screen needs one round trip rather than two.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_access(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan        text;
  v_status      text;
  v_started     timestamptz;
  v_expires     timestamptz;
  v_can_write   boolean;
  v_now         timestamptz := now();
begin
  select r.plan, r.plan_status, r.trial_started_at, r.plan_expires_at
    into v_plan, v_status, v_started, v_expires
    from public.restaurants r
   where r.id = p_restaurant_id;

  if not found then
    return null;
  end if;

  v_can_write := public.restaurant_can_write(p_restaurant_id);

  return jsonb_build_object(
    'plan',        v_plan,
    'status',      v_status,
    'started_at',  v_started,
    'trial_ends_at', v_started + interval '7 days',
    'plan_expires_at', v_expires,
    'days_remaining',
      case
        when v_can_write and v_plan not in ('starter', 'professional', 'business')
          then greatest(
                 ceil(extract(epoch from (v_started + interval '7 days' - v_now)) / 86400.0),
                 0)::int
        else 0
      end,
    'can_write',   v_can_write,
    'read_only',   not v_can_write,
    'features',    to_jsonb(public.restaurant_features(p_restaurant_id))
  );
end;
$$;

grant execute on function public.plan_features(text) to authenticated, anon;
grant execute on function public.restaurant_features(uuid) to authenticated;
grant execute on function public.restaurant_has_feature(uuid, text) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261026001200_plan_entitlements.sql','fca591050cb7499913138f51eb23ce9fd8215103614314920490f8e5c56c3b2f');

-- SOURCE 20261026001300_restaurant_upi.sql SHA256 ec2c9ddf2f5f3060e8c13f378caab078c462c2098cce3ff364ed4f37e3cb284d
-- ============================================================================
-- AutoDine — migration 20261026001300: the restaurant's own UPI QR.
--
-- THE PROBLEM THIS SOLVES
--
-- The gateway is off (no keys, no KYC), so a guest's only way to pay is to walk
-- to the counter. Every Indian restaurant already has a UPI ID printed on a
-- standee. Showing that standee's QR on the guest's phone, with the exact
-- amount filled in, is not a payment integration — it is a convenience — and
-- it is honest as long as nobody pretends the money was verified.
--
-- WHAT IS AND IS NOT CLAIMED
--
-- Displaying a UPI QR does not prove payment. The guest's UPI app completes the
-- transfer and tells the guest; it tells us nothing. So:
--
--   * The payee is the RESTAURANT's own UPI ID, configured by its owner. Never
--     a platform-wide account: routing one restaurant's money to another's
--     account is not a bug, it is theft.
--   * Tapping "I have paid" writes a PENDING row, not a recorded one. Pending
--     rows are excluded from every total in the product (see migration 0004 and
--     public_online_due). It is a claim a cashier can see, not money received.
--   * Only a cashier or owner recording the collection moves money to
--     'recorded' — the same path that already exists for cash.
--
-- The claim row is idempotent: one pending claim per order, enforced by a
-- unique idempotency key, so a guest tapping twice or refreshing cannot fill
-- the counter's screen with duplicates.
--
-- VALIDATION
--
-- A UPI ID looks like `name@bank`. The check below is deliberately loose — it
-- rejects spaces, `upi:` schemes and the empty string, and accepts anything
-- with one `@` and a plausible local part and handle. A stricter pattern would
-- reject real handles with dots and hyphens, and the receiving app rejects
-- truly invalid ones anyway. The QR is also only shown when the column is
-- non-empty, so a restaurant that never configured one shows no QR at all
-- instead of a broken code pointing at nothing.
--
-- UNVERIFIED ON A REAL DATABASE. See the notes in migration 20261026001100.
-- ============================================================================

-- ------------------------------------------------------------ restaurants
alter table public.restaurants
  add column if not exists upi_id text,
  add column if not exists upi_payee_name text;

-- Dropped and re-added rather than wrapped in a DO block, for the same reason
-- as the plan constraints: one statement each, and the syntax check can parse
-- everything around them.
alter table public.restaurants drop constraint if exists restaurants_upi_id_check;
alter table public.restaurants
  add constraint restaurants_upi_id_check
  check (
    upi_id is null
    or upi_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}$'
  );

comment on column public.restaurants.upi_id is
  'The restaurant''s own UPI ID for guest payments (e.g. name@okhdfcbank). Null means no UPI QR is shown.';
comment on column public.restaurants.upi_payee_name is
  'Name shown in the guest''s UPI app. Never a platform name.';

-- ---------------------------------------------------------------------------
-- What may a guest see, and only with the right credentials?
--
-- The guest token is the same credential get_public_order uses: an order code
-- alone is guessable and must never reveal a payment handle. Amount comes from
-- orders.total_paise minus recorded payments — read here, never passed in.
-- ---------------------------------------------------------------------------
create or replace function public.public_upi_details(
  p_slug  text,
  p_code  text,
  p_token uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order       public.orders%rowtype;
  v_upi_id      text;
  v_payee       text;
  v_restaurant  text;
  v_paid        bigint := 0;
  v_claim       timestamptz;
begin
  if p_token is null or p_token = '00000000-0000-0000-0000-000000000000'::uuid then
    return null;
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.code = p_code
     and o.guest_token = p_token
     and r.slug = p_slug
     and r.is_active;

  if not found then
    return null;
  end if;

  select r.upi_id, r.upi_payee_name, r.name
    into v_upi_id, v_payee, v_restaurant
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  select max(p.created_at) into v_claim
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'pending'
     and p.provider = 'upi-claim';

  return jsonb_build_object(
    'upi_id',        v_upi_id,
    'payee_name',    coalesce(nullif(btrim(v_payee), ''), v_restaurant),
    'restaurant_name', v_restaurant,
    'code',          v_order.code,
    'payment_status', v_order.payment_status,
    'due_paise',     greatest(v_order.total_paise - v_paid, 0),
    'claimed_at',    v_claim
  );
end;
$$;

comment on function public.public_upi_details(text, text, uuid) is
  'The restaurant''s own UPI details for one order, to a caller holding that order''s guest token.';

-- ---------------------------------------------------------------------------
-- "I have paid." A claim, not a receipt.
-- ---------------------------------------------------------------------------
create or replace function public.claim_upi_payment(
  p_slug  text,
  p_code  text,
  p_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_upi_id  text;
  v_paid    bigint := 0;
  v_due     bigint;
  v_key     text;
  v_existing uuid;
begin
  if p_token is null or p_token = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'This order could not be found.' using errcode = 'P0001';
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.code = p_code
     and o.guest_token = p_token
     and r.slug = p_slug
     and r.is_active;

  if not found then
    raise exception 'This order could not be found.' using errcode = 'P0001';
  end if;

  if v_order.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true);
  end if;

  select r.upi_id into v_upi_id
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  if v_upi_id is null or btrim(v_upi_id) = '' then
    raise exception 'This restaurant has not set up UPI payments.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  v_due := greatest(v_order.total_paise - v_paid, 0);

  if v_due = 0 then
    return jsonb_build_object('ok', true, 'already_paid', true);
  end if;

  v_key := 'upi-claim:' || v_order.id::text;

  select p.id into v_existing
    from public.payments p
   where p.idempotency_key = v_key;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'already_claimed', true);
  end if;

  insert into public.payments(
    order_id, restaurant_id, method, amount_paise, status, provider, idempotency_key
  ) values (
    v_order.id, v_order.restaurant_id, 'upi', v_due, 'pending', 'upi-claim', v_key
  );

  -- A claim is a fact worth showing at the counter, so the order carries it.
  -- payment_status stays 'pending': only recorded money changes that.
  update public.orders
     set payment_status = 'pending'
   where id = v_order.id
     and payment_status <> 'paid';

  return jsonb_build_object('ok', true, 'claim_recorded', true, 'due_paise', v_due);
end;
$$;

comment on function public.claim_upi_payment(text, text, uuid) is
  'Records the guest''s "I have paid" as a PENDING row (provider upi-claim). Never marks an order paid.';

-- The claim is anonymous (the guest has no login): it is reachable from the
-- guest order page, which calls it with the order token. It can only ever
-- insert a pending row for the order whose token was presented.
revoke all on function public.claim_upi_payment(text, text, uuid) from public;
grant execute on function public.claim_upi_payment(text, text, uuid) to anon, authenticated;
grant execute on function public.public_upi_details(text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The counter's view of a claim.
--
-- The queue itself is read from orders with the cashier's own session (RLS).
-- Claims are keyed by order id, so the screen can mark a ticket "guest says
-- paid by UPI" without a second interpretation of what that means.
-- ---------------------------------------------------------------------------
create or replace function public.counter_claims(p_restaurant_id uuid)
returns table (order_id uuid, claimed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.order_id, max(p.created_at) as claimed_at
    from public.payments p
   where p.restaurant_id = p_restaurant_id
     and p.status = 'pending'
     and p.provider = 'upi-claim'
     and public.has_restaurant_role(
           p_restaurant_id, array['owner', 'manager', 'cashier'])
   group by p.order_id;
$$;

comment on function public.counter_claims(uuid) is
  'Orders where the guest has claimed a UPI payment and nobody has recorded it yet.';

grant execute on function public.counter_claims(uuid) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261026001300_restaurant_upi.sql','ec2c9ddf2f5f3060e8c13f378caab078c462c2098cce3ff364ed4f37e3cb284d');

-- SOURCE 20261026001400_default_accent.sql SHA256 34294fac086c993dfd58b54ad1043348ffdd975f6034ead446d1bc3ae515e968
-- ============================================================================
-- The accent a NEW restaurant starts with.
--
-- WHY THIS EXISTS
--
-- The guest flow was redesigned around a warm cream surface with a wine-dark
-- accent (maroon). The column default was still 'forest', a green chosen for
-- the older flat-white design, so every restaurant created from here on would
-- begin in a colour the product no longer leads with -- and would look
-- different from the demo and the screenshots.
--
-- WHAT IT DOES NOT DO
--
-- It does not touch a single existing row. An owner who chose forest, or
-- terracotta, or anything else, keeps it: re-colouring somebody's restaurant
-- because the product changed its mind is not a migration, it is an edit to
-- their branding. Only the DEFAULT for future inserts moves.
--
-- Safe to run more than once. Reversible with:
--   alter table public.restaurants alter column accent set default 'forest';
-- ============================================================================

alter table public.restaurants
  alter column accent set default 'maroon';

comment on column public.restaurants.accent is
  'Guest-flow palette key (see lib/branding/palette.ts). Default maroon; the CHECK constraint lists every key this build can render.';

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261026001400_default_accent.sql','34294fac086c993dfd58b54ad1043348ffdd975f6034ead446d1bc3ae515e968');

-- SOURCE 20261026001500_place_order_addon_pricing_where.sql SHA256 d49ba92b157d846c51715ea9a2a179f5f1c336f7c79732819cd241085317ed94
-- WHY A GUEST COULD NOT PLACE AN ORDER, AND WHY IT READ "Reference 21000"
--
-- Supabase preloads the `safeupdate` extension for the `authenticator` role:
--
--   pg_db_role_setting -> authenticator ->
--     session_preload_libraries=supautils, safeupdate
--
-- Every request PostgREST makes runs as `authenticator` (then SET ROLE
-- anon / authenticated), so that library is active for the app and for nothing
-- else. It refuses any UPDATE or DELETE without a WHERE clause, and it raises
-- that refusal with SQLSTATE 21000 -- the same class Postgres uses for a
-- cardinality violation. That is why the guest saw "21000" and why reading the
-- function could not explain it: the code was right, the guard was answering.
--
-- There is exactly one WHERE-less statement in the whole public schema, and it
-- is in this function: the line that folds add-on prices into the dish price on
-- the temporary order table. It had no WHERE because it means "every line".
--
-- The fix is not to silence the guard. It is to say what the statement means:
-- only the lines that HAVE add-ons need their price raised. Same arithmetic,
-- same totals (a line without add-ons was adding zero before), a real predicate
-- now, and one pass over the temp table instead of a correlated subquery per
-- row.
--
-- Nothing else in this function changes.

create or replace function public.place_public_order_core(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null
) returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_max_addons_per_line constant int := 20;
  k_default_tax_bps constant int := 500;
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  k_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  v_session public.table_verification_sessions%rowtype;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_table_id uuid;
  v_tax_bps int;
  v_note text;
  v_line_count int;
  v_subtotal_paise bigint := 0;
  v_discount_paise bigint := 0;
  v_taxable_paise bigint := 0;
  v_tax_paise bigint := 0;
  v_total_paise bigint := 0;
  v_code text;
  v_prefix text;
  v_order_id uuid;
  v_written int := 0;
begin
  if p_session_token is not null then
    if p_session_token !~ '^[A-Fa-f0-9]{64}$' then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select s.* into v_session
      from public.table_verification_sessions s
     where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
       and s.expires_at > statement_timestamp()
       and s.revoked_at is null;

    if not found then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.table_qr_codes q
       where q.id = v_session.qr_code_id
         and q.revoked_at is null
         and q.table_id = v_session.table_id
         and q.restaurant_id = v_session.restaurant_id
    ) then
      raise exception 'Your table verification is no longer valid. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.id = v_session.restaurant_id
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
    end if;

    select t.id into v_table_id
      from public.dining_tables t
     where t.id = v_session.table_id
       and t.restaurant_id = v_restaurant_id
       and t.is_active = true;

    if v_table_id is null then
      raise exception 'This table is not taking orders right now. Please ask staff.'
        using errcode = 'P0001';
    end if;

    if p_slug is not null and btrim(p_slug) <> '' then
      if not exists (
        select 1 from public.restaurants r
         where r.id = v_restaurant_id and r.slug = btrim(p_slug)
      ) then
        raise exception 'This order is for a different restaurant. Please open the menu again.'
          using errcode = 'P0001';
      end if;
    end if;
  else
    if p_slug is null or btrim(p_slug) = '' then
      raise exception 'No restaurant was given.' using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.slug = btrim(p_slug)
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders.' using errcode = 'P0001';
    end if;

    v_table_id := null;
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from public.menus m
     where m.restaurant_id = v_restaurant_id
       and m.is_published = true
  ) then
    raise exception 'That restaurant has no published menu.' using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count = 0 then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  if v_line_count > k_max_lines then
    raise exception 'That is more than % dishes in one order.', k_max_lines
      using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > k_max_note then
    v_note := left(v_note, k_max_note);
  end if;

  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean not null,
    sort_order int not null,
    variant_id uuid,
    variant_snapshot text,
    addon_ids uuid[] not null default '{}'
  ) on commit drop;

  create temporary table if not exists tt_line_addons (
    sort_order int not null,
    pick int not null,
    name text not null,
    price_paise bigint not null
  ) on commit drop;

  truncate tt_order_lines;
  truncate tt_line_addons;

  insert into tt_order_lines (
    item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_id, variant_snapshot, addon_ids
  )
  select
    i.id,
    i.name,
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord,
    v.id,
    v.name,
    coalesce((
      select array_agg(ids.v)
        from (
          select distinct t.v
            from jsonb_array_elements_text(
                   case
                     when jsonb_typeof(line->'addon_ids') = 'array' then line->'addon_ids'
                     when jsonb_typeof(line->'addonIds') = 'array' then line->'addonIds'
                     else '[]'::jsonb
                   end
                 ) as t(v)
           where t.v ~ k_uuid_pattern
           limit k_max_addons_per_line
        ) ids
    ), '{}')::uuid[]
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
      join public.menus m
        on m.id = c.menu_id
       and m.restaurant_id = v_restaurant_id
       and m.is_published = true
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
     limit 1
  ) i on true
  left join public.item_variants v
    on v.id = nullif(coalesce(line->>'variant_id', line->>'variantId'), '')::uuid
   and v.item_id = i.id
  where jsonb_typeof(line) = 'object'
    and (line->>'qty') ~ '^[0-9]+$'
    and (line->>'qty')::int > 0;

  select count(*) into v_written from tt_order_lines;

  if v_written = 0 then
    raise exception 'None of those dishes are available right now.' using errcode = 'P0001';
  end if;

  insert into tt_line_addons (sort_order, pick, name, price_paise)
  select line_ord, pick, name, price_paise
    from (
      select l.sort_order as line_ord,
             a.name,
             a.price_paise,
             row_number() over (partition by l.sort_order, g.id order by want.ord) as pick,
             g.max_select
        from tt_order_lines l
        cross join lateral unnest(l.addon_ids) with ordinality as want(id, ord)
        join public.item_addons a
          on a.id = want.id
         and a.is_available = true
        join public.item_addon_groups g
          on g.id = a.group_id
         and g.item_id = l.item_id
    ) picked
   where pick <= max_select
   order by line_ord, pick;

  -- THE FIX. This was `update tt_order_lines ... ;` with no predicate, which
  -- safeupdate refuses. A line with no add-ons was only ever having zero added
  -- to it, so restricting the update to the lines that do have add-ons is the
  -- same arithmetic with an honest predicate.
  update tt_order_lines l
     set unit_price_paise = l.unit_price_paise + priced.sum_paise
    from (
      select x.sort_order, sum(x.price_paise)::bigint as sum_paise
        from tt_line_addons x
       group by x.sort_order
    ) priced
   where priced.sort_order = l.sort_order;

  select coalesce(sum(unit_price_paise * qty), 0)::bigint
    into v_subtotal_paise
    from tt_order_lines;

  v_tax_bps := coalesce(v_restaurant_tax_bps, k_default_tax_bps);

  v_discount_paise := 0;
  v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
  v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
  v_total_paise := v_taxable_paise + v_tax_paise;

  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant_name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  v_code := v_prefix || '-' || (
    select string_agg(
             substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1),
             ''
           )
      from generate_series(1, 5)
  );

  insert into public.orders (
    restaurant_id,
    table_id,
    code,
    customer_note,
    prep_status,
    payment_status,
    subtotal_paise,
    discount_paise,
    tax_paise,
    total_paise
  ) values (
    v_restaurant_id,
    v_table_id,
    v_code,
    v_note,
    'new',
    'pending',
    v_subtotal_paise,
    v_discount_paise,
    v_tax_paise,
    v_total_paise
  )
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'The order could not be recorded.' using errcode = 'P0001';
  end if;

  insert into public.order_items (
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot, addons_snapshot
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot,
    coalesce((
      select array_agg(x.name order by x.pick)
        from tt_line_addons x
       where x.sort_order = tt_order_lines.sort_order
    ), array[]::text[])
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

revoke all on function public.place_public_order_core(text, jsonb, text, text) from public;
revoke all on function public.place_public_order_core(text, jsonb, text, text) from anon;
revoke all on function public.place_public_order_core(text, jsonb, text, text) from authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261026001500_place_order_addon_pricing_where.sql','d49ba92b157d846c51715ea9a2a179f5f1c336f7c79732819cd241085317ed94');

-- SOURCE 20261027000900_idempotent_guest_orders.sql SHA256 f03e4b50b4ab1e196711774e900e4f395c456c34dcdc487e519a3e43a1e1a86f
-- ============================================================================
-- AutoDine — migration 20261027000900: one checkout attempt, one order
--
-- WHY THIS EXISTS
--
-- place_public_order wrote a new order on every call. The browser already
-- tries not to call it twice (the button goes busy on the first tap), but
-- that only covers a tap landing on one page: a phone re-sending a POST after
-- the connection dropped, a guest with the same cart open in two tabs, or an
-- impatient double-tap before the first response arrives all produce two
-- orders from one intention. Two tickets in the kitchen and a double bill at
-- the till for one plate of paneer.
--
-- WHAT CHANGES
--
-- orders.guest_token stops being merely a credential and becomes the identity
-- of the attempt:
--
--   * a partial unique index means two rows cannot claim one attempt;
--   * place_public_order returns the existing order's code, instead of
--     writing a second row, when it is handed a token it has already written.
--
-- WHY THE TOKEN AND NOT THE CART
--
-- Hashing the cart would make "the same two chais again" -- a completely
-- ordinary second round at a table -- look like a replay and silently drop it.
-- The attempt key belongs to one visit to the checkout page, is generated in
-- the browser, and is rotated when that page is restored from the back-forward
-- cache. See components/AttemptToken.tsx.
--
-- WHAT DOES NOT CHANGE
--
-- Without a token the function behaves exactly as before: it writes an order
-- and returns its code. Nothing about pricing, sessions, table checks or the
-- kitchen moves. A client that has not been redeployed keeps working.
--
-- APPLYING THIS
--
-- Additive and safe on the running app: a new index, and one function
-- replacement whose signature is unchanged. The app sends the attempt key
-- already; before this is applied it is simply an extra argument the function
-- stores, and the behaviour is the old one.
--
-- APPLIED
--
-- Project bdbaqpevwmgdvghszjno, 2026-10-24, before the app that sends the
-- attempt key was promoted. Verified live afterwards, in a rolled-back
-- transaction as anon: two posts with one key returned AU-G9HYN / AU-G9HYN and
-- left one order row.
-- ============================================================================

-- One row per attempt. Partial, because staff counter orders carry no token
-- and must not collide with each other.
create unique index if not exists orders_guest_token_unique
  on public.orders (guest_token)
  where guest_token is not null;

create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
begin
  -- A table session is still required, exactly as before. This guard is the
  -- one that keeps the guest path from ever writing an untabled order.
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  -- ---------------------------------------------------------------- replay
  -- The same attempt key, twice. Return the order the first call wrote: the
  -- guest sees one confirmation, the kitchen sees one ticket, and the till
  -- charges once.
  if p_guest_token is not null and v_restaurant_id is not null then
    select o.code into v_existing
      from public.orders o
     where o.guest_token = p_guest_token
       and o.restaurant_id = v_restaurant_id
     limit 1;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  if p_guest_token is not null then
    -- Scoped by restaurant as well as code: order codes are not unique across
    -- restaurants, and updating the wrong venue's order would hand a stranger
    -- the credential for somebody else's bill.
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id;
  end if;

  return v_code;

exception
  -- Two requests with the same key, genuinely at the same time: the index
  -- refused the second write. The order that exists is the one to answer
  -- with -- it is the same intention, already recorded.
  when unique_violation then
    if p_guest_token is not null then
      select o.code into v_existing
        from public.orders o
       where o.guest_token = p_guest_token
         and (v_restaurant_id is null or o.restaurant_id = v_restaurant_id)
       limit 1;

      if v_existing is not null then
        return v_existing;
      end if;
    end if;
    raise;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text, uuid) is
  'Place an order as a signed-out diner. Requires a table session token from '
  'verify_table_qr_with_code: without one this raises, so the guest path never '
  'creates an untabled order. Prices are read from the database. Idempotent on '
  'p_guest_token: a replayed attempt returns the order it already wrote.';

revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from public;
revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from anon;
revoke all on function public.place_public_order(text, jsonb, text, text, uuid) from authenticated;
-- The guest path: a diner has no account. The session token is what
-- authorises the write, and it is checked inside place_public_order_core.
grant execute on function public.place_public_order(text, jsonb, text, text, uuid) to anon;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261027000900_idempotent_guest_orders.sql','f03e4b50b4ab1e196711774e900e4f395c456c34dcdc487e519a3e43a1e1a86f');

-- SOURCE 20261028000100_renew_the_king_trial.sql SHA256 0a2d1e127b6b0d84f36b83492325527bd8a15b8e0ff5635f46668a95344d3d5d
-- ============================================================================
-- AutoDine — trial renewal for "The King" restaurant
-- ============================================================================
--
-- WHY THIS SCRIPT EXISTS
--
-- The trial clock is `restaurants.trial_started_at + interval '7 days'`,
-- compared against `now()` in the database. When the trial ends and there
-- is no subscription, `restaurant_can_write()` returns false and every
-- write path is blocked.
--
-- This script resets `trial_started_at` to `now()` for "The King",
-- starting a fresh 7-day trial from the moment it runs.
--
-- WHO MAY RUN THIS
--
-- Server-side only. The `protect_restaurant_plan()` trigger in migration
-- 20261026001100 preserves plan columns when `auth.uid()` is not null
-- (i.e. when a signed-in user writes). This script must be run with the
-- service role or directly in the Supabase SQL editor, where `auth.uid()`
-- is null.
--
-- WHAT IT DOES
--
-- Sets `trial_started_at` to `now()` for the restaurant whose name is
-- "The King". This starts a fresh 7-day trial. The plan columns
-- (plan, plan_status, plan_started_at, plan_expires_at) are untouched.
--
-- WHAT IT DOES NOT DO
--
-- It does not charge anybody. It does not change the plan. It does not
-- delete data. It only moves the trial clock forward.
--
-- USAGE
--
-- Run this in the Supabase SQL editor, or via:
--   psql "postgres://..." -f supabase/migrations/20261028000100_renew_the_king_trial.sql
--
-- VERIFY BEFORE AND AFTER
--
-- Before:
--   SELECT id, name, trial_started_at, trial_started_at + interval '7 days' AS trial_ends
--   FROM public.restaurants
--   WHERE name ILIKE 'The King';
--
-- After:
--   SELECT id, name, trial_started_at, trial_started_at + interval '7 days' AS trial_ends
--   FROM public.restaurants
--   WHERE name ILIKE 'The King';
--
-- The trial_started_at should be the current time, and trial_ends should
-- be 7 days from now.
-- ============================================================================

-- Find the restaurant by name. Use ILIKE for case-insensitive matching.
-- If "The King" is the exact name, this will match exactly one row.
DO $$
DECLARE
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_trial_started_at timestamptz;
  v_trial_ends_at timestamptz;
  v_row_count int;
BEGIN
  -- Find the restaurant
  SELECT id, name, trial_started_at
    INTO v_restaurant_id, v_restaurant_name, v_trial_started_at
    FROM public.restaurants
   WHERE name ILIKE 'The King'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'No restaurant found with name "The King". Nothing was changed.';
    RETURN;
  END IF;

  -- Check if the trial is already active (not expired)
  v_trial_ends_at := v_trial_started_at + interval '7 days';
  IF v_trial_ends_at > now() THEN
    RAISE NOTICE 'Restaurant "%" already has an active trial (ends at %). Nothing was changed.',
      v_restaurant_name, v_trial_ends_at;
    RETURN;
  END IF;

  -- Log the old state
  RAISE NOTICE 'Renewing trial for restaurant "%" (id: %). Old trial ended at %.',
    v_restaurant_name, v_restaurant_id, v_trial_ends_at;

  -- Update trial_started_at to now()
  UPDATE public.restaurants
     SET trial_started_at = now()
   WHERE id = v_restaurant_id;

  -- Get the new state
  SELECT trial_started_at INTO v_trial_started_at
    FROM public.restaurants
   WHERE id = v_restaurant_id;

  v_trial_ends_at := v_trial_started_at + interval '7 days';

  RAISE NOTICE 'Trial renewed for "%". New trial ends at % (7 days from now).',
    v_restaurant_name, v_trial_ends_at;
END $$;

-- Final verification: show the updated state
SELECT
  r.id,
  r.name,
  r.trial_started_at,
  r.trial_started_at + interval '7 days' AS trial_ends_at,
  r.plan,
  r.plan_status,
  public.restaurant_can_write(r.id) AS can_write
FROM public.restaurants r
WHERE r.name ILIKE 'The King';

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261028000100_renew_the_king_trial.sql','0a2d1e127b6b0d84f36b83492325527bd8a15b8e0ff5635f46668a95344d3d5d');

-- SOURCE 20261028000900_guest_scan_confirm.sql SHA256 e00ff8f7ab4190d7697016715d17c6e22bc34d2fba4a551ef2966563247bcb76
-- ============================================================================
-- AutoDine — migration 20261028000900: guest verification without a code
--
-- WHAT THIS ADDS
--
-- A third way for a guest to prove they are at a table, chosen per restaurant:
--
--   code          today's behaviour. Six rotating digits, entered once per
--                 sitting. The default, and unchanged for every existing row.
--   scan_confirm  a scan mints the table session. The FIRST order of a table
--                 sitting is held for one tap from staff on the kitchen board;
--                 once a human has vouched for the table, later orders in the
--                 same session go straight through.
--   scan          a scan mints the session and nothing is held. Fastest, and
--                 the setting says so in the owner's own words.
--
-- WHAT THIS DOES NOT DO
--
-- It does not weaken any existing guard. The session token is still the only
-- credential the guest order path accepts, sessions still expire after 59
-- minutes, prices are still recomputed server-side, tenant isolation and every
-- RLS policy are untouched, and a restaurant on 'code' behaves exactly as it
-- did before this file.
--
-- It is additive: new columns with defaults, two new functions, one replaced
-- function, one repaired read function. Nothing is dropped, no type changes,
-- no data is rewritten. Every existing order keeps hold_required = false,
-- which is "not held".
--
-- THE HONEST LIMIT
--
-- A static printed QR can be photographed. In a scan mode the on-site secret is
-- gone, and what remains is either a human assertion (scan_confirm) or nothing
-- (scan). No claim of "verified presence" may be made for those two modes, in
-- copy or in code comments.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The restaurant's choice.
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists guest_verification_mode text not null default 'code'
    check (guest_verification_mode in ('code', 'scan_confirm', 'scan'));

comment on column public.restaurants.guest_verification_mode is
  'How a guest proves they are at a table. code = rotating digits (default), '
  'scan_confirm = scan plus one staff tap per sitting, scan = scan only. '
  'Static QR codes cannot prove presence, so scan and scan_confirm must never '
  'be described as verified.';

-- ---------------------------------------------------------------------------
-- 2. The decision is snapshotted onto the order.
--
-- A setting changed at 20:05 must not retroactively release a ticket that was
-- held at 20:04, nor hold one that had already been accepted. hold_required is
-- therefore written once, when the order is created, and never recomputed.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists hold_required     boolean not null default false,
  add column if not exists confirmed_at      timestamptz,
  add column if not exists confirmed_by      uuid,
  add column if not exists table_session_id  uuid;

comment on column public.orders.hold_required is
  'Written when the order is created: it arrived under a scan mode and no '
  'human had vouched for this table session yet.';
comment on column public.orders.confirmed_at is
  'When staff accepted the held table. NULL means nobody has. Never set by the '
  'guest path.';
comment on column public.orders.table_session_id is
  'The table session the order was placed under, so the board can confirm a '
  'whole sitting in one statement and group a party''s orders.';

-- The board asks for held tickets constantly; the index is partial because
-- held, unconfirmed orders are a tiny fraction of the table.
create index if not exists orders_held_idx
  on public.orders (restaurant_id, placed_at)
  where hold_required and confirmed_at is null;

create index if not exists orders_session_idx
  on public.orders (table_session_id)
  where table_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Rate limit for sessions minted by a scan.
--
-- Deliberately a separate table from qr_verification_attempts: that one counts
-- FAILED attempts at a code, this one counts SUCCESSFUL openings of a session.
-- Mixing them would make a busy table look like an attacker, and an attacker
-- look like a busy table.
-- ---------------------------------------------------------------------------
create table if not exists public.table_session_opens (
  id         uuid primary key default gen_random_uuid(),
  qr_code_id uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash    text not null,
  opened_at  timestamptz not null default now()
);

create index if not exists table_session_opens_card_idx
  on public.table_session_opens (qr_code_id, opened_at desc);
create index if not exists table_session_opens_ip_idx
  on public.table_session_opens (ip_hash, opened_at desc);

-- No policies: only the security-definer function below touches this table.
alter table public.table_session_opens enable row level security;
revoke all on public.table_session_opens from anon;
revoke all on public.table_session_opens from authenticated;

-- ---------------------------------------------------------------------------
-- 4. open_table_session — the only new way a session can exist.
--
-- This is the exact place where verification is relaxed, so it is written to
-- be boring and paranoid: it refuses in 'code' mode, refuses for a dead card,
-- a closed table, a paused restaurant, a read-only restaurant, and a venue
-- with nothing published; it rate-limits per card and per address; and it
-- mints the same hashed, 59-minute session the code path mints, through the
-- same table with the same columns.
--
-- A reused session is NOT returned because only its hash is stored; the guest
-- gets a fresh token on every scan and the old one stays valid until it
-- expires. That is the same behaviour re-scanning a card has today.
-- ---------------------------------------------------------------------------
create or replace function public.open_table_session(
  p_public_token text,
  p_ip_hash      text
) returns table (
  status          text,
  session_token   text,
  restaurant_slug text,
  table_label     text,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The schema caps a session at one hour from creation; 59 minutes leaves the
  -- same minute of headroom the code path uses.
  k_session_minutes constant int := 59;
  k_opens_per_card  constant int := 10;
  k_opens_per_ip    constant int := 20;
  k_window          constant interval := interval '1 hour';

  v_qr        public.table_qr_codes%rowtype;
  v_table     public.dining_tables%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_mode      text;
  v_token     text;
  v_expires   timestamptz;
  v_count     int;
begin
  if p_public_token is null or btrim(p_public_token) !~ '^[A-Za-z0-9_-]{8,128}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select q.* into v_qr
    from public.table_qr_codes q
   where q.public_token = btrim(p_public_token)
     and q.revoked_at is null;

  if not found then
    return query select 'revoked'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select r.* into v_restaurant from public.restaurants r where r.id = v_qr.restaurant_id;
  v_mode := coalesce(v_restaurant.guest_verification_mode, 'code');

  -- The whole point of the setting: a restaurant on 'code' cannot be opened by
  -- a scan, no matter what the client asks for.
  if v_mode = 'code' then
    return query select 'code'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select t.* into v_table
    from public.dining_tables t
   where t.id = v_qr.table_id
     and t.restaurant_id = v_qr.restaurant_id
     and t.is_active = true;

  if not found then
    return query select 'revoked'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not v_restaurant.is_active or not public.restaurant_can_write(v_restaurant.id) then
    return query select 'notserving'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.menus m
     where m.restaurant_id = v_restaurant.id and m.is_published = true
  ) then
    return query select 'nomenu'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- Two brakes, one per card and one per address. Counted before the insert so
  -- a refusal records nothing.
  select count(*) into v_count
    from public.table_session_opens o
   where o.qr_code_id = v_qr.id
     and o.opened_at > statement_timestamp() - k_window;
  if v_count >= k_opens_per_card then
    return query select 'limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*) into v_count
    from public.table_session_opens o
   where o.ip_hash = p_ip_hash
     and o.opened_at > statement_timestamp() - k_window;
  if v_count >= k_opens_per_ip then
    return query select 'limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 64 hex characters: two UUIDv4s with the dashes removed. Same shape and the
  -- same reasoning as verify_table_qr_with_code.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_expires := statement_timestamp() + make_interval(mins => k_session_minutes);

  insert into public.table_verification_sessions (
    token_hash, restaurant_id, table_id, qr_code_id, expires_at
  ) values (
    encode(sha256(v_token::bytea), 'hex'),
    v_restaurant.id,
    v_table.id,
    v_qr.id,
    v_expires
  );

  insert into public.table_session_opens (qr_code_id, ip_hash) values (v_qr.id, p_ip_hash);

  return query select 'opened'::text, v_token, v_restaurant.slug, v_table.label, v_expires;
end;
$$;

comment on function public.open_table_session(text, text) is
  'Mint a table session from a scanned card, for restaurants whose '
  'guest_verification_mode is scan_confirm or scan. Refuses in code mode. '
  'Rate limited per card and per address. Does not prove presence.';

revoke all on function public.open_table_session(text, text) from public;
revoke all on function public.open_table_session(text, text) from anon;
revoke all on function public.open_table_session(text, text) from authenticated;
grant execute on function public.open_table_session(text, text) to anon;
grant execute on function public.open_table_session(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Stamping the decision onto a new order.
--
-- Called by place_public_order after the order exists, because the order id is
-- what place_public_order_core returns. A restaurant on 'code' gets the
-- session id recorded and nothing else; hold_required stays false, which is
-- today's behaviour.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_guest_verification(
  p_code          text,
  p_restaurant_id uuid,
  p_session_token text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid;
  v_mode    text;
  v_held    boolean;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    return;
  end if;

  select s.id, r.guest_verification_mode
    into v_session, v_mode
    from public.table_verification_sessions s
    join public.restaurants r on r.id = s.restaurant_id
   where s.token_hash = encode(sha256(btrim(p_session_token)::bytea), 'hex')
     and s.expires_at > statement_timestamp()
     and s.restaurant_id = p_restaurant_id
   limit 1;

  if v_session is null then
    return;
  end if;

  -- Held = nothing in this sitting has been vouched for by a human yet. If the
  -- first ticket was confirmed, the second one is not held, which is what
  -- keeps a busy table to one tap; if the first one is still waiting, the
  -- second one waits with it rather than slipping past the check.
  if v_mode = 'scan_confirm' then
    select not exists (
      select 1 from public.orders o
       where o.table_session_id = v_session
         and o.confirmed_at is not null
    ) into v_held;
  else
    v_held := false;
  end if;

  update public.orders o
     set table_session_id = v_session,
         hold_required = v_held
   where o.code = p_code
     and o.restaurant_id = p_restaurant_id
     and o.table_session_id is null;
end;
$$;

revoke all on function public.stamp_guest_verification(text, uuid, text) from public;
revoke all on function public.stamp_guest_verification(text, uuid, text) from anon;
revoke all on function public.stamp_guest_verification(text, uuid, text) from authenticated;

-- ---------------------------------------------------------------------------
-- 6. place_public_order — unchanged rules, one extra line.
--
-- The whole body is the 20261027000900 version, verbatim, so this migration is
-- a single readable replacement rather than a patch nobody can diff. The only
-- addition is the call to stamp_guest_verification after the order is written.
-- ---------------------------------------------------------------------------
create or replace function public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null,
  p_guest_token uuid default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  -- ---------------------------------------------------------------- replay
  if p_guest_token is not null and v_restaurant_id is not null then
    select o.code into v_existing
      from public.orders o
     where o.guest_token = p_guest_token
       and o.restaurant_id = v_restaurant_id
     limit 1;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  if p_guest_token is not null then
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id;
  end if;

  -- NEW: record which sitting this belongs to, and whether it is held. The
  -- session was already validated by place_public_order_core; this only reads
  -- the restaurant's mode and writes two columns.
  if v_restaurant_id is not null then
    perform public.stamp_guest_verification(v_code, v_restaurant_id, p_session_token);
  end if;

  return v_code;

exception
  when unique_violation then
    -- Two requests with the same attempt key, genuinely at the same time: the
    -- index fired before the read above could see the other row. Return the
    -- winner's code so both callers show one order.
    if p_guest_token is not null then
      select o.code into v_existing
        from public.orders o
       where o.guest_token = p_guest_token
         and (v_restaurant_id is null or o.restaurant_id = v_restaurant_id)
       limit 1;
      if v_existing is not null then
        return v_existing;
      end if;
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Confirming and rejecting a table's held tickets.
--
-- Both are security definer with their own membership check, because they take
-- a session id rather than a row the caller owns. The guard is the UPDATE's
-- own predicate: `confirmed_at is null` means a second tap, from a second
-- tablet, matches zero rows and says so. Nothing here reads a client-supplied
-- count, role or state.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_table_orders(
  p_table_session_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_count      integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to confirm a table.' using errcode = 'P0001';
  end if;

  select s.restaurant_id into v_restaurant
    from public.table_verification_sessions s
   where s.id = p_table_session_id;

  if v_restaurant is null then
    raise exception 'That table is no longer on the board.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only an owner, a manager or kitchen staff can confirm a table.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant) then
    raise exception 'This restaurant is read-only right now, so tickets cannot be confirmed.'
      using errcode = 'P0001';
  end if;

  update public.orders o
     set confirmed_at = statement_timestamp(),
         confirmed_by = auth.uid()
   where o.table_session_id = p_table_session_id
     and o.restaurant_id = v_restaurant
     and o.hold_required
     and o.confirmed_at is null
     and o.prep_status <> 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.reject_table_orders(
  p_table_session_id uuid,
  p_reason           text default null
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_count      integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to reject a table.' using errcode = 'P0001';
  end if;

  select s.restaurant_id into v_restaurant
    from public.table_verification_sessions s
   where s.id = p_table_session_id;

  if v_restaurant is null then
    raise exception 'That table is no longer on the board.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only an owner, a manager or kitchen staff can reject a table.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant) then
    raise exception 'This restaurant is read-only right now, so tickets cannot be rejected.'
      using errcode = 'P0001';
  end if;

  -- Only held, unconfirmed, still-open tickets. A confirmed ticket has already
  -- been vouched for; cancelling it is cancel_order's job, with its own rules.
  update public.orders o
     set prep_status = 'cancelled',
         customer_note = case
           when p_reason is null or btrim(p_reason) = '' then o.customer_note
           else coalesce(o.customer_note || ' · ', '') || 'Not confirmed by staff: ' || btrim(p_reason)
         end
   where o.table_session_id = p_table_session_id
     and o.restaurant_id = v_restaurant
     and o.hold_required
     and o.confirmed_at is null
     and o.prep_status <> 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.confirm_table_orders(uuid) from public;
revoke all on function public.confirm_table_orders(uuid) from anon;
revoke all on function public.confirm_table_orders(uuid) from authenticated;
grant execute on function public.confirm_table_orders(uuid) to authenticated;

revoke all on function public.reject_table_orders(uuid, text) from public;
revoke all on function public.reject_table_orders(uuid, text) from anon;
revoke all on function public.reject_table_orders(uuid, text) from authenticated;
grant execute on function public.reject_table_orders(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. get_public_order — two more keys, so the guest can be told the truth.
--
-- The guest's status page must not say "in the kitchen" for a ticket nobody has
-- accepted. It reads hold_required and confirmed_at from here.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_order(
  p_slug text,
  p_code text,
  p_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'prep_status', o.prep_status,
    'payment_status', o.payment_status,
    'subtotal_paise', o.subtotal_paise,
    'tax_paise', o.tax_paise,
    'total_paise', o.total_paise,
    'customer_note', o.customer_note,
    'placed_at', o.placed_at,
    'hold_required', o.hold_required,
    'confirmed_at', o.confirmed_at,
    'table_label', t.label,
    'lines', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name_snapshot,
                 'qty', i.qty,
                 'unit_price_paise', i.unit_price_paise,
                 'is_veg', i.is_veg,
                 'variant', i.variant_snapshot,
                 'addons', i.addons_snapshot
               )
               order by i.sort_order
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.dining_tables t on t.id = o.table_id
  where r.slug = p_slug
    and r.is_active
    and o.code = p_code
    and p_token is not null
    and o.guest_token = p_token
  limit 1;
$$;

revoke all on function public.get_public_order(text, text, uuid) from public;
revoke all on function public.get_public_order(text, text, uuid) from anon;
revoke all on function public.get_public_order(text, text, uuid) from authenticated;
grant execute on function public.get_public_order(text, text, uuid) to anon;
grant execute on function public.get_public_order(text, text, uuid) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261028000900_guest_scan_confirm.sql','e00ff8f7ab4190d7697016715d17c6e22bc34d2fba4a551ef2966563247bcb76');

-- SOURCE 20261029000100_staff_invites.sql SHA256 7d5df1e76cc47bcb6f8d867d79c59e853b41e4260e39be7528fc4fa4b6110801
-- ============================================================================
-- Team access: staff invitations, redemption, and role-scoped writes
--
-- WHY THIS EXISTS
--
-- public.memberships has carried a role since the first migration --
-- owner / manager / kitchen / cashier -- and nothing could ever create a
-- second row. Every restaurant was one login: the person who signed up was
-- the owner, the cashier and the cook, and a kitchen tablet could only be
-- that same account. The roles were real in the database and unreachable in
-- the product.
--
-- THE SHAPE
--
--   * An owner (or a manager, for the roles a manager may hire) mints an
--     invitation. What comes back is a short code, once. The database stores
--     only sha256(code): a leaked dump cannot be turned back into a working
--     link, and neither the owner nor support can read an old one.
--   * The code is scoped to one restaurant and one role, expires (default 7
--     days, maximum 30), and is single use. Redemption locks the row, so two
--     people racing the same link produce one membership and one honest
--     "already used" for the loser -- never two members and never a silent
--     second join.
--   * The browser cannot write this table at all. There is no INSERT, UPDATE
--     or DELETE grant: every change goes through a SECURITY DEFINER function
--     that derives the actor from auth.uid() and checks the caller's role in
--     that restaurant. An invite cannot be pointed at another restaurant
--     because the restaurant id is read from the invite row, not the client.
--   * Invitations can never mint an owner. Ownership is not transferable
--     through a link; the last owner cannot be removed either, which is what
--     keeps a restaurant from ending up with nobody who can administer it.
--
-- ALSO HERE: THE WRITE POLICIES THE ROLES IMPLIED
--
-- The menu, table and payment policies were written when every member was an
-- owner. They said "any member of this restaurant may write" -- so a kitchen
-- login could have renamed a dish, changed a price, rotated a table's QR
-- code, or inserted a payment row directly. The roles only become meaningful
-- once those policies say what the roles mean:
--
--   * menu, categories, items, variants, add-ons, tables   owner + manager
--   * payments: read                                       owner + manager + cashier
--   * payments: write                                      nobody -- the
--     record_counter_payment RPC is the only door, and it checks the role
--
-- Reads stay open to every member: a cook needs the dish names on a ticket.
--
-- NOT APPLIED ANYWHERE. This migration is on a feature branch only; it has
-- not been run against any Supabase project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The invitation
-- ----------------------------------------------------------------------------

create table if not exists public.restaurant_invites (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role          public.member_role not null,
  -- sha256 of the normalised code, hex. The code itself is never stored.
  code_hash     text not null unique,
  created_by    uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  redeemed_by   uuid references public.profiles(id) on delete cascade,
  redeemed_at   timestamptz,
  revoked_at    timestamptz,
  -- Ownership is granted once, at signup. It cannot be handed out by link.
  constraint restaurant_invites_role_not_owner check (role <> 'owner'),
  -- A redemption is one moment: both columns set, or neither.
  constraint restaurant_invites_redeemed_together
    check ((redeemed_at is null) = (redeemed_by is null)),
  -- An invitation cannot already be expired when it is created.
  constraint restaurant_invites_expires_after_creation check (expires_at > created_at)
);

comment on table public.restaurant_invites is
  'Single-use, expiring staff invitations. Stores only sha256 of the code; writes go through SECURITY DEFINER functions, never the client.';

create index if not exists restaurant_invites_restaurant_idx
  on public.restaurant_invites (restaurant_id, created_at desc);

-- The lookup that redemption actually performs, restricted to links that can
-- still be used. Keeps a table that accumulates expired invitations from
-- turning the redeem path into a scan.
create index if not exists restaurant_invites_live_idx
  on public.restaurant_invites (restaurant_id)
  where redeemed_at is null and revoked_at is null;

alter table public.restaurant_invites enable row level security;

-- Read-only to owners and managers; no write policy exists on purpose.
drop policy if exists restaurant_invites_read on public.restaurant_invites;
create policy restaurant_invites_read on public.restaurant_invites
  for select
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager']));

-- A policy is not a permission. Supabase's default grants on a new table are
-- not something this project relies on (see 20261021000500), so the grants
-- are explicit -- and they name their columns. `code_hash` is deliberately
-- absent: even a member who may read the table cannot read the hashes, so an
-- offline guessing attack has nothing to start from.
revoke all on public.restaurant_invites from anon;
revoke all on public.restaurant_invites from authenticated;
grant select (
  id, restaurant_id, role, created_by, created_at, expires_at, redeemed_at, revoked_at
) on public.restaurant_invites to authenticated;

-- ----------------------------------------------------------------------------
-- Codes
--
-- 16 characters from a 32-symbol alphabet = 80 bits. The four symbols people
-- confuse when reading a code aloud (I, O, 0, 1) are not in the alphabet, so
-- a code can be dictated over the phone without "was that an O or a zero".
-- Normalisation is case- and punctuation-insensitive: a code pasted from
-- WhatsApp with the dashes, or typed without them, hashes the same.
-- ----------------------------------------------------------------------------

create or replace function public.normalise_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

-- pgcrypto/digest are not available on this instance (see
-- 20261023000900); sha256(bytea) is a built-in and is what is used here.
create or replace function public.hash_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(public.normalise_invite_code(p_code), 'UTF8')), 'hex');
$$;

create or replace function public.new_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hex      text := replace(gen_random_uuid()::text, '-', '');
  v_code     text := '';
  i          integer;
begin
  -- Two hex characters per symbol, taken mod 32. 256 / 32 is exact, so the
     -- modulo introduces no bias: every symbol is equally likely.
  for i in 1..16 loop
    v_code := v_code
      || substr(v_alphabet, (('x' || substr(v_hex, i * 2 - 1, 2))::bit(8)::integer % 32) + 1, 1);
    if i % 4 = 0 and i < 16 then
      v_code := v_code || '-';
    end if;
  end loop;

  return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- Mint an invitation
--
-- p_restaurant_id is never taken from the client's word alone: the caller must
-- hold a membership row with a role that may hire. A manager may invite
-- kitchen and cashier; only the owner may invite a manager. Nobody may invite
-- an owner.
-- ----------------------------------------------------------------------------

create or replace function public.create_staff_invite(
  p_restaurant_id uuid,
  p_role          public.member_role,
  p_days          integer default 7
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_caller public.member_role;
  v_days   integer := least(greatest(coalesce(p_days, 7), 1), 30);
  v_code   text;
  v_hash   text;
  i        integer;
begin
  if v_actor is null then
    raise exception 'Sign in to invite staff.' using errcode = '42501';
  end if;

  if p_restaurant_id is null then
    raise exception 'A restaurant is required.' using errcode = '22023';
  end if;

  select m.role into v_caller
  from public.memberships m
  where m.restaurant_id = p_restaurant_id
    and m.user_id = v_actor;

  if not found or v_caller not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can invite staff to this restaurant.'
      using errcode = '42501';
  end if;

  if p_role is null then
    raise exception 'Choose a role for the invitation.' using errcode = '22023';
  end if;

  if p_role = 'owner' then
    raise exception 'Ownership cannot be granted by invitation.' using errcode = '42501';
  end if;

  if p_role = 'manager' and v_caller <> 'owner' then
    raise exception 'Only the owner can invite a manager.' using errcode = '42501';
  end if;

  -- A collision of 80 random bits means something is badly wrong, but the
     -- unique index is the authority, so the insert is retried a few times
     -- rather than trusted. Losing the race is not an error the caller can act
     -- on, so after five attempts it becomes a plain "try again".
  for i in 1..5 loop
    v_code := public.new_invite_code();
    v_hash := public.hash_invite_code(v_code);

    begin
      insert into public.restaurant_invites (restaurant_id, role, code_hash, created_by, expires_at)
      values (p_restaurant_id, p_role, v_hash, v_actor, now() + make_interval(days => v_days));
      return v_code;
    exception when unique_violation then
      -- try another code
    end;
  end loop;

  raise exception 'Could not create an invitation. Please try again.' using errcode = 'P0001';
end;
$$;

-- ----------------------------------------------------------------------------
-- What a link is
--
-- Read-only and consumes nothing, so a staff member can open the link, sign
-- in, and still see what they are joining. Requires a session: an anonymous
-- visitor holding a guessed link learns nothing, including whether it exists.
-- ----------------------------------------------------------------------------

create or replace function public.preview_staff_invite(p_code text)
returns table (
  status          text,
  restaurant_id   uuid,
  restaurant_name text,
  role            public.member_role,
  expires_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invite public.restaurant_invites%rowtype;
  v_name   text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to open this invitation.' using errcode = '42501';
  end if;

  select * into v_invite
  from public.restaurant_invites i
  where i.code_hash = public.hash_invite_code(p_code);

  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::public.member_role, null::timestamptz;
    return;
  end if;

  select r.name into v_name
  from public.restaurants r
  where r.id = v_invite.restaurant_id and r.is_active;

  -- The status ladder is ordered deliberately. A link that was both revoked
     -- and later expired is described as revoked: that is the fact the owner
     -- acted on, and it is the one that explains why a code that looks valid
     -- does not work.
  if not found then
    return query select 'closed'::text, v_invite.restaurant_id, null::text, v_invite.role, v_invite.expires_at;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif v_invite.expires_at <= now() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif exists (
    select 1 from public.memberships m
    where m.restaurant_id = v_invite.restaurant_id
      and m.user_id = auth.uid()
  ) then
    -- Said here rather than only at redemption, so the page can offer "open
       -- your screen" instead of an Accept button that would answer "you are
       -- already on this team".
    return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  else
    return query select 'ok'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Redeem
--
-- One transaction, one row, one member. `for update` is what makes the link
-- single use under concurrency: the second caller blocks, then reads the row
-- with redeemed_at already set and is told the truth. The membership is
-- created for the invite's restaurant -- never one named by the caller -- so
-- a link to restaurant A cannot join B.
-- ----------------------------------------------------------------------------

create or replace function public.redeem_staff_invite(p_code text)
returns table (
  status          text,
  restaurant_id   uuid,
  restaurant_name text,
  role            public.member_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_invite public.restaurant_invites%rowtype;
  v_name   text;
begin
  if v_actor is null then
    raise exception 'Sign in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_invite
  from public.restaurant_invites i
  where i.code_hash = public.hash_invite_code(p_code)
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::public.member_role;
    return;
  end if;

  select r.name into v_name
  from public.restaurants r
  where r.id = v_invite.restaurant_id and r.is_active;

  if not found then
    return query select 'closed'::text, v_invite.restaurant_id, null::text, v_invite.role;
    return;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  elsif v_invite.expires_at <= now() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  end if;

  -- Already a member: say so, and do NOT burn the code. The person holding a
     -- link for a restaurant they already work in has not used anything up --
     -- the link is still good for the colleague it was sent to.
  if exists (
    select 1 from public.memberships m
    where m.restaurant_id = v_invite.restaurant_id
      and m.user_id = v_actor
  ) then
    return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  end if;

  -- The membership's foreign key points at public.profiles. An account can
     -- exist without one -- the normal signup writes it, an account created by
     -- an invitation or by Supabase Auth alone does not. Creating it here is
     -- what makes "accept the link, then sign up" work in either order.
  insert into public.profiles (id) values (v_actor)
  on conflict (id) do nothing;

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_invite.restaurant_id, v_actor, v_invite.role);

  update public.restaurant_invites
     set redeemed_by = v_actor, redeemed_at = now()
   where id = v_invite.id;

  return query select 'ok'::text, v_invite.restaurant_id, v_name, v_invite.role;
end;
$$;

-- ----------------------------------------------------------------------------
-- Revoke an invitation that has not been used
-- ----------------------------------------------------------------------------

create or replace function public.revoke_staff_invite(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_invite public.restaurant_invites%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in to change invitations.' using errcode = '42501';
  end if;

  select * into v_invite
  from public.restaurant_invites i
  where i.id = p_invite_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if not public.has_restaurant_role(v_invite.restaurant_id, array['owner', 'manager']) then
    -- Deliberately the same message whether the invite is absent or belongs
       -- to somebody else's restaurant: an id that is not yours must not be
       -- distinguishable from one that does not exist.
    raise exception 'That invitation is not yours to revoke.' using errcode = '42501';
  end if;

  if v_invite.redeemed_at is not null then
    return 'used';
  end if;

  if v_invite.revoked_at is not null then
    return 'revoked';
  end if;

  update public.restaurant_invites
     set revoked_at = now()
   where id = v_invite.id;

  return 'revoked';
end;
$$;

-- ----------------------------------------------------------------------------
-- Remove somebody from the team
--
-- Owner only. A manager can invite a cook; a manager cannot remove the person
-- who owns the restaurant, or another manager.
--
-- THE LAST OWNER CANNOT BE REMOVED. Without this, one tap produces a
-- restaurant nobody can administer: no menus, no settings, no way to grant
-- the role back, since ownership can only be created by the signup path. The
-- check counts owners rather than looking at the caller, because a second
-- owner may exist and any one of them may leave.
-- ----------------------------------------------------------------------------

create or replace function public.remove_staff_member(p_membership_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_membership public.memberships%rowtype;
  v_owners     integer;
begin
  if v_actor is null then
    raise exception 'Sign in to change the team.' using errcode = '42501';
  end if;

  select * into v_membership
  from public.memberships m
  where m.id = p_membership_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if not public.has_restaurant_role(v_membership.restaurant_id, array['owner']) then
    raise exception 'Only the owner can remove a team member.' using errcode = '42501';
  end if;

  if v_membership.role <> 'owner' and v_membership.user_id = v_actor then
    -- An owner removing their own non-owner membership in a restaurant they
       -- own is nonsense; refuse rather than half-apply it.
    raise exception 'You cannot remove your own access to a restaurant you own.'
      using errcode = '42501';
  end if;

  if v_membership.role = 'owner' then
    select count(*) into v_owners
    from public.memberships m
    where m.restaurant_id = v_membership.restaurant_id
      and m.role = 'owner';

    if v_owners <= 1 then
      raise exception 'The last owner cannot be removed. Make somebody else an owner first.'
        using errcode = '42501';
    end if;
  end if;

  delete from public.memberships m where m.id = v_membership.id;

  return 'removed';
end;
$$;

-- ----------------------------------------------------------------------------
-- The email on a team row
--
-- auth.users is a Supabase object, not one of this repository's tables: a
-- plain Postgres built from these migrations (the local harness, a CI scratch
-- database) does not have it. A function that joined it directly would work on
-- Supabase and fail everywhere else, which is the worst possible split.
--
-- to_regclass() is checked BEFORE the select, so the statement is never
-- executed where the relation is absent -- and the column is simply null there.
-- ----------------------------------------------------------------------------

create or replace function public.staff_email(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if to_regclass('auth.users') is null then
    return null;
  end if;

  return (select u.email::text from auth.users u where u.id = p_user_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- The team list
--
-- A SECURITY DEFINER read instead of a wider policy on public.profiles.
-- profiles_self lets a person read only their own row; opening it to
-- co-members would also expose their phone number. This returns the four
-- facts a People screen needs and nothing else: who, what role, since when,
-- and whether it is you. The email is the one an owner needs to tell two
-- "Staff member" rows apart, and is visible to owner/manager only.
-- ----------------------------------------------------------------------------

create or replace function public.list_staff_members(p_restaurant_id uuid)
returns table (
  membership_id uuid,
  user_id       uuid,
  role          public.member_role,
  full_name     text,
  email         text,
  joined_at     timestamptz,
  is_self       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Sign in to see the team.' using errcode = '42501';
  end if;

  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can see the team list.' using errcode = '42501';
  end if;

  return query
    select
      m.id,
      m.user_id,
      m.role,
      nullif(trim(p.full_name), ''),
      public.staff_email(m.user_id),
      m.created_at,
      m.user_id = v_actor
    from public.memberships m
    left join public.profiles p on p.id = m.user_id
    where m.restaurant_id = p_restaurant_id
    order by
      -- Owners first, then managers, then the rest; oldest first inside a
         -- role, so the list does not reshuffle when somebody joins.
      case m.role
        when 'owner' then 0
        when 'manager' then 1
        when 'cashier' then 2
        else 3
      end,
      m.created_at asc;
end;
$$;

-- ----------------------------------------------------------------------------
-- Function grants
--
-- The browser calls these over PostgREST. `anon` gets nothing: every one of
-- them begins by requiring auth.uid(), and granting execute to anon would
-- only move that failure deeper.
-- ----------------------------------------------------------------------------

revoke all on function public.normalise_invite_code(text) from public;
revoke all on function public.hash_invite_code(text) from public;
revoke all on function public.new_invite_code() from public;
revoke all on function public.staff_email(uuid) from public, anon, authenticated;
revoke all on function public.create_staff_invite(uuid, public.member_role, integer) from public, anon;
revoke all on function public.preview_staff_invite(text) from public, anon;
revoke all on function public.redeem_staff_invite(text) from public, anon;
revoke all on function public.revoke_staff_invite(uuid) from public, anon;
revoke all on function public.remove_staff_member(uuid) from public, anon;
revoke all on function public.list_staff_members(uuid) from public, anon;

grant execute on function public.create_staff_invite(uuid, public.member_role, integer) to authenticated;
grant execute on function public.preview_staff_invite(text) to authenticated;
grant execute on function public.redeem_staff_invite(text) to authenticated;
grant execute on function public.revoke_staff_invite(uuid) to authenticated;
grant execute on function public.remove_staff_member(uuid) to authenticated;
grant execute on function public.list_staff_members(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Write policies that honour the roles
--
-- DROPPED AND RECREATED, because a policy cannot be edited. Every one below
-- was `for all using (restaurant_id in (select current_restaurant_ids()))`,
-- which says "any member", and any member included the kitchen.
--
-- Every write policy also checks public.restaurant_can_write(restaurant_id):
-- a restaurant whose trial has expired can still read its menu but cannot
-- change it. The trial gate is a licence check, not an access check, so it
-- belongs in the policy alongside the role check, not only in the RPCs.
-- ----------------------------------------------------------------------------

-- Menus: every member reads (the board and the ledger join through menus),
-- owner and manager write.
--
-- The remote project ships per-command policies (menus_staff_read,
-- menus_staff_insert, menus_staff_update, menus_staff_delete) rather than a
-- single `for all` policy. Both spellings are dropped so this migration
-- produces the same result on a fresh database and on an existing one.
drop policy if exists menus_staff on public.menus;
drop policy if exists menus_staff_read on public.menus;
drop policy if exists menus_staff_insert on public.menus;
drop policy if exists menus_staff_update on public.menus;
drop policy if exists menus_staff_delete on public.menus;
drop policy if exists menus_member_read on public.menus;
drop policy if exists menus_manage on public.menus;
create policy menus_member_read on public.menus
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy menus_manage on public.menus
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- Categories: every member reads, owner and manager write.
--
-- See the menus section above for why both the `for all` and per-command
-- policy spellings are dropped.
drop policy if exists categories_staff on public.categories;
drop policy if exists categories_staff_read on public.categories;
drop policy if exists categories_staff_insert on public.categories;
drop policy if exists categories_staff_update on public.categories;
drop policy if exists categories_staff_delete on public.categories;
drop policy if exists categories_member_read on public.categories;
drop policy if exists categories_manage on public.categories;
create policy categories_member_read on public.categories
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy categories_manage on public.categories
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- Items: every member reads, owner and manager write.
--
-- See the menus section above for why both spellings are dropped.
drop policy if exists items_staff on public.items;
drop policy if exists items_staff_read on public.items;
drop policy if exists items_staff_insert on public.items;
drop policy if exists items_staff_update on public.items;
drop policy if exists items_staff_delete on public.items;
drop policy if exists items_member_read on public.items;
drop policy if exists items_manage on public.items;
create policy items_member_read on public.items
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy items_manage on public.items
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- Variants and add-ons carry their own restaurant_id through a policy that
-- joins items; the write side mirrors items exactly.
--
-- See the menus section above for why both spellings are dropped.
drop policy if exists variants_staff on public.item_variants;
drop policy if exists variants_staff_read on public.item_variants;
drop policy if exists variants_staff_insert on public.item_variants;
drop policy if exists variants_staff_update on public.item_variants;
drop policy if exists variants_staff_delete on public.item_variants;
drop policy if exists variants_member_read on public.item_variants;
drop policy if exists variants_manage on public.item_variants;
create policy variants_member_read on public.item_variants
  for select using (
    exists (
      select 1 from public.items i
      where i.id = item_variants.item_id
        and i.restaurant_id in (select public.current_restaurant_ids())
    )
  );
create policy variants_manage on public.item_variants
  for all
  using (
    exists (
      select 1 from public.items i
      where i.id = item_variants.item_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_variants.item_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  );

-- Add-on groups: same pattern as variants, joined through items.
--
-- These two tables had no old per-command policies, so the `for all` policy
-- below is the only write policy -- which is why the trial gate must be in
-- it rather than somewhere else.
drop policy if exists addon_groups_staff on public.item_addon_groups;
drop policy if exists addon_groups_member_read on public.item_addon_groups;
drop policy if exists addon_groups_manage on public.item_addon_groups;
create policy addon_groups_member_read on public.item_addon_groups
  for select using (
    exists (
      select 1 from public.items i
      where i.id = item_addon_groups.item_id
        and i.restaurant_id in (select public.current_restaurant_ids())
    )
  );
create policy addon_groups_manage on public.item_addon_groups
  for all
  using (
    exists (
      select 1 from public.items i
      where i.id = item_addon_groups.item_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_addon_groups.item_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  );

-- Add-ons: same pattern as add-on groups, joined through groups and items.
--
-- See the add-on groups section above for why the trial gate is in the policy.
drop policy if exists addons_staff on public.item_addons;
drop policy if exists addons_member_read on public.item_addons;
drop policy if exists addons_manage on public.item_addons;
create policy addons_member_read on public.item_addons
  for select using (
    exists (
      select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
      where g.id = item_addons.group_id
        and i.restaurant_id in (select public.current_restaurant_ids())
    )
  );
create policy addons_manage on public.item_addons
  for all
  using (
    exists (
      select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
      where g.id = item_addons.group_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  )
  with check (
    exists (
      select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
      where g.id = item_addons.group_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  );

-- Tables and printed codes: every member may read (the board names tables),
-- owner and manager may write. Code rotation itself stays in
-- rotate_table_qr_code(), which checks the write gate.
--
-- See the menus section above for why both spellings are dropped.
drop policy if exists tables_staff on public.dining_tables;
drop policy if exists tables_staff_read on public.dining_tables;
drop policy if exists tables_staff_insert on public.dining_tables;
drop policy if exists tables_staff_update on public.dining_tables;
drop policy if exists tables_staff_delete on public.dining_tables;
drop policy if exists tables_member_read on public.dining_tables;
drop policy if exists tables_manage on public.dining_tables;
create policy tables_member_read on public.dining_tables
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy tables_manage on public.dining_tables
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- QR tokens: every member may read, owner and manager may write.
--
-- See the menus section above for why both spellings are dropped.
drop policy if exists qr_tokens_staff on public.qr_tokens;
drop policy if exists qr_tokens_staff_read on public.qr_tokens;
drop policy if exists qr_tokens_staff_insert on public.qr_tokens;
drop policy if exists qr_tokens_staff_update on public.qr_tokens;
drop policy if exists qr_tokens_staff_delete on public.qr_tokens;
drop policy if exists qr_tokens_member_read on public.qr_tokens;
drop policy if exists qr_tokens_manage on public.qr_tokens;
create policy qr_tokens_member_read on public.qr_tokens
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy qr_tokens_manage on public.qr_tokens
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- Payments are the bill. The kitchen needs the food, not the money.
--
-- The remote project has a legacy payments_staff_read policy in addition to
-- payments_money_read; both are dropped so only the role-scoped read remains.
drop policy if exists payments_staff on public.payments;
drop policy if exists payments_staff_read on public.payments;
drop policy if exists payments_money_read on public.payments;
create policy payments_money_read on public.payments
  for select
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'cashier']));

-- And no write policy at all: money is recorded by record_counter_payment()
   -- (which checks the role itself and writes under SECURITY DEFINER) or by the
   -- online payment path. Revoking the table privileges makes a direct insert
   -- impossible rather than merely un-policied.
revoke insert, update, delete on public.payments from anon;
revoke insert, update, delete on public.payments from authenticated;

-- SELECT is granted explicitly, in keeping with this repository's rule that a
   -- policy is not a permission (see 20261021000500). Without it the counter and
   -- the bill read nothing at all -- the row-level policy above would never even
   -- be consulted, because the statement fails on the privilege first. This is
   -- also why the local harness matters: on Supabase the default privileges
   -- happen to include SELECT, so a missing grant there is invisible until it is
   -- run somewhere that does not have them.
grant select on public.payments to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261029000100_staff_invites.sql','7d5df1e76cc47bcb6f8d867d79c59e853b41e4260e39be7528fc4fa4b6110801');

-- SOURCE 20261103000100_brand_studio.sql SHA256 5a0ef45c8d1c3e80926e5388ae911ad59023d85a7dcda57c5e45db243e465f1c
-- ============================================================================
-- Brand Studio: brand assets, brand profiles (drafts + versions), publish
-- history, and the atomic menu+brand publish/rollback pair.
--
-- WHY THIS SHAPE
--
-- The approved, guest-visible brand already lives on `restaurants`
-- (logo_path, banner_path, accent — migration 20261025001000). This migration
-- does NOT replace that. It adds the reviewable layer around it:
--
--   restaurant_brand_assets    every uploaded or extracted image, with the
--                              metadata an audit needs (mime, size, pixels,
--                              checksum) and a tenant-matchable id.
--   restaurant_brand_profiles  the DRAFT the owner reviews and the PUBLISHED
--                              versions behind it. status: draft → published
--                              → archived. One draft per (restaurant, import).
--   restaurant_publish_history what went live when, and the snapshot needed to
--                              put the previous pair back.
--
-- Publishing copies the profile onto the restaurants row INSIDE one function
-- (`publish_menu_brand_pair`), together with the menu's is_published flip, so
-- a half-published version is not representable: either the transaction
-- commits or the previous live state stands untouched.
--
-- OPT-IN, ALWAYS
--
-- `restaurants.brand_theme_enabled` starts false for every existing and new
-- row. Nothing in this migration changes what a single guest sees today.
--
-- TENANT ISOLATION IS ENFORCED TWICE
--
-- 1. Path CHECKs (path like restaurant_id || '/%') so a row can never point at
--    another tenant's folder, even written by a service-role script.
-- 2. Composite foreign keys (asset_id, restaurant_id) so a profile can never
--    reference ANOTHER restaurant's asset — the database refuses it, not just
--    the application.
--
-- MIRRORING
--
-- Policy spellings mirror 20261029000100 (member_read / manage). Functions
-- mirror create_outlet (20261022000700): security definer, explicit auth.uid()
-- checks, fixed search_path, revoke-from-public then grant to authenticated.
-- ============================================================================

-- ---------------------------------------------------------------- the
-- private source bucket
--
-- The public bucket above is for things a GUEST renders (logo, banner, dish,
-- approved crop). The owner's working material — menu-card originals,
-- reference images — is different: no diner should be able to read it. It
-- goes in a PRIVATE bucket and is served only through short-lived signed
-- URLs to the owner's own session. Same path rules, same role rules.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-brand-source',
  'restaurant-brand-source',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "managers read their own brand sources" on storage.objects;
create policy "managers read their own brand sources"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers upload their own brand sources" on storage.objects;
create policy "managers upload their own brand sources"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers replace their own brand sources" on storage.objects;
create policy "managers replace their own brand sources"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  )
  with check (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "managers delete their own brand sources" on storage.objects;
create policy "managers delete their own brand sources"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'restaurant-brand-source'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
        then public.can_manage_restaurant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- ---------------------------------------------------------------- columns

alter table public.restaurants
  add column if not exists brand_theme_enabled boolean not null default false,
  add column if not exists brand_theme jsonb,
  add column if not exists brand_profile_id uuid;

comment on column public.restaurants.brand_theme_enabled is
  'Opt-in flag for per-restaurant guest theming. False for every restaurant until the owner publishes a brand profile. Existing appearance is the default, not a fallback.';
comment on column public.restaurants.brand_theme is
  'The published theme as validated JSON (lib/branding/theme.ts is the only writer through publish_menu_brand_pair). Never model output verbatim.';
comment on column public.restaurants.brand_profile_id is
  'The currently approved brand profile. Null means the restaurant has never opted in.';

-- A menu remembers which import created it, so the pair (menu, brand draft)
-- can be found again and duplicate Creates are refused rather than doubled.
alter table public.menus
  add column if not exists import_id uuid;

comment on column public.menus.import_id is
  'Stable import identifier linking this menu draft to its brand draft. Null for menus created by hand.';

-- ---------------------------------------------------------------- assets

create table if not exists public.restaurant_brand_assets (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind          text not null check (kind in ('logo', 'banner', 'reference', 'menu-photo', 'crop')),
  bucket        text not null check (bucket in ('restaurant-assets', 'restaurant-brand-source')),
  path          text not null,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size     integer not null check (byte_size > 0 and byte_size <= 8388608),
  width         integer check (width is null or (width > 0 and width <= 20000)),
  height        integer check (height is null or (height > 0 and height <= 20000)),
  checksum      text not null check (checksum ~ '^[0-9a-f]{64}$'),
  source        text not null default 'upload' check (source in ('upload', 'extract')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),

  unique (bucket, path),
  -- The cross-reference pair used by the composite FKs below.
  unique (id, restaurant_id),
  -- A path always starts with its own restaurant id (same fence as
  -- restaurants_branding_path_check in 20261025001000).
  constraint restaurant_brand_assets_path_check
    check (path like restaurant_id::text || '/%')
);

comment on table public.restaurant_brand_assets is
  'Metadata for every brand Studio asset: originals, references and approved crops. The bytes live in Storage; this row is the ownership record.';
comment on column public.restaurant_brand_assets.bucket is
  'restaurant-assets = public-read (guest-rendered). restaurant-brand-source = private (owner working material, signed URLs only).';

create index if not exists restaurant_brand_assets_restaurant_idx
  on public.restaurant_brand_assets (restaurant_id, created_at desc);

alter table public.restaurant_brand_assets enable row level security;

drop policy if exists brand_assets_member_read on public.restaurant_brand_assets;
create policy brand_assets_member_read on public.restaurant_brand_assets
  for select using (restaurant_id in (select public.current_restaurant_ids()));

-- can_manage_restaurant (owner|manager, independent of billing state) rather
-- than restaurant_can_write: a workspace whose trial expired must still be
-- able to fix its own logo and brand, exactly as 20261025001000 argues.
drop policy if exists brand_assets_manage on public.restaurant_brand_assets;
create policy brand_assets_manage on public.restaurant_brand_assets
  for all
  using (public.can_manage_restaurant(restaurant_id))
  with check (public.can_manage_restaurant(restaurant_id));

-- ---------------------------------------------------------------- profiles

create table if not exists public.restaurant_brand_profiles (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- The stable import identifier. One DRAFT per import; repeats of Create with
  -- the same import_id hit the partial unique index below and are refused.
  import_id     uuid not null,
  status        text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version       integer not null default 1,
  -- The owner-confirmed restaurant name. Null = do not touch restaurants.name.
  name          text check (name is null or (length(btrim(name)) between 1 and 80)),
  logo_asset_id   uuid,
  banner_asset_id uuid,
  theme         jsonb not null default '{}'::jsonb,
  -- Provenance per decision (owner-upload / existing / printed-menu / ai) and
  -- the conflict list shown to the owner. Never trusted back without
  -- sanitising (lib/branding/draft.ts).
  source        jsonb not null default '{}'::jsonb,
  menu_id       uuid references public.menus(id) on delete set null,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  published_by  uuid,

  -- Tenant-match enforced by the database: these composite FKs cannot point
  -- at another restaurant's asset even if application code is wrong.
  constraint brand_profile_logo_fk
    foreign key (logo_asset_id, restaurant_id)
    references public.restaurant_brand_assets (id, restaurant_id),
  constraint brand_profile_banner_fk
    foreign key (banner_asset_id, restaurant_id)
    references public.restaurant_brand_assets (id, restaurant_id)
);

comment on table public.restaurant_brand_profiles is
  'Brand drafts and published versions. Guests never read this table: publish_menu_brand_pair copies the approved values onto restaurants.';

create unique index if not exists restaurant_brand_profiles_draft_import
  on public.restaurant_brand_profiles (restaurant_id, import_id)
  where status = 'draft';

create index if not exists restaurant_brand_profiles_status_idx
  on public.restaurant_brand_profiles (restaurant_id, status, version desc);

alter table public.restaurant_brand_profiles enable row level security;

drop policy if exists brand_profiles_member_read on public.restaurant_brand_profiles;
create policy brand_profiles_member_read on public.restaurant_brand_profiles
  for select using (restaurant_id in (select public.current_restaurant_ids()));

drop policy if exists brand_profiles_manage on public.restaurant_brand_profiles;
create policy brand_profiles_manage on public.restaurant_brand_profiles
  for all
  using (public.can_manage_restaurant(restaurant_id))
  with check (public.can_manage_restaurant(restaurant_id));

-- Published and archived profiles are version history: only drafts may be
-- deleted. (Delete of a draft = "discard this import's brand half".)
drop policy if exists brand_profiles_delete_draft on public.restaurant_brand_profiles;
create policy brand_profiles_delete_draft on public.restaurant_brand_profiles
  for delete using (status = 'draft' and public.can_manage_restaurant(restaurant_id));

-- ---------------------------------------------------------------- history

create table if not exists public.restaurant_publish_history (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  action        text not null check (action in ('publish', 'rollback')),
  menu_id       uuid references public.menus(id) on delete set null,
  brand_profile_id uuid references public.restaurant_brand_profiles(id) on delete set null,
  -- The live state BEFORE this action: name, logo_path, banner_path,
  -- brand_theme, brand_theme_enabled, brand_profile_id, menu_is_published.
  snapshot      jsonb not null,
  actor         uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

comment on table public.restaurant_publish_history is
  'One row per publish or rollback, with the prior live state needed to restore the previous menu+brand pair.';

create index if not exists restaurant_publish_history_idx
  on public.restaurant_publish_history (restaurant_id, created_at desc);

alter table public.restaurant_publish_history enable row level security;

drop policy if exists publish_history_member_read on public.restaurant_publish_history;
create policy publish_history_member_read on public.restaurant_publish_history
  for select using (restaurant_id in (select public.current_restaurant_ids()));

-- Rows are written by the functions below; the policy exists so a direct
-- insert by a manager is possible but updates and deletes are not: history is
-- append-only.
drop policy if exists publish_history_append on public.restaurant_publish_history;
create policy publish_history_append on public.restaurant_publish_history
  for insert with check (public.can_manage_restaurant(restaurant_id));

-- ------------------------------------------------------ publish (atomic)

create or replace function public.publish_menu_brand_pair(
  p_menu_id uuid,
  p_brand_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user      uuid := auth.uid();
  v_restaurant uuid;
  v_profile   public.restaurant_brand_profiles%rowtype;
  v_menu      public.menus%rowtype;
  v_prev_profile uuid;
  v_snapshot  jsonb;
  v_name      text;
  v_logo      text;
  v_banner    text;
  v_theme     jsonb;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  select * into v_profile
  from public.restaurant_brand_profiles
  where id = p_brand_profile_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'That brand draft does not exist.');
  end if;

  v_restaurant := v_profile.restaurant_id;

  if not public.has_restaurant_role(v_restaurant, array['owner', 'manager']) then
    return jsonb_build_object('ok', false, 'reason', 'Only an owner or manager can publish.');
  end if;

  -- The menu half is a write to public.menus, and every menus write is
  -- trial-gated by RLS (menus_manage = role AND restaurant_can_write,
  -- migration 20261029000100). This function runs as SECURITY DEFINER and
  -- would otherwise bypass that gate, so the same condition is enforced
  -- here. The pair is atomic: if the menu half cannot be written, neither
  -- half goes live.
  if not public.restaurant_can_write(v_restaurant) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Only an owner or manager can change the menu, and the trial must still be running. Nothing was published.'
    );
  end if;

  -- The pair must belong to the same restaurant, and the menu must exist.
  select * into v_menu from public.menus where id = p_menu_id;
  if not found or v_menu.restaurant_id <> v_restaurant then
    return jsonb_build_object('ok', false, 'reason', 'That menu is not on your account.');
  end if;

  -- Idempotent: publishing an already-published pair changes nothing and
  -- writes no second history row.
  if v_profile.status = 'published' and v_menu.is_published then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_profile.status = 'archived' then
    return jsonb_build_object('ok', false, 'reason', 'That brand draft is no longer current. Create a new draft.');
  end if;

  select id into v_prev_profile
  from public.restaurant_brand_profiles
  where restaurant_id = v_restaurant and status = 'published'
    and id <> v_profile.id
  limit 1;

  select name, logo_path, banner_path, brand_theme into v_name, v_logo, v_banner, v_theme
  from public.restaurants where id = v_restaurant;

  v_snapshot := jsonb_build_object(
    'name', v_name,
    'logo_path', v_logo,
    'banner_path', v_banner,
    'brand_theme', v_theme,
    'brand_theme_enabled', (select brand_theme_enabled from public.restaurants where id = v_restaurant),
    'brand_profile_id', v_prev_profile,
    'menu_is_published', v_menu.is_published
  );

  -- Resolve the asset paths the profile points at (same tenant, enforced by
  -- the composite FKs; the join is belt and braces).
  select a.path into v_logo
  from public.restaurant_brand_assets a
  where a.id = v_profile.logo_asset_id and a.restaurant_id = v_restaurant;
  select a.path into v_banner
  from public.restaurant_brand_assets a
  where a.id = v_profile.banner_asset_id and a.restaurant_id = v_restaurant;

  v_name  := case when v_profile.name is not null then btrim(v_profile.name) else v_name end;
  v_theme := v_profile.theme;

  -- One statement for the live brand. Either everything below commits or
  -- nothing does — this function is a single transaction.
  update public.restaurants
  set name = v_name,
      logo_path = v_logo,
      banner_path = v_banner,
      brand_theme = v_theme,
      brand_theme_enabled = true,
      brand_profile_id = v_profile.id,
      updated_at = now()
  where id = v_restaurant;

  update public.menus
  set is_published = true
  where id = p_menu_id;

  -- Version bookkeeping: the outgoing profile keeps its row as history.
  update public.restaurant_brand_profiles
  set status = 'archived', updated_at = now()
  where restaurant_id = v_restaurant and status = 'published' and id <> v_profile.id;

  update public.restaurant_brand_profiles
  set status = 'published',
      menu_id = p_menu_id,
      published_at = now(),
      published_by = v_user,
      updated_at = now()
  where id = v_profile.id;

  insert into public.restaurant_publish_history
    (restaurant_id, action, menu_id, brand_profile_id, snapshot, actor)
  values
    (v_restaurant, 'publish', p_menu_id, v_profile.id, v_snapshot, v_user);

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

revoke all on function public.publish_menu_brand_pair(uuid, uuid) from public;
revoke all on function public.publish_menu_brand_pair(uuid, uuid) from anon;
revoke all on function public.publish_menu_brand_pair(uuid, uuid) from authenticated;
grant execute on function public.publish_menu_brand_pair(uuid, uuid) to authenticated;

-- ------------------------------------------------------------- rollback

create or replace function public.rollback_last_publish(
  p_restaurant_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user   uuid := auth.uid();
  v_last   public.restaurant_publish_history%rowtype;
  v_snap   jsonb;
  v_menu_id uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    return jsonb_build_object('ok', false, 'reason', 'Only an owner or manager can roll back.');
  end if;

  -- Rollback also writes menus.is_published, so it carries the same trial
  -- gate as publish (see the note there): SECURITY DEFINER must not become a
  -- way around menus_manage.
  if not public.restaurant_can_write(p_restaurant_id) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Only an owner or manager can change the menu, and the trial must still be running. Nothing was rolled back.'
    );
  end if;

  select * into v_last
  from public.restaurant_publish_history
  where restaurant_id = p_restaurant_id
  order by created_at desc, id desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'There is nothing to roll back.');
  end if;
  if v_last.action = 'rollback' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_snap := v_last.snapshot;
  v_menu_id := v_last.menu_id;

  -- Put the previous live state back, one statement per table, same
  -- transaction: if anything fails, the current pair stays live.
  update public.restaurants
  set name = v_snap->>'name',
      logo_path = v_snap->>'logo_path',
      banner_path = v_snap->>'banner_path',
      brand_theme = (v_snap->'brand_theme'),
      brand_theme_enabled = coalesce((v_snap->>'brand_theme_enabled')::boolean, false),
      brand_profile_id = (v_snap->>'brand_profile_id')::uuid,
      updated_at = now()
  where id = p_restaurant_id;

  if v_menu_id is not null then
    update public.menus
    set is_published = coalesce((v_snap->>'menu_is_published')::boolean, false)
    where id = v_menu_id;
  end if;

  -- The restored profile (if any) is approved again; the rolled-back one goes
  -- back to draft so the owner can fix and re-publish it.
  if (v_snap->>'brand_profile_id') is not null then
    update public.restaurant_brand_profiles
    set status = 'published', updated_at = now()
    where id = (v_snap->>'brand_profile_id')::uuid
      and restaurant_id = p_restaurant_id;
  end if;

  update public.restaurant_brand_profiles
  set status = 'draft', updated_at = now()
  where id = v_last.brand_profile_id
    and restaurant_id = p_restaurant_id;

  insert into public.restaurant_publish_history
    (restaurant_id, action, menu_id, brand_profile_id, snapshot, actor)
  values
    (p_restaurant_id, 'rollback', v_menu_id, v_last.brand_profile_id, v_snap, v_user);

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

revoke all on function public.rollback_last_publish(uuid) from public;
revoke all on function public.rollback_last_publish(uuid) from anon;
revoke all on function public.rollback_last_publish(uuid) from authenticated;
grant execute on function public.rollback_last_publish(uuid) to authenticated;

-- ---------------------------------------------------------- brand theme
-- restaurants.brand_theme_enabled / brand_theme are written only by
-- publish_menu_brand_pair and rollback_last_publish above. The existing
-- restaurants_update policy covers the branding screen's logo/banner/name
-- writes and is deliberately NOT widened here.

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261103000100_brand_studio.sql','5a0ef45c8d1c3e80926e5388ae911ad59023d85a7dcda57c5e45db243e465f1c');

-- SOURCE 20261105000100_veg_tri_state.sql SHA256 b5247e496a14e286f0cd64af00275e713519ac1a41caee9a03e62cf01d7e1b4e
-- Veg tri-state: an unmarked dish is not vegetarian, it is UNMARKED.
--
-- WHY THIS MIGRATION EXISTS
--
-- `is_veg` was `not null default true`, and two layers quietly leaned on
-- that: the import sanitisers coerced anything that was not false into
-- true (the photo review even had an "unknown" state that displayed as a
-- green mark), and place_public_order_core snapshotted
-- coalesce(i.is_veg, true). In India the mark is a legal and religious
-- signal, not decoration: a dish the printed menu never marked must reach
-- the owner's review as "not marked", and the guest menu must show no mark
-- at all rather than a green dot that AutoDine invented.
--
-- WHAT CHANGES
--
--   items.is_veg / order_items.is_veg: nullable (NULL = the source never
--   said). The default is dropped on purpose: a forgotten column in a new
--   insert must surface as unmarked, never as vegetarian.
--
--   place_public_order_core: the temp-table column widens and the snapshot
--   passes is_veg through untouched. Everything else in the function is
--   byte-identical -- same price truth, same idempotency, same trial gate,
--   same revokes. CREATE OR REPLACE keeps the existing grants.
--
-- Safe to apply before the code ships: old code writes only true/false,
-- which nullable columns accept unchanged.

alter table public.items alter column is_veg drop default;
alter table public.items alter column is_veg drop not null;

alter table public.order_items alter column is_veg drop default;
alter table public.order_items alter column is_veg drop not null;

comment on column public.items.is_veg is
  'TRUE = marked vegetarian, FALSE = marked non-vegetarian, NULL = the source never marked it. Never assume.';
comment on column public.order_items.is_veg is
  'Snapshot of items.is_veg at order time. NULL = unmarked at order time.';

create or replace function public.place_public_order_core(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null
) returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_max_addons_per_line constant int := 20;
  k_default_tax_bps constant int := 500;
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  k_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  v_session public.table_verification_sessions%rowtype;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_table_id uuid;
  v_tax_bps int;
  v_note text;
  v_line_count int;
  v_subtotal_paise bigint := 0;
  v_discount_paise bigint := 0;
  v_taxable_paise bigint := 0;
  v_tax_paise bigint := 0;
  v_total_paise bigint := 0;
  v_code text;
  v_prefix text;
  v_order_id uuid;
  v_written int := 0;
begin
  if p_session_token is not null then
    if p_session_token !~ '^[A-Fa-f0-9]{64}$' then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select s.* into v_session
      from public.table_verification_sessions s
     where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
       and s.expires_at > statement_timestamp()
       and s.revoked_at is null;

    if not found then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.table_qr_codes q
       where q.id = v_session.qr_code_id
         and q.revoked_at is null
         and q.table_id = v_session.table_id
         and q.restaurant_id = v_session.restaurant_id
    ) then
      raise exception 'Your table verification is no longer valid. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.id = v_session.restaurant_id
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
    end if;

    select t.id into v_table_id
      from public.dining_tables t
     where t.id = v_session.table_id
       and t.restaurant_id = v_restaurant_id
       and t.is_active = true;

    if v_table_id is null then
      raise exception 'This table is not taking orders right now. Please ask staff.'
        using errcode = 'P0001';
    end if;

    if p_slug is not null and btrim(p_slug) <> '' then
      if not exists (
        select 1 from public.restaurants r
         where r.id = v_restaurant_id and r.slug = btrim(p_slug)
      ) then
        raise exception 'This order is for a different restaurant. Please open the menu again.'
          using errcode = 'P0001';
      end if;
    end if;
  else
    if p_slug is null or btrim(p_slug) = '' then
      raise exception 'No restaurant was given.' using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.slug = btrim(p_slug)
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders.' using errcode = 'P0001';
    end if;

    v_table_id := null;
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from public.menus m
     where m.restaurant_id = v_restaurant_id
       and m.is_published = true
  ) then
    raise exception 'That restaurant has no published menu.' using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count = 0 then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  if v_line_count > k_max_lines then
    raise exception 'That is more than % dishes in one order.', k_max_lines
      using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > k_max_note then
    v_note := left(v_note, k_max_note);
  end if;

  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean,
    sort_order int not null,
    variant_id uuid,
    variant_snapshot text,
    addon_ids uuid[] not null default '{}'
  ) on commit drop;

  create temporary table if not exists tt_line_addons (
    sort_order int not null,
    pick int not null,
    name text not null,
    price_paise bigint not null
  ) on commit drop;

  truncate tt_order_lines;
  truncate tt_line_addons;

  insert into tt_order_lines (
    item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_id, variant_snapshot, addon_ids
  )
  select
    i.id,
    i.name,
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    i.is_veg,
    ord,
    v.id,
    v.name,
    coalesce((
      select array_agg(ids.v)
        from (
          select distinct t.v
            from jsonb_array_elements_text(
                   case
                     when jsonb_typeof(line->'addon_ids') = 'array' then line->'addon_ids'
                     when jsonb_typeof(line->'addonIds') = 'array' then line->'addonIds'
                     else '[]'::jsonb
                   end
                 ) as t(v)
           where t.v ~ k_uuid_pattern
           limit k_max_addons_per_line
        ) ids
    ), '{}')::uuid[]
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
      join public.menus m
        on m.id = c.menu_id
       and m.restaurant_id = v_restaurant_id
       and m.is_published = true
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
     limit 1
  ) i on true
  left join public.item_variants v
    on v.id = nullif(coalesce(line->>'variant_id', line->>'variantId'), '')::uuid
   and v.item_id = i.id
  where jsonb_typeof(line) = 'object'
    and (line->>'qty') ~ '^[0-9]+$'
    and (line->>'qty')::int > 0;

  select count(*) into v_written from tt_order_lines;

  if v_written = 0 then
    raise exception 'None of those dishes are available right now.' using errcode = 'P0001';
  end if;

  insert into tt_line_addons (sort_order, pick, name, price_paise)
  select line_ord, pick, name, price_paise
    from (
      select l.sort_order as line_ord,
             a.name,
             a.price_paise,
             row_number() over (partition by l.sort_order, g.id order by want.ord) as pick,
             g.max_select
        from tt_order_lines l
        cross join lateral unnest(l.addon_ids) with ordinality as want(id, ord)
        join public.item_addons a
          on a.id = want.id
         and a.is_available = true
        join public.item_addon_groups g
          on g.id = a.group_id
         and g.item_id = l.item_id
    ) picked
   where pick <= max_select
   order by line_ord, pick;

  -- THE FIX. This was `update tt_order_lines ... ;` with no predicate, which
  -- safeupdate refuses. A line with no add-ons was only ever having zero added
  -- to it, so restricting the update to the lines that do have add-ons is the
  -- same arithmetic with an honest predicate.
  update tt_order_lines l
     set unit_price_paise = l.unit_price_paise + priced.sum_paise
    from (
      select x.sort_order, sum(x.price_paise)::bigint as sum_paise
        from tt_line_addons x
       group by x.sort_order
    ) priced
   where priced.sort_order = l.sort_order;

  select coalesce(sum(unit_price_paise * qty), 0)::bigint
    into v_subtotal_paise
    from tt_order_lines;

  v_tax_bps := coalesce(v_restaurant_tax_bps, k_default_tax_bps);

  v_discount_paise := 0;
  v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
  v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
  v_total_paise := v_taxable_paise + v_tax_paise;

  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant_name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  v_code := v_prefix || '-' || (
    select string_agg(
             substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1),
             ''
           )
      from generate_series(1, 5)
  );

  insert into public.orders (
    restaurant_id,
    table_id,
    code,
    customer_note,
    prep_status,
    payment_status,
    subtotal_paise,
    discount_paise,
    tax_paise,
    total_paise
  ) values (
    v_restaurant_id,
    v_table_id,
    v_code,
    v_note,
    'new',
    'pending',
    v_subtotal_paise,
    v_discount_paise,
    v_tax_paise,
    v_total_paise
  )
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'The order could not be recorded.' using errcode = 'P0001';
  end if;

  insert into public.order_items (
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot, addons_snapshot
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot,
    coalesce((
      select array_agg(x.name order by x.pick)
        from tt_line_addons x
       where x.sort_order = tt_order_lines.sort_order
    ), array[]::text[])
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

revoke all on function public.place_public_order_core(text, jsonb, text, text) from public;
revoke all on function public.place_public_order_core(text, jsonb, text, text) from anon;
revoke all on function public.place_public_order_core(text, jsonb, text, text) from authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261105000100_veg_tri_state.sql','b5247e496a14e286f0cd64af00275e713519ac1a41caee9a03e62cf01d7e1b4e');

-- SOURCE 20261106000000_menu_translations.sql SHA256 f7b13237f05426bc297c03142402511d3751f08727d5035dfeae5dd063eb365e
-- R3, part 2: menu translations.
--
-- Per-item and per-category language data, stored beside the original and
-- never in place of it. The original name and description stay the source of
-- truth; a translation is a separate entry carrying its own approval and a
-- hash of the source text it was made from, so a menu update makes the old
-- translation visibly outdated instead of silently stale. The guest screen
-- shows a translation only while it is approved AND its hash still matches;
-- otherwise it falls back to the original — never blank, never mixed-up
-- language. Guests read these columns through the existing items_public /
-- categories_public policies (row level); only restaurant writes change them.

alter table public.items
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.categories
  add column if not exists translations jsonb not null default '{}'::jsonb;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261106000000_menu_translations.sql','f7b13237f05426bc297c03142402511d3751f08727d5035dfeae5dd063eb365e');

-- SOURCE 20261107000000_storefront_settings.sql SHA256 a530b163e3683b11944b33e0eec0566a8d3616523e0e09d13b2fed9972c37eec
-- ============================================================================
-- Storefront settings: the announcement banner
--
-- WHAT THIS IS
--
-- The owner writes one line -- a festival note, an early close, a new outlet
-- -- and it appears at the top of the guest menu. Off by default: nothing is
-- shown until the owner writes something and turns it on.
--
-- WHAT THIS IS NOT
--
-- The open/closed decision is deliberately NOT here. `restaurants.is_active`
-- has always been the ordering status: the guest reads filter on it,
-- place_public_order refuses with "That restaurant is not taking orders." and
-- the table scan says "Not taking orders right now." The owner toggle writes
-- that existing column; adding a second flag would create two answers to one
-- question, and the day they disagree the guest gets one story and the
-- kitchen another.
-- ============================================================================

alter table public.restaurants
  add column if not exists announcement_text text,
  add column if not exists announcement_on   boolean not null default false;

alter table public.restaurants
  drop constraint if exists restaurants_announcement_text_len;
alter table public.restaurants
  add constraint restaurants_announcement_text_len
  check (announcement_text is null or char_length(announcement_text) <= 200);

comment on column public.restaurants.announcement_text is
  'One line the owner wants guests to read at the top of the menu. Shown only when announcement_on is true.';
comment on column public.restaurants.announcement_on is
  'Whether the announcement banner appears on the guest menu. Off by default.';

-- ============================================================================
-- What closing must NOT touch: an order already placed.
--
-- `is_active` off blocks NEW business -- place_public_order refuses it. But
-- three read/pay paths over an EXISTING order also carried the filter, so a
-- guest who ordered at 8:55 could no longer see, or pay for, their order the
-- moment the owner closed at 9:00. A placed order's status and payment belong
-- to that order, not to the storefront's hours. The same bodies, without the
-- filter. The real credential checks -- code plus guest token -- are all still
-- here and untouched.
--
-- settle_online_payment is deliberately not redefined: it never carried the
-- filter, so money in flight settles whether the shop is open or shut.
-- ============================================================================

create or replace function public.get_public_order(
  p_slug text,
  p_code text,
  p_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'prep_status', o.prep_status,
    'payment_status', o.payment_status,
    'subtotal_paise', o.subtotal_paise,
    'tax_paise', o.tax_paise,
    'total_paise', o.total_paise,
    'customer_note', o.customer_note,
    'placed_at', o.placed_at,
    'table_label', t.label,
    'lines', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name_snapshot,
                 'qty', i.qty,
                 'unit_price_paise', i.unit_price_paise,
                 'is_veg', i.is_veg,
                 'variant', i.variant_snapshot,
                 'addons', i.addons_snapshot
               )
               order by i.sort_order
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.dining_tables t on t.id = o.table_id
  where r.slug = p_slug
    and o.code = p_code
    and p_token is not null
    and o.guest_token = p_token
  limit 1;
$$;

revoke all on function public.get_public_order(text, text, uuid) from public;
revoke all on function public.get_public_order(text, text, uuid) from anon;
revoke all on function public.get_public_order(text, text, uuid) from authenticated;
grant execute on function public.get_public_order(text, text, uuid) to anon;
grant execute on function public.get_public_order(text, text, uuid) to authenticated;

create or replace function public.public_online_due(
  p_slug  text,
  p_code  text,
  p_token uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_enabled boolean;
  v_name    text;
  v_paid    bigint := 0;
begin
  if p_token is null or p_token = '00000000-0000-0000-0000-000000000000'::uuid then
    return null;
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.code = p_code
     and o.guest_token = p_token
     and r.slug = p_slug;

  if not found then
    return null;
  end if;

  select coalesce(r.online_payments_enabled, false), r.name
    into v_enabled, v_name
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  return jsonb_build_object(
    'order_id',      v_order.id,
    'code',          v_order.code,
    'restaurant_name', v_name,
    'enabled',       coalesce(v_enabled, false),
    'payment_status', v_order.payment_status,
    'prep_status',   v_order.prep_status,
    'total_paise',   v_order.total_paise,
    'due_paise',     greatest(v_order.total_paise - v_paid, 0)
  );
end;
$$;

create or replace function public.begin_online_payment(
  p_provider            text,
  p_provider_order_ref  text,
  p_slug                text,
  p_order_id            uuid,
  p_guest_token         uuid,
  p_amount_paise        bigint
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders%rowtype;
  v_enabled boolean;
  v_paid    bigint := 0;
  v_due     bigint := 0;
  v_key     text;
  v_row     public.payments%rowtype;
  v_id      uuid;
begin
  if p_provider is null or btrim(p_provider) = '' then
    raise exception 'No payment provider was named.' using errcode = '22023';
  end if;

  if p_provider_order_ref is null or btrim(p_provider_order_ref) = '' then
    raise exception 'The provider did not return an order id.' using errcode = '22023';
  end if;

  if p_guest_token is null then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  -- Lock first, then prove the credential. Two statements on purpose: the
  -- lock has to be taken before the balance is computed, and it is taken on
  -- the row the token resolves to, so a wrong token locks nothing it should
  -- not.
  select o.id into v_order.id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id
     and o.guest_token = p_guest_token
     and r.slug = p_slug
   for update of o;

  if v_order.id is null then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
   where o.id = p_order_id
     and o.guest_token = p_guest_token
     and r.slug = p_slug;

  if not found then
    raise exception 'This order cannot be paid from here.' using errcode = '42501';
  end if;

  select coalesce(r.online_payments_enabled, false)
    into v_enabled
    from public.restaurants r
   where r.id = v_order.restaurant_id;

  if not coalesce(v_enabled, false) then
    raise exception 'Online payment is not switched on for this restaurant.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_order.restaurant_id) then
    raise exception 'This restaurant is not taking payments right now.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order was cancelled.' using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order is already settled.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = v_order.id
     and p.status = 'recorded';

  v_due := greatest(v_order.total_paise - v_paid, 0);

  if v_due <= 0 then
    raise exception 'This order has no outstanding balance.' using errcode = 'P0001';
  end if;

  if p_amount_paise is null or p_amount_paise <> v_due then
    raise exception 'The amount offered does not match what this order owes.'
      using errcode = 'P0001';
  end if;

  -- Idempotent on the provider's order id: a retried request attaches to the
  -- attempt already recorded instead of creating a second one.
  v_key := 'online-intent:' || p_provider || ':' || p_provider_order_ref;

  select * into v_row from public.payments p where p.idempotency_key = v_key;
  if found then
    if v_row.order_id <> v_order.id or v_row.amount_paise <> v_due then
      raise exception 'That payment attempt belongs to a different order.'
        using errcode = 'P0001';
    end if;
    return v_row.id;
  end if;

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, provider_ref, idempotency_key
  ) values (
    v_order.id, v_order.restaurant_id, 'online', v_due, 'pending',
    p_provider, p_provider_order_ref, v_key
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.public_online_due(text, text, uuid) from public;
revoke all on function public.public_online_due(text, text, uuid) from anon;
revoke all on function public.public_online_due(text, text, uuid) from authenticated;
grant execute on function public.public_online_due(text, text, uuid) to service_role;

revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from public;
revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from anon;
revoke all on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) from authenticated;
grant execute on function public.begin_online_payment(text, text, text, uuid, uuid, bigint) to service_role;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261107000000_storefront_settings.sql','a530b163e3683b11944b33e0eec0566a8d3616523e0e09d13b2fed9972c37eec');

-- SOURCE 20261107074545_order_sessions.sql SHA256 f51ddd3fe7b5b73d58ec959f8d47dcb55ab4b14b4408959bd11d9cca3f1e7e05
-- ============================================================================
-- AutoDine — migration 20261107074545: one table, one active order session
--
-- WHY THIS EXISTS
--
-- The redesign's core rule is "ONE TABLE = ONE ACTIVE ORDER SESSION = ONE
-- CONSOLIDATED BILL": from the first order until the restaurant closes the
-- tab at checkout, every ticket at that table joins one sitting.
--
-- The closest thing that existed -- orders.table_session_id -- is the
-- VERIFICATION session (table_verification_sessions), and that is the wrong
-- life cycle for a bill: it expires with the QR window (about an hour). A
-- two-hour lunch where guests re-verify once would split into two "sessions"
-- and two bills. The comment on that column always described the intent
-- ("group a party's orders"); this table gives the intent its own entity with
-- the right life: opened by the FIRST ORDER at the table, closed only by the
-- restaurant at checkout (Phase 8), immune to QR re-verifications.
--
-- WHAT THIS ADDS
--
--   1. order_sessions -- the sitting itself. One OPEN row per table, enforced
--      by a partial unique index, so concurrent first orders race safely:
--      the loser of the insert joins the winner's row via ON CONFLICT.
--   2. orders.order_session_id -- which sitting the ticket belongs to.
--      Nullable and ON DELETE SET NULL: order history survives anything that
--      happens to the grouping.
--   3. place_public_order attaches every new ticket to the table's open
--      session (or opens one). A CLOSED session is never joined: the next
--      order at that table opens a fresh sitting, which is exactly what
--      "the table becomes available for a new session" means. So a closed
--      session can no longer receive orders -- they land on the new one.
--
-- WHAT THIS DOES NOT DO
--
--   No UI yet: Phase 4 (dashboard cards) reads this and Phase 6 (the
--   consolidated invoice) bills it. No backfill: existing orders keep
--   order_session_id NULL and old bills are unaffected. The verification
--   session and its hold/confirm machinery are untouched -- stamping runs
--   exactly as before.
--
-- IDEMPOTENCY, AND WHY THE RACE BELOW IS SAFE
--
-- place_public_order is idempotent on p_guest_token (20261027000900): the
-- replay check returns the existing code before any of this runs. The
-- concurrency case -- two posts of one attempt landing together -- is
-- resolved by the unique index on orders.guest_token: the second writer
-- raises unique_violation, and the EXCEPTION block rolls the whole function
-- body back (plpgsql runs it in a subtransaction) before returning the first
-- writer's code. That is why the session attach below may freely UPDATE the
-- order after the insert: on the losing path there is no order left to
-- update. Do not "simplify" this by moving work outside the block or
-- committing mid-function -- that is the refactor that would leave ghost
-- duplicate orders behind.
--
-- APPLYING THIS
--
-- Additive: one table, one column, one index pair, one function
-- replacement (same signature). The running app notices nothing until the
-- phases that read the column ship.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The sitting.
-- ---------------------------------------------------------------------------
create table if not exists public.order_sessions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id      uuid not null references public.dining_tables(id) on delete cascade,
  opened_at     timestamptz not null default now(),
  -- Written by the checkout flow (Phase 8). Until then a sitting stays open.
  closed_at     timestamptz,
  closed_by     uuid references public.profiles(id),
  status        text not null default 'open'
                check (status in ('open', 'closed'))
);

-- One open sitting per table. This partial unique index is also the race
-- arbiter for the open-or-join upsert in place_public_order.
create unique index if not exists order_sessions_open_unique
  on public.order_sessions (table_id)
  where status = 'open';

create index if not exists order_sessions_restaurant_idx
  on public.order_sessions (restaurant_id, opened_at desc);

-- RLS: deny by default. Staff may read their own restaurant's sittings;
-- everything else goes through security-definer functions.
alter table public.order_sessions enable row level security;
revoke all on public.order_sessions from anon;
revoke all on public.order_sessions from authenticated;
revoke all on public.order_sessions from service_role;

create policy order_sessions_staff on public.order_sessions
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
     where m.restaurant_id = order_sessions.restaurant_id
       and m.user_id = auth.uid()
  ));


-- ---------------------------------------------------------------------------
-- 2. Which sitting a ticket joined.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists order_session_id uuid
    references public.order_sessions(id) on delete set null;

comment on column public.orders.order_session_id is
  'The sitting (order session) this ticket belongs to: one per table, opened by its first order and closed only at checkout. Distinct from table_session_id, which is the short-lived QR verification session.';

create index if not exists orders_order_session_idx
  on public.orders (order_session_id)
  where order_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. place_public_order: every new ticket joins the table's open sitting.
--
--    The body is the 20261108000200 version unchanged except for step 4.
--    Signatures and grants are exactly as they were: one function, no
--    unguarded overload, anon may call it and nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.place_public_order(
  p_slug          text,
  p_lines         jsonb,
  p_note          text default null,
  p_session_token text default null,
  p_guest_token   uuid default null,
  p_ip_hash       text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
  v_allowed   boolean;
  v_retry     integer;
  v_table_id  uuid;
  v_order_session_id uuid;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  -- ---------------------------------------------------------------- replay
  if p_guest_token is not null and v_restaurant_id is not null then
    select o.code into v_existing
      from public.orders o
     where o.guest_token = p_guest_token
       and o.restaurant_id = v_restaurant_id
     limit 1;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- ----------------------------------------------------------- rate limit
  select a.allowed, a.retry_after_seconds
    into v_allowed, v_retry
    from public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  if coalesce(v_allowed, true) then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  end if;

  if coalesce(v_allowed, true) and p_ip_hash is not null and btrim(p_ip_hash) <> '' then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
  end if;

  if coalesce(v_allowed, true) is not true then
    raise exception 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      using errcode = 'P0001', hint = 'rate-limited';
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  -- Stamp the verification sitting onto the order: session id always (scan or
  -- code), and hold_required for a scan_confirm sitting nobody has vouched
  -- for yet.
  perform public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token));

  if p_guest_token is not null then
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id;
  end if;

  -- 4. The sitting: one open order session per table. The upsert opens one
  --    for a table's first order and joins the existing one afterwards; a
  --    closed sitting is never joined, so the next order after checkout
  --    starts a fresh bill exactly as the flow promises.
  select o.table_id into v_table_id
    from public.orders o
   where o.code = v_code
     and o.restaurant_id = v_restaurant_id;

  if v_table_id is not null then
    insert into public.order_sessions (restaurant_id, table_id)
    values (v_restaurant_id, v_table_id)
    on conflict (table_id) where status = 'open'
    do update set table_id = excluded.table_id
    returning id into v_order_session_id;

    update public.orders o
       set order_session_id = v_order_session_id
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id
       and o.order_session_id is null;
  end if;

  return v_code;

exception
  when unique_violation then
    if p_guest_token is not null then
      select o.code into v_existing
        from public.orders o
       where o.guest_token = p_guest_token
         and (v_restaurant_id is null or o.restaurant_id = v_restaurant_id)
       limit 1;

      if v_existing is not null then
        return v_existing;
      end if;
    end if;
    raise;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text, uuid, text) is
  'Guest order placement: server-priced, idempotent on p_guest_token, rate '
  'limited per session / per table / per ip hash, and attached to the table''s '
  'open order session (one consolidated bill per sitting).';

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261107074545_order_sessions.sql','f51ddd3fe7b5b73d58ec959f8d47dcb55ab4b14b4408959bd11d9cca3f1e7e05');

-- SOURCE 20261107080000_payment_audit_ledger.sql SHA256 341a1cc55ec7b4a6c6c41b596b747b8d77ad7f851675a94df46d516a71957a41
-- Counter and session settlement both persist the staff actor.
alter table public.payments add column if not exists recorded_by uuid references public.profiles(id) on delete set null;
-- Complete the ledger before the P4 migration alters its constraints. This
-- backfill is intentionally ordered before P4 for fresh installs. Existing
-- deployments must review their schema/history before applying backfills.
create table if not exists public.payment_audit_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  method text not null,
  amount_paise bigint not null check (amount_paise >= 0),
  created_at timestamptz not null default now(),
  unique (payment_id, event_type)
);
create index if not exists payment_audit_events_restaurant_created_idx
  on public.payment_audit_events (restaurant_id, created_at desc);
alter table public.payment_audit_events enable row level security;
revoke all on public.payment_audit_events from public, anon, authenticated;
grant select on public.payment_audit_events to authenticated;
drop policy if exists payment_audit_events_staff_read on public.payment_audit_events;
create policy payment_audit_events_staff_read on public.payment_audit_events
  for select to authenticated using (public.is_member(restaurant_id));
-- Ledger writes are confined to SECURITY DEFINER payment functions.

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261107080000_payment_audit_ledger.sql','341a1cc55ec7b4a6c6c41b596b747b8d77ad7f851675a94df46d516a71957a41');

-- SOURCE 20261107082936_session_manual_payment_p4.sql SHA256 f916098300e5aaa1daa55305a37818d5e31588e52e8c1e02fb9ba4c28ab423a4
-- ============================================================================
-- P4: mark one table session paid, with an auditable internal ledger entry.
--
-- The operator sees one simple tick for the whole table session. There is no
-- payment-mode selector. Internally the settlement is recorded as method
-- 'manual', so dashboard/report revenue remains backed by the same payments
-- ledger as cash/card/UPI and the staff/timestamp are auditable.
--
-- The manual method is not accepted by record_counter_payment and is never
-- exposed as a cashier choice. This RPC derives every amount from locked order
-- rows and existing recorded payments; the caller submits only a session UUID.
-- ============================================================================

-- Keep the existing methods intact and add the internal manual marker. The
-- audit-event table was originally cash-only even though the counter RPC has
-- supported cash/card/UPI since migration 20261020170906; widening this precise
-- set restores those existing paths while adding the manual event.
alter table public.payments
  drop constraint if exists payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method in ('cash', 'card', 'upi', 'online', 'manual'));

alter table public.payment_audit_events
  drop constraint if exists payment_audit_events_method_check;
alter table public.payment_audit_events
  add constraint payment_audit_events_method_check
  check (method in ('cash', 'card', 'upi', 'online', 'manual'));

alter table public.payment_audit_events
  drop constraint if exists payment_audit_events_event_type_check;
alter table public.payment_audit_events
  add constraint payment_audit_events_event_type_check
  check (event_type in ('cash_collected', 'card_collected', 'upi_collected', 'online_collected', 'manual_marked_paid'));

alter table public.order_sessions
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid references public.profiles(id) on delete set null;

comment on column public.order_sessions.paid_at is
  'When staff marked this sitting paid, or the latest settlement time used to show a fully paid session.';
comment on column public.order_sessions.paid_by is
  'Staff member who marked this sitting paid. Null when it was settled only through individual counter payments.';

-- SECURITY DEFINER; derives restaurant and role from the locked session, never
-- trusts a restaurant id, amount, payment method, or actor supplied by client.
create or replace function public.mark_order_session_paid(
  p_order_session_id uuid
) returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id       uuid;
  v_role           public.member_role;
  v_session       public.order_sessions%rowtype;
  v_order         public.orders%rowtype;
  v_paid_paise    bigint;
  v_due_paise     bigint;
  v_payment_id    uuid;
  v_existing      public.payments%rowtype;
  v_key           text;
  v_order_count   integer := 0;
  v_recorded_any  boolean := false;
  v_settled_at    timestamptz;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'Sign in with an authorized restaurant account to mark a table paid.'
      using errcode = '42501';
  end if;

  select s.* into v_session
    from public.order_sessions s
    join public.restaurants r on r.id = s.restaurant_id and r.is_active
   where s.id = p_order_session_id
   for update of s;

  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_session.restaurant_id
     and m.user_id = v_actor_id;

  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to settle this table.'
      using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_session.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before marking a table paid.'
      using errcode = 'P0001';
  end if;

  if v_session.status <> 'open' or v_session.closed_at is not null then
    raise exception 'This table session is already closed.' using errcode = 'P0001';
  end if;

  -- One table can have several tickets. Lock them in stable order so a
  -- concurrent counter payment cannot race the balance calculation.
  for v_order in
    select o.*
      from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
     order by o.id
     for update
  loop
    v_order_count := v_order_count + 1;

    select coalesce(sum(p.amount_paise), 0)::bigint
      into v_paid_paise
      from public.payments p
     where p.order_id = v_order.id
       and p.status = 'recorded';

    v_due_paise := greatest(v_order.total_paise - v_paid_paise, 0);

    if v_due_paise > 0 then
      v_key := 'manual-session:' || v_session.id::text || ':' || v_order.id::text;

      select * into v_existing
        from public.payments p
       where p.idempotency_key = v_key;

      if found then
        if v_existing.order_id <> v_order.id
           or v_existing.amount_paise <> v_due_paise
           or v_existing.method <> 'manual'
           or v_existing.status <> 'recorded' then
          raise exception 'The manual settlement key conflicts with an existing payment.'
            using errcode = 'P0001';
        end if;
        v_payment_id := v_existing.id;
      else
        insert into public.payments (
          order_id, restaurant_id, method, amount_paise, status,
          provider, recorded_by, idempotency_key
        ) values (
          v_order.id, v_session.restaurant_id, 'manual', v_due_paise, 'recorded',
          'staff_manual', v_actor_id, v_key
        ) returning id into v_payment_id;

        insert into public.payment_audit_events (
          restaurant_id, order_id, payment_id, actor_id,
          event_type, method, amount_paise
        ) values (
          v_session.restaurant_id, v_order.id, v_payment_id, v_actor_id,
          'manual_marked_paid', 'manual', v_due_paise
        ) on conflict (payment_id, event_type) do nothing;

        v_recorded_any := true;
      end if;
    end if;

    update public.orders
       set payment_status = 'paid',
           updated_at = statement_timestamp()
     where id = v_order.id
       and restaurant_id = v_session.restaurant_id;
  end loop;

  if v_order_count = 0 then
    raise exception 'This table has no active tickets to settle.' using errcode = 'P0001';
  end if;

  if v_recorded_any then
    v_settled_at := statement_timestamp();
    update public.order_sessions
       set paid_at = v_settled_at,
           paid_by = v_actor_id
     where id = v_session.id;
  else
    -- Idempotent retry: keep the original marker. For sessions settled through
    -- individual cashier payments, use the latest recorded ledger timestamp.
    select coalesce(
      v_session.paid_at,
      max(p.created_at),
      statement_timestamp()
    ) into v_settled_at
      from public.orders o
      left join public.payments p
        on p.order_id = o.id and p.status = 'recorded'
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled';

    update public.order_sessions
       set paid_at = coalesce(paid_at, v_settled_at),
           paid_by = coalesce(paid_by, v_actor_id)
     where id = v_session.id
     returning paid_at into v_settled_at;
  end if;

  return v_settled_at;
end;
$$;

comment on function public.mark_order_session_paid(uuid) is
  'Atomically marks an open table session paid, derives each remaining order balance server-side, records internal manual ledger/audit rows, and stores staff plus timestamp.';

revoke all on function public.mark_order_session_paid(uuid) from public;
revoke all on function public.mark_order_session_paid(uuid) from anon;
revoke all on function public.mark_order_session_paid(uuid) from authenticated;
grant execute on function public.mark_order_session_paid(uuid) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261107082936_session_manual_payment_p4.sql','f916098300e5aaa1daa55305a37818d5e31588e52e8c1e02fb9ba4c28ab423a4');

-- SOURCE 20261107104440_p5_voice_waiter.sql SHA256 9fe4f5cbc412941fe0e49e3d1354eb1dce4a4f84c057061b0eec5834b3b3a51c
-- P5: durable kitchen announcement outcomes and table-scoped waiter calls.
-- Guest writes are bearer-session checked in SECURITY DEFINER RPCs; staff
-- reads are membership-scoped by RLS; all mutations go through guarded RPCs.

-- Order announcements are sound, not order state. Keep the latest delivered
-- outcome on the order without changing its prep/payment state machines.
alter table public.orders
  add column if not exists kitchen_announcement_status text,
  add column if not exists kitchen_announcement_at timestamptz,
  add column if not exists kitchen_announcement_error text;

alter table public.orders
  drop constraint if exists orders_kitchen_announcement_status_check;
alter table public.orders
  add constraint orders_kitchen_announcement_status_check
  check (kitchen_announcement_status is null or kitchen_announcement_status in ('announced', 'failed'));

create or replace function public.record_kitchen_announcement_result(
  p_order_id uuid,
  p_status text,
  p_failure_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_reason text := left(nullif(btrim(p_failure_reason), ''), 200);
begin
  if auth.uid() is null then
    raise exception 'Sign in to record a kitchen announcement.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('announced', 'failed') then
    raise exception 'That announcement result is not valid.' using errcode = '22023';
  end if;
  if p_status = 'announced' then
    v_reason := null;
  elsif v_reason is null then
    v_reason := 'Speech did not complete.';
  end if;

  select o.restaurant_id into v_restaurant_id
    from public.orders o
   where o.id = p_order_id;
  if not found then
    return false;
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only kitchen staff may record an announcement.' using errcode = '42501';
  end if;

  update public.orders
     set kitchen_announcement_status = p_status,
         kitchen_announcement_at = statement_timestamp(),
         kitchen_announcement_error = v_reason
   where id = p_order_id and restaurant_id = v_restaurant_id;
  return found;
end;
$$;

revoke all on function public.record_kitchen_announcement_result(uuid, text, text) from public, anon;
grant execute on function public.record_kitchen_announcement_result(uuid, text, text) to authenticated;

-- The cross-device auto-announcement winner is distinct from the persisted
-- outcome: a device that cannot speak must not consume another device's claim.
create table if not exists public.kitchen_announcement_claims (
  order_id uuid primary key references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz not null default statement_timestamp()
);
create index if not exists kitchen_announcement_claims_restaurant_idx
  on public.kitchen_announcement_claims (restaurant_id, claimed_at desc);
alter table public.kitchen_announcement_claims enable row level security;
revoke all on public.kitchen_announcement_claims from public, anon, authenticated;

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

  insert into public.kitchen_announcement_claims (order_id, restaurant_id, claimed_by)
  values (p_order_id, v_restaurant_id, v_actor)
  on conflict (order_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;
revoke all on function public.claim_kitchen_order_announcement(uuid) from public, anon;
grant execute on function public.claim_kitchen_order_announcement(uuid) to authenticated;

-- A waiter call is tied to the live QR verification session by its stored
-- token hash (the verification table deliberately has no surrogate id). The
-- board keeps its table-label snapshot when an expired session is purged.
create table if not exists public.table_waiter_calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  table_id uuid not null references public.dining_tables(id) on delete restrict,
  table_session_hash text references public.table_verification_sessions(token_hash) on delete set null,
  table_label_snapshot text not null,
  request_key uuid not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  announcement_status text not null default 'pending'
    check (announcement_status in ('pending', 'claimed', 'announced', 'failed')),
  announcement_claimed_at timestamptz,
  announcement_at timestamptz,
  announcement_error text,
  constraint table_waiter_calls_request_unique unique (table_session_hash, request_key),
  constraint table_waiter_calls_resolution_check check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

create unique index if not exists table_waiter_calls_one_open_per_table
  on public.table_waiter_calls (table_id) where status = 'open';
create index if not exists table_waiter_calls_board_idx
  on public.table_waiter_calls (restaurant_id, created_at) where status = 'open';

alter table public.table_waiter_calls enable row level security;
revoke all on public.table_waiter_calls from public, anon, authenticated;
grant select on public.table_waiter_calls to authenticated;
create policy table_waiter_calls_staff_read on public.table_waiter_calls
  for select to authenticated
  using (public.is_member(restaurant_id));

create or replace function public.call_waiter(
  p_session_token text,
  p_request_key uuid
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_hash text;
  v_restaurant_id uuid;
  v_table_id uuid;
  v_table_label text;
  v_existing_status text;
  v_open_id uuid;
  v_recent boolean;
begin
  if p_request_key is null or p_session_token is null
     or p_session_token !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'Verify your table before calling a waiter.' using errcode = 'P0001';
  end if;

  -- Lock the table row to serialize double-taps and the cooldown check.
  select s.token_hash, s.restaurant_id, s.table_id, t.label
    into v_session_hash, v_restaurant_id, v_table_id, v_table_label
    from public.table_verification_sessions s
    join public.restaurants r on r.id = s.restaurant_id and r.is_active
    join public.dining_tables t on t.id = s.table_id
         and t.restaurant_id = s.restaurant_id and t.is_active
    join public.table_qr_codes q on q.id = s.qr_code_id and q.revoked_at is null
   where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
     and s.expires_at > statement_timestamp()
     and s.revoked_at is null
   for update of t;
  if not found then
    raise exception 'Your table session has expired. Scan the code on your table again.' using errcode = 'P0001';
  end if;

  select c.status into v_existing_status
    from public.table_waiter_calls c
   where c.table_session_hash = v_session_hash and c.request_key = p_request_key;
  if found then
    return case when v_existing_status = 'open' then 'already_open' else 'already_handled' end;
  end if;

  select c.id into v_open_id
    from public.table_waiter_calls c
   where c.table_id = v_table_id and c.status = 'open'
   limit 1;
  if found then return 'already_open'; end if;

  select exists (
    select 1 from public.table_waiter_calls c
     where c.table_id = v_table_id
       and c.created_at > statement_timestamp() - interval '30 seconds'
  ) into v_recent;
  if v_recent then return 'wait_a_moment'; end if;

  insert into public.table_waiter_calls (
    restaurant_id, table_id, table_session_hash, table_label_snapshot, request_key
  ) values (
    v_restaurant_id, v_table_id, v_session_hash, v_table_label, p_request_key
  );
  return 'created';
exception
  when unique_violation then
    -- A concurrent call for this table is already open; treat the retry as a
    -- successful acknowledgement rather than creating a second alert.
    return 'already_open';
end;
$$;
revoke all on function public.call_waiter(text, uuid) from public;
revoke all on function public.call_waiter(text, uuid) from authenticated;
grant execute on function public.call_waiter(text, uuid) to anon, authenticated;

create or replace function public.claim_table_waiter_call_announcement(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
begin
  if v_actor is null then raise exception 'Sign in to announce a waiter call.' using errcode = '42501'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open' and c.announcement_status = 'pending'
   for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen', 'cashier')
  ) then raise exception 'You cannot access waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set announcement_status = 'claimed', announcement_claimed_at = statement_timestamp()
   where id = p_call_id and announcement_status = 'pending';
  return found;
end;
$$;
revoke all on function public.claim_table_waiter_call_announcement(uuid) from public, anon;
grant execute on function public.claim_table_waiter_call_announcement(uuid) to authenticated;

create or replace function public.record_table_waiter_call_announcement(
  p_call_id uuid,
  p_status text,
  p_failure_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_reason text := left(nullif(btrim(p_failure_reason), ''), 200);
begin
  if v_actor is null then raise exception 'Sign in to record a waiter-call announcement.' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('announced', 'failed') then raise exception 'That announcement result is not valid.' using errcode = '22023'; end if;
  if p_status = 'announced' then v_reason := null; elsif v_reason is null then v_reason := 'Speech did not complete.'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open';
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen', 'cashier')
  ) then raise exception 'You cannot access waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set announcement_status = p_status,
         announcement_at = statement_timestamp(),
         announcement_error = v_reason
   where id = p_call_id and restaurant_id = v_restaurant_id and status = 'open';
  return found;
end;
$$;
revoke all on function public.record_table_waiter_call_announcement(uuid, text, text) from public, anon;
grant execute on function public.record_table_waiter_call_announcement(uuid, text, text) to authenticated;

create or replace function public.resolve_table_waiter_call(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
begin
  if v_actor is null then raise exception 'Sign in to clear a waiter call.' using errcode = '42501'; end if;
  select c.restaurant_id into v_restaurant_id
    from public.table_waiter_calls c
   where c.id = p_call_id and c.status = 'open'
   for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant_id
       and m.user_id = v_actor
       and m.role in ('owner', 'manager', 'kitchen', 'cashier')
  ) then raise exception 'You cannot clear waiter calls for this restaurant.' using errcode = '42501'; end if;
  update public.table_waiter_calls
     set status = 'resolved', resolved_at = statement_timestamp(), resolved_by = v_actor
   where id = p_call_id and status = 'open';
  return found;
end;
$$;
revoke all on function public.resolve_table_waiter_call(uuid) from public, anon;
grant execute on function public.resolve_table_waiter_call(uuid) to authenticated;

-- Service calls are a high-signal event like an order INSERT. RLS on the
-- staff SELECT policy scopes the realtime payload to the restaurant.
alter table public.table_waiter_calls replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_waiter_calls') then
    alter publication supabase_realtime add table public.table_waiter_calls;
  end if;
end $$;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261107104440_p5_voice_waiter.sql','9fe4f5cbc412941fe0e49e3d1354eb1dce4a4f84c057061b0eec5834b3b3a51c');

-- SOURCE 20261108000000_guest_rate_limits.sql SHA256 d810ec679dd3ea4d402b898ba213703990af12b0fd191de3f015002c9249555e
-- ============================================================================
-- AutoDine — migration 20261108000000: guest endpoint attempt budgets
--
-- WHAT THIS ADDS
--
-- A shared, atomic rate-limit counter and an order-placement budget, closing
-- the gap the init migration named out loud: "No rate limiting on place_order.
-- An abusive client can spam orders." The six-digit code path already budgets
-- attempts (reserve_qr_verification_attempt: five per fifteen minutes, per QR
-- and per IP hash); this file gives place_public_order the same protection and
-- gives both a shared counter they can rely on across instances.
--
-- WHY A DATABASE COUNTER
--
-- The deployment runs on serverless instances: in-memory counters reset on
-- every cold start and never agree with each other. One upsert statement with
-- a windowed counter is atomic under concurrency (two callers cannot both read
-- the same count and land on twenty instead of twenty-one), shared by every
-- instance, and costs nothing beyond the database we already pay for.
--
-- WHERE THE GUARD SITS
--
-- Inside place_public_order itself, not in an app-layer wrapper. The function
-- is granted to anon, so a caller who skips our website and talks to PostgREST
-- directly must still pass the budget. It runs AFTER the idempotent-replay
-- check on purpose: a retry of the same guest token returns the order it
-- already made and is never counted as a new attempt.
--
-- THE KEYS (see the guard for thresholds and why)
--
--   po:s:<sha256(session token)>   per table session
--   po:t:<restaurant id>           per restaurant — protects the kitchen
--                                  regardless of which session presses the
--                                  button, and cannot be sidestepped by
--                                  minting fresh sessions
--   po:i:<ip hash>                 per client address, hash only — the raw
--                                  address is never stored here
--
-- THE HONEST LIMIT
--
-- p_ip_hash is optional: direct PostgREST callers do not have to supply one,
-- and the per-table budget is what still binds them. The threshold for that
-- case is the table budget.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The counter. One row per key; the window restarts by itself.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_hits (
  key               text primary key,
  window_started_at timestamptz not null,
  count             integer not null
);

alter table public.rate_limit_hits enable row level security;

-- Nothing reads or writes this table except hit_rate_limit() below, which is
-- SECURITY DEFINER. No grants, no policies: direct access is closed.
revoke all on public.rate_limit_hits from anon;
revoke all on public.rate_limit_hits from authenticated;
revoke all on public.rate_limit_hits from service_role;

-- For the purge inside hit_rate_limit(): expired rows are found by window.
create index if not exists rate_limit_hits_window_idx
  on public.rate_limit_hits (window_started_at);

-- ---------------------------------------------------------------------------
-- 2. One atomic bump. Returns whether this attempt is allowed and, when it is
--    not, how many seconds remain in the window.
--
--    language sql, one statement: the insert … on conflict upsert and the
--    decision are the same snapshot, so two simultaneous callers serialize on
--    the row lock and get consecutive counts, not one count twice.
-- ---------------------------------------------------------------------------
create or replace function public.hit_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
) returns table (allowed boolean, retry_after_seconds integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  with purged as (
    delete from public.rate_limit_hits
     where window_started_at < statement_timestamp() - interval '1 day'
    returning 1
  ),
  bumped as (
    insert into public.rate_limit_hits as h (key, window_started_at, count)
    values (p_key, statement_timestamp(), 1)
    on conflict (key) do update
       set window_started_at = case
             when h.window_started_at
                    + make_interval(secs => greatest(p_window_seconds, 1))
                  <= statement_timestamp()
               then statement_timestamp()
             else h.window_started_at
           end,
           count = case
             when h.window_started_at
                    + make_interval(secs => greatest(p_window_seconds, 1))
                  <= statement_timestamp()
               then 1
             else h.count + 1
           end
    returning h.window_started_at, h.count
  )
  select
    (b.count <= p_limit) as allowed,
    (case
       when b.count <= p_limit then 0
       else greatest(1, ceil(extract(epoch from (
              b.window_started_at
                + make_interval(secs => greatest(p_window_seconds, 1))
                - statement_timestamp()
            )))::integer)
     end) as retry_after_seconds
  from bumped b
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from anon;
revoke all on function public.hit_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. place_public_order, with the budget inside it.
--
--    The signature gains one optional argument (p_ip_hash) and the old
--    five-argument function is dropped, so there is exactly one function and
--    no unguarded overload a direct caller could find. Five-argument callers
--    keep working through the default.
--
--    Thresholds, chosen from what a real guest does, not from round numbers:
--
--      per session   30 per 10 minutes. A table orders a few times per
--                    sitting and a flaky connection retries a few times on
--                    top; thirty is an hour of headroom for a human and a
--                    ceiling for a script.
--      per table     60 per 10 minutes. The kitchen is what spam actually
--                    hurts; six tickets a minute already fills the pass.
--      per ip hash   60 per 10 minutes. One address can be a whole phone
--                    network behind NAT, so this budget is deliberately the
--                    loosest of the three; the table budget is the real wall.
--
--    The error is deliberately identical in shape to every other refusal in
--    this function: a guest-readable sentence, errcode P0001, and a
--    'rate-limited' hint the application can recognise without matching on
--    sentence text. The sentence carries the wait because the guest can act
--    on it.
-- ---------------------------------------------------------------------------
drop function if exists public.place_public_order(text, jsonb, text, text, uuid);

create or replace function public.place_public_order(
  p_slug          text,
  p_lines         jsonb,
  p_note          text default null,
  p_session_token text default null,
  p_guest_token   uuid default null,
  p_ip_hash       text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
  v_allowed   boolean;
  v_retry     integer;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  -- ---------------------------------------------------------------- replay
  if p_guest_token is not null and v_restaurant_id is not null then
    select o.code into v_existing
      from public.orders o
     where o.guest_token = p_guest_token
       and o.restaurant_id = v_restaurant_id
     limit 1;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- ----------------------------------------------------------- rate limit
  -- After the replay block on purpose: an idempotent retry returns above and
  -- is never counted as a new attempt.
  select a.allowed, a.retry_after_seconds
    into v_allowed, v_retry
    from public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  if coalesce(v_allowed, true) then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  end if;

  if coalesce(v_allowed, true) and p_ip_hash is not null and btrim(p_ip_hash) <> '' then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
  end if;

  if coalesce(v_allowed, true) is not true then
    raise exception 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      using errcode = 'P0001', hint = 'rate-limited';
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  if p_guest_token is not null then
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id;
  end if;

  return v_code;

exception
  when unique_violation then
    if p_guest_token is not null then
      select o.code into v_existing
        from public.orders o
       where o.guest_token = p_guest_token
         and (v_restaurant_id is null or o.restaurant_id = v_restaurant_id)
       limit 1;

      if v_existing is not null then
        return v_existing;
      end if;
    end if;
    raise;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text, uuid, text) is
  'Guest order placement: server-priced, idempotent on p_guest_token, and rate '
  'limited per session / per table / per ip hash (see hit_rate_limit). The '
  'rate-limited refusal carries hint ''rate-limited'' and the wait in seconds.';

grant execute on function public.place_public_order(text, jsonb, text, text, uuid, text) to anon;
grant execute on function public.place_public_order(text, jsonb, text, text, uuid, text) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108000000_guest_rate_limits.sql','d810ec679dd3ea4d402b898ba213703990af12b0fd191de3f015002c9249555e');

-- SOURCE 20261108000200_drift_reconcile.sql SHA256 5bc548abeb6d71bc4b3db839de82b5c9b0d685f874e190280d5ba028470a63bc
-- ============================================================================
-- AutoDine — migration 20261108000200: drift reconciliation
--
-- WHY THIS FILE EXISTS
--
-- The database and the repository ledger have been two parallel histories.
-- Changes made through the console landed in supabase_migrations under their
-- own names, while the repository recorded its own versions of the same work:
-- neither list contained the other. Two concrete holes came out of that:
--
--   1. 20261028000900_guest_scan_confirm.sql was never applied here. The
--      columns and functions it promises (table sessions minted by a scan,
--      held first tickets, table confirmation) were absent from the database,
--      and the kitchen board's own SELECT names columns that did not exist.
--   2. qr_verification_attempts, reserve_qr_verification_attempt and
--      clear_qr_verification_attempts exist in the database but in no
--      repository file — a fresh replay of the ledger could not reproduce the
--      verify path at all.
--
-- WHAT THIS FILE DOES
--
--   Part 1  captures the database-only objects verbatim (the verify budget).
--   Part 2  applies 20261028000900's DDL and functions verbatim; every
--           statement is if-not-exists or create-or-replace, so it is safe on
--           a database that already has some of it.
--   Part 3  re-declares place_public_order with the one line that migration
--           promised and never wrote: the call to stamp_guest_verification.
--           Until now hold_required and table_session_id were never set, and
--           the hold/confirm machinery was dead code.
--
-- Nothing here changes behaviour for a restaurant on 'code' verification:
-- stamp_guest_verification records the session id and leaves hold_required
-- false, which is exactly the pre-existing behaviour.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Part 1 — captured from the database (applied there before the ledger knew).
-- ---------------------------------------------------------------------------

-- qr_verification_attempts: the code-entry budget. Applied to the database
-- first (the verify path has called it since day one); captured here so the
-- repository ledger can be replayed onto an empty database.
create table if not exists public.qr_verification_attempts (
  qr_code_id      uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash         text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count   integer not null default 0 check (attempt_count >= 0 and attempt_count <= 5),
  window_started_at timestamptz not null default statement_timestamp(),
  blocked_until   timestamptz,
  updated_at      timestamptz not null default statement_timestamp(),
  primary key (qr_code_id, ip_hash)
);

alter table public.qr_verification_attempts enable row level security;
revoke all on public.qr_verification_attempts from anon;
revoke all on public.qr_verification_attempts from authenticated;

create or replace function public.reserve_qr_verification_attempt(p_qr_code_id uuid, p_ip_hash text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.qr_verification_attempts%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit fingerprint.' using errcode = '22023';
  end if;
  insert into public.qr_verification_attempts(qr_code_id, ip_hash)
  values (p_qr_code_id, p_ip_hash)
  on conflict (qr_code_id, ip_hash) do nothing;
  select * into v_row
  from public.qr_verification_attempts a
  where a.qr_code_id = p_qr_code_id and a.ip_hash = p_ip_hash
  for update;
  if not found then
    raise exception 'Unknown table QR code.' using errcode = 'P0002';
  end if;
  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;
  if v_row.window_started_at <= v_now - interval '15 minutes' then
    update public.qr_verification_attempts
      set attempt_count = 1, window_started_at = v_now,
          blocked_until = null, updated_at = v_now
      where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
    return query select true, 0;
    return;
  end if;
  if v_row.attempt_count >= 5 then
    update public.qr_verification_attempts
      set blocked_until = coalesce(blocked_until, v_now + interval '15 minutes'), updated_at = v_now
      where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash
      returning public.qr_verification_attempts.blocked_until into v_row.blocked_until;
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;
  update public.qr_verification_attempts
    set attempt_count = attempt_count + 1, updated_at = v_now
    where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
  return query select true, 0;
end;
$$;

create or replace function public.clear_qr_verification_attempts(p_qr_code_id uuid, p_ip_hash text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.qr_verification_attempts
  where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash;
$$;

revoke all on function public.reserve_qr_verification_attempt(uuid, text) from public;
revoke all on function public.reserve_qr_verification_attempt(uuid, text) from anon;
revoke all on function public.reserve_qr_verification_attempt(uuid, text) from authenticated;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from public;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from anon;
revoke all on function public.clear_qr_verification_attempts(uuid, text) from authenticated;

-- ---------------------------------------------------------------------------
-- Part 2 — 20261028000900_guest_scan_confirm.sql, applied at last.
-- ---------------------------------------------------------------------------

alter table public.restaurants
  add column if not exists guest_verification_mode text not null default 'code'
    check (guest_verification_mode in ('code', 'scan_confirm', 'scan'));

comment on column public.restaurants.guest_verification_mode is
  'How a guest proves they are at a table. code = rotating digits (default), '
  'scan_confirm = scan plus one staff tap per sitting, scan = scan only. '
  'Static QR codes cannot prove presence, so scan and scan_confirm must never '
  'be described as verified.';

-- ---------------------------------------------------------------------------
-- 2. The decision is snapshotted onto the order.
--
-- A setting changed at 20:05 must not retroactively release a ticket that was
-- held at 20:04, nor hold one that had already been accepted. hold_required is
-- therefore written once, when the order is created, and never recomputed.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists hold_required     boolean not null default false,
  add column if not exists confirmed_at      timestamptz,
  add column if not exists confirmed_by      uuid,
  add column if not exists table_session_id  uuid;

comment on column public.orders.hold_required is
  'Written when the order is created: it arrived under a scan mode and no '
  'human had vouched for this table session yet.';
comment on column public.orders.confirmed_at is
  'When staff accepted the held table. NULL means nobody has. Never set by the '
  'guest path.';
comment on column public.orders.table_session_id is
  'The table session the order was placed under, so the board can confirm a '
  'whole sitting in one statement and group a party''s orders.';

-- The board asks for held tickets constantly; the index is partial because
-- held, unconfirmed orders are a tiny fraction of the table.
create index if not exists orders_held_idx
  on public.orders (restaurant_id, placed_at)
  where hold_required and confirmed_at is null;

create index if not exists orders_session_idx
  on public.orders (table_session_id)
  where table_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Rate limit for sessions minted by a scan.
--
-- Deliberately a separate table from qr_verification_attempts: that one counts
-- FAILED attempts at a code, this one counts SUCCESSFUL openings of a session.
-- Mixing them would make a busy table look like an attacker, and an attacker
-- look like a busy table.
-- ---------------------------------------------------------------------------
create table if not exists public.table_session_opens (
  id         uuid primary key default gen_random_uuid(),
  qr_code_id uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash    text not null,
  opened_at  timestamptz not null default now()
);

create index if not exists table_session_opens_card_idx
  on public.table_session_opens (qr_code_id, opened_at desc);
create index if not exists table_session_opens_ip_idx
  on public.table_session_opens (ip_hash, opened_at desc);

-- No policies: only the security-definer function below touches this table.
alter table public.table_session_opens enable row level security;
revoke all on public.table_session_opens from anon;
revoke all on public.table_session_opens from authenticated;

create or replace function public.open_table_session(
  p_public_token text,
  p_ip_hash      text
) returns table (
  status          text,
  session_token   text,
  restaurant_slug text,
  table_label     text,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The schema caps a session at one hour from creation; 59 minutes leaves the
  -- same minute of headroom the code path uses.
  k_session_minutes constant int := 59;
  k_opens_per_card  constant int := 10;
  k_opens_per_ip    constant int := 20;
  k_window          constant interval := interval '1 hour';

  v_qr        public.table_qr_codes%rowtype;
  v_table     public.dining_tables%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_mode      text;
  v_token     text;
  v_expires   timestamptz;
  v_count     int;
begin
  if p_public_token is null or btrim(p_public_token) !~ '^[A-Za-z0-9_-]{8,128}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return query select 'unreadable'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select q.* into v_qr
    from public.table_qr_codes q
   where q.public_token = btrim(p_public_token)
     and q.revoked_at is null;

  if not found then
    return query select 'revoked'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select r.* into v_restaurant from public.restaurants r where r.id = v_qr.restaurant_id;
  v_mode := coalesce(v_restaurant.guest_verification_mode, 'code');

  -- The whole point of the setting: a restaurant on 'code' cannot be opened by
  -- a scan, no matter what the client asks for.
  if v_mode = 'code' then
    return query select 'code'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select t.* into v_table
    from public.dining_tables t
   where t.id = v_qr.table_id
     and t.restaurant_id = v_qr.restaurant_id
     and t.is_active = true;

  if not found then
    return query select 'revoked'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not v_restaurant.is_active or not public.restaurant_can_write(v_restaurant.id) then
    return query select 'notserving'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.menus m
     where m.restaurant_id = v_restaurant.id and m.is_published = true
  ) then
    return query select 'nomenu'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- Two brakes, one per card and one per address. Counted before the insert so
  -- a refusal records nothing.
  select count(*) into v_count
    from public.table_session_opens o
   where o.qr_code_id = v_qr.id
     and o.opened_at > statement_timestamp() - k_window;
  if v_count >= k_opens_per_card then
    return query select 'limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*) into v_count
    from public.table_session_opens o
   where o.ip_hash = p_ip_hash
     and o.opened_at > statement_timestamp() - k_window;
  if v_count >= k_opens_per_ip then
    return query select 'limited'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 64 hex characters: two UUIDv4s with the dashes removed. Same shape and the
  -- same reasoning as verify_table_qr_with_code.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  v_expires := statement_timestamp() + make_interval(mins => k_session_minutes);

  insert into public.table_verification_sessions (
    token_hash, restaurant_id, table_id, qr_code_id, expires_at
  ) values (
    encode(sha256(v_token::bytea), 'hex'),
    v_restaurant.id,
    v_table.id,
    v_qr.id,
    v_expires
  );

  insert into public.table_session_opens (qr_code_id, ip_hash) values (v_qr.id, p_ip_hash);

  return query select 'opened'::text, v_token, v_restaurant.slug, v_table.label, v_expires;
end;
$$;

comment on function public.open_table_session(text, text) is
  'Mint a table session from a scanned card, for restaurants whose '
  'guest_verification_mode is scan_confirm or scan. Refuses in code mode. '
  'Rate limited per card and per address. Does not prove presence.';

revoke all on function public.open_table_session(text, text) from public;
revoke all on function public.open_table_session(text, text) from anon;
revoke all on function public.open_table_session(text, text) from authenticated;
grant execute on function public.open_table_session(text, text) to anon;
grant execute on function public.open_table_session(text, text) to authenticated;

create or replace function public.stamp_guest_verification(
  p_code          text,
  p_restaurant_id uuid,
  p_session_token text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid;
  v_mode    text;
  v_held    boolean;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    return;
  end if;

  select s.id, r.guest_verification_mode
    into v_session, v_mode
    from public.table_verification_sessions s
    join public.restaurants r on r.id = s.restaurant_id
   where s.token_hash = encode(sha256(btrim(p_session_token)::bytea), 'hex')
     and s.expires_at > statement_timestamp()
     and s.restaurant_id = p_restaurant_id
   limit 1;

  if v_session is null then
    return;
  end if;

  -- Held = nothing in this sitting has been vouched for by a human yet. If the
  -- first ticket was confirmed, the second one is not held, which is what
  -- keeps a busy table to one tap; if the first one is still waiting, the
  -- second one waits with it rather than slipping past the check.
  if v_mode = 'scan_confirm' then
    select not exists (
      select 1 from public.orders o
       where o.table_session_id = v_session
         and o.confirmed_at is not null
    ) into v_held;
  else
    v_held := false;
  end if;

  update public.orders o
     set table_session_id = v_session,
         hold_required = v_held
   where o.code = p_code
     and o.restaurant_id = p_restaurant_id
     and o.table_session_id is null;
end;
$$;

revoke all on function public.stamp_guest_verification(text, uuid, text) from public;
revoke all on function public.stamp_guest_verification(text, uuid, text) from anon;
revoke all on function public.stamp_guest_verification(text, uuid, text) from authenticated;

create or replace function public.confirm_table_orders(
  p_table_session_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_count      integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to confirm a table.' using errcode = 'P0001';
  end if;

  select s.restaurant_id into v_restaurant
    from public.table_verification_sessions s
   where s.id = p_table_session_id;

  if v_restaurant is null then
    raise exception 'That table is no longer on the board.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only an owner, a manager or kitchen staff can confirm a table.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant) then
    raise exception 'This restaurant is read-only right now, so tickets cannot be confirmed.'
      using errcode = 'P0001';
  end if;

  update public.orders o
     set confirmed_at = statement_timestamp(),
         confirmed_by = auth.uid()
   where o.table_session_id = p_table_session_id
     and o.restaurant_id = v_restaurant
     and o.hold_required
     and o.confirmed_at is null
     and o.prep_status <> 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.reject_table_orders(
  p_table_session_id uuid,
  p_reason           text default null
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant uuid;
  v_count      integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to reject a table.' using errcode = 'P0001';
  end if;

  select s.restaurant_id into v_restaurant
    from public.table_verification_sessions s
   where s.id = p_table_session_id;

  if v_restaurant is null then
    raise exception 'That table is no longer on the board.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_restaurant
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'kitchen')
  ) then
    raise exception 'Only an owner, a manager or kitchen staff can reject a table.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant) then
    raise exception 'This restaurant is read-only right now, so tickets cannot be rejected.'
      using errcode = 'P0001';
  end if;

  -- Only held, unconfirmed, still-open tickets. A confirmed ticket has already
  -- been vouched for; cancelling it is cancel_order's job, with its own rules.
  update public.orders o
     set prep_status = 'cancelled',
         customer_note = case
           when p_reason is null or btrim(p_reason) = '' then o.customer_note
           else coalesce(o.customer_note || ' · ', '') || 'Not confirmed by staff: ' || btrim(p_reason)
         end
   where o.table_session_id = p_table_session_id
     and o.restaurant_id = v_restaurant
     and o.hold_required
     and o.confirmed_at is null
     and o.prep_status <> 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.confirm_table_orders(uuid) from public;
revoke all on function public.confirm_table_orders(uuid) from anon;
revoke all on function public.confirm_table_orders(uuid) from authenticated;
grant execute on function public.confirm_table_orders(uuid) to authenticated;

revoke all on function public.reject_table_orders(uuid, text) from public;
revoke all on function public.reject_table_orders(uuid, text) from anon;
revoke all on function public.reject_table_orders(uuid, text) from authenticated;
grant execute on function public.reject_table_orders(uuid, text) to authenticated;

-- get_public_order is deliberately NOT re-asserted here: the repository's
-- latest word on it is 20261107000000_storefront_settings.sql (the storefront
-- fix that removed the is_active filter), and the database already carries
-- that version. Copying the older 20261028000900 shape would quietly regress
-- it.

-- ---------------------------------------------------------------------------
-- Part 3 — place_public_order, with the stamp the original promised.
-- ---------------------------------------------------------------------------

create or replace function public.place_public_order(
  p_slug          text,
  p_lines         jsonb,
  p_note          text default null,
  p_session_token text default null,
  p_guest_token   uuid default null,
  p_ip_hash       text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text;
  v_restaurant_id uuid;
  v_existing  text;
  v_allowed   boolean;
  v_retry     integer;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      using errcode = 'P0001';
  end if;

  select r.id into v_restaurant_id
    from public.restaurants r
   where r.slug = btrim(coalesce(p_slug, ''));

  if p_guest_token is not null and v_restaurant_id is not null then
    select o.code into v_existing
      from public.orders o
     where o.guest_token = p_guest_token
       and o.restaurant_id = v_restaurant_id
     limit 1;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select a.allowed, a.retry_after_seconds
    into v_allowed, v_retry
    from public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  if coalesce(v_allowed, true) then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  end if;

  if coalesce(v_allowed, true) and p_ip_hash is not null and btrim(p_ip_hash) <> '' then
    select a.allowed, a.retry_after_seconds
      into v_allowed, v_retry
      from public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
  end if;

  if coalesce(v_allowed, true) is not true then
    raise exception 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      using errcode = 'P0001', hint = 'rate-limited';
  end if;

  v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);

  -- Stamp the sitting onto the order: session id always (scan or code), and
  -- hold_required for a scan_confirm sitting nobody has vouched for yet.
  -- This is the call 20261028000900 promised and its wrapper forgot; without
  -- it the hold/confirm machinery is dead code.
  perform public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token));

  if p_guest_token is not null then
    update public.orders o
       set guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (select r.tax_rate_bps from public.restaurants r where r.id = o.restaurant_id)
           )
     where o.code = v_code
       and o.restaurant_id = v_restaurant_id;
  end if;

  return v_code;

exception
  when unique_violation then
    if p_guest_token is not null then
      select o.code into v_existing
        from public.orders o
       where o.guest_token = p_guest_token
         and (v_restaurant_id is null or o.restaurant_id = v_restaurant_id)
       limit 1;

      if v_existing is not null then
        return v_existing;
      end if;
    end if;
    raise;
end;
$$;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108000200_drift_reconcile.sql','5bc548abeb6d71bc4b3db839de82b5c9b0d685f874e190280d5ba028470a63bc');

-- SOURCE 20261108000300_publish_menu_snapshot.sql SHA256 4f89f160e960ca03a0e34064b573ca564482dd953e96454f09419c1d10307fa2
-- ============================================================================
-- AutoDine — migration 20261108000300: the publish snapshot remembers the menu
--
-- WHAT THIS FIXES
--
-- Rollback used to restore only the brand half of a pair: name, logo, banner,
-- theme, the published flag. A dish added or repriced after the publish stayed
-- changed after the rollback — the owner was told so at the time and had to
-- undo menu edits by hand. This closes that gap: the publish snapshot now
-- carries the menu's rows as they were, and a rollback puts them back.
--
-- HOW
--
--   publish_menu_brand_pair  — the snapshot gains `menu_content`: every
--     category, item, variant, add-on group and add-on of the menu being
--     published, captured with to_jsonb so the whole row travels (including
--     columns added by later migrations).
--   rollback_last_publish    — when the snapshot carries menu_content, the
--     menu's rows are replaced with the snapshot's rows inside the same
--     transaction: children first on the way out (add-ons, groups, variants,
--     items, categories), parents first on the way back in.
--
-- Old history rows have no menu_content; a rollback of one of them behaves
-- exactly as before (brand half only). Everything else about publish and
-- rollback — roles, the trial gate, the idempotent `already` answer, the
-- history row — is unchanged.
-- ============================================================================

create or replace function public.publish_menu_brand_pair(
  p_menu_id uuid,
  p_brand_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user      uuid := auth.uid();
  v_restaurant uuid;
  v_profile   public.restaurant_brand_profiles%rowtype;
  v_menu      public.menus%rowtype;
  v_prev_profile uuid;
  v_snapshot  jsonb;
  v_name      text;
  v_logo      text;
  v_banner    text;
  v_theme     jsonb;
  v_cat_ids   uuid[];
  v_item_ids  uuid[];
  v_group_ids uuid[];
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  select * into v_profile
  from public.restaurant_brand_profiles
  where id = p_brand_profile_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'That brand draft does not exist.');
  end if;

  v_restaurant := v_profile.restaurant_id;

  if not public.has_restaurant_role(v_restaurant, array['owner', 'manager']) then
    return jsonb_build_object('ok', false, 'reason', 'Only an owner or manager can publish.');
  end if;

  if not public.restaurant_can_write(v_restaurant) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Only an owner or manager can change the menu, and the trial must still be running. Nothing was published.'
    );
  end if;

  select * into v_menu from public.menus where id = p_menu_id;
  if not found or v_menu.restaurant_id <> v_restaurant then
    return jsonb_build_object('ok', false, 'reason', 'That menu is not on your account.');
  end if;

  if v_profile.status = 'published' and v_menu.is_published then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if v_profile.status = 'archived' then
    return jsonb_build_object('ok', false, 'reason', 'That brand draft is no longer current. Create a new draft.');
  end if;

  select id into v_prev_profile
  from public.restaurant_brand_profiles
  where restaurant_id = v_restaurant and status = 'published'
    and id <> v_profile.id
  limit 1;

  select name, logo_path, banner_path, brand_theme into v_name, v_logo, v_banner, v_theme
  from public.restaurants where id = v_restaurant;

  -- The menu half of the pair, exactly as it stands at this moment. Rollback
  -- restores these rows; see the header.
  select coalesce(array_agg(c.id), '{}') into v_cat_ids
    from public.categories c where c.menu_id = p_menu_id;
  select coalesce(array_agg(i.id), '{}') into v_item_ids
    from public.items i where i.category_id = any(v_cat_ids);
  select coalesce(array_agg(g.id), '{}') into v_group_ids
    from public.item_addon_groups g where g.item_id = any(v_item_ids);

  v_snapshot := jsonb_build_object(
    'name', v_name,
    'logo_path', v_logo,
    'banner_path', v_banner,
    'brand_theme', v_theme,
    'brand_theme_enabled', (select brand_theme_enabled from public.restaurants where id = v_restaurant),
    'brand_profile_id', v_prev_profile,
    'menu_is_published', v_menu.is_published,
    'menu_content', jsonb_build_object(
      'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.categories c where c.id = any(v_cat_ids)),
      'items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.items i where i.id = any(v_item_ids)),
      'item_variants', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from public.item_variants v where v.item_id = any(v_item_ids)),
      'item_addon_groups', (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from public.item_addon_groups g where g.id = any(v_group_ids)),
      'item_addons', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.item_addons a where a.group_id = any(v_group_ids))
    )
  );

  select a.path into v_logo
  from public.restaurant_brand_assets a
  where a.id = v_profile.logo_asset_id and a.restaurant_id = v_restaurant;
  select a.path into v_banner
  from public.restaurant_brand_assets a
  where a.id = v_profile.banner_asset_id and a.restaurant_id = v_restaurant;

  v_name  := case when v_profile.name is not null then btrim(v_profile.name) else v_name end;
  v_theme := v_profile.theme;

  update public.restaurants
  set name = v_name,
      logo_path = v_logo,
      banner_path = v_banner,
      brand_theme = v_theme,
      brand_theme_enabled = true,
      brand_profile_id = v_profile.id,
      updated_at = now()
  where id = v_restaurant;

  update public.menus
  set is_published = true
  where id = p_menu_id;

  update public.restaurant_brand_profiles
  set status = 'archived', updated_at = now()
  where restaurant_id = v_restaurant and status = 'published' and id <> v_profile.id;

  update public.restaurant_brand_profiles
  set status = 'published',
      menu_id = p_menu_id,
      published_at = now(),
      published_by = v_user,
      updated_at = now()
  where id = v_profile.id;

  insert into public.restaurant_publish_history
    (restaurant_id, action, menu_id, brand_profile_id, snapshot, actor)
  values
    (v_restaurant, 'publish', p_menu_id, v_profile.id, v_snapshot, v_user);

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

create or replace function public.rollback_last_publish(
  p_restaurant_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user   uuid := auth.uid();
  v_last   public.restaurant_publish_history%rowtype;
  v_snap   jsonb;
  v_menu_id uuid;
  v_cat_ids  uuid[];
  v_item_ids uuid[];
  v_group_ids uuid[];
begin
  if v_user is null then
    raise exception 'unauthenticated';
  end if;

  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    return jsonb_build_object('ok', false, 'reason', 'Only an owner or manager can roll back.');
  end if;

  if not public.restaurant_can_write(p_restaurant_id) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Only an owner or manager can change the menu, and the trial must still be running. Nothing was rolled back.'
    );
  end if;

  select * into v_last
  from public.restaurant_publish_history
  where restaurant_id = p_restaurant_id
  order by created_at desc, id desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'There is nothing to roll back.');
  end if;
  if v_last.action = 'rollback' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_snap := v_last.snapshot;
  v_menu_id := v_last.menu_id;

  update public.restaurants
  set name = v_snap->>'name',
      logo_path = v_snap->>'logo_path',
      banner_path = v_snap->>'banner_path',
      brand_theme = (v_snap->'brand_theme'),
      brand_theme_enabled = coalesce((v_snap->>'brand_theme_enabled')::boolean, false),
      brand_profile_id = (v_snap->>'brand_profile_id')::uuid,
      updated_at = now()
  where id = p_restaurant_id;

  if v_menu_id is not null then
    update public.menus
    set is_published = coalesce((v_snap->>'menu_is_published')::boolean, false)
    where id = v_menu_id;

    -- The menu half of the pair, restored row for row. Present only on
    -- snapshots taken after this migration; older ones roll back the brand
    -- half alone, exactly as they always did.
    if v_snap ? 'menu_content' then
      select coalesce(array_agg(c.id), '{}') into v_cat_ids
        from public.categories c where c.menu_id = v_menu_id;
      select coalesce(array_agg(i.id), '{}') into v_item_ids
        from public.items i where i.category_id = any(v_cat_ids);
      select coalesce(array_agg(g.id), '{}') into v_group_ids
        from public.item_addon_groups g where g.item_id = any(v_item_ids);

      -- Children first: each level's rows are only reachable through their
      -- parents, so the parents leave last and return first.
      delete from public.item_addons      where group_id = any(v_group_ids);
      delete from public.item_addon_groups where item_id = any(v_item_ids);
      delete from public.item_variants    where item_id = any(v_item_ids);
      delete from public.items            where category_id = any(v_cat_ids);
      delete from public.categories       where menu_id = v_menu_id;

      insert into public.categories
        select * from jsonb_populate_recordset(null::public.categories, v_snap->'menu_content'->'categories');
      insert into public.items
        select * from jsonb_populate_recordset(null::public.items, v_snap->'menu_content'->'items');
      insert into public.item_variants
        select * from jsonb_populate_recordset(null::public.item_variants, v_snap->'menu_content'->'item_variants');
      insert into public.item_addon_groups
        select * from jsonb_populate_recordset(null::public.item_addon_groups, v_snap->'menu_content'->'item_addon_groups');
      insert into public.item_addons
        select * from jsonb_populate_recordset(null::public.item_addons, v_snap->'menu_content'->'item_addons');
    end if;
  end if;

  if (v_snap->>'brand_profile_id') is not null then
    update public.restaurant_brand_profiles
    set status = 'published', updated_at = now()
    where id = (v_snap->>'brand_profile_id')::uuid
      and restaurant_id = p_restaurant_id;
  end if;

  update public.restaurant_brand_profiles
  set status = 'draft', updated_at = now()
  where id = v_last.brand_profile_id
    and restaurant_id = p_restaurant_id;

  insert into public.restaurant_publish_history
    (restaurant_id, action, menu_id, brand_profile_id, snapshot, actor)
  values
    (p_restaurant_id, 'rollback', v_menu_id, v_last.brand_profile_id, v_snap, v_user);

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108000300_publish_menu_snapshot.sql','4f89f160e960ca03a0e34064b573ca564482dd953e96454f09419c1d10307fa2');

-- SOURCE 20261108000500_order_session_staff_read.sql SHA256 b7ffa5a92701e474a07353674fcda396fa5ef64275ba8f81289990bd057fe377
-- The live order_sessions migration (20261107074545) installed a membership-
-- scoped SELECT policy but revoked the authenticated role's table privilege.
-- Policies filter rows; they do not grant table privileges. Staff screens use
-- the user's authenticated client, so grant SELECT only. No client write
-- privileges are added. This permission was applied directly to production
-- and is now represented in migration history for future environments.
grant select on public.order_sessions to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108000500_order_session_staff_read.sql','b7ffa5a92701e474a07353674fcda396fa5ef64275ba8f81289990bd057fe377');

-- SOURCE 20261108001000_order_code_and_kitchen_announce_guard.sql SHA256 925b49b45e2f358bd97ed9f5b93f418d9e5bb433e4c7f851b1cb14cf1573af62
-- ---------------------------------------------------------------------------
-- Small reliability fixes: collision-safe public order codes and one
-- cross-device kitchen announcement winner per order.
-- ---------------------------------------------------------------------------

-- The code generator already emits a random five-character suffix. The
-- database must still be the final authority: a collision should be retried,
-- never allowed to create two guest-visible tickets with the same code.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.orders
     GROUP BY restaurant_id, code
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate order codes exist within a restaurant; resolve them before adding orders_restaurant_code_unique.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_restaurant_code_unique
  ON public.orders (restaurant_id, code);

CREATE OR REPLACE FUNCTION public.place_public_order_core_with_code_retry(
  p_slug text,
  p_lines jsonb,
  p_note text,
  p_session_token text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_constraint_name text;
  v_attempt integer := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    BEGIN
      v_code := public.place_public_order_core(p_slug, p_lines, p_note, p_session_token);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name IS DISTINCT FROM 'orders_restaurant_code_unique' THEN
        RAISE;
      END IF;
      IF v_attempt >= 8 THEN
        RAISE EXCEPTION 'Could not allocate a unique order code after % attempts.', v_attempt
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.place_public_order_core_with_code_retry(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.place_public_order_core_with_code_retry(text, jsonb, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.place_public_order_core_with_code_retry(text, jsonb, text, text) FROM authenticated;

-- Keep the existing rate limiting, guest-token idempotency, session stamping,
-- and tax snapshot behavior. Only the core call changes: unique-code
-- collisions are retried inside a savepoint, while unrelated unique errors
-- continue to reach the existing idempotency handler below.
CREATE OR REPLACE FUNCTION public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text DEFAULT NULL,
  p_session_token text DEFAULT NULL,
  p_guest_token uuid DEFAULT NULL,
  p_ip_hash text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_restaurant_id uuid;
  v_existing text;
  v_allowed boolean;
  v_retry integer;
BEGIN
  IF p_session_token IS NULL OR btrim(p_session_token) = '' THEN
    RAISE EXCEPTION 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id INTO v_restaurant_id
    FROM public.restaurants r
   WHERE r.slug = btrim(coalesce(p_slug, ''));

  IF p_guest_token IS NOT NULL AND v_restaurant_id IS NOT NULL THEN
    SELECT o.code INTO v_existing
      FROM public.orders o
     WHERE o.guest_token = p_guest_token
       AND o.restaurant_id = v_restaurant_id
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT a.allowed, a.retry_after_seconds
    INTO v_allowed, v_retry
    FROM public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  IF coalesce(v_allowed, true) THEN
    SELECT a.allowed, a.retry_after_seconds
      INTO v_allowed, v_retry
      FROM public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  END IF;

  IF coalesce(v_allowed, true) AND p_ip_hash IS NOT NULL AND btrim(p_ip_hash) <> '' THEN
    SELECT a.allowed, a.retry_after_seconds
      INTO v_allowed, v_retry
      FROM public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
  END IF;

  IF coalesce(v_allowed, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      USING ERRCODE = 'P0001', HINT = 'rate-limited';
  END IF;

  v_code := public.place_public_order_core_with_code_retry(p_slug, p_lines, p_note, p_session_token);

  PERFORM public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token));

  IF p_guest_token IS NOT NULL THEN
    UPDATE public.orders o
       SET guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (SELECT r.tax_rate_bps FROM public.restaurants r WHERE r.id = o.restaurant_id)
           )
     WHERE o.code = v_code
       AND o.restaurant_id = v_restaurant_id;
  END IF;

  RETURN v_code;

EXCEPTION
  WHEN unique_violation THEN
    IF p_guest_token IS NOT NULL THEN
      SELECT o.code INTO v_existing
        FROM public.orders o
       WHERE o.guest_token = p_guest_token
         AND (v_restaurant_id IS NULL OR o.restaurant_id = v_restaurant_id)
       LIMIT 1;

      IF v_existing IS NOT NULL THEN
        RETURN v_existing;
      END IF;
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) TO authenticated;

-- Web Locks elect one tab only. This private claim elects one device too.
-- The caller cannot read or mutate the table directly; the SECURITY DEFINER
-- RPC verifies both the order state and the kitchen-role membership.
CREATE TABLE IF NOT EXISTS public.kitchen_announcement_claims (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  claimed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE INDEX IF NOT EXISTS kitchen_announcement_claims_restaurant_idx
  ON public.kitchen_announcement_claims (restaurant_id, claimed_at DESC);

ALTER TABLE public.kitchen_announcement_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitchen_announcement_claims FROM PUBLIC;
REVOKE ALL ON public.kitchen_announcement_claims FROM anon;
REVOKE ALL ON public.kitchen_announcement_claims FROM authenticated;

CREATE OR REPLACE FUNCTION public.claim_kitchen_order_announcement(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_rows bigint := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to claim a kitchen announcement.' USING ERRCODE = '42501';
  END IF;

  SELECT o.restaurant_id INTO v_restaurant_id
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.prep_status = 'new'
     AND NOT (o.hold_required AND o.confirmed_at IS NULL)
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.memberships m
     WHERE m.restaurant_id = v_restaurant_id
       AND m.user_id = v_actor
       AND m.role IN ('owner', 'manager', 'kitchen')
  ) THEN
    RAISE EXCEPTION 'Only kitchen staff may claim an announcement.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.kitchen_announcement_claims (order_id, restaurant_id, claimed_by)
  VALUES (p_order_id, v_restaurant_id, v_actor)
  ON CONFLICT (order_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_kitchen_order_announcement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_kitchen_order_announcement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_kitchen_order_announcement(uuid) TO authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108001000_order_code_and_kitchen_announce_guard.sql','925b49b45e2f358bd97ed9f5b93f418d9e5bb433e4c7f851b1cb14cf1573af62');

-- SOURCE 20261108002000_invoice_receipts.sql SHA256 1b4620b3bb773376fa07ce1f78a9b754ba9d134559a896e3d1cc40d8648a66ba
-- P6: immutable, numbered receipts for closed table sessions.
--
-- GST tax invoices intentionally remain unavailable until approved per-item
-- tax classifications, pricing modes, seller state, and place-of-supply rules
-- are configured. This migration issues a clearly identified non-GST receipt
-- only. It never reuses a number: voided receipts remain in the ledger, and a
-- replacement gets the next number.
--
-- Invoice issuance accepts only a session id. The database locks the session,
-- loads every non-cancelled ticket and recorded payment, snapshots all values,
-- and allocates a per-restaurant financial-year number in one transaction.
-- P8's close RPC calls issue_closed_session_receipt() in the same transaction.
-- No client total, line, or invoice number is trusted.

create table if not exists public.restaurant_invoice_series (
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  financial_year text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  next_number integer not null default 1 check (next_number between 1 and 1000000),
  primary key (restaurant_id, financial_year)
);

comment on table public.restaurant_invoice_series is
  'Internal per-restaurant, per-financial-year receipt counters. Financial years run 1 April through 31 March; allocation is row-locked and transactional.';

-- Payment time is distinct from attempt creation time for asynchronous online
-- settlement. Older recorded rows fall back to created_at in invoice snapshots.
alter table public.payments
  add column if not exists recorded_at timestamptz;

comment on column public.payments.recorded_at is
  'When funds were recorded as received. Null on pending/legacy rows; consumers fall back to created_at only for already-recorded historical data.';

create table if not exists public.restaurant_invoices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  order_session_id uuid not null references public.order_sessions(id) on delete restrict,
  invoice_number varchar(16) not null,
  financial_year text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  sequence_number integer not null check (sequence_number between 1 and 999999),
  document_type text not null check (document_type in ('receipt', 'gst_tax_invoice')),
  status text not null default 'issued' check (status in ('issued', 'voided')),
  issued_at timestamptz not null default statement_timestamp(),
  issued_by uuid references public.profiles(id) on delete set null,
  table_label_snapshot text,
  session_opened_at timestamptz not null,
  session_closed_at timestamptz not null,
  seller_snapshot jsonb not null,
  customer_snapshot jsonb,
  totals_snapshot jsonb not null,
  payment_snapshot jsonb not null,
  source_order_ids uuid[] not null,
  supersedes_invoice_id uuid references public.restaurant_invoices(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default statement_timestamp(),
  constraint restaurant_invoices_number_unique unique (restaurant_id, invoice_number),
  constraint restaurant_invoices_sequence_unique unique (restaurant_id, financial_year, sequence_number),
  constraint restaurant_invoices_format_check check (
    invoice_number = 'INV/' || financial_year || '/' || lpad(sequence_number::text, 6, '0')
    and length(invoice_number) <= 16
  ),
  constraint restaurant_invoices_void_fields_check check (
    (status = 'issued' and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'voided' and voided_at is not null and void_reason is not null)
  )
);

-- Only one live receipt per sitting. A voided record stays immutable and a
-- deliberate replacement receives a new number and points back to it.
create unique index if not exists restaurant_invoices_one_issued_per_session
  on public.restaurant_invoices (order_session_id)
  where status = 'issued';

create index if not exists restaurant_invoices_restaurant_issued_idx
  on public.restaurant_invoices (restaurant_id, issued_at desc);

create table if not exists public.restaurant_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.restaurant_invoices(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  source_order_id uuid not null references public.orders(id) on delete restrict,
  source_order_item_id uuid references public.order_items(id) on delete set null,
  line_snapshot jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (invoice_id, line_number)
);

alter table public.restaurant_invoices enable row level security;
alter table public.restaurant_invoice_lines enable row level security;
alter table public.restaurant_invoice_series enable row level security;

revoke all on public.restaurant_invoices from public, anon, authenticated, service_role;
revoke all on public.restaurant_invoice_lines from public, anon, authenticated, service_role;
revoke all on public.restaurant_invoice_series from public, anon, authenticated, service_role;

grant select on public.restaurant_invoices, public.restaurant_invoice_lines to authenticated;

create policy restaurant_invoices_staff_read on public.restaurant_invoices
  for select to authenticated
  using (public.is_member(restaurant_id));

create policy restaurant_invoice_lines_staff_read on public.restaurant_invoice_lines
  for select to authenticated
  using (public.is_member(restaurant_id));

-- A finalized snapshot is never updated or deleted through table access.
-- The only permitted state transition is the audited void RPC below.
create or replace function public.issue_closed_session_receipt(
  p_order_session_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.order_sessions%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_role public.member_role;
  v_existing public.restaurant_invoices%rowtype;
  v_previous public.restaurant_invoices%rowtype;
  v_issued_at timestamptz := statement_timestamp();
  v_local_date date;
  v_fy_start integer;
  v_fy text;
  v_sequence integer;
  v_invoice_number text;
  v_invoice_id uuid;
  v_seller jsonb;
  v_totals jsonb;
  v_payments jsonb;
  v_order_ids uuid[];
  v_order_count integer;
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
  v_paid bigint;
  v_table_label text;
  v_item_count integer;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to issue a receipt.'
      using errcode = '42501';
  end if;

  select s.* into v_session
    from public.order_sessions s
   where s.id = p_order_session_id
   for update;
  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_session.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to issue this receipt.' using errcode = '42501';
  end if;
  if v_session.status <> 'closed' or v_session.closed_at is null then
    raise exception 'Close the table session before issuing its final receipt.' using errcode = 'P0001';
  end if;

  select i.* into v_existing
    from public.restaurant_invoices i
   where i.order_session_id = v_session.id and i.status = 'issued';
  if found then
    return v_existing.id;
  end if;
  if not public.restaurant_can_write(v_session.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before issuing a receipt.'
      using errcode = 'P0001';
  end if;

  -- GST invoices stay fail-closed until the restaurant has an approved
  -- per-item tax configuration and place-of-supply model. There is no public
  -- route to request one through this receipt function.
  select r.* into v_restaurant
    from public.restaurants r
   where r.id = v_session.restaurant_id and r.is_active;
  if not found then
    raise exception 'Restaurant is not active.' using errcode = 'P0001';
  end if;
  if nullif(btrim(v_restaurant.name), '') is null
     or nullif(btrim(v_restaurant.address), '') is null then
    raise exception 'Add the restaurant name and address in Settings before issuing a receipt.'
      using errcode = 'P0001';
  end if;

  select t.label into v_table_label
    from public.dining_tables t
   where t.id = v_session.table_id and t.restaurant_id = v_session.restaurant_id;

  select count(*)::integer,
         coalesce(sum(o.subtotal_paise), 0)::bigint,
         coalesce(sum(o.discount_paise), 0)::bigint,
         coalesce(sum(o.tax_paise), 0)::bigint,
         coalesce(sum(o.total_paise), 0)::bigint,
         array_agg(o.id order by o.placed_at, o.id)
    into v_order_count, v_subtotal, v_discount, v_tax, v_total, v_order_ids
    from public.orders o
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled';
  if v_order_count = 0 then
    raise exception 'This table session has no non-cancelled tickets to bill.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and o.discount_paise > 0
  ) then
    raise exception 'This session has discounts without the approved item-level tax and discount audit configuration. A final receipt cannot be issued yet.'
      using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = any(v_order_ids) and p.status = 'recorded';

  select count(*)::integer into v_item_count
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled';
  if v_item_count = 0 then
    raise exception 'Ticket item details are unavailable; a receipt cannot be issued.' using errcode = 'P0001';
  end if;

  -- India financial year: local restaurant date, 1 April to 31 March.
  begin
    v_local_date := (v_issued_at at time zone coalesce(nullif(v_restaurant.timezone, ''), 'Asia/Kolkata'))::date;
  exception when others then
    v_local_date := (v_issued_at at time zone 'Asia/Kolkata')::date;
  end;
  v_fy_start := extract(year from v_local_date)::integer;
  if extract(month from v_local_date) < 4 then
    v_fy_start := v_fy_start - 1;
  end if;
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');

  insert into public.restaurant_invoice_series (restaurant_id, financial_year, next_number)
  values (v_session.restaurant_id, v_fy, 1)
  on conflict (restaurant_id, financial_year) do nothing;

  select s.next_number into v_sequence
    from public.restaurant_invoice_series s
   where s.restaurant_id = v_session.restaurant_id and s.financial_year = v_fy
   for update;
  if v_sequence > 999999 then
    raise exception 'The invoice series for this financial year has reached its six-digit limit.'
      using errcode = '22003';
  end if;
  update public.restaurant_invoice_series
     set next_number = v_sequence + 1
   where restaurant_id = v_session.restaurant_id and financial_year = v_fy;

  v_invoice_number := 'INV/' || v_fy || '/' || lpad(v_sequence::text, 6, '0');
  v_seller := jsonb_build_object(
    'restaurant_id', v_restaurant.id,
    'name', btrim(v_restaurant.name),
    'address', btrim(v_restaurant.address),
    'phone', nullif(btrim(v_restaurant.phone), ''),
    'logo_path', nullif(btrim(v_restaurant.logo_path), '')
  );
  v_totals := jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'ticket_discount_paise', v_discount,
    'bill_discount_paise', 0,
    'taxable_paise', null,
    'tax_paise', v_tax,
    'other_charges_paise', 0,
    'total_paise', v_total,
    'amount_paid_paise', v_paid,
    'outstanding_paise', greatest(v_total - v_paid, 0),
    'payment_status', case when v_paid >= v_total then 'paid' else 'unpaid' end
  );

  select coalesce(jsonb_agg(jsonb_build_object(
           'method', p.method,
           'amount_paise', p.amount_paise,
           'received_at', coalesce(p.recorded_at, p.created_at)
         ) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.payments p
   where p.order_id = any(v_order_ids) and p.status = 'recorded';

  select i.* into v_previous
    from public.restaurant_invoices i
   where i.order_session_id = v_session.id and i.status = 'voided'
   order by i.issued_at desc, i.id desc
   limit 1;

  insert into public.restaurant_invoices (
    restaurant_id, order_session_id, invoice_number, financial_year,
    sequence_number, document_type, issued_at, issued_by,
    table_label_snapshot, session_opened_at, session_closed_at,
    seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot,
    source_order_ids, supersedes_invoice_id
  ) values (
    v_session.restaurant_id, v_session.id, v_invoice_number, v_fy,
    v_sequence, 'receipt', v_issued_at, v_actor,
    v_table_label, v_session.opened_at, v_session.closed_at,
    v_seller, null, v_totals, v_payments,
    v_order_ids, v_previous.id
  ) returning id into v_invoice_id;

  insert into public.restaurant_invoice_lines (
    invoice_id, restaurant_id, line_number, source_order_id,
    source_order_item_id, line_snapshot
  )
  select v_invoice_id,
         v_session.restaurant_id,
         row_number() over (order by o.placed_at, o.id, oi.sort_order, oi.id)::integer,
         o.id,
         oi.id,
         jsonb_build_object(
           'ticket_code', o.code,
           'item_name', oi.name_snapshot,
           'variant', oi.variant_snapshot,
           'addons', to_jsonb(oi.addons_snapshot),
           'quantity', oi.qty,
           'unit_price_paise', oi.unit_price_paise,
           'amount_paise', oi.unit_price_paise * oi.qty,
           'is_veg', oi.is_veg
         )
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled'
   order by o.placed_at, o.id, oi.sort_order, oi.id;

  return v_invoice_id;
end;
$$;

comment on function public.issue_closed_session_receipt(uuid) is
  'Issues or returns the single immutable non-GST receipt for a closed table session. Server-derived totals and payment history; atomic per-restaurant financial-year numbering. GST tax invoices remain fail-closed until tax configuration is approved.';

revoke all on function public.issue_closed_session_receipt(uuid) from public, anon, authenticated;
grant execute on function public.issue_closed_session_receipt(uuid) to authenticated;

create or replace function public.void_restaurant_invoice(
  p_invoice_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.restaurant_invoices%rowtype;
  v_role public.member_role;
begin
  if v_actor is null then
    raise exception 'Sign in to void this invoice.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(btrim(p_reason)) > 500 then
    raise exception 'Enter a reason between 5 and 500 characters.' using errcode = '22023';
  end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = p_invoice_id
   for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_invoice.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can void a receipt.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_invoice.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'This receipt has already been voided.' using errcode = 'P0001';
  end if;

  update public.restaurant_invoices
     set status = 'voided', voided_at = statement_timestamp(),
         voided_by = v_actor, void_reason = btrim(p_reason)
   where id = v_invoice.id;
end;
$$;

comment on function public.void_restaurant_invoice(uuid, text) is
  'Voids, but never deletes or renumbers, a receipt. Only restaurant owners/managers may void; a replacement uses the next invoice number.';

revoke all on function public.void_restaurant_invoice(uuid, text) from public, anon, authenticated;
grant execute on function public.void_restaurant_invoice(uuid, text) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108002000_invoice_receipts.sql','1b4620b3bb773376fa07ce1f78a9b754ba9d134559a896e3d1cc40d8648a66ba');

-- SOURCE 20261108003000_session_checkout_payment_receipts.sql SHA256 3f2e15eff39bb56fe8a5338de8f5c40d3c184260739bafe525abb6dfef746d23
-- P8: close a table session and issue its durable receipt atomically.
--
-- Payment state is frozen into the issued invoice snapshot. Payments recorded
-- after issue produce separate immutable payment acknowledgements linked to
-- that invoice; they never rewrite the invoice PDF or the original share text.

create table if not exists public.restaurant_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  invoice_id uuid not null references public.restaurant_invoices(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  receipt_reference text not null,
  issued_at timestamptz not null default statement_timestamp(),
  snapshot jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint restaurant_payment_receipts_one_per_payment unique (payment_id),
  constraint restaurant_payment_receipts_invoice_sequence unique (invoice_id, sequence_number),
  constraint restaurant_payment_receipts_reference_unique unique (restaurant_id, receipt_reference)
);

create index if not exists restaurant_payment_receipts_invoice_idx
  on public.restaurant_payment_receipts (invoice_id, sequence_number);

alter table public.restaurant_payment_receipts enable row level security;
revoke all on public.restaurant_payment_receipts from public, anon, authenticated, service_role;
grant select on public.restaurant_payment_receipts to authenticated;

create policy restaurant_payment_receipts_staff_read on public.restaurant_payment_receipts
  for select to authenticated
  using (public.is_member(restaurant_id));

-- `created_at` can be the provider-attempt time for an online payment. Stamp a
-- separate received time as the payment becomes recorded; legacy rows remain
-- readable through coalesce(recorded_at, created_at).
create or replace function public.stamp_payment_recorded_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'recorded' and (new.recorded_at is null or (tg_op = 'UPDATE' and old.status is distinct from 'recorded')) then
    new.recorded_at := statement_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_payment_recorded_at() from public, anon, authenticated;

drop trigger if exists payments_stamp_recorded_at on public.payments;
create trigger payments_stamp_recorded_at
before insert or update of status, recorded_at on public.payments
for each row execute function public.stamp_payment_recorded_at();

-- Append one payment acknowledgement for any recorded counter or online
-- payment that arrives after a live invoice was issued. The ledger row and its
-- acknowledgement commit or roll back together.
create or replace function public.issue_payment_receipt_after_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice public.restaurant_invoices%rowtype;
  v_order_session_id uuid;
  v_sequence integer;
  v_total bigint;
  v_paid bigint;
  v_reference text;
  v_snapshot jsonb;
begin
  if new.status <> 'recorded' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'recorded' then
    return new;
  end if;

  -- Serialize against checkout on the same sitting. If the payment commits
  -- first, checkout snapshots it; if checkout commits first, this trigger
  -- sees the issued invoice and creates its supplemental receipt.
  select s.id into v_order_session_id
    from public.orders o
    join public.order_sessions s on s.id = o.order_session_id
   where o.id = new.order_id and o.restaurant_id = new.restaurant_id
   for update of s;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.restaurant_id = new.restaurant_id
     and new.order_id = any(i.source_order_ids)
     and i.status = 'issued'
   order by i.issued_at desc, i.id desc
   limit 1
   for update;
  if not found then
    -- Payments received before the invoice are already represented in its
    -- issue-time payment snapshot, so no duplicate acknowledgement is made.
    return new;
  end if;

  if exists (
    select 1 from public.restaurant_payment_receipts r where r.payment_id = new.id
  ) then
    return new;
  end if;

  select coalesce(max(r.sequence_number), 0) + 1
    into v_sequence
    from public.restaurant_payment_receipts r
   where r.invoice_id = v_invoice.id;

  v_total := coalesce((v_invoice.totals_snapshot->>'total_paise')::bigint, 0);
  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = any(v_invoice.source_order_ids)
     and p.status = 'recorded';

  -- A supplemental payment reference, not a GST invoice serial number.
  v_reference := 'PR/' || v_invoice.financial_year || '/' ||
                 lpad(v_invoice.sequence_number::text, 6, '0') || '-' ||
                 lpad(v_sequence::text, 2, '0');
  v_snapshot := jsonb_build_object(
    'receipt_reference', v_reference,
    'invoice_number', v_invoice.invoice_number,
    'seller', v_invoice.seller_snapshot,
    'table_label', v_invoice.table_label_snapshot,
    'payment_method', new.method,
    'payment_amount_paise', new.amount_paise,
    'payment_received_at', coalesce(new.recorded_at, new.created_at, statement_timestamp()),
    'total_paid_paise', v_paid,
    'outstanding_paise', greatest(v_total - v_paid, 0),
    'payment_status', case when v_paid >= v_total then 'paid' else 'partially_paid' end
  );

  insert into public.restaurant_payment_receipts (
    restaurant_id, invoice_id, payment_id, sequence_number,
    receipt_reference, issued_at, snapshot
  ) values (
    new.restaurant_id, v_invoice.id, new.id, v_sequence,
    v_reference, coalesce(new.recorded_at, statement_timestamp()), v_snapshot
  ) on conflict (payment_id) do nothing;

  return new;
end;
$$;

comment on function public.issue_payment_receipt_after_invoice_payment() is
  'Creates one immutable supplemental payment receipt when a recorded payment arrives after the related session invoice. Does not mutate the issued invoice snapshot.';

revoke all on function public.issue_payment_receipt_after_invoice_payment() from public, anon, authenticated;

drop trigger if exists payments_issue_invoice_receipt on public.payments;
create trigger payments_issue_invoice_receipt
after insert or update of status on public.payments
for each row execute function public.issue_payment_receipt_after_invoice_payment();

-- One transaction: closing blocks further guest tickets, then the P6 helper
-- snapshots all existing tickets and allocates the final number. Any failure
-- in receipt validation rolls the close back too, so no session is stranded.
create or replace function public.close_order_session_and_issue_receipt(
  p_order_session_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.order_sessions%rowtype;
  v_role public.member_role;
  v_invoice_id uuid;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to close this table.'
      using errcode = '42501';
  end if;

  select s.* into v_session
    from public.order_sessions s
   where s.id = p_order_session_id
   for update;
  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_session.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to check out this table.' using errcode = '42501';
  end if;
  if v_session.status = 'open' then
    if not public.restaurant_can_write(v_session.restaurant_id) then
      raise exception 'This restaurant is in read-only mode. Restore access before checkout.'
        using errcode = 'P0001';
    end if;
    update public.order_sessions
       set status = 'closed',
           closed_at = statement_timestamp(),
           closed_by = v_actor
     where id = v_session.id;
  elsif v_session.closed_at is null then
    raise exception 'The closed table session has no close timestamp; ask an owner to review it.'
      using errcode = 'P0001';
  end if;

  v_invoice_id := public.issue_closed_session_receipt(v_session.id);
  return v_invoice_id;
end;
$$;

comment on function public.close_order_session_and_issue_receipt(uuid) is
  'Atomically closes an open table session and creates/returns its final receipt. Can be retried safely; receipt validation failure rolls the close back.';

revoke all on function public.close_order_session_and_issue_receipt(uuid) from public, anon, authenticated;
grant execute on function public.close_order_session_and_issue_receipt(uuid) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108003000_session_checkout_payment_receipts.sql','3f2e15eff39bb56fe8a5338de8f5c40d3c184260739bafe525abb6dfef746d23');

-- SOURCE 20261108005000_p9_security_hardening.sql SHA256 0e681fd67fe010e163e79d53292733d8295e2771efc9f0324f468b0cfc5ddbc0
-- P9 security hardening: invitation attempt budgets, append-only staff audit
-- records, and idempotent invitation redemption after a lost response.

-- ---------------------------------------------------------------------------
-- Join-code attempt budgets
--
-- This migration depends on hit_rate_limit() from
-- 20261108000000_guest_rate_limits.sql. Limits are keyed by auth.uid() and a
-- SHA-256 of the normalised code; they remain effective for direct PostgREST
-- calls, not only requests that pass through the Next.js page.
-- ---------------------------------------------------------------------------

create or replace function public.preview_staff_invite(p_code text)
returns table (
  status          text,
  restaurant_id   uuid,
  restaurant_name text,
  role            public.member_role,
  expires_at      timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invite public.restaurant_invites%rowtype;
  v_name text;
  v_allowed boolean;
  v_retry integer;
  v_code_hash text := public.hash_invite_code(p_code);
begin
  if v_actor is null then
    raise exception 'Sign in to open this invitation.' using errcode = '42501';
  end if;

  select h.allowed, h.retry_after_seconds into v_allowed, v_retry
    from public.hit_rate_limit('staff-invite:preview:user:' || v_actor::text, 30, 3600) h;
  if not coalesce(v_allowed, false) then
    return query select 'rate_limited'::text, null::uuid, null::text, null::public.member_role, null::timestamptz;
    return;
  end if;
  select h.allowed, h.retry_after_seconds into v_allowed, v_retry
    from public.hit_rate_limit('staff-invite:preview:code:' || v_actor::text || ':' || v_code_hash, 12, 3600) h;
  if not coalesce(v_allowed, false) then
    return query select 'rate_limited'::text, null::uuid, null::text, null::public.member_role, null::timestamptz;
    return;
  end if;

  select * into v_invite
    from public.restaurant_invites i
   where i.code_hash = v_code_hash;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::public.member_role, null::timestamptz;
    return;
  end if;

  select r.name into v_name
    from public.restaurants r
   where r.id = v_invite.restaurant_id and r.is_active;
  if not found then
    return query select 'closed'::text, v_invite.restaurant_id, null::text, v_invite.role, v_invite.expires_at;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif v_invite.expires_at <= statement_timestamp() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_invite.restaurant_id and m.user_id = v_actor
  ) then
    return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  else
    return query select 'ok'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  end if;
end;
$$;

revoke all on function public.preview_staff_invite(text) from public, anon;
grant execute on function public.preview_staff_invite(text) to authenticated;

create or replace function public.redeem_staff_invite(p_code text)
returns table (
  status          text,
  restaurant_id   uuid,
  restaurant_name text,
  role            public.member_role
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invite public.restaurant_invites%rowtype;
  v_name text;
  v_allowed boolean;
  v_retry integer;
  v_invite_found boolean := false;
  v_code_hash text := public.hash_invite_code(p_code);
begin
  if v_actor is null then
    raise exception 'Sign in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_invite
    from public.restaurant_invites i
   where i.code_hash = v_code_hash
   for update;
  v_invite_found := found;

  -- A retry after the commit must be safe even if the response was lost. Only
  -- the same actor who redeemed the link, and still has that membership, gets
  -- this idempotent success; everybody else sees the single-use status below.
  if found and v_invite.redeemed_at is not null and v_invite.redeemed_by = v_actor
     and exists (
       select 1 from public.memberships m
        where m.restaurant_id = v_invite.restaurant_id and m.user_id = v_actor
     ) then
    select r.name into v_name from public.restaurants r
     where r.id = v_invite.restaurant_id and r.is_active;
    if found then
      return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role;
      return;
    end if;
  end if;

  select h.allowed, h.retry_after_seconds into v_allowed, v_retry
    from public.hit_rate_limit('staff-invite:redeem:user:' || v_actor::text, 12, 3600) h;
  if not coalesce(v_allowed, false) then
    return query select 'rate_limited'::text, null::uuid, null::text, null::public.member_role;
    return;
  end if;
  select h.allowed, h.retry_after_seconds into v_allowed, v_retry
    from public.hit_rate_limit('staff-invite:redeem:code:' || v_actor::text || ':' || v_code_hash, 5, 3600) h;
  if not coalesce(v_allowed, false) then
    return query select 'rate_limited'::text, null::uuid, null::text, null::public.member_role;
    return;
  end if;

  if not v_invite_found then
    return query select 'not_found'::text, null::uuid, null::text, null::public.member_role;
    return;
  end if;

  select r.name into v_name
    from public.restaurants r
   where r.id = v_invite.restaurant_id and r.is_active;
  if not found then
    return query select 'closed'::text, v_invite.restaurant_id, null::text, v_invite.role;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role;
  elsif v_invite.expires_at <= statement_timestamp() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role;
  elsif exists (
    select 1 from public.memberships m
     where m.restaurant_id = v_invite.restaurant_id and m.user_id = v_actor
  ) then
    -- An existing team member does not consume somebody else's link.
    return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  end if;

  insert into public.profiles (id) values (v_actor)
  on conflict (id) do nothing;

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_invite.restaurant_id, v_actor, v_invite.role);

  update public.restaurant_invites
     set redeemed_by = v_actor, redeemed_at = statement_timestamp()
   where id = v_invite.id;

  return query select 'ok'::text, v_invite.restaurant_id, v_name, v_invite.role;
end;
$$;

revoke all on function public.redeem_staff_invite(text) from public, anon;
grant execute on function public.redeem_staff_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only staff/security audit records
--
-- Do not store invitation codes, hashes, emails, IP addresses, or request
-- payloads. Trigger rows cover invite lifecycle and team membership changes.
-- The read RPC is restricted to owners/managers; there is no direct table
-- access or client write path.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_security_audit_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  actor_id uuid,
  event_type text not null check (event_type in (
    'staff_invite.created',
    'staff_invite.redeemed',
    'staff_invite.revoked',
    'staff_invite.deleted',
    'staff_member.added',
    'staff_member.removed',
    'staff_member.role_changed'
  )),
  target_type text not null check (target_type in ('staff_invite', 'membership')),
  target_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists staff_security_audit_log_restaurant_time_idx
  on public.staff_security_audit_log (restaurant_id, created_at desc, id desc);

alter table public.staff_security_audit_log enable row level security;
revoke all on public.staff_security_audit_log from public, anon, authenticated, service_role;

create or replace function public.reject_staff_security_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Staff security audit records are append-only.' using errcode = '42501';
end;
$$;
revoke all on function public.reject_staff_security_audit_mutation() from public, anon, authenticated;

drop trigger if exists staff_security_audit_log_immutable on public.staff_security_audit_log;
create trigger staff_security_audit_log_immutable
before update or delete on public.staff_security_audit_log
for each row execute function public.reject_staff_security_audit_mutation();

create or replace function public.audit_staff_invite_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event text;
  v_actor uuid := auth.uid();
  v_restaurant_id uuid;
  v_id uuid;
  v_role public.member_role;
  v_expires_at timestamptz;
begin
  if tg_op = 'INSERT' then
    v_event := 'staff_invite.created';
    v_actor := coalesce(v_actor, new.created_by);
    v_restaurant_id := new.restaurant_id;
    v_id := new.id;
    v_role := new.role;
    v_expires_at := new.expires_at;
  elsif tg_op = 'DELETE' then
    v_event := 'staff_invite.deleted';
    v_restaurant_id := old.restaurant_id;
    v_id := old.id;
    v_role := old.role;
    v_expires_at := old.expires_at;
  elsif old.redeemed_at is null and new.redeemed_at is not null then
    v_event := 'staff_invite.redeemed';
    v_actor := coalesce(v_actor, new.redeemed_by);
    v_restaurant_id := new.restaurant_id;
    v_id := new.id;
    v_role := new.role;
    v_expires_at := new.expires_at;
  elsif old.revoked_at is null and new.revoked_at is not null then
    v_event := 'staff_invite.revoked';
    v_restaurant_id := new.restaurant_id;
    v_id := new.id;
    v_role := new.role;
    v_expires_at := new.expires_at;
  else
    return new;
  end if;

  insert into public.staff_security_audit_log (
    restaurant_id, actor_id, event_type, target_type, target_id, metadata
  ) values (
    v_restaurant_id, v_actor, v_event, 'staff_invite', v_id,
    jsonb_build_object('role', v_role, 'expires_at', v_expires_at)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_staff_invite_change() from public, anon, authenticated;

drop trigger if exists restaurant_invites_security_audit on public.restaurant_invites;
create trigger restaurant_invites_security_audit
after insert or update or delete on public.restaurant_invites
for each row execute function public.audit_staff_invite_change();

create or replace function public.audit_staff_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event text;
  v_restaurant_id uuid;
  v_membership_id uuid;
  v_member_user_id uuid;
  v_actor uuid := auth.uid();
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_event := 'staff_member.added';
    v_restaurant_id := new.restaurant_id;
    v_membership_id := new.id;
    v_member_user_id := new.user_id;
    v_metadata := jsonb_build_object('role', new.role, 'member_user_id', new.user_id);
  elsif tg_op = 'DELETE' then
    v_event := 'staff_member.removed';
    v_restaurant_id := old.restaurant_id;
    v_membership_id := old.id;
    v_member_user_id := old.user_id;
    v_metadata := jsonb_build_object('role', old.role, 'member_user_id', old.user_id);
  elsif old.role is distinct from new.role then
    v_event := 'staff_member.role_changed';
    v_restaurant_id := new.restaurant_id;
    v_membership_id := new.id;
    v_member_user_id := new.user_id;
    v_metadata := jsonb_build_object('old_role', old.role, 'new_role', new.role, 'member_user_id', new.user_id);
  else
    return new;
  end if;

  insert into public.staff_security_audit_log (
    restaurant_id, actor_id, event_type, target_type, target_id, metadata
  ) values (
    v_restaurant_id, v_actor, v_event, 'membership', v_membership_id, v_metadata
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_staff_membership_change() from public, anon, authenticated;

drop trigger if exists memberships_security_audit on public.memberships;
create trigger memberships_security_audit
after insert or update or delete on public.memberships
for each row execute function public.audit_staff_membership_change();

create or replace function public.list_staff_security_audit(
  p_restaurant_id uuid,
  p_limit integer default 50
) returns table (
  id uuid,
  actor_id uuid,
  event_type text,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view staff security history.' using errcode = '42501';
  end if;
  if p_restaurant_id is null
     or not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can view staff security history.' using errcode = '42501';
  end if;

  return query
    select a.id, a.actor_id, a.event_type, a.target_type, a.target_id, a.metadata, a.created_at
      from public.staff_security_audit_log a
     where a.restaurant_id = p_restaurant_id
     order by a.created_at desc, a.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;
revoke all on function public.list_staff_security_audit(uuid, integer) from public, anon;
grant execute on function public.list_staff_security_audit(uuid, integer) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108005000_p9_security_hardening.sql','0e681fd67fe010e163e79d53292733d8295e2771efc9f0324f468b0cfc5ddbc0');

-- SOURCE 20261108006000_restore_public_order_session_attach.sql SHA256 024a9dc4ab1767c10769668e6dee80832ea4f3829e1564d5043f040064093524
-- ============================================================================
-- Restore the P3 durable order-session attachment in the latest public-order
-- wrapper. The order-code reliability migration replaced this wrapper from an
-- older body and accidentally omitted the open-or-join step introduced by
-- 20261108000200. The core order write and checkout flow are unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text DEFAULT NULL,
  p_session_token text DEFAULT NULL,
  p_guest_token uuid DEFAULT NULL,
  p_ip_hash text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_restaurant_id uuid;
  v_existing text;
  v_allowed boolean;
  v_retry integer;
  v_table_id uuid;
  v_order_session_id uuid;
BEGIN
  IF p_session_token IS NULL OR btrim(p_session_token) = '' THEN
    RAISE EXCEPTION 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id INTO v_restaurant_id
    FROM public.restaurants r
   WHERE r.slug = btrim(coalesce(p_slug, ''));

  -- Replays return before rate counting or any new ticket/session work.
  IF p_guest_token IS NOT NULL AND v_restaurant_id IS NOT NULL THEN
    SELECT o.code INTO v_existing
      FROM public.orders o
     WHERE o.guest_token = p_guest_token
       AND o.restaurant_id = v_restaurant_id
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT a.allowed, a.retry_after_seconds
    INTO v_allowed, v_retry
    FROM public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  IF coalesce(v_allowed, true) THEN
    SELECT a.allowed, a.retry_after_seconds
      INTO v_allowed, v_retry
      FROM public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  END IF;

  IF coalesce(v_allowed, true) AND p_ip_hash IS NOT NULL AND btrim(p_ip_hash) <> '' THEN
    SELECT a.allowed, a.retry_after_seconds
      INTO v_allowed, v_retry
      FROM public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
  END IF;

  IF coalesce(v_allowed, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      USING ERRCODE = 'P0001', HINT = 'rate-limited';
  END IF;

  v_code := public.place_public_order_core_with_code_retry(p_slug, p_lines, p_note, p_session_token);
  PERFORM public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token));

  IF p_guest_token IS NOT NULL THEN
    UPDATE public.orders o
       SET guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (SELECT r.tax_rate_bps FROM public.restaurants r WHERE r.id = o.restaurant_id)
           )
     WHERE o.code = v_code
       AND o.restaurant_id = v_restaurant_id;
  END IF;

  -- Every guest ticket at a table belongs to the table's one open sitting.
  -- The partial unique index arbitrates concurrent first orders; an order for
  -- a closed sitting opens a fresh session instead of reusing history.
  SELECT o.table_id INTO v_table_id
    FROM public.orders o
   WHERE o.code = v_code
     AND o.restaurant_id = v_restaurant_id;

  IF v_table_id IS NOT NULL THEN
    INSERT INTO public.order_sessions (restaurant_id, table_id)
    VALUES (v_restaurant_id, v_table_id)
    ON CONFLICT (table_id) WHERE status = 'open'
    DO UPDATE SET table_id = excluded.table_id
    RETURNING id INTO v_order_session_id;

    UPDATE public.orders o
       SET order_session_id = v_order_session_id
     WHERE o.code = v_code
       AND o.restaurant_id = v_restaurant_id
       AND o.order_session_id IS NULL;
  END IF;

  RETURN v_code;

EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent replay may lose the guest-token unique-index race. The
    -- PL/pgSQL exception subtransaction rolls back its core order, line items,
    -- and session attachment before returning the winning order's code.
    IF p_guest_token IS NOT NULL THEN
      SELECT o.code INTO v_existing
        FROM public.orders o
       WHERE o.guest_token = p_guest_token
         AND (v_restaurant_id IS NULL OR o.restaurant_id = v_restaurant_id)
       LIMIT 1;

      IF v_existing IS NOT NULL THEN
        RETURN v_existing;
      END IF;
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) IS
  'Guest order placement: server-priced, idempotent on p_guest_token, rate limited, collision-retried, and attached to the table''s open order session.';

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261108006000_restore_public_order_session_attach.sql','024a9dc4ab1767c10769668e6dee80832ea4f3829e1564d5043f040064093524');

-- SOURCE 20261109000100_restore_hold_fields.sql SHA256 0b9ae189c2f47aea6aacc27488fb81439c2996009a8af6be93be8c004af65c7a
-- ============================================================================
-- AutoDine — migration 20261109000100: get_public_order must report a hold
--
-- WHY THIS EXISTS
--
-- 20261028000900 added orders.hold_required / orders.confirmed_at and made
-- get_public_order return them, so the guest could be told "waiting for the
-- restaurant to confirm your table" instead of "confirmed".
--
-- 20261107000000 then replaced get_public_order to remove the r.is_active
-- filter (a deliberate storefront fix) but copied the older function body,
-- which did not have the two hold fields. The result is that the guest status
-- page and the live-status poller can never see a hold: awaitingConfirmation
-- is always false, and a held ticket is shown as "Confirmed".
--
-- 20261108000200_drift_reconcile re-applied the hold stamp to
-- place_public_order but explicitly did NOT re-assert get_public_order,
-- because it believed 20261107000000 was the latest word. It is the latest
-- word, but it is missing the hold fields. This migration keeps the
-- storefront fix (no is_active filter) and adds the two fields back.
--
-- This is the 20261107000000 body, unchanged except for the two keys.
-- ============================================================================

create or replace function public.get_public_order(
  p_slug text,
  p_code text,
  p_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'prep_status', o.prep_status,
    'payment_status', o.payment_status,
    'subtotal_paise', o.subtotal_paise,
    'tax_paise', o.tax_paise,
    'total_paise', o.total_paise,
    'customer_note', o.customer_note,
    'placed_at', o.placed_at,
    'hold_required', o.hold_required,
    'confirmed_at', o.confirmed_at,
    'table_label', t.label,
    'lines', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name_snapshot,
                 'qty', i.qty,
                 'unit_price_paise', i.unit_price_paise,
                 'is_veg', i.is_veg,
                 'variant', i.variant_snapshot,
                 'addons', i.addons_snapshot
               )
               order by i.sort_order
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.dining_tables t on t.id = o.table_id
  where r.slug = p_slug
    and o.code = p_code
    and p_token is not null
    and o.guest_token = p_token
  limit 1;
$$;

revoke all on function public.get_public_order(text, text, uuid) from public;
revoke all on function public.get_public_order(text, text, uuid) from anon;
revoke all on function public.get_public_order(text, text, uuid) from authenticated;
grant execute on function public.get_public_order(text, text, uuid) to anon;
grant execute on function public.get_public_order(text, text, uuid) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000100_restore_hold_fields.sql','0b9ae189c2f47aea6aacc27488fb81439c2996009a8af6be93be8c004af65c7a');

-- SOURCE 20261109000200_order_attempt_lock.sql SHA256 ec029cc6fee516caffaef554e798892ce684989fac41673917a3ee230a9b6b14
-- Preserve the latest session attachment and retry logic; serialize guest-token replays.
-- ============================================================================
-- Restore the P3 durable order-session attachment in the latest public-order
-- wrapper. The order-code reliability migration replaced this wrapper from an
-- older body and accidentally omitted the open-or-join step introduced by
-- 20261108000200. The core order write and checkout flow are unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.place_public_order(
  p_slug text,
  p_lines jsonb,
  p_note text DEFAULT NULL,
  p_session_token text DEFAULT NULL,
  p_guest_token uuid DEFAULT NULL,
  p_ip_hash text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_restaurant_id uuid;
  v_existing text;
  v_allowed boolean;
  v_retry integer;
  v_table_id uuid;
  v_order_session_id uuid;
BEGIN
  IF p_guest_token IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('guest:' || p_guest_token::text));
  END IF;
  IF p_session_token IS NULL OR btrim(p_session_token) = '' THEN
    RAISE EXCEPTION 'Scan the QR code on your table and enter the code showing in the restaurant before ordering.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id INTO v_restaurant_id
    FROM public.restaurants r
   WHERE r.slug = btrim(coalesce(p_slug, ''));

  -- Replays return before rate counting or any new ticket/session work.
  IF p_guest_token IS NOT NULL AND v_restaurant_id IS NOT NULL THEN
    SELECT o.code INTO v_existing
      FROM public.orders o
     WHERE o.guest_token = p_guest_token
       AND o.restaurant_id = v_restaurant_id
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT a.allowed, a.retry_after_seconds
    INTO v_allowed, v_retry
    FROM public.hit_rate_limit(
      'po:s:' || encode(sha256(btrim(p_session_token)::bytea), 'hex'),
      30, 600
    ) a;

  IF coalesce(v_allowed, true) THEN
    SELECT a.allowed, a.retry_after_seconds
      INTO v_allowed, v_retry
      FROM public.hit_rate_limit(
        'po:t:' || coalesce(v_restaurant_id::text, 'unknown'),
        60, 600
      ) a;
  END IF;

  IF coalesce(v_allowed, true) AND p_ip_hash IS NOT NULL AND btrim(p_ip_hash) <> '' THEN
    SELECT a.allowed, a.retry_after_seconds
      INTO v_allowed, v_retry
      FROM public.hit_rate_limit('po:i:' || btrim(p_ip_hash), 60, 600) a;
  END IF;

  IF coalesce(v_allowed, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'Too many orders right now. Please wait % seconds and try again.',
      coalesce(v_retry, 60)
      USING ERRCODE = 'P0001', HINT = 'rate-limited';
  END IF;

  v_code := public.place_public_order_core_with_code_retry(p_slug, p_lines, p_note, p_session_token);
  PERFORM public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token));

  IF p_guest_token IS NOT NULL THEN
    UPDATE public.orders o
       SET guest_token = p_guest_token,
           tax_rate_bps_snapshot = coalesce(
             o.tax_rate_bps_snapshot,
             (SELECT r.tax_rate_bps FROM public.restaurants r WHERE r.id = o.restaurant_id)
           )
     WHERE o.code = v_code
       AND o.restaurant_id = v_restaurant_id;
  END IF;

  -- Every guest ticket at a table belongs to the table's one open sitting.
  -- The partial unique index arbitrates concurrent first orders; an order for
  -- a closed sitting opens a fresh session instead of reusing history.
  SELECT o.table_id INTO v_table_id
    FROM public.orders o
   WHERE o.code = v_code
     AND o.restaurant_id = v_restaurant_id;

  IF v_table_id IS NOT NULL THEN
    INSERT INTO public.order_sessions (restaurant_id, table_id)
    VALUES (v_restaurant_id, v_table_id)
    ON CONFLICT (table_id) WHERE status = 'open'
    DO UPDATE SET table_id = excluded.table_id
    RETURNING id INTO v_order_session_id;

    UPDATE public.orders o
       SET order_session_id = v_order_session_id
     WHERE o.code = v_code
       AND o.restaurant_id = v_restaurant_id
       AND o.order_session_id IS NULL;
  END IF;

  RETURN v_code;

EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent replay may lose the guest-token unique-index race. The
    -- PL/pgSQL exception subtransaction rolls back its core order, line items,
    -- and session attachment before returning the winning order's code.
    IF p_guest_token IS NOT NULL THEN
      SELECT o.code INTO v_existing
        FROM public.orders o
       WHERE o.guest_token = p_guest_token
         AND (v_restaurant_id IS NULL OR o.restaurant_id = v_restaurant_id)
       LIMIT 1;

      IF v_existing IS NOT NULL THEN
        RETURN v_existing;
      END IF;
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.place_public_order(text, jsonb, text, text, uuid, text) IS
  'Guest order placement: server-priced, idempotent on p_guest_token, rate limited, collision-retried, and attached to the table''s open order session.';

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000200_order_attempt_lock.sql','ec029cc6fee516caffaef554e798892ce684989fac41673917a3ee230a9b6b14');

-- SOURCE 20261109000300_payment_state_guards.sql SHA256 db4b979da5aecb20836b0844d49497f3656d85556ecf5e5d4991d1b86e429aff
-- ============================================================================
-- AutoDine — migration 20261109000300: a pending online payment is a lock
--
-- WHY THIS EXISTS
--
-- The online payment path records a pending attempt before the guest pays.
-- Three other paths only looked at orders.payment_status, which stays
-- 'pending' until settlement, so they treated the order as untouched:
--
--   * cancel_order() allowed the guest to cancel while the payment was in
--     flight; settle_online_payment() then marked the cancelled order paid.
--   * set_order_line_quantities() allowed the guest to reprice the order
--     underneath the attempt; the provider captured the old amount.
--   * record_counter_payment() let the cashier collect the full balance in
--     cash while the online attempt was still pending, then the webhook
--     settled the online attempt too: a double collection.
--
-- Each function now refuses when a pending online attempt exists. The
-- cashier queue also shows the attempt (lib/db/cashier-screen.ts), but the
-- database is the authority. settle_online_payment() refuses a cancelled
-- order instead of marking it paid; the webhook retries, the payment row
-- stays pending, and staff can arrange a refund through the payment provider.
--
-- The bodies are the current versions with the guards added. No signature
-- changes, so existing callers keep working.
-- ============================================================================

create or replace function public.cancel_order(
  p_order_id uuid,
  p_guest_token uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k_guest_window constant interval := interval '10 minutes';
  v_order public.orders%rowtype;
  v_staff boolean := false;
  v_reason text;
begin
  if p_order_id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;


  -- Who is asking. This comes first because it decides whether the caller is
  -- even allowed to know this order exists.
  if p_guest_token is not null then
    -- Wrong token and no such order give the same answer: never confirm which.
    if v_order.guest_token is distinct from p_guest_token then
      raise exception 'That order could not be found.' using errcode = 'P0001';
    end if;
  else
    select exists (
      select 1
        from public.memberships m
       where m.restaurant_id = v_order.restaurant_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'manager', 'cashier', 'kitchen')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to cancel this order.' using errcode = 'P0001';
    end if;
  end if;

  -- A pending online attempt is money in flight. Cancelling or repricing the
  -- order underneath it would leave the provider capturing an amount that no
  -- longer matches the bill, and there is no refund path in this build.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Please wait for it to finish or ask staff.' using errcode = 'P0001';
  end if;

  -- Cancelling twice is not an error: two people can press the same button,
  -- and the second press should not raise "the kitchen has started" over a
  -- state that is already cancelled. This check has to come before the
  -- guests' "only while new" rule, or the second press of a button tells the
  -- guest something that is not true.
  if v_order.prep_status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'already', true);
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. A refund has to be handled at the counter.'
      using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'served' then
    raise exception 'This order has already been served.' using errcode = 'P0001';
  end if;

  -- A guest may only cancel before the kitchen starts, and only for ten
  -- minutes. Staff have no such limit: they are standing next to the guest.
  if p_guest_token is not null then
    if v_order.prep_status <> 'new' then
      raise exception 'The kitchen has already started this order. Please ask the staff.'
        using errcode = 'P0001';
    end if;

    if v_order.placed_at < statement_timestamp() - k_guest_window then
      raise exception 'This order is more than ten minutes old. Please ask the staff to cancel it.'
        using errcode = 'P0001';
    end if;
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    v_reason := case when p_guest_token is not null then 'guest' else 'staff' end;
  end if;

  update public.orders
     set prep_status = 'cancelled',
         cancel_reason = left(v_reason, 120),
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('status', 'cancelled', 'already', false);
end;
$$;

create or replace function public.set_order_line_quantities(
  p_order_id uuid,
  p_lines jsonb,
  p_guest_token uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_staff boolean := false;
  v_rate int;
  v_taxable bigint;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_lines_left int := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;


  if p_guest_token is not null then
    if v_order.guest_token is distinct from p_guest_token then
      raise exception 'That order could not be found.' using errcode = 'P0001';
    end if;
  else
    select exists (
      select 1
        from public.memberships m
       where m.restaurant_id = v_order.restaurant_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'manager', 'cashier', 'kitchen')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to change this order.' using errcode = 'P0001';
    end if;
  end if;

  -- A pending online attempt is money in flight. Cancelling or repricing the
  -- order underneath it would leave the provider capturing an amount that no
  -- longer matches the bill, and there is no refund path in this build.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Please wait for it to finish or ask staff.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order has been cancelled.' using errcode = 'P0001';
  end if;

  if v_order.prep_status <> 'new' then
    raise exception 'The kitchen has already started this order. Please ask the staff to change it.'
      using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. Ask the counter to change it.'
      using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  with wanted as (
    select (entry->>'line_id')::uuid as line_id,
           greatest(0, least(99, coalesce((entry->>'qty')::int, 0))) as qty
      from jsonb_array_elements(p_lines) as entry
     where (entry->>'line_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  )
  update public.order_items i
     set qty = w.qty
    from wanted w
   where i.id = w.line_id
     and i.order_id = v_order.id;

  -- A line taken to zero is removed, not kept at zero: a ticket that says
  -- "0 Butter Naan" is a ticket somebody has to read twice.
  delete from public.order_items i
   where i.order_id = v_order.id
     and i.qty <= 0;

  select count(*), coalesce(sum(unit_price_paise * qty), 0)
    into v_lines_left, v_subtotal
    from public.order_items
   where order_id = v_order.id;

  if v_lines_left = 0 then
    raise exception 'An order needs at least one dish. Cancel it instead.' using errcode = 'P0001';
  end if;

  -- The rate this order was priced at, falling back to the restaurant's
  -- current rate only for orders placed before the snapshot column existed.
  v_rate := coalesce(
    v_order.tax_rate_bps_snapshot,
    (select r.tax_rate_bps from public.restaurants r where r.id = v_order.restaurant_id),
    0
  );

  v_taxable := greatest(v_subtotal - v_order.discount_paise, 0);
  v_tax := round(v_taxable::numeric * v_rate / 10000.0)::bigint;
  v_total := v_taxable + v_tax;

  update public.orders
     set subtotal_paise = v_subtotal,
         tax_paise = v_tax,
         total_paise = v_total,
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'tax_paise', v_tax,
    'total_paise', v_total,
    'lines', v_lines_left
  );
end;
$$;

create or replace function public.record_counter_payment(
  p_restaurant_slug  text,
  p_order_id         uuid,
  p_method           text,            -- 'cash' | 'card' | 'upi'
  p_amount_paise     bigint,          -- must equal the outstanding balance
  p_idempotency_key  uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant  public.restaurants%rowtype;
  v_role        public.member_role;
  v_order       public.orders%rowtype;
  v_existing    public.payments%rowtype;
  v_paid_paise  bigint := 0;
  v_due_paise   bigint := 0;
  v_payment_id  uuid;
  v_key         text;
  v_actor_id    uuid;
  v_event       text;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'Sign in with an authorized restaurant account to record a payment.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'A payment request key is required.' using errcode = 'P0002';
  end if;

  -- Only methods a counter can actually take. 'online' is excluded on
  -- purpose: see the header comment.
  if p_method not in ('cash', 'card', 'upi') then
    raise exception 'Unsupported counter payment method: %.', p_method
      using errcode = '22023';
  end if;

  select * into v_restaurant
  from public.restaurants r
  where r.slug = p_restaurant_slug and r.is_active;

  if not found then
    raise exception 'Restaurant not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
  from public.memberships m
  where m.restaurant_id = v_restaurant.id
    and m.user_id = v_actor_id;

  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to collect payments for this restaurant.'
      using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.restaurant_id = v_restaurant.id
  for update;

  if not found then
    raise exception 'Order not found for this restaurant.' using errcode = 'P0002';
  end if;

  -- Do not take cash while an online attempt is still pending. The counter
  -- queue shows the attempt, but the database is the authority: a cashier
  -- who has not seen the badge must not be able to collect twice.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Do not take cash until it settles.' using errcode = 'P0001';
  end if;

  -- The method is part of the key. Without it, a cash attempt and a card
  -- attempt on the same order that reused a UUID would collide and one would
  -- be silently answered with the other's payment.
  v_key := p_method || ':' || v_restaurant.id::text || ':' || v_order.id::text
           || ':' || p_idempotency_key::text;

  select * into v_existing
  from public.payments p
  where p.idempotency_key = v_key;

  if found then
    if v_existing.order_id = v_order.id
       and v_existing.amount_paise = p_amount_paise
       and v_existing.method = p_method
       and v_existing.status = 'recorded' then
      return v_existing.id;
    end if;
    raise exception 'This payment request key was already used with different details.'
      using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant.id) then
    raise exception 'This restaurant is in read-only mode. Restore access before collecting payments.'
      using errcode = 'P0001';
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = 'P0002';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'Only unpaid pending orders can be settled at the counter.'
      using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'Cancelled orders cannot be settled.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid_paise
  from public.payments p
  where p.order_id = v_order.id and p.status = 'recorded';

  v_due_paise := v_order.total_paise - v_paid_paise;

  if v_due_paise <= 0 then
    raise exception 'This order has no outstanding balance.' using errcode = 'P0001';
  end if;

  if p_amount_paise <> v_due_paise then
    raise exception 'Amount must exactly match the outstanding balance of % paise.', v_due_paise
      using errcode = 'P0001';
  end if;

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, recorded_by, idempotency_key
  ) values (
    v_order.id, v_restaurant.id, p_method, v_due_paise, 'recorded',
    'counter', v_actor_id, v_key
  )
  returning id into v_payment_id;

  update public.orders
     set payment_status = 'paid',
         updated_at     = statement_timestamp()
   where id = v_order.id;

  -- Distinct event types per method so the audit log can be filtered by how
  -- the money actually moved, not just that it moved.
  v_event := p_method || '_collected';

  insert into public.payment_audit_events (
    restaurant_id, order_id, payment_id, actor_id,
    event_type, method, amount_paise
  ) values (
    v_restaurant.id, v_order.id, v_payment_id, v_actor_id,
    v_event, p_method, v_due_paise
  );

  if v_payment_id is null then
    raise exception 'Payment was not recorded.' using errcode = 'P0001';
  end if;

  return v_payment_id;
end;
$$;

create or replace function public.settle_online_payment(
  p_provider              text,
  p_provider_order_ref    text,
  p_provider_payment_ref  text,
  p_amount_paise          bigint default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.payments%rowtype;
  v_order public.orders%rowtype;
begin
  if p_provider is null or p_provider_order_ref is null or p_provider_payment_ref is null then
    raise exception 'A provider order and payment id are both required.' using errcode = '22023';
  end if;

  select * into v_row
    from public.payments p
   where p.provider = p_provider
     and p.provider_ref = p_provider_order_ref
   for update;

  if not found then
    -- Money we cannot account for is not something to guess at. The provider
    -- will retry the webhook; the server log says what arrived.
    raise exception 'No payment attempt matches that reference.' using errcode = 'P0002';
  end if;

  if v_row.status = 'recorded' then
    return v_row.id;
  end if;

  if v_row.status = 'refunded' then
    raise exception 'That payment was refunded.' using errcode = 'P0001';
  end if;

  -- The webhook states the amount and is held to it. The browser callback does
  -- not carry one, and a null means "the attempt's own amount" -- which was
  -- computed from public.orders when the attempt began, not by the caller.
  if p_amount_paise is not null and p_amount_paise <> v_row.amount_paise then
    raise exception 'The settled amount does not match the attempt (expected %, got %).',
      v_row.amount_paise, p_amount_paise
      using errcode = 'P0001';
  end if;

  select * into v_order from public.orders o where o.id = v_row.order_id for update;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order was cancelled. The payment cannot be settled automatically; arrange a refund through the payment provider.' using errcode = 'P0001';
  end if;

  update public.payments
     set status = 'recorded',
         provider_payment_ref = p_provider_payment_ref
   where id = v_row.id;

  update public.orders
     set payment_status = 'paid',
         updated_at = statement_timestamp()
   where id = v_row.order_id
     and payment_status <> 'paid';

  select * into v_order from public.orders o where o.id = v_row.order_id;

  -- The same audit table counter payments write to, with its own event type,
  -- so "how was this order paid" is answerable for both paths.
  insert into public.payment_audit_events (
    restaurant_id, order_id, payment_id, actor_id,
    event_type, method, amount_paise
  ) values (
    v_row.restaurant_id, v_row.order_id, v_row.id, null,
    'online_collected', 'online', v_row.amount_paise
  );

  return v_row.id;
end;
$$;

revoke all on function public.cancel_order(uuid, uuid, text) from public;
revoke all on function public.cancel_order(uuid, uuid, text) from anon;
revoke all on function public.cancel_order(uuid, uuid, text) from authenticated;
grant execute on function public.cancel_order(uuid, uuid, text) to anon;
grant execute on function public.cancel_order(uuid, uuid, text) to authenticated;

revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from public;
revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from anon;
revoke all on function public.set_order_line_quantities(uuid, jsonb, uuid) from authenticated;
grant execute on function public.set_order_line_quantities(uuid, jsonb, uuid) to anon;
grant execute on function public.set_order_line_quantities(uuid, jsonb, uuid) to authenticated;

revoke all on function public.record_counter_payment(text, uuid, text, bigint, uuid) from public;
revoke all on function public.record_counter_payment(text, uuid, text, bigint, uuid) from anon;
revoke all on function public.record_counter_payment(text, uuid, text, bigint, uuid) from authenticated;
grant execute on function public.record_counter_payment(text, uuid, text, bigint, uuid) to authenticated;

revoke all on function public.settle_online_payment(text, text, text, bigint) from public;
revoke all on function public.settle_online_payment(text, text, text, bigint) from anon;
revoke all on function public.settle_online_payment(text, text, text, bigint) from authenticated;
grant execute on function public.settle_online_payment(text, text, text, bigint) to service_role;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000300_payment_state_guards.sql','db4b979da5aecb20836b0844d49497f3656d85556ecf5e5d4991d1b86e429aff');

-- SOURCE 20261109000400_order_write_boundary.sql SHA256 891b6dd75e69d794437340b4d3c60904193a092cf7503868dd629e92f8759d0c
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
revoke all on function public.place_order(text, text, jsonb, text) from public, anon, authenticated;
-- A public caller must not choose arbitrary budgets/windows for internal keys.
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000400_order_write_boundary.sql','891b6dd75e69d794437340b4d3c60904193a092cf7503868dd629e92f8759d0c');

-- SOURCE 20261109000500_session_payment_guard.sql SHA256 c73571e7d1055dfd6815e93952122fe51091bae0eba128cc7d58e879c74614f6
-- Preserve manual session settlement, but do not collect against in-flight gateway money.
create or replace function public.mark_order_session_paid(
  p_order_session_id uuid
) returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id       uuid;
  v_role           public.member_role;
  v_session       public.order_sessions%rowtype;
  v_order         public.orders%rowtype;
  v_paid_paise    bigint;
  v_due_paise     bigint;
  v_payment_id    uuid;
  v_existing      public.payments%rowtype;
  v_key           text;
  v_order_count   integer := 0;
  v_recorded_any  boolean := false;
  v_settled_at    timestamptz;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'Sign in with an authorized restaurant account to mark a table paid.'
      using errcode = '42501';
  end if;

  select s.* into v_session
    from public.order_sessions s
    join public.restaurants r on r.id = s.restaurant_id and r.is_active
   where s.id = p_order_session_id
   for update of s;

  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_session.restaurant_id
     and m.user_id = v_actor_id;

  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to settle this table.'
      using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_session.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before marking a table paid.'
      using errcode = 'P0001';
  end if;

  if v_session.status <> 'open' or v_session.closed_at is not null then
    raise exception 'This table session is already closed.' using errcode = 'P0001';
  end if;

  -- One table can have several tickets. Lock them in stable order so a
  -- concurrent counter payment cannot race the balance calculation.
  for v_order in
    select o.*
      from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
     order by o.id
     for update
  loop
    v_order_count := v_order_count + 1;
    if exists (select 1 from public.payments p
               where p.order_id = v_order.id and p.method = 'online' and p.status = 'pending') then
      raise exception 'An online payment is in progress. Resolve it before settling this table.' using errcode = 'P0001';
    end if;


    select coalesce(sum(p.amount_paise), 0)::bigint
      into v_paid_paise
      from public.payments p
     where p.order_id = v_order.id
       and p.status = 'recorded';

    v_due_paise := greatest(v_order.total_paise - v_paid_paise, 0);

    if v_due_paise > 0 then
      v_key := 'manual-session:' || v_session.id::text || ':' || v_order.id::text;

      select * into v_existing
        from public.payments p
       where p.idempotency_key = v_key;

      if found then
        if v_existing.order_id <> v_order.id
           or v_existing.amount_paise <> v_due_paise
           or v_existing.method <> 'manual'
           or v_existing.status <> 'recorded' then
          raise exception 'The manual settlement key conflicts with an existing payment.'
            using errcode = 'P0001';
        end if;
        v_payment_id := v_existing.id;
      else
        insert into public.payments (
          order_id, restaurant_id, method, amount_paise, status,
          provider, recorded_by, idempotency_key
        ) values (
          v_order.id, v_session.restaurant_id, 'manual', v_due_paise, 'recorded',
          'staff_manual', v_actor_id, v_key
        ) returning id into v_payment_id;

        insert into public.payment_audit_events (
          restaurant_id, order_id, payment_id, actor_id,
          event_type, method, amount_paise
        ) values (
          v_session.restaurant_id, v_order.id, v_payment_id, v_actor_id,
          'manual_marked_paid', 'manual', v_due_paise
        ) on conflict (payment_id, event_type) do nothing;

        v_recorded_any := true;
      end if;
    end if;

    update public.orders
       set payment_status = 'paid',
           updated_at = statement_timestamp()
     where id = v_order.id
       and restaurant_id = v_session.restaurant_id;
  end loop;

  if v_order_count = 0 then
    raise exception 'This table has no active tickets to settle.' using errcode = 'P0001';
  end if;

  if v_recorded_any then
    v_settled_at := statement_timestamp();
    update public.order_sessions
       set paid_at = v_settled_at,
           paid_by = v_actor_id
     where id = v_session.id;
  else
    -- Idempotent retry: keep the original marker. For sessions settled through
    -- individual cashier payments, use the latest recorded ledger timestamp.
    select coalesce(
      v_session.paid_at,
      max(p.created_at),
      statement_timestamp()
    ) into v_settled_at
      from public.orders o
      left join public.payments p
        on p.order_id = o.id and p.status = 'recorded'
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled';

    update public.order_sessions
       set paid_at = coalesce(paid_at, v_settled_at),
           paid_by = coalesce(paid_by, v_actor_id)
     where id = v_session.id
     returning paid_at into v_settled_at;
  end if;

  return v_settled_at;
end;
$$;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000500_session_payment_guard.sql','c73571e7d1055dfd6815e93952122fe51091bae0eba128cc7d58e879c74614f6');

-- SOURCE 20261109000600_finalized_source_guard.sql SHA256 95c2823533e2b8e5e8d662d0e86081ea520bf79066ac06aaa59f02ee1009c8e3
-- Keep the issued receipt and its source ledger consistent. Cancellation or
-- repricing an unpaid order after checkout previously changed the live bill
-- without changing the already-issued immutable invoice.
create or replace function public.guard_finalized_order_source()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_session uuid;
begin
  if tg_table_name = 'orders' then
    v_session := old.order_session_id;
    if tg_op = 'UPDATE' and
       (new.restaurant_id, new.table_id, new.order_session_id, new.subtotal_paise,
        new.discount_paise, new.tax_paise, new.total_paise, new.code,
        new.prep_status = 'cancelled') is not distinct from
       (old.restaurant_id, old.table_id, old.order_session_id, old.subtotal_paise,
        old.discount_paise, old.tax_paise, old.total_paise, old.code,
        old.prep_status = 'cancelled') then
      return new;
    end if;
  else
    select order_session_id into v_session from public.orders where id = old.order_id;
  end if;
  if exists (select 1 from public.restaurant_invoices
             where order_session_id = v_session and status = 'issued') then
    raise exception 'This bill has a finalized invoice. Void it through the authorized correction workflow before changing its source.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_finalized_order_source() from public, anon, authenticated;
create trigger orders_guard_finalized_source before update or delete on public.orders
for each row execute function public.guard_finalized_order_source();
create trigger order_items_guard_finalized_source before update or delete on public.order_items
for each row execute function public.guard_finalized_order_source();

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000600_finalized_source_guard.sql','95c2823533e2b8e5e8d662d0e86081ea520bf79066ac06aaa59f02ee1009c8e3');

-- SOURCE 20261109000700_order_line_removal.sql SHA256 f1201dd01095acdf31ee1eb20f11998ce0f4087b11c7ba5f78a1b727898dc2e1
-- Correct removal semantics and validate order-line edits atomically.
create or replace function public.set_order_line_quantities(
  p_order_id uuid,
  p_lines jsonb,
  p_guest_token uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_staff boolean := false;
  v_rate int;
  v_taxable bigint;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_lines_left int := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'That order could not be found.' using errcode = 'P0001';
  end if;


  if p_guest_token is not null then
    if v_order.guest_token is distinct from p_guest_token then
      raise exception 'That order could not be found.' using errcode = 'P0001';
    end if;
  else
    select exists (
      select 1
        from public.memberships m
       where m.restaurant_id = v_order.restaurant_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'manager', 'cashier', 'kitchen')
    ) into v_staff;

    if not coalesce(v_staff, false) then
      raise exception 'You are not allowed to change this order.' using errcode = 'P0001';
    end if;
  end if;

  -- A pending online attempt is money in flight. Cancelling or repricing the
  -- order underneath it would leave the provider capturing an amount that no
  -- longer matches the bill, and there is no refund path in this build.
  if exists (
    select 1 from public.payments p
     where p.order_id = v_order.id
       and p.status = 'pending'
       and p.method = 'online'
  ) then
    raise exception 'An online payment is in progress for this order. Please wait for it to finish or ask staff.' using errcode = 'P0001';
  end if;

  if v_order.prep_status = 'cancelled' then
    raise exception 'This order has been cancelled.' using errcode = 'P0001';
  end if;

  if v_order.prep_status <> 'new' then
    raise exception 'The kitchen has already started this order. Please ask the staff to change it.'
      using errcode = 'P0001';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order has already been paid. Ask the counter to change it.'
      using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'There was nothing to change.' using errcode = 'P0001';
  end if;

  -- Validate the whole payload before changing any row. No silent unknown IDs,
  -- duplicate source rows, truncated decimals, or non-numeric quantities.
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'line_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(e->>'qty', '') !~ '^[0-9]{1,2}$'
  ) then
    raise exception 'Each change needs a valid line and a whole quantity from 0 to 99.' using errcode = '22023';
  end if;
  if (select count(distinct e->>'line_id') from jsonb_array_elements(p_lines) e) <> jsonb_array_length(p_lines)
     or exists (select 1 from jsonb_array_elements(p_lines) e
                where not exists (select 1 from public.order_items i
                                  where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id)) then
    raise exception 'One of those lines does not belong to this order, or was submitted twice.' using errcode = '22023';
  end if;

  -- Delete zero-quantity lines FIRST: writing qty=0 then deleting violates
  -- the order_items qty > 0 constraint before the DELETE can run.
  delete from public.order_items i using jsonb_array_elements(p_lines) e
   where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int = 0;
  update public.order_items i set qty = (e->>'qty')::int
    from jsonb_array_elements(p_lines) e
   where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int > 0;

  select count(*), coalesce(sum(unit_price_paise * qty), 0)
    into v_lines_left, v_subtotal
    from public.order_items
   where order_id = v_order.id;

  if v_lines_left = 0 then
    raise exception 'An order needs at least one dish. Cancel it instead.' using errcode = 'P0001';
  end if;

  -- The rate this order was priced at, falling back to the restaurant's
  -- current rate only for orders placed before the snapshot column existed.
  v_rate := coalesce(
    v_order.tax_rate_bps_snapshot,
    (select r.tax_rate_bps from public.restaurants r where r.id = v_order.restaurant_id),
    0
  );

  v_taxable := greatest(v_subtotal - v_order.discount_paise, 0);
  v_tax := round(v_taxable::numeric * v_rate / 10000.0)::bigint;
  v_total := v_taxable + v_tax;

  update public.orders
     set subtotal_paise = v_subtotal,
         tax_paise = v_tax,
         total_paise = v_total,
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'tax_paise', v_tax,
    'total_paise', v_total,
    'lines', v_lines_left
  );
end;
$$;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000700_order_line_removal.sql','f1201dd01095acdf31ee1eb20f11998ce0f4087b11c7ba5f78a1b727898dc2e1');

-- SOURCE 20261109000800_table_activity_summary.sql SHA256 66226b9a9717378d1a53c9e4ccee0f3e8aa869645d45fb0224ff269a6fb9c2ad
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

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000800_table_activity_summary.sql','66226b9a9717378d1a53c9e4ccee0f3e8aa869645d45fb0224ff269a6fb9c2ad');

-- SOURCE 20261109000900_staff_tts_budget.sql SHA256 71cd1c7bec6659b93e5244ad9147cee37e7fcb0de98c3fa22c5f1aece6d9d24f
-- Fixed shared budgets. The browser cannot choose a higher quota or name a
-- user; identity comes from the verified JWT and membership is checked here.
create or replace function public.reserve_staff_tts_attempt(p_restaurant_id uuid)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare u uuid := auth.uid(); a record; b record;
begin
  if u is null or not exists (select 1 from public.memberships m where m.restaurant_id=p_restaurant_id and m.user_id=u) then
    raise exception 'Staff membership required' using errcode='42501';
  end if;
  select * into a from public.hit_rate_limit('tts:u:'||u::text,30,600);
  if not a.allowed then return query select false,a.retry_after_seconds; return; end if;
  select * into b from public.hit_rate_limit('tts:r:'||p_restaurant_id::text,300,600);
  return query select b.allowed,b.retry_after_seconds;
end $$;
revoke all on function public.reserve_staff_tts_attempt(uuid) from public, anon;
grant execute on function public.reserve_staff_tts_attempt(uuid) to authenticated;

insert into supabase_migrations.arena_staging_upgrade_manifest(filename,sha256) values ('20261109000900_staff_tts_budget.sql','71cd1c7bec6659b93e5244ad9147cee37e7fcb0de98c3fa22c5f1aece6d9d24f');
