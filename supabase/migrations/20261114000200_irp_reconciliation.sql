-- Read-only reconciliation surface for e-Invoice attempts (2026-11-14).
--
-- Lists every document that has not reached a terminal e-Invoice state
-- (pending / failed) with the last attempt time and attempt count from the
-- append-only audit table. Used by the owner/manager to chase IRNs.
--
-- No writes. The function is SECURITY INVOKER (the default), so the
-- caller's own row-level security on restaurant_invoices /
-- restaurant_irp_requests decides which rows appear — there is no path to
-- another tenant's documents. There is deliberately no way to flip an IRN
-- here; recording an IRN is a future, owner-approved integration decision.

create or replace function public.list_restaurant_irp_reconciliation()
returns table (
  invoice_id uuid,
  restaurant_id uuid,
  invoice_number text,
  document_type text,
  irp_status text,
  is_b2b boolean,
  issued_at timestamptz,
  last_attempt_at timestamptz,
  attempt_count integer
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    i.id,
    i.restaurant_id,
    i.invoice_number,
    i.document_type,
    i.irp_status,
    (i.recipient_gstin is not null),
    i.issued_at,
    (select max(r.created_at) from public.restaurant_irp_requests r where r.invoice_id = i.id),
    (select count(*)::integer from public.restaurant_irp_requests r where r.invoice_id = i.id)
  from public.restaurant_invoices i
  where i.irp_status in ('pending', 'failed')
$$;

comment on function public.list_restaurant_irp_reconciliation() is
  'Documents awaiting an IRN (pending) or whose last IRP attempt failed, with attempt counts from restaurant_irp_requests. Read-only; the calling role''s RLS decides visibility.';

revoke all on function public.list_restaurant_irp_reconciliation() from public, anon;
grant execute on function public.list_restaurant_irp_reconciliation() to authenticated;
