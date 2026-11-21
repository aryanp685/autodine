-- Preserve the staff actor on counter and session-level manual settlements.
-- Both record_counter_payment() and mark_order_session_paid() already write
-- this field; adding it explicitly keeps fresh migration replays compatible
-- with the deployed RPC contracts.
alter table public.payments
  add column if not exists recorded_by uuid
    references public.profiles(id) on delete set null;

comment on column public.payments.recorded_by is
  'Staff profile that recorded a manual/counter payment; null for provider-originated or legacy payments.';
