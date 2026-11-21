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
