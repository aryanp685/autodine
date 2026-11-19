-- ====================================================================
-- GST: B2B recipient capture, e-Invoice readiness, alcohol block,
--      shared-GSTIN cross-outlet consistency (2026-11-14)
-- ====================================================================
-- Implements the approved two-mode plan (Part 9 of the master operational
-- completion programme):
--
--   1. Buyer (recipient) GSTIN capture at issue time on Regular GST tax
--      invoices only. Composition Bills of Supply and normal receipts never
--      carry a buyer GSTIN (fail closed). The document is never recalculated
--      later; the recipient is snapshotted like everything else.
--   2. e-Invoice applicability decided AT ISSUE TIME from the recorded
--      preceding-FY aggregate turnover (AATO > ₹5 crore, Notification
--      No. 10/2023-CT, as amended). B2B documents whose applicability
--      cannot be ruled out are issued irp_status='pending' and must never
--      be rendered as final until a validated IRN exists. NO IRP provider
--      is configured or called by this migration; provider selection and
--      live integration remain an explicit external decision.
--      lib/gst/irp/ contains the provider-independent adapter interface,
--      the versioned payload builder and the offline sandbox stub used by
--      tests. lib/gst/applicability.ts encodes the threshold and fails
--      closed on unknown AATO.
--   3. Alcoholic lines block issuance of any GST document (regular or
--      composition). GST restaurant-service rates never apply to alcohol;
--      an unsupported document is refused rather than mis-issued. Normal
--      ('off') receipts are unaffected. items.is_alcoholic records the
--      flag; owners/managers can set it in the menu item UI or SQL.
--   4. Shared-GSTIN cross-outlet consistency: two restaurants (outlets)
--      holding the same GSTIN may not differ in legal name, registration
--      type or state code, and the PAN embedded must not mix regular and
--      Composition registrations. Enforced in the database with an
--      advisory-lock-serialized trigger.
--   5. restaurant_irp_requests: append-only provider-agnostic audit of
--      every IRP attempt (payload_built / submitted / accepted / rejected /
--      transport_error), written only through the owner/manager definer
--      RPC record_restaurant_irp_request(). No provider credentials live
--      in the database.
--
-- Everything here is forward-only. No hosted database is touched by this
-- commit; verify on an isolated non-production database first.

-- =================================================== items: alcohol flag

alter table public.items add column if not exists is_alcoholic boolean not null default false;

comment on column public.items.is_alcoholic is
  'True for alcoholic liquor lines. Such lines block issuance of any GST document (regular tax invoice and composition Bill of Supply); GST restaurant-service rates never apply to alcohol.';

-- ============================================ invoices: recipient capture

alter table public.restaurant_invoices add column if not exists recipient_name text;
alter table public.restaurant_invoices add column if not exists recipient_gstin text;
alter table public.restaurant_invoices add column if not exists recipient_state_code text;
alter table public.restaurant_invoices add column if not exists recipient_address text;
alter table public.restaurant_invoices add column if not exists recipient_email text;

alter table public.restaurant_invoices drop constraint if exists restaurant_invoices_recipient_gstin_format;
alter table public.restaurant_invoices add constraint restaurant_invoices_recipient_gstin_format
  check (recipient_gstin is null or recipient_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$');

alter table public.restaurant_invoices drop constraint if exists restaurant_invoices_recipient_state_matches_gstin;
alter table public.restaurant_invoices add constraint restaurant_invoices_recipient_state_matches_gstin
  check (recipient_gstin is null or recipient_state_code = substr(recipient_gstin, 1, 2));

alter table public.restaurant_invoices drop constraint if exists restaurant_invoices_recipient_email_plausible;
alter table public.restaurant_invoices add constraint restaurant_invoices_recipient_email_plausible
  check (recipient_email is null or recipient_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

alter table public.restaurant_invoices drop constraint if exists restaurant_invoices_recipient_requires_name;
alter table public.restaurant_invoices add constraint restaurant_invoices_recipient_requires_name
  check (recipient_gstin is null or char_length(btrim(recipient_name)) >= 2);

comment on column public.restaurant_invoices.recipient_gstin is
  'Buyer GST registration number for B2B tax invoices, captured at issue time and immutable thereafter. Checksum is verified by the app; the database enforces the format and the state-code agreement. NULL = B2C document (never e-invoice applicable).';
comment on column public.restaurant_invoices.recipient_state_code is
  'First two digits of the buyer GSTIN; equals the buyer state for tax purposes (POS for restaurant services remains the outlet state).';

-- ===================================== irp audit trail (provider-agnostic)

create table if not exists public.restaurant_irp_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  invoice_id uuid not null references public.restaurant_invoices(id) on delete cascade,
  attempt_no integer not null check (attempt_no >= 1),
  provider text not null check (char_length(btrim(provider)) between 2 and 80),
  payload_version text not null check (char_length(btrim(payload_version)) between 1 and 40),
  status text not null check (status in ('payload_built', 'submitted', 'accepted', 'rejected', 'transport_error')),
  request_sha256 text,
  response_sha256 text,
  error_code text,
  error_message text,
  created_at timestamptz not null default statement_timestamp(),
  constraint restaurant_irp_requests_unique unique (invoice_id, attempt_no)
);

comment on table public.restaurant_irp_requests is
  'Append-only audit of e-Invoice IRP attempts. Contains no credentials and no full payloads — only content hashes, versions and outcomes. Written exclusively through record_restaurant_irp_request().';

alter table public.restaurant_irp_requests enable row level security;
revoke all on public.restaurant_irp_requests from public, anon, authenticated, service_role;
grant select on public.restaurant_irp_requests to authenticated;

drop policy if exists restaurant_irp_requests_staff_read on public.restaurant_irp_requests;
create policy restaurant_irp_requests_staff_read on public.restaurant_irp_requests
  for select to authenticated
  using (public.is_member(restaurant_id));

create or replace function public.record_restaurant_irp_request(
  p_invoice_id uuid,
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
  v_invoice public.restaurant_invoices%rowtype;
  v_role public.member_role;
  v_attempt integer;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to record an IRP attempt.' using errcode = '42501';
  end if;
  select i.* into v_invoice from public.restaurant_invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  select m.role into v_role from public.memberships m
   where m.restaurant_id = v_invoice.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can record an IRP attempt.' using errcode = '42501';
  end if;
  if p_status not in ('payload_built', 'submitted', 'accepted', 'rejected', 'transport_error') then
    raise exception 'Unknown IRP status.' using errcode = '23514';
  end if;
  select coalesce(max(r.attempt_no), 0) + 1 into v_attempt
    from public.restaurant_irp_requests r where r.invoice_id = v_invoice.id;
  insert into public.restaurant_irp_requests (
    restaurant_id, invoice_id, attempt_no, provider, payload_version, status,
    request_sha256, response_sha256, error_code, error_message
  ) values (
    v_invoice.restaurant_id, v_invoice.id, v_attempt, btrim(p_provider), btrim(p_payload_version), p_status,
    p_request_sha256, p_response_sha256, p_error_code, left(p_error_message, 2000)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_restaurant_irp_request(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_restaurant_irp_request(uuid, text, text, text, text, text, text, text)
  to authenticated;

-- ====================== cross-outlet consistency for shared GST registrations

-- Two outlets that share a GSTIN are the same legal registration; they may
-- not drift on legal name, registration type, state code or PAN. Two
-- outlets sharing a PAN may not straddle regular and composition status.
-- Serialized with an advisory transaction lock so concurrent saves cannot
-- both pass.
create or replace function public.restaurant_gst_config_shared_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gstin text := upper(nullif(btrim(new.gstin), ''));
  v_pan text := upper(coalesce(nullif(btrim(new.pan), ''), substr(coalesce(new.gstin, ''), 3, 10)));
begin
  if v_gstin is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(v_gstin), 9131));
  if exists (
    select 1 from public.restaurant_gst_config c
     where upper(c.gstin) = v_gstin
       and c.restaurant_id <> new.restaurant_id
       and (btrim(c.legal_name), c.registration_type, c.state_code,
            upper(coalesce(nullif(btrim(c.pan), ''), substr(c.gstin, 3, 10))))
           is distinct from
           (btrim(new.legal_name), new.registration_type, new.state_code, v_pan)
  ) then
    raise exception 'Another outlet under GSTIN % carries a different legal name, registration type, state code or PAN. Align the shared GST registration before saving.', v_gstin
      using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(v_pan), 9132));
  if exists (
    select 1 from public.restaurant_gst_config c
     where upper(coalesce(nullif(btrim(c.pan), ''), substr(c.gstin, 3, 10))) = v_pan
       and c.restaurant_id <> new.restaurant_id
       and c.registration_type <> new.registration_type
  ) then
    raise exception 'GSTINs under the same PAN must share the same registration type (regular or Composition Scheme). One PAN cannot straddle both.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurant_gst_config_shared_identity on public.restaurant_gst_config;
create trigger restaurant_gst_config_shared_identity
  before insert or update on public.restaurant_gst_config
  for each row execute function public.restaurant_gst_config_shared_identity();

-- ============================================================ issue function

drop function if exists public.issue_closed_session_receipt(uuid);
create or replace function public.issue_closed_session_receipt(
  p_order_session_id uuid,
  p_recipient jsonb default null
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
  v_gst public.restaurant_gst_config%rowtype;
  v_gst_doc_type text := 'receipt';
  v_rate_bps integer := 0;
  v_taxable bigint;
  v_cgst bigint := 0;
  v_sgst bigint := 0;
  v_igst bigint := 0;
  v_profile_notification text;
  v_gst_snapshot jsonb;
  v_irp_status text := 'not_required';
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
  v_paid bigint;
  v_table_label text;
  v_item_count integer;
  v_r_name text;
  v_r_gstin text;
  v_r_state text;
  v_r_address text;
  v_r_email text;
  v_customer jsonb;
  v_alcoholic boolean;
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

  -- GST document selection. mode='off' (or no row) keeps the historical
  -- non-GST receipt byte-for-byte. GST modes fail closed when the
  -- configuration is incomplete: never issue a half-configured document.
  select c.* into v_gst
    from public.restaurant_gst_config c
   where c.restaurant_id = v_session.restaurant_id;

  if v_gst.mode = 'regular' then
    if nullif(btrim(coalesce(v_gst.legal_name, '')), '') is null
       or nullif(btrim(coalesce(v_gst.address, '')), '') is null
       or v_gst.gstin is null
       or v_gst.state_code is null
       or v_gst.regular_profile is null
       or v_gst.registration_type <> 'regular' then
      raise exception 'Complete the GST settings before issuing a GST tax invoice: GSTIN, legal name, registered address, state code and the 5%% or 18%% profile.'
        using errcode = 'P0001';
    end if;
    v_gst_doc_type := 'gst_tax_invoice';
  elsif v_gst.mode = 'composition' then
    if nullif(btrim(coalesce(v_gst.legal_name, '')), '') is null
       or nullif(btrim(coalesce(v_gst.address, '')), '') is null
       or v_gst.gstin is null
       or v_gst.state_code is null
       or v_gst.registration_type <> 'composition'
       or not v_gst.composition_acknowledged then
      raise exception 'Complete the composition settings before issuing a Bill of Supply: GSTIN (registration type composition), legal name, registered address, state code and the ineligibility acknowledgment.'
        using errcode = 'P0001';
    end if;
    v_gst_doc_type := 'bill_of_supply';
  else
    if nullif(btrim(v_restaurant.name), '') is null
       or nullif(btrim(v_restaurant.address), '') is null then
      raise exception 'Add the restaurant name and address in Settings before issuing a receipt.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Alcoholic lines can never ride a GST document. Restaurant-service GST
  -- does not tax alcohol; a Bill of Supply / tax invoice over alcohol lines
  -- would misstate the law. 'off' mode is unaffected.
  select exists (
    select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.items i on i.id = oi.item_id
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and i.is_alcoholic
  ) into v_alcoholic;
  if coalesce(v_gst.mode, 'off') <> 'off' and v_alcoholic then
    raise exception 'This bill contains alcoholic items, which GST cannot tax. Remove or void the alcohol lines (they can be billed outside this GST document) before issuing it.'
      using errcode = 'P0001';
  end if;

  -- B2B recipient capture (Regular GST only). Composition and normal
  -- receipts cannot carry a buyer GSTIN: fail closed rather than half-do it.
  if p_recipient is not null then
    if v_gst_doc_type <> 'gst_tax_invoice' then
      raise exception 'A buyer GSTIN can only be recorded on a GST tax invoice in Regular GST mode. Switch the billing mode to Regular GST, or remove the buyer details.'
        using errcode = 'P0001';
    end if;
    v_r_name := nullif(btrim(coalesce(p_recipient->>'name', '')), '');
    v_r_gstin := upper(nullif(btrim(coalesce(p_recipient->>'gstin', '')), ''));
    v_r_address := nullif(btrim(coalesce(p_recipient->>'address', '')), '');
    v_r_email := lower(nullif(btrim(coalesce(p_recipient->>'email', '')), ''));
    if v_r_name is null or char_length(v_r_name) < 2 then
      raise exception 'Enter the buyer legal name for the GST invoice.'
        using errcode = 'P0001';
    end if;
    if v_r_gstin is null then
      raise exception 'Enter the buyer GSTIN.'
        using errcode = 'P0001';
    end if;
    if v_r_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
      raise exception 'The buyer GSTIN does not match the 2-digit state + PAN + entity + Z + checksum layout. It is not accepted.'
        using errcode = 'P0001';
    end if;
    v_r_state := substr(v_r_gstin, 1, 2);
    if v_r_state::integer < 1 or v_r_state::integer > 38 then
      raise exception 'The buyer GSTIN state code is not one of the GST states.'
        using errcode = 'P0001';
    end if;
    if v_r_address is not null and char_length(v_r_address) < 5 then
      raise exception 'The buyer billing address must be at least 5 characters, or omitted.'
        using errcode = 'P0001';
    end if;
    if v_r_email is not null and v_r_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
      raise exception 'The buyer email address does not look usable.'
        using errcode = 'P0001';
    end if;
    v_customer := jsonb_build_object(
      'name', v_r_name,
      'gstin', v_r_gstin,
      'state_code', v_r_state,
      'pan', substr(v_r_gstin, 3, 10),
      'address', v_r_address,
      'email', v_r_email
    );
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

  -- A document cannot span two pricing configurations. Tickets priced under a
  -- different mode than the one now configured are refused, loudly.
  if coalesce(v_gst.mode, 'off') <> 'off' and exists (
    select 1 from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and coalesce(o.gst_mode_snapshot, 'off') <> v_gst.mode
  ) then
    raise exception 'This sitting contains tickets priced under a different GST configuration. Close them out, or switch the GST mode back, before issuing a document.'
      using errcode = 'P0001';
  end if;
  if v_gst.mode = 'composition' and exists (
    select 1 from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
       and o.tax_paise > 0
  ) then
    raise exception 'This sitting includes tickets that collected tax; a Bill of Supply cannot be issued over them. Void those tickets or switch to Regular GST first.'
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

  -- GST decomposition of the document. Sums come from the order snapshots,
  -- never from re-reading the menu. CGST takes the odd paisa when the tax is
  -- odd (same rule as splitInHalf in lib/money.ts).
  if v_gst_doc_type = 'gst_tax_invoice' then
    -- The document's rate is the effective profile rate from the
    -- configuration snapshot taken at issue time, never the legacy
    -- restaurants.tax_rate_bps that un-snapshotted historical orders carry.
    v_rate_bps := case v_gst.regular_profile when 'specified_premises' then 1800 else 500 end;
    v_taxable := greatest(v_subtotal - v_discount, 0) - v_tax;
    v_cgst := round(v_tax::numeric / 2)::bigint;
    v_sgst := v_tax - v_cgst;
    v_profile_notification := case v_gst.regular_profile
      when 'specified_premises' then 'Notification No. 05/2025-CT(Rate), w.e.f. 2025-04-01'
      else 'Notification No. 11/2017-CT(Rate), Sl. 7(i), as amended' end;
    -- e-Invoice applicability is decided at issue time from the recorded
    -- preceding-FY AATO (Notification No. 10/2023-CT, as amended; threshold
    -- ₹5 crore). B2C documents are never e-invoice applicable. A B2B
    -- document whose applicability cannot be ruled out is issued as
    -- irp_status='pending' and must never be rendered as a final tax
    -- invoice until a validated IRN exists. No IRP is called in this build.
    v_irp_status := 'not_required';
    if v_r_gstin is not null then
      if v_gst.preceding_fy_turnover_paise is null
         or v_gst.preceding_fy_turnover_paise > 5000000000 then
        v_irp_status := 'pending';
      end if;
    end if;
  elsif v_gst_doc_type = 'bill_of_supply' then
    v_taxable := greatest(v_subtotal - v_discount, 0) - v_tax;
  else
    v_taxable := null;
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
  if v_gst_doc_type = 'receipt' then
    v_seller := jsonb_build_object(
      'restaurant_id', v_restaurant.id,
      'name', btrim(v_restaurant.name),
      'address', btrim(v_restaurant.address),
      'phone', nullif(btrim(v_restaurant.phone), ''),
      'logo_path', nullif(btrim(v_restaurant.logo_path), '')
    );
  else
    v_seller := jsonb_build_object(
      'restaurant_id', v_restaurant.id,
      'name', btrim(v_gst.legal_name),
      'legal_name', btrim(v_gst.legal_name),
      'trade_name', nullif(btrim(coalesce(v_gst.trade_name, '')), ''),
      'address', btrim(v_gst.address),
      'phone', nullif(btrim(v_restaurant.phone), ''),
      'logo_path', nullif(btrim(v_restaurant.logo_path), ''),
      'gstin', v_gst.gstin,
      'pan', nullif(btrim(coalesce(v_gst.pan, '')), ''),
      'state_code', v_gst.state_code,
      'registration_type', v_gst.registration_type
    );
  end if;
  if v_gst_doc_type = 'gst_tax_invoice' or v_gst_doc_type = 'bill_of_supply' then
    v_gst_snapshot := jsonb_build_object(
      'mode', v_gst.mode,
      'regular_profile', v_gst.regular_profile,
      'profile_notification', v_profile_notification,
      'rate_bps', v_rate_bps,
      'cgst_bps', case when v_gst_doc_type = 'gst_tax_invoice' then v_rate_bps / 2 else 0 end,
      'sgst_bps', case when v_gst_doc_type = 'gst_tax_invoice' then v_rate_bps / 2 else 0 end,
      'taxable_paise', v_taxable,
      'cgst_paise', v_cgst,
      'sgst_paise', v_sgst,
      'igst_paise', v_igst,
      'place_of_supply_state_code', v_gst.state_code,
      'inter_state', false,
      'recipient_supplied', (v_r_gstin is not null),
      'config_version', v_gst.config_version,
      'notice', case when v_gst_doc_type = 'bill_of_supply'
        then 'Composition taxable person, not eligible to collect tax on supplies.'
        else null end
    );
  end if;

  v_totals := jsonb_build_object(
    'subtotal_paise', v_subtotal,
    'ticket_discount_paise', v_discount,
    'bill_discount_paise', 0,
    'taxable_paise', v_taxable,
    'tax_paise', case when v_gst_doc_type = 'bill_of_supply' then 0 else v_tax end,
    'cgst_paise', v_cgst,
    'sgst_paise', v_sgst,
    'igst_paise', v_igst,
    'tax_rate_bps', v_rate_bps,
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
    source_order_ids, supersedes_invoice_id,
    gst_snapshot, irp_status,
    recipient_name, recipient_gstin, recipient_state_code,
    recipient_address, recipient_email
  ) values (
    v_session.restaurant_id, v_session.id, v_invoice_number, v_fy,
    v_sequence, v_gst_doc_type, v_issued_at, v_actor,
    v_table_label, v_session.opened_at, v_session.closed_at,
    v_seller, v_customer, v_totals, v_payments,
    v_order_ids, v_previous.id,
    v_gst_snapshot, v_irp_status,
    v_r_name, v_r_gstin, v_r_state,
    v_r_address, v_r_email
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

comment on function public.issue_closed_session_receipt(uuid, jsonb) is
  'Issues or returns the single immutable document for a closed table session: a non-GST receipt (GST mode off), a Bill of Supply (composition), or a GST tax invoice (regular). Optional p_recipient captures the buyer legal name, GSTIN (app-checksum-verified; format/state/PAN cross-checked in the database) and optional address/email on Regular-GST documents only. e-Invoice applicability is set at issue time from the recorded preceding-FY AATO; a B2B document whose applicability cannot be ruled out is issued irp_status=pending and must never be rendered as final until a validated IRN exists. No IRP provider is configured or called. Alcoholic lines block any GST document. Decomposition is snapshotted at issue time; documents are immutable and voided only through void_restaurant_invoice.';

revoke all on function public.issue_closed_session_receipt(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.issue_closed_session_receipt(uuid, jsonb) to authenticated;

-- ============================================ close wrapper with passthrough

drop function if exists public.close_order_session_and_issue_receipt(uuid);

create or replace function public.close_order_session_and_issue_receipt(
  p_order_session_id uuid,
  p_recipient jsonb default null
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
  v_outstanding_paise bigint := 0;
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

    select coalesce(sum(greatest(o.total_paise - coalesce(p.recorded_paise, 0), 0)), 0)::bigint
      into v_outstanding_paise
      from public.orders o
      left join lateral (
        select coalesce(sum(pay.amount_paise), 0)::bigint as recorded_paise
          from public.payments pay
         where pay.order_id = o.id
           and pay.restaurant_id = v_session.restaurant_id
           and pay.status = 'recorded'
      ) p on true
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled';

    if v_outstanding_paise > 0 then
      raise exception 'Collect the full outstanding balance before closing this table session.'
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
  elsif not exists (
    select 1 from public.restaurant_invoices i
     where i.order_session_id = v_session.id and i.status = 'issued'
  ) then
    -- Defensive handling for a closed row with no issued receipt. This is not
    -- the normal path: the supported close RPC commits both or neither.
    select coalesce(sum(greatest(o.total_paise - coalesce(p.recorded_paise, 0), 0)), 0)::bigint
      into v_outstanding_paise
      from public.orders o
      left join lateral (
        select coalesce(sum(pay.amount_paise), 0)::bigint as recorded_paise
          from public.payments pay
         where pay.order_id = o.id
           and pay.restaurant_id = v_session.restaurant_id
           and pay.status = 'recorded'
      ) p on true
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled';
    if v_outstanding_paise > 0 then
      raise exception 'Collect the full outstanding balance before issuing this session receipt.'
        using errcode = 'P0001';
    end if;
  end if;

  v_invoice_id := public.issue_closed_session_receipt(v_session.id, p_recipient);
  return v_invoice_id;
end;
$$;

comment on function public.close_order_session_and_issue_receipt(uuid, jsonb) is
  'Atomically closes only a fully settled table session and creates/returns its final document (receipt, Bill of Supply or GST tax invoice). Optional p_recipient passes B2B buyer details through to issue_closed_session_receipt. An unpaid or partially paid session remains open. Replays of an already-issued receipt are idempotent.';

revoke all on function public.close_order_session_and_issue_receipt(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.close_order_session_and_issue_receipt(uuid, jsonb) to authenticated;

-- ====================== readiness probe follows the new signature

create or replace function public.operational_schema_readiness()
returns jsonb language sql stable security definer set search_path = pg_catalog, public
as $$
 select jsonb_object_agg(probe, present and coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false))
 from (
  select v.probe,v.signature,exists(select 1 from pg_attribute a where a.attrelid=to_regclass(v.relation) and a.attname=v.column_name and not a.attisdropped) present
  from (values
   ('orderSessions','public.orders','order_session_id','public.place_public_order_attempt(text,jsonb,text,text,uuid,text)'),
   ('settlement','public.order_sessions','paid_at','public.mark_order_session_paid(uuid)'),
   ('invoices','public.restaurant_invoices','invoice_number','public.close_order_session_and_issue_receipt(uuid,jsonb)'),
   ('paymentReceipts','public.restaurant_payment_receipts','snapshot','public.close_order_session_and_issue_receipt(uuid,jsonb)'),
   ('announcementClaims','public.kitchen_announcement_claims','order_id','public.claim_kitchen_order_announcement(uuid)')
  ) v(probe,relation,column_name,signature)
 ) checks
$$;

revoke all on function public.operational_schema_readiness() from public,anon,authenticated;
grant execute on function public.operational_schema_readiness() to service_role;

-- =============================== read_shared_restaurant_invoice (recipient)
create or replace function public.read_shared_restaurant_invoice(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.restaurant_invoice_share_links%rowtype;
  v_invoice public.restaurant_invoices%rowtype;
  v_lines jsonb;
  v_timezone text;
  v_allowed boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  select h.allowed into v_allowed
    from public.hit_rate_limit('receipt-share:view:' || substr(p_token_hash, 1, 32), 60, 60) h;
  if not coalesce(v_allowed, false) then return null; end if;

  select l.* into v_link
    from public.restaurant_invoice_share_links l
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > statement_timestamp()
   for update;
  if not found then return null; end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = v_link.invoice_id
     and i.restaurant_id = v_link.restaurant_id
     and i.status = 'issued';
  if not found then return null; end if;

  select coalesce(nullif(r.timezone, ''), 'Asia/Kolkata') into v_timezone
    from public.restaurants r where r.id = v_invoice.restaurant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', il.id,
    'line_snapshot', il.line_snapshot
  ) order by il.line_number), '[]'::jsonb)
    into v_lines
    from public.restaurant_invoice_lines il
   where il.invoice_id = v_invoice.id
     and il.restaurant_id = v_invoice.restaurant_id;

  update public.restaurant_invoice_share_links
     set last_accessed_at = statement_timestamp(), access_count = access_count + 1
   where id = v_link.id;
  insert into public.restaurant_invoice_share_audit (
    restaurant_id, invoice_id, share_link_id, actor_id, event_type
  ) values (v_link.restaurant_id, v_invoice.id, v_link.id, auth.uid(), 'opened');

  return jsonb_build_object(
    'timezone', v_timezone,
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'financial_year', v_invoice.financial_year,
      'document_type', v_invoice.document_type,
      'status', v_invoice.status,
      'issued_at', v_invoice.issued_at,
      'table_label_snapshot', v_invoice.table_label_snapshot,
      'order_session_id', v_invoice.order_session_id,
      'session_opened_at', v_invoice.session_opened_at,
      'session_closed_at', v_invoice.session_closed_at,
      'seller_snapshot', v_invoice.seller_snapshot,
      'totals_snapshot', v_invoice.totals_snapshot,
      'payment_snapshot', v_invoice.payment_snapshot,
      'gst_snapshot', v_invoice.gst_snapshot,
      'customer_snapshot', v_invoice.customer_snapshot,
      'recipient_name', v_invoice.recipient_name,
      'recipient_gstin', v_invoice.recipient_gstin,
      'recipient_state_code', v_invoice.recipient_state_code,
      'recipient_address', v_invoice.recipient_address,
      'recipient_email', v_invoice.recipient_email,
      'irn', v_invoice.irn,
      'irp_status', v_invoice.irp_status,
      'supersedes_invoice_id', v_invoice.supersedes_invoice_id,
      'void_reason', v_invoice.void_reason
    ),
    'lines', v_lines
  );
end;
$$;
