-- GST two-mode billing: Normal receipts / Composition (Bill of Supply) / Regular GST.
--
-- WHAT THIS MIGRATION DOES
--
--   1. Adds public.restaurant_gst_config (one live row per restaurant) and
--      public.restaurant_gst_config_history (append-only audit). The DEFAULT
--      is mode='off': every restaurant behaves exactly as before until its
--      owner deliberately configures GST. There is no inference from sample
--      rates and no silent tax on anyone.
--
--   2. orders gain gst_mode_snapshot / gst_config_version so a ticket is
--      priced under, and stays priced under, the configuration that produced
--      it. Repricing an order after the owner switches modes never happens;
--      the line-edit RPC respects the snapshot.
--
--   3. orders_math_check becomes mode-aware: regular GST tickets carry the
--      extracted tax INSIDE the inclusive menu total (total = subtotal, tax
--      is a breakdown of it), while every other ticket keeps the historical
--      identity total = subtotal - discount + tax.
--
--   4. restaurant_invoices gains document_type 'bill_of_supply', GST snapshot
--      columns (gst_snapshot, irn, irp_status) and a hard immutability
--      trigger: issued documents are never updated or deleted; the only
--      permitted change is the audited void transition.
--
--   5. place_public_order_core and set_order_line_quantities are replaced
--      with mode-aware pricing. In regular mode menu prices ARE the bill
--      (₹105 @5% = ₹100 taxable + ₹5 tax); extraction happens at document
--      level (one rounding), never per line. Composition tickets carry no
--      tax. Unconfigured ('off') restaurants are byte-for-byte on the old
--      exclusive formula.
--
--   6. issue_closed_session_receipt now issues: a normal non-GST receipt
--      (mode off, unchanged), a Bill of Supply (composition, no tax shown,
--      statutory notice), or a GST tax invoice (regular: taxable value,
--      CGST/SGST breakdown, place of supply, seller GSTIN, effective
--      profile reference). e-Invoice: documents are B2C today (no recipient
--      capture), so IRN is 'not_required'; when recipient capture ships, an
--      AATO-above-₹5-crore B2B document is issued as irp_status='pending'
--      and the app must not present it as a final tax invoice until a
--      validated IRN exists. No IRP provider is configured or called.
--
-- Written 2026-11-14. Forward-only. No hosted database is touched by this
-- commit; see docs/gst-two-mode-2026-11-14.md for the rollout and the
-- explicit owner decisions it encodes (inclusive pricing, fail-closed IRP,
-- composition = registration-type check plus acknowledgment).

-- ==================================================================== config

create table if not exists public.restaurant_gst_config (
  restaurant_id uuid primary key references public.restaurants(id) on delete restrict,
  mode text not null default 'off' check (mode in ('off', 'regular', 'composition')),
  regular_profile text check (regular_profile in ('other_than_specified_premises', 'specified_premises')),
  gstin text,
  legal_name text,
  trade_name text,
  address text,
  state_code text check (state_code ~ '^[0-9]{2}$'),
  pan text,
  registration_type text not null default 'regular' check (registration_type in ('regular', 'composition')),
  /** Owner acknowledged the composition ineligibility list (2026-11-14 owner decision: no CMP-02 evidence ref required). */
  composition_acknowledged boolean not null default false,
  /** Owner attested specified premises — required for the 18% profile (Notification No. 05/2025-CT(Rate)). */
  specified_premises_attested boolean not null default false,
  /** Aggregate annual turnover of the preceding financial year, in paise. Drives e-invoice applicability (₹5 crore threshold). */
  preceding_fy_turnover_paise bigint check (preceding_fy_turnover_paise is null or preceding_fy_turnover_paise >= 0),
  config_version integer not null default 1 check (config_version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.restaurant_gst_config is
  'Per-restaurant GST configuration. mode=off is the shipped default and behaves exactly like the pre-GST system. One live row per restaurant; every change is copied to restaurant_gst_config_history by trigger.';

create table if not exists public.restaurant_gst_config_history (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  config_version integer not null,
  mode text not null,
  regular_profile text,
  gstin text,
  legal_name text,
  trade_name text,
  address text,
  state_code text,
  pan text,
  registration_type text not null,
  composition_acknowledged boolean not null,
  specified_premises_attested boolean not null,
  preceding_fy_turnover_paise bigint,
  changed_by uuid,
  changed_at timestamptz not null default statement_timestamp(),
  constraint restaurant_gst_config_history_unique unique (restaurant_id, config_version)
);

comment on table public.restaurant_gst_config_history is
  'Append-only audit of GST configuration changes. Restaurants and documents cite config_version; an issued document is never recalculated by a later configuration change.';

-- Mode-dependent validity. Checked in the database so a hand-crafted request
-- cannot store a regular profile without a GSTIN, or an 18%% room without the
-- specified-premises attestation.
create or replace function public.restaurant_gst_config_validate()
returns trigger
language plpgsql
as $$
declare
  v_gstin_state text;
begin
  if new.mode = 'regular' then
    if new.regular_profile is null then
      raise exception 'Choose the GST profile: 5%% (other than specified premises, no ITC) or 18%% (specified premises, ITC).' using errcode = '23514';
    end if;
    if new.registration_type <> 'regular' then
      raise exception 'This GSTIN is registered on the Composition Scheme. A composition restaurant cannot issue GST tax invoices.' using errcode = '23514';
    end if;
    if new.gstin is null or new.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
      raise exception 'Enter the 15-character GSTIN (it will also be checksum-checked in the app).' using errcode = '23514';
    end if;
    if new.legal_name is null or char_length(btrim(new.legal_name)) < 2 then
      raise exception 'Enter the legal name on the GST registration.' using errcode = '23514';
    end if;
    if new.address is null or char_length(btrim(new.address)) < 5 then
      raise exception 'Enter the address on the GST registration.' using errcode = '23514';
    end if;
    if new.state_code is null or new.state_code <> substr(new.gstin, 1, 2) then
      raise exception 'The state code must match the first two digits of the GSTIN.' using errcode = '23514';
    end if;
    if new.pan is not null and new.pan <> substr(new.gstin, 3, 10) then
      raise exception 'The PAN must match the PAN embedded in the GSTIN (characters 3 to 12).' using errcode = '23514';
    end if;
    if new.regular_profile = 'specified_premises' and not new.specified_premises_attested then
      raise exception 'The 18%% profile is only for restaurants in specified premises. Tick the specified-premises attestation, or choose 5%%.' using errcode = '23514';
    end if;
  elsif new.mode = 'composition' then
    if new.regular_profile is not null then
      raise exception 'Composition is a status, not a rate; no regular profile may be set with it.' using errcode = '23514';
    end if;
    if new.registration_type <> 'composition' then
      raise exception 'Composition billing requires the GSTIN registration type to be composition.' using errcode = '23514';
    end if;
    if not new.composition_acknowledged then
      raise exception 'Acknowledge the composition ineligibility list before enabling composition billing.' using errcode = '23514';
    end if;
    if new.gstin is null or new.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
      raise exception 'Enter the 15-character GSTIN.' using errcode = '23514';
    end if;
    if new.legal_name is null or char_length(btrim(new.legal_name)) < 2 then
      raise exception 'Enter the legal name on the GST registration.' using errcode = '23514';
    end if;
    if new.address is null or char_length(btrim(new.address)) < 5 then
      raise exception 'Enter the address on the GST registration.' using errcode = '23514';
    end if;
    if new.state_code is null or new.state_code <> substr(new.gstin, 1, 2) then
      raise exception 'The state code must match the first two digits of the GSTIN.' using errcode = '23514';
    end if;
  else
    -- mode = off: nothing required. The restaurant keeps its existing
    -- (possibly tax-free) behaviour.
    null;
  end if;
  return new;
end;
$$;

drop trigger if exists restaurant_gst_config_validate on public.restaurant_gst_config;
create trigger restaurant_gst_config_validate
  before insert or update on public.restaurant_gst_config
  for each row execute function public.restaurant_gst_config_validate();

-- config_version bump + history. Runs as definer so the history insert is
-- never blocked by the caller's own (intentionally absent) grants.
create or replace function public.restaurant_gst_config_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.config_version := 1;
    new.created_at := statement_timestamp();
  else
    new.config_version := coalesce(old.config_version, 1) + 1;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

drop trigger if exists restaurant_gst_config_version on public.restaurant_gst_config;
create trigger restaurant_gst_config_version
  before insert or update on public.restaurant_gst_config
  for each row execute function public.restaurant_gst_config_version();

create or replace function public.restaurant_gst_config_history_track()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.restaurant_gst_config_history (
    restaurant_id, config_version, mode, regular_profile, gstin, legal_name,
    trade_name, address, state_code, pan, registration_type,
    composition_acknowledged, specified_premises_attested,
    preceding_fy_turnover_paise, changed_by
  ) values (
    new.restaurant_id, new.config_version, new.mode, new.regular_profile, new.gstin,
    new.legal_name, new.trade_name, new.address, new.state_code, new.pan,
    new.registration_type, new.composition_acknowledged, new.specified_premises_attested,
    new.preceding_fy_turnover_paise, auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists restaurant_gst_config_history_track on public.restaurant_gst_config;
create trigger restaurant_gst_config_history_track
  after insert or update on public.restaurant_gst_config
  for each row execute function public.restaurant_gst_config_history_track();

alter table public.restaurant_gst_config enable row level security;
alter table public.restaurant_gst_config_history enable row level security;

revoke all on public.restaurant_gst_config from public, anon, authenticated, service_role;
revoke all on public.restaurant_gst_config_history from public, anon, authenticated, service_role;

grant select on public.restaurant_gst_config to authenticated;
grant select on public.restaurant_gst_config_history to authenticated;
grant insert, update on public.restaurant_gst_config to authenticated;

drop policy if exists restaurant_gst_config_staff_read on public.restaurant_gst_config;
create policy restaurant_gst_config_staff_read on public.restaurant_gst_config
  for select to authenticated
  using (public.is_member(restaurant_id));
drop policy if exists restaurant_gst_config_history_staff_read on public.restaurant_gst_config_history;
create policy restaurant_gst_config_history_staff_read on public.restaurant_gst_config_history
  for select to authenticated
  using (public.is_member(restaurant_id));
-- Only owner and manager may write the GST configuration; the app enforces
-- the same, and these policies are the backstop. History has NO write grant
-- at all: it is appended by the definer trigger and nobody else.
drop policy if exists restaurant_gst_config_owner_manager_write on public.restaurant_gst_config;
create policy restaurant_gst_config_owner_manager_write on public.restaurant_gst_config
  for insert to authenticated
  with check (exists (
    select 1 from public.memberships m
     where m.restaurant_id = restaurant_gst_config.restaurant_id
       and m.user_id = auth.uid() and m.role in ('owner', 'manager')
  ));
drop policy if exists restaurant_gst_config_owner_manager_update on public.restaurant_gst_config;
create policy restaurant_gst_config_owner_manager_update on public.restaurant_gst_config
  for update to authenticated
  using (exists (
    select 1 from public.memberships m
     where m.restaurant_id = restaurant_gst_config.restaurant_id
       and m.user_id = auth.uid() and m.role in ('owner', 'manager')
  ))
  with check (exists (
    select 1 from public.memberships m
     where m.restaurant_id = restaurant_gst_config.restaurant_id
       and m.user_id = auth.uid() and m.role in ('owner', 'manager')
  ));

-- ============================================================ pricing helper

-- Returns the pricing mode and (for regular) the effective rate. 'off' callers
-- fall back to the legacy restaurants.tax_rate_bps behaviour. Security definer
-- and exposing only mode/rate/version — never the GSTIN — so it can be read
-- inside other security-definer functions without leaking registration data.
create or replace function public.gst_pricing(p_restaurant_id uuid)
returns table(mode text, rate_bps integer, config_version integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(c.mode, 'off'),
         case
           when c.mode = 'regular' then
             case c.regular_profile
               when 'specified_premises' then 1800
               else 500
             end
           else null
         end,
         coalesce(c.config_version, 0)
  from (select p_restaurant_id as restaurant_id) p
  left join public.restaurant_gst_config c on c.restaurant_id = p.restaurant_id;
$$;

revoke all on function public.gst_pricing(uuid) from public, anon;
grant execute on function public.gst_pricing(uuid) to authenticated, service_role;

-- ==================================================================== orders

alter table public.orders add column if not exists gst_mode_snapshot text
  check (gst_mode_snapshot in ('off', 'regular', 'composition'));
alter table public.orders add column if not exists gst_config_version integer;

comment on column public.orders.gst_mode_snapshot is
  'GST pricing mode in effect when the order was priced: NULL = legacy (pre-GST-system, exclusive formula), off/regular/composition. Line edits reuse this snapshot, never the current configuration.';

alter table public.orders drop constraint if exists orders_math_check;
alter table public.orders add constraint orders_math_check check (
  case
    -- Regular GST tickets carry the extracted tax inside the inclusive menu
    -- total. total = subtotal - discount; tax_paise is a breakdown of it.
    when gst_mode_snapshot = 'regular'
      then total_paise = greatest(subtotal_paise - discount_paise, 0)
    -- Legacy, off and composition: total = subtotal - discount + tax (tax is 0 for composition and for legacy restaurants with rate 0).
    else total_paise = greatest(subtotal_paise - discount_paise, 0) + tax_paise
  end
);

-- ============================================ place_public_order_core

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
  v_gst_mode text := 'off';
  v_gst_rate int;
  v_gst_version int := 0;
  v_inclusive_paise bigint;
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

  -- GST pricing: 'off' keeps the legacy exclusive formula untouched.
  -- 'composition' carries no tax at all. 'regular' treats the menu price as
  -- tax-inclusive and extracts tax at document level (one rounding).
  select p.mode, p.rate_bps, p.config_version
    into v_gst_mode, v_gst_rate, v_gst_version
    from public.gst_pricing(v_restaurant_id) p;

  v_discount_paise := 0;
  if v_gst_mode = 'composition' then
    v_tax_bps := 0;
    v_taxable_paise := greatest(v_subtotal_paise, 0);
    v_tax_paise := 0;
    v_total_paise := v_taxable_paise;
  elsif v_gst_mode = 'regular' then
    v_tax_bps := coalesce(v_gst_rate, 500);
    v_inclusive_paise := greatest(v_subtotal_paise, 0);
    v_taxable_paise := round(v_inclusive_paise::numeric * 10000 / (10000 + v_tax_bps))::bigint;
    v_tax_paise := v_inclusive_paise - v_taxable_paise;
    v_total_paise := v_inclusive_paise;
  else
    v_gst_mode := 'off';
    v_gst_version := coalesce(v_gst_version, 0);
    v_tax_bps := coalesce(v_restaurant_tax_bps, k_default_tax_bps);
    v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
    v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
    v_total_paise := v_taxable_paise + v_tax_paise;
  end if;

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
    total_paise,
    gst_mode_snapshot,
    gst_config_version,
    tax_rate_bps_snapshot
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
    v_total_paise,
    v_gst_mode,
    v_gst_version,
    v_tax_bps
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

-- ================================== set_order_line_quantities (mode-aware)

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
  v_mode text;
  v_inclusive bigint;
  v_taxable bigint;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_total bigint := 0;
  v_lines_left int := 0;
begin
  -- Serialize source mutations with checkout before locking the ticket.
  perform s.id from public.order_sessions s
    join public.orders o on o.order_session_id = s.id
   where o.id = p_order_id and s.restaurant_id = o.restaurant_id
     and ((p_guest_token is not null and o.guest_token = p_guest_token)
       or (p_guest_token is null and exists (
         select 1 from public.memberships m where m.restaurant_id=o.restaurant_id
           and m.user_id=auth.uid() and m.role in ('owner','manager','cashier','kitchen'))))
   for update of s;

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

  -- Reprice under the configuration THIS order was priced under. Orders
  -- placed before the GST system, and orders in restaurants with GST off,
  -- keep the legacy exclusive formula with the order's snapshotted rate.
  v_mode := coalesce(v_order.gst_mode_snapshot, 'off');
  v_rate := coalesce(
    v_order.tax_rate_bps_snapshot,
    (select r.tax_rate_bps from public.restaurants r where r.id = v_order.restaurant_id),
    0
  );

  v_inclusive := greatest(v_subtotal - v_order.discount_paise, 0);
  if v_mode = 'composition' then
    v_taxable := v_inclusive;
    v_tax := 0;
    v_total := v_inclusive;
  elsif v_mode = 'regular' then
    v_taxable := round(v_inclusive::numeric * 10000 / (10000 + v_rate))::bigint;
    v_tax := v_inclusive - v_taxable;
    v_total := v_inclusive;
  else
    v_taxable := v_inclusive;
    v_tax := round(v_taxable::numeric * v_rate / 10000.0)::bigint;
    v_total := v_taxable + v_tax;
  end if;

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

-- ====================================== restaurant_invoices: GST documents

alter table public.restaurant_invoices drop constraint if exists restaurant_invoices_document_type_check;
alter table public.restaurant_invoices add constraint restaurant_invoices_document_type_check
  check (document_type in ('receipt', 'gst_tax_invoice', 'bill_of_supply'));

alter table public.restaurant_invoices add column if not exists gst_snapshot jsonb;
alter table public.restaurant_invoices add column if not exists irn text;
alter table public.restaurant_invoices add column if not exists irp_status text not null default 'not_required'
  check (irp_status in ('not_required', 'pending', 'generated', 'failed', 'cancelled'));

comment on column public.restaurant_invoices.gst_snapshot is
  'Immutable GST decomposition captured at issue time (mode, profile, rate, CGST/SGST split, place of supply, config_version). Never recalculated afterwards.';
comment on column public.restaurant_invoices.irn is
  'IRP invoice reference number. Assigned only after the IRP validates the document; NULL in this build (no e-invoice provider configured).';
comment on column public.restaurant_invoices.irp_status is
  'e-Invoice state. not_required (B2C and all composition/normal documents), pending (B2B AATO>₹5cr B2B — MUST NOT render as final tax invoice), generated/failed/cancelled (after IRP integration).';

-- Hard immutability. The only permitted transition is issued → voided via the
-- audited RPC (status + voided_at + voided_by + void_reason and nothing
-- else). DELETE is never permitted. RLS already withholds table writes from
-- every role; this trigger is the database-level guarantee even for roles
-- with direct table grants.
create or replace function public.restaurant_invoices_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Invoice records can never be deleted; void them instead.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'voided_at' - 'voided_by' - 'void_reason')
     is distinct from
     (to_jsonb(old) - 'status' - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'Issued invoices are immutable. Only the audited void transition is permitted.' using errcode = '42501';
  end if;
  if new.status = old.status then
    if (new.voided_at, new.voided_by, new.void_reason) is distinct from (old.voided_at, old.voided_by, old.void_reason) then
      raise exception 'Issued invoices are immutable; void fields cannot be edited in place.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status = 'issued' and new.status = 'voided' then
    if new.voided_at is null or new.void_reason is null or char_length(btrim(new.void_reason)) < 5 then
      raise exception 'Voiding requires a timestamp and a reason of at least 5 characters.' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'Invoice status can only move from issued to voided.' using errcode = '42501';
end;
$$;

drop trigger if exists restaurant_invoices_immutable on public.restaurant_invoices;
create trigger restaurant_invoices_immutable
  before update or delete on public.restaurant_invoices
  for each row execute function public.restaurant_invoices_immutable();

create or replace function public.restaurant_invoice_lines_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Invoice line records are immutable.' using errcode = '42501';
end;
$$;

drop trigger if exists restaurant_invoice_lines_immutable on public.restaurant_invoice_lines;
create trigger restaurant_invoice_lines_immutable
  before update or delete on public.restaurant_invoice_lines
  for each row execute function public.restaurant_invoice_lines_immutable();

-- ======================= issue_closed_session_receipt (GST-aware)

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
  v_gst public.restaurant_gst_config%rowtype;
  v_gst_doc_type text := 'receipt';
  v_rate_bps integer := 0;
  v_taxable bigint;
  v_cgst bigint := 0;
  v_sgst bigint := 0;
  v_igst bigint := 0;
  v_profile_notification text;
  v_gst_snapshot jsonb;
  v_irp_status text := 'not_required';
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

  -- GST document selection. mode='off' (or no row) keeps the historical
  -- non-GST receipt byte-for-byte. GST modes fail closed when the
  -- configuration is incomplete: never issue a half-configured document.
  select c.* into v_gst
    from public.restaurant_gst_config c
   where c.restaurant_id = v_session.restaurant_id;

  if v_gst.mode = 'regular' then
    if nullif(btrim(coalesce(v_gst.legal_name, '')), '') is null
       or nullif(btrim(coalesce(v_gst.address, '')), '') is null
       or v_gst.gstin is null
       or v_gst.state_code is null
       or v_gst.regular_profile is null
       or v_gst.registration_type <> 'regular' then
      raise exception 'Complete the GST settings before issuing a GST tax invoice: GSTIN, legal name, registered address, state code and the 5%% or 18%% profile.'
        using errcode = 'P0001';
    end if;
    v_gst_doc_type := 'gst_tax_invoice';
  elsif v_gst.mode = 'composition' then
    if nullif(btrim(coalesce(v_gst.legal_name, '')), '') is null
       or nullif(btrim(coalesce(v_gst.address, '')), '') is null
       or v_gst.gstin is null
       or v_gst.state_code is null
       or v_gst.registration_type <> 'composition'
       or not v_gst.composition_acknowledged then
      raise exception 'Complete the composition settings before issuing a Bill of Supply: GSTIN (registration type composition), legal name, registered address, state code and the ineligibility acknowledgment.'
        using errcode = 'P0001';
    end if;
    v_gst_doc_type := 'bill_of_supply';
  else
    if nullif(btrim(v_restaurant.name), '') is null
       or nullif(btrim(v_restaurant.address), '') is null then
      raise exception 'Add the restaurant name and address in Settings before issuing a receipt.'
        using errcode = 'P0001';
    end if;
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

  -- A document cannot span two pricing configurations. Tickets priced under a
  -- different mode than the one now configured are refused, loudly.
  if coalesce(v_gst.mode, 'off') <> 'off' and exists (
    select 1 from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and coalesce(o.gst_mode_snapshot, 'off') <> v_gst.mode
  ) then
    raise exception 'This sitting contains tickets priced under a different GST configuration. Close them out, or switch the GST mode back, before issuing a document.'
      using errcode = 'P0001';
  end if;
  if v_gst.mode = 'composition' and exists (
    select 1 from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and o.tax_paise > 0
  ) then
    raise exception 'This sitting includes tickets that collected tax; a Bill of Supply cannot be issued over them. Void those tickets or switch to Regular GST first.'
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

  -- GST decomposition of the document. Sums come from the order snapshots,
  -- never from re-reading the menu. CGST takes the odd paisa when the tax is
  -- odd (same rule as splitInHalf in lib/money.ts).
  if v_gst_doc_type = 'gst_tax_invoice' then
    -- The document's rate is the effective profile rate from the
    -- configuration snapshot taken at issue time, never the legacy
    -- restaurants.tax_rate_bps that un-snapshotted historical orders carry.
    v_rate_bps := case v_gst.regular_profile when 'specified_premises' then 1800 else 500 end;
    v_taxable := greatest(v_subtotal - v_discount, 0) - v_tax;
    v_cgst := round(v_tax::numeric / 2)::bigint;
    v_sgst := v_tax - v_cgst;
    v_profile_notification := case v_gst.regular_profile
      when 'specified_premises' then 'Notification No. 05/2025-CT(Rate), w.e.f. 2025-04-01'
      else 'Notification No. 11/2017-CT(Rate), Sl. 7(i), as amended' end;
    -- B2C only in this build: no recipient capture yet, so no IRN is ever
    -- owed here. When B2B recipient capture ships, an applicable document
    -- (AATO > Rs 5 crore, Notification No. 10/2023-CT as amended) MUST be
    -- issued as irp_status='pending' and never rendered as final.
    v_irp_status := 'not_required';
  elsif v_gst_doc_type = 'bill_of_supply' then
    v_taxable := greatest(v_subtotal - v_discount, 0) - v_tax;
  else
    v_taxable := null;
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
  if v_gst_doc_type = 'receipt' then
    v_seller := jsonb_build_object(
      'restaurant_id', v_restaurant.id,
      'name', btrim(v_restaurant.name),
      'address', btrim(v_restaurant.address),
      'phone', nullif(btrim(v_restaurant.phone), ''),
      'logo_path', nullif(btrim(v_restaurant.logo_path), '')
    );
  else
    v_seller := jsonb_build_object(
      'restaurant_id', v_restaurant.id,
      'name', btrim(v_gst.legal_name),
      'legal_name', btrim(v_gst.legal_name),
      'trade_name', nullif(btrim(coalesce(v_gst.trade_name, '')), ''),
      'address', btrim(v_gst.address),
      'phone', nullif(btrim(v_restaurant.phone), ''),
      'logo_path', nullif(btrim(v_restaurant.logo_path), ''),
      'gstin', v_gst.gstin,
      'pan', nullif(btrim(coalesce(v_gst.pan, '')), ''),
      'state_code', v_gst.state_code,
      'registration_type', v_gst.registration_type
    );
  end if;
  if v_gst_doc_type = 'gst_tax_invoice' or v_gst_doc_type = 'bill_of_supply' then
    v_gst_snapshot := jsonb_build_object(
      'mode', v_gst.mode,
      'regular_profile', v_gst.regular_profile,
      'profile_notification', v_profile_notification,
      'rate_bps', v_rate_bps,
      'cgst_bps', case when v_gst_doc_type = 'gst_tax_invoice' then v_rate_bps / 2 else 0 end,
      'sgst_bps', case when v_gst_doc_type = 'gst_tax_invoice' then v_rate_bps / 2 else 0 end,
      'taxable_paise', v_taxable,
      'cgst_paise', v_cgst,
      'sgst_paise', v_sgst,
      'igst_paise', v_igst,
      'place_of_supply_state_code', v_gst.state_code,
      'inter_state', false,
      'config_version', v_gst.config_version,
      'notice', case when v_gst_doc_type = 'bill_of_supply'
        then 'Composition taxable person, not eligible to collect tax on supplies.'
        else null end
    );
  end if;

  v_totals := jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'ticket_discount_paise', v_discount,
    'bill_discount_paise', 0,
    'taxable_paise', v_taxable,
    'tax_paise', case when v_gst_doc_type = 'bill_of_supply' then 0 else v_tax end,
    'cgst_paise', v_cgst,
    'sgst_paise', v_sgst,
    'igst_paise', v_igst,
    'tax_rate_bps', v_rate_bps,
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
    source_order_ids, supersedes_invoice_id,
    gst_snapshot, irp_status
  ) values (
    v_session.restaurant_id, v_session.id, v_invoice_number, v_fy,
    v_sequence, v_gst_doc_type, v_issued_at, v_actor,
    v_table_label, v_session.opened_at, v_session.closed_at,
    v_seller, null, v_totals, v_payments,
    v_order_ids, v_previous.id,
    v_gst_snapshot, v_irp_status
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
  'Issues or returns the single immutable document for a closed table session: a non-GST receipt (GST mode off), a Bill of Supply (composition), or a GST tax invoice (regular). Server-derived totals and payment history; atomic per-restaurant financial-year numbering. Decomposition is snapshotted at issue time; documents are immutable and voided only through void_restaurant_invoice.';

-- =============================== read_shared_restaurant_invoice (GST fields)
-- The share RPC whitelists columns; extend it so a shared GST document renders
-- exactly like the counter copy. CREATE OR REPLACE keeps grants.
create or replace function public.read_shared_restaurant_invoice(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.restaurant_invoice_share_links%rowtype;
  v_invoice public.restaurant_invoices%rowtype;
  v_lines jsonb;
  v_timezone text;
  v_allowed boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  select h.allowed into v_allowed
    from public.hit_rate_limit('receipt-share:view:' || substr(p_token_hash, 1, 32), 60, 60) h;
  if not coalesce(v_allowed, false) then return null; end if;

  select l.* into v_link
    from public.restaurant_invoice_share_links l
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > statement_timestamp()
   for update;
  if not found then return null; end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = v_link.invoice_id
     and i.restaurant_id = v_link.restaurant_id
     and i.status = 'issued';
  if not found then return null; end if;

  select coalesce(nullif(r.timezone, ''), 'Asia/Kolkata') into v_timezone
    from public.restaurants r where r.id = v_invoice.restaurant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', il.id,
    'line_snapshot', il.line_snapshot
  ) order by il.line_number), '[]'::jsonb)
    into v_lines
    from public.restaurant_invoice_lines il
   where il.invoice_id = v_invoice.id
     and il.restaurant_id = v_invoice.restaurant_id;

  update public.restaurant_invoice_share_links
     set last_accessed_at = statement_timestamp(), access_count = access_count + 1
   where id = v_link.id;
  insert into public.restaurant_invoice_share_audit (
    restaurant_id, invoice_id, share_link_id, actor_id, event_type
  ) values (v_link.restaurant_id, v_invoice.id, v_link.id, auth.uid(), 'opened');

  return jsonb_build_object(
    'timezone', v_timezone,
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'financial_year', v_invoice.financial_year,
      'document_type', v_invoice.document_type,
      'status', v_invoice.status,
      'issued_at', v_invoice.issued_at,
      'table_label_snapshot', v_invoice.table_label_snapshot,
      'order_session_id', v_invoice.order_session_id,
      'session_opened_at', v_invoice.session_opened_at,
      'session_closed_at', v_invoice.session_closed_at,
      'seller_snapshot', v_invoice.seller_snapshot,
      'totals_snapshot', v_invoice.totals_snapshot,
      'payment_snapshot', v_invoice.payment_snapshot,
      'gst_snapshot', v_invoice.gst_snapshot,
      'irn', v_invoice.irn,
      'irp_status', v_invoice.irp_status,
      'supersedes_invoice_id', v_invoice.supersedes_invoice_id,
      'void_reason', v_invoice.void_reason
    ),
    'lines', v_lines
  );
end;
$$;
