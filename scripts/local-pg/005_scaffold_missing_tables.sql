-- LOCAL HARNESS ONLY — reconstruction of tables that exist in the live
-- database but were never checked in (see docs/migration-…-review.md §2.1 and
-- the payment-audit references below). Column shapes are taken from the code
-- paths that read/write them; this is NOT production DDL, and any result from
-- this database is a scaffold result.
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

-- LOCAL HARNESS ONLY — inferred from the payments RPC insert sites and the
-- later P4 constraint/ON CONFLICT clauses. This table has no checked-in create
-- migration but exists in the live schema. It is included only so the complete
-- repository migration sequence can be exercised locally; its exact production
-- DDL still requires a schema clone to verify.
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
