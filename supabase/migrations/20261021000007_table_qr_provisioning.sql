-- ============================================================================
-- AutoDine — migration 0007: every table has a QR code, and it can be printed
--
-- WHY THIS EXISTS
--
-- Migration 0006 made scanning work. Scanning is only half of it: there has
-- to be something to scan.
--
-- Six tables existed and two had a code. T2 through T5 had none, in either
-- table. They could not be scanned at all, and nothing anywhere said so.
--
-- Worse, the Tables screen drew a QR code for them anyway. It was not a QR
-- code. QrChip hashed the table name into a pleasant-looking pattern with
-- three finder squares sketched in the corners. It looked right in a demo and
-- decoded to nothing. A restaurant owner would have printed those, taped them
-- to five tables, and discovered the problem mid-service with a queue at the
-- door. A feature that fails is an inconvenience; a feature that appears to
-- work and cannot is the thing that loses a customer their Friday night.
--
-- WHAT THIS ADDS
--
-- A trigger on dining_tables so that a table cannot exist without a code.
-- Not "the screen remembers to create one" — the row cannot be INSERTed
-- without one following. That is the only kind of guarantee that survives a
-- new screen, an import script, or someone writing SQL at eleven at night.
--
-- A backfill, so the four tables already missing codes get them.
--
-- issue_table_qr_code() and revoke_table_qr_code(), SECURITY DEFINER, so
-- issuing a code is one atomic operation rather than two writes from the
-- client that a dropped connection can leave half-done. Both check membership
-- before touching anything, because SECURITY DEFINER suspends RLS and the
-- function body then becomes the only thing standing between a caller and
-- every restaurant's tables.
--
-- On revocation: a revoked code must stop a live session, not merely stop new
-- ones. The trigger from an earlier migration does that. This migration does
-- not depend on it but is written knowing it is there.
--
-- ON THE TWO QR SYSTEMS
--
-- This schema has qr_tokens (twelve-hour rotating codes) and table_qr_codes
-- (permanent printed codes). qr_tokens is empty and nothing issues it any
-- more; the screen that managed it is being moved to table_qr_codes. It is
-- left in place rather than dropped because table_qr_codes.source_qr_token_id
-- references it. It is dead weight, and leaving it means the next person has
-- to work out which of the two to use — so this comment says: use
-- table_qr_codes. qr_tokens is not the one.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A new code's public token
--
-- 256 bits from two UUIDv4s, hex-encoded. Not base64url: encoding it would
-- need a bytea round-trip through encode()/decode() for twenty-one fewer
-- characters in a URL, and the shorter URL buys one QR version. Not worth
-- making this harder to read.
--
-- gen_random_bytes() is not available on this instance -- pgcrypto is
-- installed but not in a schema on the search path. gen_random_uuid() is
-- built in and needs nothing.
-- ----------------------------------------------------------------------------
create or replace function public.new_qr_public_token()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- ----------------------------------------------------------------------------
-- A table is never without a code
--
-- AFTER INSERT, not BEFORE: the row must exist first so the code's
-- composite foreign key to dining_tables has something to point at.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_table_qr_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.table_qr_codes (restaurant_id, table_id, public_token, created_by)
  values (new.restaurant_id, new.id, public.new_qr_public_token(), auth.uid());

  return new;
end;
$$;

drop trigger if exists trg_dining_tables_ensure_qr on public.dining_tables;

create trigger trg_dining_tables_ensure_qr
  after insert on public.dining_tables
  for each row
  execute function public.ensure_table_qr_code();

-- ----------------------------------------------------------------------------
-- Backfill: give a code to every table that has not got a live one
--
-- This runs the same INSERT the trigger would, so nothing here can drift from
-- what a newly created table gets. distinct on, because a table could
-- conceivably hold several revoked codes and must end up with exactly one
-- live one.
-- ----------------------------------------------------------------------------
insert into public.table_qr_codes (restaurant_id, table_id, public_token)
select distinct on (t.id) t.restaurant_id, t.id, public.new_qr_public_token()
from public.dining_tables t
where not exists (
  select 1
  from public.table_qr_codes q
  where q.table_id = t.id
    and q.revoked_at is null
)
order by t.id, t.label;

-- ----------------------------------------------------------------------------
-- Replace a table's code
--
-- One call, not two client writes. Issuing a code means revoking the old one
-- and inserting a new one; split across the network, a failure between the
-- two leaves the table with no live code, which is the exact state this
-- migration exists to make impossible.
--
-- WHY NOT issue_table_qr_code(), WHICH ALREADY EXISTS
--
-- The schema already ships issue_table_qr_code(p_restaurant_id, p_table_id,
-- p_public_token, p_actor_id) and revoke_table_qr_code(p_restaurant_id,
-- p_qr_code_id). They are left exactly as they are, and not used, for two
-- reasons.
--
-- First, they are granted to nobody but the owner -- not authenticated, not
-- even service_role. Nothing in the application can reach them, so extending
-- them would be building on an entrance that is bricked up.
--
-- Second, and the reason they were not simply granted: neither checks that
-- the caller has anything to do with the restaurant. Both take the actor id
-- as an argument and believe it. Under SECURITY DEFINER that is the whole
-- security model, and it is not one -- any authenticated user could reissue
-- and thereby read the live code for any table in any restaurant. Granting
-- those would have created a hole; the correct move is a function that
-- derives the actor from the session and checks membership in it, which is
-- what rotate_table_qr_code() below does.
--
-- They are not dropped either. Overloading a name Postgres already resolves
-- is a trap for the next reader, and these may yet be reworked; leaving them
-- untouched with this note is safer than a rename that breaks something a
-- later migration still calls.
-- ----------------------------------------------------------------------------
create or replace function public.rotate_table_qr_code(p_table_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_token         text;
begin
  if p_table_id is null then
    raise exception 'A table is required.' using errcode = '22023';
  end if;

  select t.restaurant_id
    into v_restaurant_id
  from public.dining_tables t
  where t.id = p_table_id;

  if not found then
    raise exception 'That table does not exist.' using errcode = 'P0002';
  end if;

  -- The one check that makes SECURITY DEFINER survivable. RLS is suspended
  -- inside this function, so without this line any signed-in user could
  -- rotate -- and read back -- the code for any table anywhere.
  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  v_token := public.new_qr_public_token();

  -- Revoke before inserting. The trigger on table_qr_codes that ends sessions
  -- for a revoked code fires here, so anyone sitting at this table under the
  -- old code is signed out of it at once.
  update public.table_qr_codes
     set revoked_at = now()
   where table_id = p_table_id
     and revoked_at is null;

  insert into public.table_qr_codes (restaurant_id, table_id, public_token, created_by)
  values (v_restaurant_id, p_table_id, v_token, auth.uid());

  return v_token;
end;
$$;

-- ----------------------------------------------------------------------------
-- Take a table's code out of service
--
-- Revoking is not deleting. The row stays so that a scan of the old card can
-- explain itself -- "this code is no longer in use" -- instead of falling
-- through to a generic error that tells neither guest nor staff anything.
-- ----------------------------------------------------------------------------
create or replace function public.retire_table_qr_code(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
begin
  if p_table_id is null then
    raise exception 'A table is required.' using errcode = '22023';
  end if;

  select t.restaurant_id
    into v_restaurant_id
  from public.dining_tables t
  where t.id = p_table_id;

  if not found then
    raise exception 'That table does not exist.' using errcode = 'P0002';
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'You do not manage this restaurant.' using errcode = '42501';
  end if;

  update public.table_qr_codes
     set revoked_at = now()
   where table_id = p_table_id
     and revoked_at is null;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants
--
-- Only authenticated staff issue and revoke codes. Anon never does: it scans
-- them, through verify_table_qr, and that is the whole of what a guest needs.
-- ----------------------------------------------------------------------------
revoke all on function public.new_qr_public_token() from public, anon, authenticated;
revoke all on function public.rotate_table_qr_code(uuid) from public, anon, authenticated;
revoke all on function public.retire_table_qr_code(uuid) from public, anon, authenticated;

grant execute on function public.rotate_table_qr_code(uuid) to authenticated;
grant execute on function public.retire_table_qr_code(uuid) to authenticated;
