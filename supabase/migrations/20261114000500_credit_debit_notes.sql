-- 20261114000500 — Credit/debit notes against GST documents.
--
-- WHAT THIS ADDS
--
--   restaurant_note_series   per-outlet, per-FY, per-kind counters (CN/ DN/).
--   restaurant_notes         immutable issued notes referencing one
--                            GST document (gst_tax_invoice | bill_of_supply).
--                            Notes against ordinary receipts are refused:
--                            only a tax invoice or bill of supply admits a
--                            credit/debit note. A plain receipt is corrected
--                            by void + re-issue.
--   restaurant_note_events   append-only ledger of note issuance and voids.
--   restaurant_irp_requests  gains note_id (nullable) + exactly-one-document
--                            check; invoice rows unchanged.
--   issue_invoice_note()     owner/manager-only issuance (definer).
--   void_invoice_note()      owner/manager-only audited void transition.
--   record_note_irp_request() owner/manager-only IRP attempt audit for notes.
--
-- SEMANTICS AND BOUNDS
--
--   * A note covers the FULL source document (no line-level partial notes in
--     this build). Partial correction after the fact would re-derive GST from
--     disaggregated snapshots and produce indefensible tax numbers; the
--     correction path for partial errors is void + re-issue, same as today.
--   * At most one LIVE credit note and one LIVE debit note per source
--     document (partial unique indexes are the backstop; a friendly check
--     runs first).
--   * Amounts are copied from the parent's immutable snapshots, never
--     recomputed from current configuration. taxable + CGST + SGST + IGST
--     must equal the parent's total, or the note is refused (P0001) — a
--     note that cannot be decomposed honestly is not issued.
--   * A note inherits the parent's e-Invoice posture, fail-closed: a parent
--     that is pending/failed/generated gets a pending note (the note needs
--     its own IRN when the original was e-invoiced). B2C parents (not_required)
--     get not_required notes. No IRN exists in this build; irp_status='generated'
--     is only ever written by the future provider integration.
--   * Notes are immutable like invoices: DELETE is refused; the only permitted
--     transition is the audited void RPC (owner/manager + can_write).
--   * No rows are updated in restaurant_invoices; the note points at it.
--
-- Forward-only. No hosted database is touched. Never applied to production.

-- ============================================================== series table

create table if not exists public.restaurant_note_series (
  restaurant_id  uuid not null references public.restaurants(id) on delete restrict,
  financial_year text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  document_type  text not null check (document_type in ('credit_note', 'debit_note')),
  next_number    integer not null default 1 check (next_number between 1 and 1000000),
  primary key (restaurant_id, financial_year, document_type)
);

comment on table public.restaurant_note_series is
  'Internal per-restaurant, per-financial-year, per-kind note counters. Row-locked and transactional, like restaurant_invoice_series.';

-- ============================================================== notes table

create table if not exists public.restaurant_notes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  invoice_id uuid not null references public.restaurant_invoices(id) on delete restrict,
  document_type text not null check (document_type in ('credit_note', 'debit_note')),
  document_number varchar(16) not null,
  financial_year text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  sequence_number integer not null check (sequence_number between 1 and 999999),
  status text not null default 'issued' check (status in ('issued', 'voided')),
  reason_code text not null check (reason_code in
    ('returned_supply', 'quantity_difference', 'rate_difference', 'post_supply_change', 'other')),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  taxable_paise bigint not null check (taxable_paise >= 0),
  cgst_paise    bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise    bigint not null default 0 check (sgst_paise >= 0),
  igst_paise    bigint not null default 0 check (igst_paise >= 0),
  total_paise   bigint not null check (total_paise > 0),
  gst_snapshot       jsonb not null,
  seller_snapshot    jsonb not null,
  customer_snapshot  jsonb,
  totals_snapshot    jsonb not null,
  payment_snapshot   jsonb not null default '[]'::jsonb,
  irp_status text not null default 'not_required'
    check (irp_status in ('not_required', 'pending', 'generated', 'failed', 'cancelled')),
  irn text check (irn is null or irn ~ '^[0-9a-f]{64}$'),
  source_document_number text not null,
  source_issued_at timestamptz not null,
  issued_at timestamptz not null default statement_timestamp(),
  issued_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text,
  created_at timestamptz not null default statement_timestamp(),
  constraint restaurant_notes_number_unique unique (restaurant_id, document_number),
  constraint restaurant_notes_sequence_unique unique (restaurant_id, financial_year, document_type, sequence_number),
  constraint restaurant_notes_format_check check (
    document_number = (case document_type when 'credit_note' then 'CN/' else 'DN/' end)
                      || financial_year || '/'
                      || lpad(sequence_number::text, 6, '0')
    and length(document_number) <= 16
  ),
  constraint restaurant_notes_amounts_check check (
    total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise
  ),
  constraint restaurant_notes_irn_consistency check (
    (irp_status in ('generated', 'cancelled')) = (irn is not null)
  ),
  constraint restaurant_notes_void_fields_check check (
    (status = 'issued' and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'voided' and voided_at is not null and void_reason is not null)
  )
);

comment on table public.restaurant_notes is
  'Immutable, sequentially numbered credit/debit notes referencing one GST document. Amounts are copied from the parent snapshot; only the audited void transition exists. No writes outside the definer RPCs.';

-- A source document admits at most one live credit note and one live debit
-- note. A voided note no longer blocks a replacement (a fresh note gets a
-- fresh number).
create unique index if not exists restaurant_notes_one_live_credit_note
  on public.restaurant_notes (invoice_id)
  where document_type = 'credit_note' and status = 'issued';
create unique index if not exists restaurant_notes_one_live_debit_note
  on public.restaurant_notes (invoice_id)
  where document_type = 'debit_note' and status = 'issued';
create index if not exists restaurant_notes_invoice_idx on public.restaurant_notes (invoice_id);
create index if not exists restaurant_notes_restaurant_issued_idx
  on public.restaurant_notes (restaurant_id, issued_at desc);

-- ===================================================== events (append-only)

create table if not exists public.restaurant_note_events (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.restaurant_notes(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  event text not null check (event in ('issued', 'voided')),
  reason text not null,
  actor uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default statement_timestamp()
);

comment on table public.restaurant_note_events is
  'Append-only audit ledger for credit/debit notes: one row per issuance and per void. Written only by the definer RPCs.';

create index if not exists restaurant_note_events_note_idx on public.restaurant_note_events (note_id, created_at);

-- ====================================================== irp audit extension

alter table public.restaurant_irp_requests
  alter column invoice_id drop not null;
alter table public.restaurant_irp_requests
  add column if not exists note_id uuid references public.restaurant_notes(id) on delete cascade;
alter table public.restaurant_irp_requests
  drop constraint if exists restaurant_irp_requests_one_document;
alter table public.restaurant_irp_requests
  add constraint restaurant_irp_requests_one_document
  check (num_nonnulls(invoice_id, note_id) = 1);
create unique index if not exists restaurant_irp_requests_note_attempt
  on public.restaurant_irp_requests (note_id, attempt_no)
  where note_id is not null;

comment on column public.restaurant_irp_requests.note_id is
  'Credit/debit note the attempt belongs to. Exactly one of invoice_id / note_id is set.';

-- =================================================================== grants

alter table public.restaurant_notes enable row level security;
alter table public.restaurant_note_events enable row level security;
alter table public.restaurant_note_series enable row level security;

revoke all on public.restaurant_notes from public, anon, authenticated, service_role;
revoke all on public.restaurant_note_events from public, anon, authenticated, service_role;
revoke all on public.restaurant_note_series from public, anon, authenticated, service_role;

grant select on public.restaurant_notes to authenticated;
grant select on public.restaurant_note_events to authenticated;

drop policy if exists restaurant_notes_staff_read on public.restaurant_notes;
create policy restaurant_notes_staff_read on public.restaurant_notes
  for select to authenticated
  using (public.is_member(restaurant_id));
drop policy if exists restaurant_note_events_staff_read on public.restaurant_note_events;
create policy restaurant_note_events_staff_read on public.restaurant_note_events
  for select to authenticated
  using (public.is_member(restaurant_id));

-- ========================================================= immutability

create or replace function public.restaurant_notes_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Note records can never be deleted; void them instead.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'voided_at' - 'voided_by' - 'void_reason')
     is distinct from
     (to_jsonb(old) - 'status' - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'Issued notes are immutable. Only the audited void transition is permitted.' using errcode = '42501';
  end if;
  if new.status = old.status then
    if (new.voided_at, new.voided_by, new.void_reason) is distinct from (old.voided_at, old.voided_by, old.void_reason) then
      raise exception 'Issued notes are immutable; void fields cannot be edited in place.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status = 'issued' and new.status = 'voided' then
    if new.voided_at is null or new.void_reason is null or char_length(btrim(new.void_reason)) < 5 then
      raise exception 'Voiding requires a timestamp and a reason of at least 5 characters.' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'Note status can only move from issued to voided.' using errcode = '42501';
end;
$$;

drop trigger if exists restaurant_notes_immutable on public.restaurant_notes;
create trigger restaurant_notes_immutable
  before update or delete on public.restaurant_notes
  for each row execute function public.restaurant_notes_immutable();

create or replace function public.restaurant_note_events_no_rewrite()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Note events can never be changed or removed.' using errcode = '42501';
end;
$$;

drop trigger if exists restaurant_note_events_no_rewrite on public.restaurant_note_events;
create trigger restaurant_note_events_no_rewrite
  before update or delete on public.restaurant_note_events
  for each row execute function public.restaurant_note_events_no_rewrite();

-- ======================================================== issuance helper
-- Allocated inside issue_invoice_note with a row lock on the series row, in
-- the same module for readability. (No separate definer helper is granted.)

-- ===================================================== issue_invoice_note()

create or replace function public.issue_invoice_note(
  p_invoice_id   uuid,
  p_document_type text,
  p_reason_code  text,
  p_reason       text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.restaurant_invoices%rowtype;
  v_role public.member_role;
  v_taxable bigint;
  v_cgst bigint := 0;
  v_sgst bigint := 0;
  v_igst bigint := 0;
  v_tax bigint;
  v_total bigint;
  v_fy text;
  v_fy_start integer;
  v_local_date date;
  v_sequence integer;
  v_prefix text;
  v_document_number text;
  v_note_id uuid;
  v_irp_status text;
  v_gst_snapshot jsonb;
  v_totals jsonb;
  v_now timestamptz := statement_timestamp();
  v_restaurant public.restaurants%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to issue a note.' using errcode = '42501';
  end if;
  if p_document_type not in ('credit_note', 'debit_note') then
    raise exception 'document_type must be credit_note or debit_note.' using errcode = '22023';
  end if;
  if p_reason_code not in ('returned_supply', 'quantity_difference', 'rate_difference', 'post_supply_change', 'other') then
    raise exception 'reason_code must be one of returned_supply, quantity_difference, rate_difference, post_supply_change, other.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(btrim(p_reason)) > 500 then
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
    raise exception 'Only an owner or manager can issue a note.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_invoice.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;

  if v_invoice.status <> 'issued' then
    raise exception 'A voided document cannot be noted. Correct the record by issuing the replacement document instead.'
      using errcode = 'P0001';
  end if;
  if v_invoice.document_type not in ('gst_tax_invoice', 'bill_of_supply')
     or v_invoice.gst_snapshot is null then
    raise exception 'Credit/debit notes exist only against GST documents (a tax invoice or a Bill of Supply). Correct a plain receipt with void and re-issue.'
      using errcode = 'P0001';
  end if;

  -- A live note of each kind already exists?
  if exists (select 1 from public.restaurant_notes n
              where n.invoice_id = v_invoice.id and n.document_type = p_document_type and n.status = 'issued') then
    raise exception 'This document already has a live note of that kind. Void it before issuing a replacement.'
      using errcode = 'P0001';
  end if;

  -- Amounts come from the parent's immutable snapshots only.
  v_taxable := (v_invoice.gst_snapshot->>'taxable_paise')::bigint;
  v_cgst    := coalesce((v_invoice.gst_snapshot->>'cgst_paise')::bigint, 0);
  v_sgst    := coalesce((v_invoice.gst_snapshot->>'sgst_paise')::bigint, 0);
  v_igst    := coalesce((v_invoice.gst_snapshot->>'igst_paise')::bigint, 0);
  v_tax     := v_cgst + v_sgst + v_igst;
  v_total   := (v_invoice.totals_snapshot->>'total_paise')::bigint;
  if v_taxable is null or v_total is null or v_total <= 0 then
    raise exception 'The parent document snapshot is missing amounts; note refused.' using errcode = 'P0001';
  end if;
  if v_taxable + v_tax <> v_total then
    raise exception 'The parent document decomposes to a different total than it records; note refused.' using errcode = 'P0001';
  end if;

  -- IRP posture: fail closed, mirroring the parent. A B2C parent never owes
  -- an IRN; an e-invoice-applicable parent forces its note to pending.
  v_irp_status := case when v_invoice.irp_status in ('pending', 'generated', 'failed', 'cancelled')
                       then 'pending'
                       else v_invoice.irp_status end;

  v_gst_snapshot := v_invoice.gst_snapshot
    || jsonb_build_object('source_document_number', v_invoice.invoice_number,
                          'source_document_type', v_invoice.document_type);
  v_totals := jsonb_build_object(
    'taxable_paise', v_taxable,
    'cgst_paise', v_cgst,
    'sgst_paise', v_sgst,
    'igst_paise', v_igst,
    'tax_paise', v_tax,
    'rate_bps', (v_invoice.gst_snapshot->>'rate_bps')::integer,
    'total_paise', v_total,
    'source_total_paise', v_total
  );

  select r.* into v_restaurant from public.restaurants r where r.id = v_invoice.restaurant_id;
  begin
    v_local_date := (v_now at time zone coalesce(nullif(v_restaurant.timezone, ''), 'Asia/Kolkata'))::date;
  exception when others then
    v_local_date := (v_now at time zone 'Asia/Kolkata')::date;
  end;
  v_fy_start := extract(year from v_local_date)::integer;
  if extract(month from v_local_date) < 4 then
    v_fy_start := v_fy_start - 1;
  end if;
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');
  v_prefix := case p_document_type when 'credit_note' then 'CN' else 'DN' end;

  insert into public.restaurant_note_series (restaurant_id, financial_year, document_type, next_number)
  values (v_invoice.restaurant_id, v_fy, p_document_type, 1)
  on conflict (restaurant_id, financial_year, document_type) do nothing;

  select s.next_number into v_sequence
    from public.restaurant_note_series s
   where s.restaurant_id = v_invoice.restaurant_id
     and s.financial_year = v_fy and s.document_type = p_document_type
   for update;
  if v_sequence > 999999 then
    raise exception 'The note series for this financial year has reached its six-digit limit.' using errcode = '22003';
  end if;
  update public.restaurant_note_series
     set next_number = v_sequence + 1
   where restaurant_id = v_invoice.restaurant_id
     and financial_year = v_fy and document_type = p_document_type;
  v_document_number := v_prefix || '/' || v_fy || '/' || lpad(v_sequence::text, 6, '0');

  insert into public.restaurant_notes (
    restaurant_id, invoice_id, document_type, document_number, financial_year,
    sequence_number, reason_code, reason,
    taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
    gst_snapshot, seller_snapshot, customer_snapshot, totals_snapshot,
    irp_status, source_document_number, source_issued_at, issued_by
  ) values (
    v_invoice.restaurant_id, v_invoice.id, p_document_type, v_document_number, v_fy,
    v_sequence, p_reason_code, btrim(p_reason),
    v_taxable, v_cgst, v_sgst, v_igst, v_total,
    v_gst_snapshot, v_invoice.seller_snapshot, v_invoice.customer_snapshot, v_totals,
    v_irp_status, v_invoice.invoice_number, v_invoice.issued_at, v_actor
  ) returning id into v_note_id;

  insert into public.restaurant_note_events (note_id, restaurant_id, event, reason, actor)
  values (v_note_id, v_invoice.restaurant_id, 'issued', p_reason_code || ': ' || btrim(p_reason), v_actor);

  return v_note_id;
end;
$$;

comment on function public.issue_invoice_note(uuid, text, text, text) is
  'Issues an immutable credit or debit note covering the full source GST document. Owner/manager only; amounts copied from immutable parent snapshots; numbers allocated from the note series; one live note of each kind per source document.';

revoke all on function public.issue_invoice_note(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.issue_invoice_note(uuid, text, text, text) to authenticated;

-- ======================================================== void_invoice_note()

create or replace function public.void_invoice_note(
  p_note_id uuid,
  p_reason  text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_note public.restaurant_notes%rowtype;
  v_role public.member_role;
begin
  if v_actor is null then
    raise exception 'Sign in to void this note.' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 or char_length(btrim(p_reason)) > 500 then
    raise exception 'Enter a reason between 5 and 500 characters.' using errcode = '22023';
  end if;

  select n.* into v_note from public.restaurant_notes n where n.id = p_note_id for update;
  if not found then
    raise exception 'Note not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_note.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can void a note.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_note.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;
  if v_note.status <> 'issued' then
    raise exception 'This note has already been voided.' using errcode = 'P0001';
  end if;

  update public.restaurant_notes
     set status = 'voided', voided_at = statement_timestamp(),
         voided_by = v_actor, void_reason = btrim(p_reason)
   where id = v_note.id;

  insert into public.restaurant_note_events (note_id, restaurant_id, event, reason, actor)
  values (v_note.id, v_note.restaurant_id, 'voided', btrim(p_reason), v_actor);
end;
$$;

comment on function public.void_invoice_note(uuid, text) is
  'Voids, but never deletes or renumbers, a note. Only restaurant owners/managers may void.';

revoke all on function public.void_invoice_note(uuid, text) from public, anon, service_role;
grant execute on function public.void_invoice_note(uuid, text) to authenticated;

-- ================================================== record_note_irp_request()

create or replace function public.record_note_irp_request(
  p_note_id uuid,
  p_provider text,
  p_payload_version text,
  p_status text,
  p_request_sha256 text default null,
  p_response_sha256 text default null,
  p_error_code text default null,
  p_error_message text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_note public.restaurant_notes%rowtype;
  v_role public.member_role;
  v_attempt integer;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to record an IRP attempt.' using errcode = '42501';
  end if;
  select n.* into v_note from public.restaurant_notes n where n.id = p_note_id;
  if not found then
    raise exception 'Note not found.' using errcode = 'P0002';
  end if;
  select m.role into v_role from public.memberships m
   where m.restaurant_id = v_note.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can record an IRP attempt.' using errcode = '42501';
  end if;
  if p_status not in ('payload_built', 'submitted', 'accepted', 'rejected', 'transport_error') then
    raise exception 'Unknown IRP status.' using errcode = '23514';
  end if;
  select coalesce(max(r.attempt_no), 0) + 1 into v_attempt
    from public.restaurant_irp_requests r where r.note_id = v_note.id;
  insert into public.restaurant_irp_requests (
    restaurant_id, note_id, attempt_no, provider, payload_version, status,
    request_sha256, response_sha256, error_code, error_message
  ) values (
    v_note.restaurant_id, v_note.id, v_attempt, btrim(p_provider), btrim(p_payload_version), p_status,
    p_request_sha256, p_response_sha256, p_error_code, left(p_error_message, 2000)
  ) returning id into v_id;
  return v_id;
end;
$$;

comment on function public.record_note_irp_request(uuid, text, text, text, text, text, text, text) is
  'Appends one IRP attempt for a credit/debit note to the provider-agnostic audit table. No credentials, no full payloads — hashes and outcomes only. Owner/manager only.';

revoke all on function public.record_note_irp_request(uuid, text, text, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.record_note_irp_request(uuid, text, text, text, text, text, text, text)
  to authenticated;
