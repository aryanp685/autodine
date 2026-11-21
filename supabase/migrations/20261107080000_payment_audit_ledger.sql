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
