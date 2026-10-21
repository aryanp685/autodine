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
-- 8. Close the old door
--
-- verify_table_qr(token, ip) minted a session with no code at all, and anon
-- held EXECUTE on it: anyone could call it through the REST API. Revoking the
-- grant is not enough to forget it exists -- service_role could still call it
-- by accident -- so it is dropped. Exactly one function mints sessions now.
-- ----------------------------------------------------------------------------

revoke all on function public.verify_table_qr(text, text) from public;
revoke all on function public.verify_table_qr(text, text) from anon;
revoke all on function public.verify_table_qr(text, text) from authenticated;
revoke all on function public.verify_table_qr(text, text) from service_role;

drop function if exists public.verify_table_qr(text, text);

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
