-- Repair schema drift on table_verification_sessions.
--
-- The original definition (20261021000004_missing_qr_tables.sql) declares
-- `id uuid primary key default gen_random_uuid()`, but a `create table if not
-- exists` silently skips when the table already exists — which is how the
-- production database ended up with a sessions table keyed only by
-- token_hash and no id column. Every order-placement function written since
-- (guest_scan_confirm's held-order probe, drift_reconcile's
-- place_public_order) selects `s.id` from that table, so guest checkout
-- failed wholesale with 42703 "column s.id does not exist".
--
-- Additive and safe: the production table keeps token_hash as its primary
-- key; id is a defaulted unique column so both key styles are satisfied.

alter table public.table_verification_sessions
  add column if not exists id uuid not null default gen_random_uuid();

create unique index if not exists table_verification_sessions_id_key
  on public.table_verification_sessions (id);
