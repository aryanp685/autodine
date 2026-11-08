-- P6: immutable, numbered receipts for closed table sessions.
--
-- GST tax invoices intentionally remain unavailable until approved per-item
-- tax classifications, pricing modes, seller state, and place-of-supply rules
-- are configured. This migration issues a clearly identified non-GST receipt
-- only. It never reuses a number: voided receipts remain in the ledger, and a
-- replacement gets the next number.
--
-- Invoice issuance accepts only a session id. The database locks the session,
-- loads every non-cancelled ticket and recorded payment, snapshots all values,
-- and allocates a per-restaurant financial-year number in one transaction.
-- P8's close RPC calls issue_closed_session_receipt() in the same transaction.
-- No client total, line, or invoice number is trusted.

create table if not exists public.restaurant_invoice_series (
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  financial_year text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  next_number integer not null default 1 check (next_number between 1 and 1000000),
  primary key (restaurant_id, financial_year)
);

comment on table public.restaurant_invoice_series is
  'Internal per-restaurant, per-financial-year receipt counters. Financial years run 1 April through 31 March; allocation is row-locked and transactional.';

-- Payment time is distinct from attempt creation time for asynchronous online
-- settlement. Older recorded rows fall back to created_at in invoice snapshots.
alter table public.payments
  add column if not exists recorded_at timestamptz;

comment on column public.payments.recorded_at is
  'When funds were recorded as received. Null on pending/legacy rows; consumers fall back to created_at only for already-recorded historical data.';

create table if not exists public.restaurant_invoices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  order_session_id uuid not null references public.order_sessions(id) on delete restrict,
  invoice_number varchar(16) not null,
  financial_year text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  sequence_number integer not null check (sequence_number between 1 and 999999),
  document_type text not null check (document_type in ('receipt', 'gst_tax_invoice')),
  status text not null default 'issued' check (status in ('issued', 'voided')),
  issued_at timestamptz not null default statement_timestamp(),
  issued_by uuid references public.profiles(id) on delete set null,
  table_label_snapshot text,
  session_opened_at timestamptz not null,
  session_closed_at timestamptz not null,
  seller_snapshot jsonb not null,
  customer_snapshot jsonb,
  totals_snapshot jsonb not null,
  payment_snapshot jsonb not null,
  source_order_ids uuid[] not null,
  supersedes_invoice_id uuid references public.restaurant_invoices(id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default statement_timestamp(),
  constraint restaurant_invoices_number_unique unique (restaurant_id, invoice_number),
  constraint restaurant_invoices_sequence_unique unique (restaurant_id, financial_year, sequence_number),
  constraint restaurant_invoices_format_check check (
    invoice_number = 'INV/' || financial_year || '/' || lpad(sequence_number::text, 6, '0')
    and length(invoice_number) <= 16
  ),
  constraint restaurant_invoices_void_fields_check check (
    (status = 'issued' and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'voided' and voided_at is not null and void_reason is not null)
  )
);

-- Only one live receipt per sitting. A voided record stays immutable and a
-- deliberate replacement receives a new number and points back to it.
create unique index if not exists restaurant_invoices_one_issued_per_session
  on public.restaurant_invoices (order_session_id)
  where status = 'issued';

create index if not exists restaurant_invoices_restaurant_issued_idx
  on public.restaurant_invoices (restaurant_id, issued_at desc);

create table if not exists public.restaurant_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.restaurant_invoices(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  source_order_id uuid not null references public.orders(id) on delete restrict,
  source_order_item_id uuid references public.order_items(id) on delete set null,
  line_snapshot jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (invoice_id, line_number)
);

alter table public.restaurant_invoices enable row level security;
alter table public.restaurant_invoice_lines enable row level security;
alter table public.restaurant_invoice_series enable row level security;

revoke all on public.restaurant_invoices from public, anon, authenticated, service_role;
revoke all on public.restaurant_invoice_lines from public, anon, authenticated, service_role;
revoke all on public.restaurant_invoice_series from public, anon, authenticated, service_role;

grant select on public.restaurant_invoices, public.restaurant_invoice_lines to authenticated;

create policy restaurant_invoices_staff_read on public.restaurant_invoices
  for select to authenticated
  using (public.is_member(restaurant_id));

create policy restaurant_invoice_lines_staff_read on public.restaurant_invoice_lines
  for select to authenticated
  using (public.is_member(restaurant_id));

-- A finalized snapshot is never updated or deleted through table access.
-- The only permitted state transition is the audited void RPC below.
create or replace function public.issue_closed_session_receipt(
  p_order_session_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.order_sessions%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_role public.member_role;
  v_existing public.restaurant_invoices%rowtype;
  v_previous public.restaurant_invoices%rowtype;
  v_issued_at timestamptz := statement_timestamp();
  v_local_date date;
  v_fy_start integer;
  v_fy text;
  v_sequence integer;
  v_invoice_number text;
  v_invoice_id uuid;
  v_seller jsonb;
  v_totals jsonb;
  v_payments jsonb;
  v_order_ids uuid[];
  v_order_count integer;
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
  v_paid bigint;
  v_table_label text;
  v_item_count integer;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to issue a receipt.'
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
    raise exception 'You do not have permission to issue this receipt.' using errcode = '42501';
  end if;
  if v_session.status <> 'closed' or v_session.closed_at is null then
    raise exception 'Close the table session before issuing its final receipt.' using errcode = 'P0001';
  end if;

  select i.* into v_existing
    from public.restaurant_invoices i
   where i.order_session_id = v_session.id and i.status = 'issued';
  if found then
    return v_existing.id;
  end if;
  if not public.restaurant_can_write(v_session.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before issuing a receipt.'
      using errcode = 'P0001';
  end if;

  -- GST invoices stay fail-closed until the restaurant has an approved
  -- per-item tax configuration and place-of-supply model. There is no public
  -- route to request one through this receipt function.
  select r.* into v_restaurant
    from public.restaurants r
   where r.id = v_session.restaurant_id and r.is_active;
  if not found then
    raise exception 'Restaurant is not active.' using errcode = 'P0001';
  end if;
  if nullif(btrim(v_restaurant.name), '') is null
     or nullif(btrim(v_restaurant.address), '') is null then
    raise exception 'Add the restaurant name and address in Settings before issuing a receipt.'
      using errcode = 'P0001';
  end if;

  select t.label into v_table_label
    from public.dining_tables t
   where t.id = v_session.table_id and t.restaurant_id = v_session.restaurant_id;

  select count(*)::integer,
         coalesce(sum(o.subtotal_paise), 0)::bigint,
         coalesce(sum(o.discount_paise), 0)::bigint,
         coalesce(sum(o.tax_paise), 0)::bigint,
         coalesce(sum(o.total_paise), 0)::bigint,
         array_agg(o.id order by o.placed_at, o.id)
    into v_order_count, v_subtotal, v_discount, v_tax, v_total, v_order_ids
    from public.orders o
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled';
  if v_order_count = 0 then
    raise exception 'This table session has no non-cancelled tickets to bill.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and o.discount_paise > 0
  ) then
    raise exception 'This session has discounts without the approved item-level tax and discount audit configuration. A final receipt cannot be issued yet.'
      using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint
    into v_paid
    from public.payments p
   where p.order_id = any(v_order_ids) and p.status = 'recorded';

  select count(*)::integer into v_item_count
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled';
  if v_item_count = 0 then
    raise exception 'Ticket item details are unavailable; a receipt cannot be issued.' using errcode = 'P0001';
  end if;

  -- India financial year: local restaurant date, 1 April to 31 March.
  begin
    v_local_date := (v_issued_at at time zone coalesce(nullif(v_restaurant.timezone, ''), 'Asia/Kolkata'))::date;
  exception when others then
    v_local_date := (v_issued_at at time zone 'Asia/Kolkata')::date;
  end;
  v_fy_start := extract(year from v_local_date)::integer;
  if extract(month from v_local_date) < 4 then
    v_fy_start := v_fy_start - 1;
  end if;
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');

  insert into public.restaurant_invoice_series (restaurant_id, financial_year, next_number)
  values (v_session.restaurant_id, v_fy, 1)
  on conflict (restaurant_id, financial_year) do nothing;

  select s.next_number into v_sequence
    from public.restaurant_invoice_series s
   where s.restaurant_id = v_session.restaurant_id and s.financial_year = v_fy
   for update;
  if v_sequence > 999999 then
    raise exception 'The invoice series for this financial year has reached its six-digit limit.'
      using errcode = '22003';
  end if;
  update public.restaurant_invoice_series
     set next_number = v_sequence + 1
   where restaurant_id = v_session.restaurant_id and financial_year = v_fy;

  v_invoice_number := 'INV/' || v_fy || '/' || lpad(v_sequence::text, 6, '0');
  v_seller := jsonb_build_object(
    'restaurant_id', v_restaurant.id,
    'name', btrim(v_restaurant.name),
    'address', btrim(v_restaurant.address),
    'phone', nullif(btrim(v_restaurant.phone), ''),
    'logo_path', nullif(btrim(v_restaurant.logo_path), '')
  );
  v_totals := jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'ticket_discount_paise', v_discount,
    'bill_discount_paise', 0,
    'taxable_paise', null,
    'tax_paise', v_tax,
    'other_charges_paise', 0,
    'total_paise', v_total,
    'amount_paid_paise', v_paid,
    'outstanding_paise', greatest(v_total - v_paid, 0),
    'payment_status', case when v_paid >= v_total then 'paid' else 'unpaid' end
  );

  select coalesce(jsonb_agg(jsonb_build_object(
           'method', p.method,
           'amount_paise', p.amount_paise,
           'received_at', coalesce(p.recorded_at, p.created_at)
         ) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.payments p
   where p.order_id = any(v_order_ids) and p.status = 'recorded';

  select i.* into v_previous
    from public.restaurant_invoices i
   where i.order_session_id = v_session.id and i.status = 'voided'
   order by i.issued_at desc, i.id desc
   limit 1;

  insert into public.restaurant_invoices (
    restaurant_id, order_session_id, invoice_number, financial_year,
    sequence_number, document_type, issued_at, issued_by,
    table_label_snapshot, session_opened_at, session_closed_at,
    seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot,
    source_order_ids, supersedes_invoice_id
  ) values (
    v_session.restaurant_id, v_session.id, v_invoice_number, v_fy,
    v_sequence, 'receipt', v_issued_at, v_actor,
    v_table_label, v_session.opened_at, v_session.closed_at,
    v_seller, null, v_totals, v_payments,
    v_order_ids, v_previous.id
  ) returning id into v_invoice_id;

  insert into public.restaurant_invoice_lines (
    invoice_id, restaurant_id, line_number, source_order_id,
    source_order_item_id, line_snapshot
  )
  select v_invoice_id,
         v_session.restaurant_id,
         row_number() over (order by o.placed_at, o.id, oi.sort_order, oi.id)::integer,
         o.id,
         oi.id,
         jsonb_build_object(
           'ticket_code', o.code,
           'item_name', oi.name_snapshot,
           'variant', oi.variant_snapshot,
           'addons', to_jsonb(oi.addons_snapshot),
           'quantity', oi.qty,
           'unit_price_paise', oi.unit_price_paise,
           'amount_paise', oi.unit_price_paise * oi.qty,
           'is_veg', oi.is_veg
         )
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled'
   order by o.placed_at, o.id, oi.sort_order, oi.id;

  return v_invoice_id;
end;
$$;

comment on function public.issue_closed_session_receipt(uuid) is
  'Issues or returns the single immutable non-GST receipt for a closed table session. Server-derived totals and payment history; atomic per-restaurant financial-year numbering. GST tax invoices remain fail-closed until tax configuration is approved.';

revoke all on function public.issue_closed_session_receipt(uuid) from public, anon, authenticated;
grant execute on function public.issue_closed_session_receipt(uuid) to authenticated;

create or replace function public.void_restaurant_invoice(
  p_invoice_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.restaurant_invoices%rowtype;
  v_role public.member_role;
begin
  if v_actor is null then
    raise exception 'Sign in to void this invoice.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(btrim(p_reason)) > 500 then
    raise exception 'Enter a reason between 5 and 500 characters.' using errcode = '22023';
  end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = p_invoice_id
   for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_invoice.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can void a receipt.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_invoice.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'This receipt has already been voided.' using errcode = 'P0001';
  end if;

  update public.restaurant_invoices
     set status = 'voided', voided_at = statement_timestamp(),
         voided_by = v_actor, void_reason = btrim(p_reason)
   where id = v_invoice.id;
end;
$$;

comment on function public.void_restaurant_invoice(uuid, text) is
  'Voids, but never deletes or renumbers, a receipt. Only restaurant owners/managers may void; a replacement uses the next invoice number.';

revoke all on function public.void_restaurant_invoice(uuid, text) from public, anon, authenticated;
grant execute on function public.void_restaurant_invoice(uuid, text) to authenticated;
