-- P8: close a table session and issue its durable receipt atomically.
--
-- Payment state is frozen into the issued invoice snapshot. Payments recorded
-- after issue produce separate immutable payment acknowledgements linked to
-- that invoice; they never rewrite the invoice PDF or the original share text.

create table if not exists public.restaurant_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  invoice_id uuid not null references public.restaurant_invoices(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  receipt_reference text not null,
  issued_at timestamptz not null default statement_timestamp(),
  snapshot jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint restaurant_payment_receipts_one_per_payment unique (payment_id),
  constraint restaurant_payment_receipts_invoice_sequence unique (invoice_id, sequence_number),
  constraint restaurant_payment_receipts_reference_unique unique (restaurant_id, receipt_reference)
);

create index if not exists restaurant_payment_receipts_invoice_idx
  on public.restaurant_payment_receipts (invoice_id, sequence_number);

alter table public.restaurant_payment_receipts enable row level security;
revoke all on public.restaurant_payment_receipts from public, anon, authenticated, service_role;
grant select on public.restaurant_payment_receipts to authenticated;

create policy restaurant_payment_receipts_staff_read on public.restaurant_payment_receipts
  for select to authenticated
  using (public.is_member(restaurant_id));

-- `created_at` can be the provider-attempt time for an online payment. Stamp a
-- separate received time as the payment becomes recorded; legacy rows remain
-- readable through coalesce(recorded_at, created_at).
create or replace function public.stamp_payment_recorded_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'recorded' and (new.recorded_at is null or (tg_op = 'UPDATE' and old.status is distinct from 'recorded')) then
    new.recorded_at := statement_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_payment_recorded_at() from public, anon, authenticated;

drop trigger if exists payments_stamp_recorded_at on public.payments;
create trigger payments_stamp_recorded_at
before insert or update of status, recorded_at on public.payments
for each row execute function public.stamp_payment_recorded_at();

-- Append one payment acknowledgement for any recorded counter or online
-- payment that arrives after a live invoice was issued. The ledger row and its
-- acknowledgement commit or roll back together.
create or replace function public.issue_payment_receipt_after_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice public.restaurant_invoices%rowtype;
  v_order_session_id uuid;
  v_sequence integer;
  v_total bigint;
  v_paid bigint;
  v_reference text;
  v_snapshot jsonb;
begin
  if new.status <> 'recorded' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'recorded' then
    return new;
  end if;

  -- Serialize against checkout on the same sitting. If the payment commits
  -- first, checkout snapshots it; if checkout commits first, this trigger
  -- sees the issued invoice and creates its supplemental receipt.
  select s.id into v_order_session_id
    from public.orders o
    join public.order_sessions s on s.id = o.order_session_id
   where o.id = new.order_id and o.restaurant_id = new.restaurant_id
   for update of s;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.restaurant_id = new.restaurant_id
     and new.order_id = any(i.source_order_ids)
     and i.status = 'issued'
   order by i.issued_at desc, i.id desc
   limit 1
   for update;
  if not found then
    -- Payments received before the invoice are already represented in its
    -- issue-time payment snapshot, so no duplicate acknowledgement is made.
    return new;
  end if;

  if exists (
    select 1 from public.restaurant_payment_receipts r where r.payment_id = new.id
  ) then
    return new;
  end if;

  select coalesce(max(r.sequence_number), 0) + 1
    into v_sequence
    from public.restaurant_payment_receipts r
   where r.invoice_id = v_invoice.id;

  v_total := coalesce((v_invoice.totals_snapshot->>'total_paise')::bigint, 0);
  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = any(v_invoice.source_order_ids)
     and p.status = 'recorded';

  -- A supplemental payment reference, not a GST invoice serial number.
  v_reference := 'PR/' || v_invoice.financial_year || '/' ||
                 lpad(v_invoice.sequence_number::text, 6, '0') || '-' ||
                 lpad(v_sequence::text, 2, '0');
  v_snapshot := jsonb_build_object(
    'receipt_reference', v_reference,
    'invoice_number', v_invoice.invoice_number,
    'seller', v_invoice.seller_snapshot,
    'table_label', v_invoice.table_label_snapshot,
    'payment_method', new.method,
    'payment_amount_paise', new.amount_paise,
    'payment_received_at', coalesce(new.recorded_at, new.created_at, statement_timestamp()),
    'total_paid_paise', v_paid,
    'outstanding_paise', greatest(v_total - v_paid, 0),
    'payment_status', case when v_paid >= v_total then 'paid' else 'partially_paid' end
  );

  insert into public.restaurant_payment_receipts (
    restaurant_id, invoice_id, payment_id, sequence_number,
    receipt_reference, issued_at, snapshot
  ) values (
    new.restaurant_id, v_invoice.id, new.id, v_sequence,
    v_reference, coalesce(new.recorded_at, statement_timestamp()), v_snapshot
  ) on conflict (payment_id) do nothing;

  return new;
end;
$$;

comment on function public.issue_payment_receipt_after_invoice_payment() is
  'Creates one immutable supplemental payment receipt when a recorded payment arrives after the related session invoice. Does not mutate the issued invoice snapshot.';

revoke all on function public.issue_payment_receipt_after_invoice_payment() from public, anon, authenticated;

drop trigger if exists payments_issue_invoice_receipt on public.payments;
create trigger payments_issue_invoice_receipt
after insert or update of status on public.payments
for each row execute function public.issue_payment_receipt_after_invoice_payment();

-- One transaction: closing blocks further guest tickets, then the P6 helper
-- snapshots all existing tickets and allocates the final number. Any failure
-- in receipt validation rolls the close back too, so no session is stranded.
create or replace function public.close_order_session_and_issue_receipt(
  p_order_session_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.order_sessions%rowtype;
  v_role public.member_role;
  v_invoice_id uuid;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to close this table.'
      using errcode = '42501';
  end if;

  select s.* into v_session
    from public.order_sessions s
   where s.id = p_order_session_id
   for update;
  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_session.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to check out this table.' using errcode = '42501';
  end if;
  if v_session.status = 'open' then
    if not public.restaurant_can_write(v_session.restaurant_id) then
      raise exception 'This restaurant is in read-only mode. Restore access before checkout.'
        using errcode = 'P0001';
    end if;
    update public.order_sessions
       set status = 'closed',
           closed_at = statement_timestamp(),
           closed_by = v_actor
     where id = v_session.id;
  elsif v_session.closed_at is null then
    raise exception 'The closed table session has no close timestamp; ask an owner to review it.'
      using errcode = 'P0001';
  end if;

  v_invoice_id := public.issue_closed_session_receipt(v_session.id);
  return v_invoice_id;
end;
$$;

comment on function public.close_order_session_and_issue_receipt(uuid) is
  'Atomically closes an open table session and creates/returns its final receipt. Can be retried safely; receipt validation failure rolls the close back.';

revoke all on function public.close_order_session_and_issue_receipt(uuid) from public, anon, authenticated;
grant execute on function public.close_order_session_and_issue_receipt(uuid) to authenticated;
