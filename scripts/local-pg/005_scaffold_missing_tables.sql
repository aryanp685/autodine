-- LOCAL HARNESS ONLY — reconstruction of three tables that exist in the live
-- database but were never checked in (see docs/migration-…-review.md §2.1).
-- Column names are taken from the code that reads them; this is NOT the
-- production DDL and any result from this database is a scaffold result.
create table if not exists public.qr_tokens (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  table_id uuid references public.dining_tables(id) on delete cascade,
  code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

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

create table if not exists public.qr_verification_attempts (
  id bigserial primary key,
  qr_code_id uuid not null references public.table_qr_codes(id) on delete cascade,
  ip_hash text not null,
  attempted_at timestamptz not null default now()
);
