-- P9 least-privilege fix: financial receipts are readable by finance-capable
-- staff only. Kitchen and other non-settlement roles may still use the kitchen
-- board, but cannot fetch final invoices or payment acknowledgements by UUID.
-- Writes remain confined to the existing SECURITY DEFINER receipt/payment RPCs.

drop policy if exists restaurant_invoices_staff_read on public.restaurant_invoices;
create policy restaurant_invoices_finance_staff_read on public.restaurant_invoices
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
     where m.restaurant_id = restaurant_invoices.restaurant_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'cashier')
  ));

drop policy if exists restaurant_invoice_lines_staff_read on public.restaurant_invoice_lines;
create policy restaurant_invoice_lines_finance_staff_read on public.restaurant_invoice_lines
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
     where m.restaurant_id = restaurant_invoice_lines.restaurant_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'cashier')
  ));

drop policy if exists restaurant_payment_receipts_staff_read on public.restaurant_payment_receipts;
create policy restaurant_payment_receipts_finance_staff_read on public.restaurant_payment_receipts
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
     where m.restaurant_id = restaurant_payment_receipts.restaurant_id
       and m.user_id = auth.uid()
       and m.role in ('owner', 'manager', 'cashier')
  ));
