-- ============================================================================
-- AutoDine — migration 0006: scanning a table QR actually works
--
-- WHY THIS EXISTS
--
-- The database already held most of a QR flow: table_qr_codes with a public
-- token, table_verification_sessions keyed by a hashed token, per-IP attempt
-- limiting, triggers that revoke sessions when a code is revoked, and
-- place_order() which takes a session token and stamps table_id onto the
-- order. None of it was reachable. There was no route to scan into, no way to
-- create a session, and place_order is granted to service_role alone while
-- the application has never used the secret key it reads.
--
-- Meanwhile the menu told every guest "Table 7 · on-site verified" from a
-- hard-coded string. A guest at table 3 was shown table 7, and every order
-- reached the kitchen with table_id set to null. That is worse than no
-- feature: it is a feature that lies about the one thing it claims to know.
--
-- WHAT THIS ADDS
--
-- verify_table_qr() turns a scanned token into a session. It is the missing
-- half, and it is the only way a session gets created.
--
-- place_public_order() grows an optional session token. When a guest arrives
-- through a QR the order is stamped with that table, which is what makes the
-- kitchen board able to say which table a ticket belongs to.
--
-- WHY NOT JUST USE place_order()
--
-- place_order already does this job, and doing it twice is a real cost that
-- is not being dismissed. It is unusable from the application as it stands:
--
--   * it is granted to service_role only. Calling it would mean introducing
--     the secret key into the request path, which bypasses RLS everywhere it
--     is used, to call one function that authorises itself anyway.
--   * it returns an order id, and anon has no SELECT on orders, so there is
--     nothing to show the guest afterwards. Reading it back would need
--     another definer function, which is more surface than this.
--   * place_counter_order and place_order raise on the first unavailable
--     dish, which is right for a cashier watching the failure and wrong for
--     a guest whose cart went stale while they were reading the menu.
--
-- So the guest path stays in one function that returns the code the guest is
-- shown. place_order is untouched and remains the service-role path. The two
-- must not drift: both read tax from restaurants.tax_rate_bps, both require
-- an active restaurant that can be written to, and both scope every dish to
-- that restaurant alone.
--
-- SECURITY MODEL
--
-- SECURITY DEFINER with search_path pinned, as in migrations 0004 and 0005.
--
-- The session token is a bearer capability: 64 hex characters, generated
-- here, handed to the guest once, and stored only as a SHA-256 hash. The
-- database never holds one in the clear, so a dump of the table yields
-- nothing that can be replayed. It expires, and revoking the QR code revokes
-- every session issued against it through the existing trigger.
--
-- Rate limiting is per QR code and per IP hash, five attempts in fifteen
-- minutes. The hash must be 64 hex characters and is derived by the
-- application from the request address; a caller who rotates addresses can
-- outrun it, which is true of every IP limit and is not a reason to skip it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Turn a scanned QR token into a table session.
-- ---------------------------------------------------------------------------
create or replace function public.verify_table_qr(
  p_public_token text,
  p_ip_hash text
) returns table (
  session_token text,
  restaurant_slug text,
  table_label text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- One hour is not a choice made here: table_verification_sessions carries
  -- a CHECK that a session may not outlive created_at + 1 hour, and that
  -- ceiling is the schema's security decision, not a default to override.
  --
  -- It does mean a long sitting can outlast its session. The answer is not a
  -- longer session but a second scan: the code is printed on the table and
  -- re-scanning is free, so the menu asks for one when the session has gone
  -- rather than silently seating a guest at a table they left.
  --
  -- 59 minutes rather than 60 leaves room for the constraint's own clock and
  -- never tests the boundary.
  k_session_minutes constant int := 59;

  v_qr public.table_qr_codes%rowtype;
  v_table public.dining_tables%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_token text;
  v_allowed boolean;
  v_retry_after int;
  v_expires timestamptz;
begin
  if p_public_token is null or btrim(p_public_token) = '' then
    raise exception 'This code could not be read. Please ask staff for the current one.'
      using errcode = 'P0001';
  end if;

  -- The token is generated by issue_table_qr_code and is a slug-shaped
  -- string. Rejecting anything else here keeps odd input out of the lookup.
  if btrim(p_public_token) !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'This code could not be read. Please ask staff for the current one.'
      using errcode = 'P0001';
  end if;

  select q.* into v_qr
    from public.table_qr_codes q
   where q.public_token = btrim(p_public_token)
     and q.revoked_at is null;

  if not found then
    raise exception 'This code is no longer in use. Please ask staff for the current one.'
      using errcode = 'P0001';
  end if;

  -- Before anything else is checked, so that probing codes is not free.
  select allowed, retry_after_seconds
    into v_allowed, v_retry_after
    from public.reserve_qr_verification_attempt(v_qr.id, p_ip_hash);

  if not coalesce(v_allowed, false) then
    raise exception 'Too many attempts at this code. Try again in % seconds.', v_retry_after
      using errcode = 'P0001';
  end if;

  select t.* into v_table
    from public.dining_tables t
   where t.id = v_qr.table_id
     and t.restaurant_id = v_qr.restaurant_id
     and t.is_active = true;

  if not found then
    raise exception 'This table is not taking orders right now. Please ask staff.'
      using errcode = 'P0001';
  end if;

  select r.* into v_restaurant
    from public.restaurants r
   where r.id = v_qr.restaurant_id
     and r.is_active = true;

  if not found then
    raise exception 'This restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  if not public.restaurant_can_write(v_restaurant.id) then
    raise exception 'This restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.menus m
     where m.restaurant_id = v_restaurant.id and m.is_published = true
  ) then
    raise exception 'This restaurant has not published a menu yet.' using errcode = 'P0001';
  end if;

  -- 64 hex characters, which is the shape place_order and this file's own
  -- order path both require. Two UUIDv4s with the dashes removed is 256 hex
  -- bits of which 244 are random -- gen_random_bytes would be the obvious
  -- call, but it lives in pgcrypto, which this project does not have
  -- enabled, and turning on an extension to generate a string is a poor
  -- trade.
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

  -- A successful scan is not something to hold against the next guest on
  -- the same address.
  perform public.clear_qr_verification_attempts(v_qr.id, p_ip_hash);

  return query select v_token, v_restaurant.slug, v_table.label, v_expires;
end;
$$;

comment on function public.verify_table_qr(text, text) is
  'Exchange a scanned table QR token for a short-lived session. Returns the '
  'session token once and in the clear; only its SHA-256 hash is stored. '
  'Rate limited per code and per IP hash.';

revoke all on function public.verify_table_qr(text, text) from public;
revoke all on function public.verify_table_qr(text, text) from anon;
revoke all on function public.verify_table_qr(text, text) from authenticated;
-- anon keeps execute: a guest scanning a code has no account, and that is
-- the entire point of this function.
grant execute on function public.verify_table_qr(text, text) to anon;
grant execute on function public.verify_table_qr(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Place an order at a table, when the guest arrived by scanning a QR.
-- ---------------------------------------------------------------------------
--
-- place_public_order grows an optional fourth argument. Without it nothing
-- changes: the order is a counter order with no table. With it, the session
-- decides the restaurant and the table, and the slug is only checked for
-- agreement -- a guest cannot name a restaurant they were not seated in.
--
-- The three-argument form is dropped rather than overloaded. Two functions
-- with the same name and overlapping behaviour is how a caller ends up in
-- the wrong one, and there is exactly one caller.
drop function if exists public.place_public_order(text, jsonb, text);

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
  if p_session_token is not null then
    -- The token is the authority. It says which restaurant and which table,
    -- and both are taken from it rather than from anything the caller sent.
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

    -- The code the session came from must still be live. Revoking a QR
    -- revokes its sessions through the existing trigger, so this is a second
    -- check rather than the only one -- deliberate, because the trigger only
    -- fires on revocation and a session issued before it is the case that
    -- matters.
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

    -- The table must still be active: a table taken out of service has its
    -- sessions revoked, but a session that predates that should not seat
    -- anyone.
    select t.id into v_table_id
      from public.dining_tables t
     where t.id = v_session.table_id
       and t.restaurant_id = v_restaurant_id
       and t.is_active = true;

    if v_table_id is null then
      raise exception 'This table is not taking orders right now. Please ask staff.'
        using errcode = 'P0001';
    end if;

    -- The slug the cart was built against must agree with the table. They
    -- cannot disagree in normal use, and checking costs nothing.
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

    -- No table: a counter order. This is the honest value to store, rather
    -- than inventing one, and the kitchen board says "counter" for it.
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
    sort_order int not null
  ) on commit drop;

  insert into tt_order_lines (item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order)
  select
    i.id,
    i.name,
    i.price_paise,
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    coalesce(i.is_veg, true),
    ord
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
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

comment on function public.place_public_order(text, jsonb, text, text) is
  'Place an order as a signed-out diner. Takes a restaurant slug and an array '
  'of {item_id, qty}; prices are read from the database, never from the caller. '
  'Pass the session token from verify_table_qr to seat the order at that table. '
  'Returns the human-facing order code. Dishes that are missing or sold out are '
  'skipped rather than priced at zero.';

revoke all on function public.place_public_order(text, jsonb, text, text) from public;
revoke all on function public.place_public_order(text, jsonb, text, text) from anon;
revoke all on function public.place_public_order(text, jsonb, text, text) from authenticated;
grant execute on function public.place_public_order(text, jsonb, text, text) to anon;
grant execute on function public.place_public_order(text, jsonb, text, text) to authenticated;
