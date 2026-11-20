-- Final GST documents use the ticket configuration and round once at the
-- document level. Replace the body in place, leaving existing (even voided)
-- documents, source tickets, series and payments exactly as they were.

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
  v_pricing record;
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
  v_ticket_tax bigint;
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

  select r.* into v_restaurant
    from public.restaurants r
   where r.id = v_session.restaurant_id and r.is_active;
  if not found then
    raise exception 'Restaurant is not active.' using errcode = 'P0001';
  end if;

  -- The locked sitting still appears open to concurrent config writers
  -- until close AND issue commit. Read one committed profile, never
  -- relabel a historical ticket under a different mode/version/rate.
  select c.* into v_gst from public.restaurant_gst_config c
   where c.restaurant_id = v_session.restaurant_id;
  v_gst.mode := coalesce(v_gst.mode, 'off');
  select * into v_pricing from public.gst_pricing(v_session.restaurant_id);
  v_rate_bps := coalesce(v_pricing.rate_bps, 0);
  if v_gst.mode is distinct from v_pricing.mode
     or (v_gst.mode <> 'off' and v_gst.config_version is distinct from v_pricing.config_version) then
    raise exception 'Billing settings changed during checkout. Check the sitting and retry.' using errcode = 'P0001';
  end if;
  if v_gst.mode = 'regular' then
    v_gst_doc_type := 'gst_tax_invoice';
  elsif v_gst.mode = 'composition' then
    v_gst_doc_type := 'bill_of_supply';
  elsif nullif(btrim(v_restaurant.name), '') is null or nullif(btrim(v_restaurant.address), '') is null then
    raise exception 'Add the restaurant name and address in Settings before issuing a receipt.' using errcode = 'P0001';
  end if;

  -- B2B recipient capture (Regular GST only). Composition and normal
  -- receipts cannot carry a buyer GSTIN: fail closed rather than half-do it.
  if p_recipient is not null then
    if v_gst_doc_type <> 'gst_tax_invoice' then
      raise exception 'A buyer GSTIN can only be recorded on a Regular GST tax invoice. Remove the buyer details to issue this document.'
        using errcode = 'P0001';
    end if;
    if jsonb_typeof(p_recipient) <> 'object' then
      raise exception 'Send a buyer details object or omit buyer details.' using errcode = '22023';
    end if;
    v_r_name := nullif(btrim(coalesce(p_recipient->>'name', '')), '');
    v_r_gstin := upper(nullif(btrim(coalesce(p_recipient->>'gstin', '')), ''));
    v_r_address := nullif(btrim(coalesce(p_recipient->>'address', '')), '');
    v_r_email := lower(nullif(btrim(coalesce(p_recipient->>'email', '')), ''));
    if v_r_name is null or char_length(v_r_name) not between 2 and 160 then
      raise exception 'Enter the buyer legal name for the GST invoice.'
        using errcode = 'P0001';
    end if;
    if v_r_gstin is null then
      raise exception 'Enter the buyer GSTIN.'
        using errcode = 'P0001';
    end if;
    if not public.gst_valid_gstin(v_r_gstin) then
      raise exception 'The buyer GSTIN format, state code or checksum is not valid.' using errcode = 'P0001';
    end if;
    v_r_state := substr(v_r_gstin, 1, 2);
    if v_r_address is not null and char_length(v_r_address) not between 5 and 300 then
      raise exception 'The buyer billing address must be 5–300 characters, or omitted.' using errcode = 'P0001';
    end if;
    if v_r_email is not null and (char_length(v_r_email) > 254 or v_r_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$') then
      raise exception 'The buyer email address does not look usable.' using errcode = 'P0001';
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
    into v_order_count, v_subtotal, v_discount, v_ticket_tax, v_total, v_order_ids
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

  if exists (
    select 1 from public.orders o where o.id = any(v_order_ids)
    and (coalesce(o.gst_mode_snapshot, 'off') <> v_gst.mode
      or (v_gst.mode <> 'off' and (o.gst_config_version, o.tax_rate_bps_snapshot)
          is distinct from (v_gst.config_version, v_rate_bps)))
  ) then
    raise exception 'This sitting contains tickets priced under a different GST configuration. Do not reprice or collect again; ask the owner to review it.' using errcode = 'P0001';
  end if;

  if v_gst.mode <> 'off' then
    if exists (
      select 1 from public.order_items oi where oi.order_id = any(v_order_ids) and oi.is_alcoholic_snapshot is distinct from false
    ) then
      raise exception 'This sitting contains alcoholic or unclassified historical lines. Ask the owner to review it before issuing a GST document.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.orders o
      left join lateral (
        select sum(oi.qty * oi.unit_price_paise) as gross from public.order_items oi where oi.order_id = o.id
      ) lines on true
      where o.id = any(v_order_ids)
        and (o.total_paise is distinct from lines.gross or o.subtotal_paise <> o.total_paise
          or o.tax_paise <> o.total_paise - public.gst_inclusive_taxable(o.total_paise, v_rate_bps)
          or (v_rate_bps = 1800 and (o.placed_at at time zone 'Asia/Kolkata')::date < v_gst.specified_premises_effective_from))
    ) then
      raise exception 'Ticket amounts or supply dates do not match the saved GST profile. Ask the owner to review the sitting.' using errcode = 'P0001';
    end if;
  end if;

  -- A direct GST issue/re-issue cannot bypass settlement. Keep the legacy
  -- off-mode path for already-closed, unpaid receipts and supplemental
  -- payments; the supported atomic close still checks every ticket in all
  -- modes. A surplus on one ticket cannot fund another.
  if v_gst.mode <> 'off' and exists (
    select 1 from public.orders o
    left join lateral (
      select coalesce(sum(p.amount_paise), 0) as recorded
        from public.payments p where p.order_id = o.id and p.restaurant_id = v_session.restaurant_id and p.status = 'recorded'
    ) paid on true
    where o.id = any(v_order_ids) and paid.recorded < o.total_paise
  ) then
    raise exception 'Collect the full outstanding balance before issuing this session receipt.' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_paise), 0)::bigint into v_paid
    from public.payments p
   where p.order_id = any(v_order_ids) and p.restaurant_id = v_session.restaurant_id and p.status = 'recorded';

  select count(*)::integer into v_item_count
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.order_session_id = v_session.id
     and o.restaurant_id = v_session.restaurant_id
     and o.prep_status <> 'cancelled';
  if v_item_count = 0 then
    raise exception 'Ticket item details are unavailable; a receipt cannot be issued.' using errcode = 'P0001';
  end if;

  -- The money due is the same combined menu gross as at settlement. Only
  -- the document's decomposition is rounded here; never sum rounded ticket
  -- tax as the tax on an invoice. The extra paisa (if any) goes to CGST.
  v_tax := v_ticket_tax;
  if v_gst_doc_type = 'gst_tax_invoice' then
    v_taxable := public.gst_inclusive_taxable(v_total, v_rate_bps);
    v_tax := v_total - v_taxable;
    v_cgst := v_tax / 2 + v_tax % 2;
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
    v_taxable := v_total;
    v_tax := 0;
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
      'specified_premises_effective_from', case when v_rate_bps = 1800 then v_gst.specified_premises_effective_from end,
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
    'tax_paise', v_tax,
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

  if v_gst_doc_type = 'gst_tax_invoice' then
    v_totals := v_totals || jsonb_build_object(
      'ticket_tax_paise', v_ticket_tax, 'gst_rounding_delta_paise', v_tax - v_ticket_tax
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'method', p.method,
           'amount_paise', p.amount_paise,
           'received_at', coalesce(p.recorded_at, p.created_at)
         ) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.payments p
   where p.order_id = any(v_order_ids) and p.restaurant_id = v_session.restaurant_id and p.status = 'recorded';

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
  'Issues or returns the immutable document for a closed sitting. GST mode, version and rate must match the saved tickets; tax is extracted once from gross. B2B details and checksum validation are Regular-only. When IRN applicability cannot be ruled out, the document stays pending.';

revoke all on function public.issue_closed_session_receipt(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.issue_closed_session_receipt(uuid, jsonb) to authenticated;

comment on column public.restaurant_invoices.recipient_gstin is
  'Buyer GSTIN, format/state/checksum checked before issue. Immutable; NULL means no B2B buyer supplied. Not a registration lookup.';

-- Both note issuance and invoice void lock the same source invoice row.
-- Prevent leaving an outstanding GST adjustment against a voided source.
create or replace function public.guard_gst_invoice_void()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'issued' and new.status = 'voided' and exists (
    select 1 from public.restaurant_notes n
     where n.restaurant_id = old.restaurant_id and n.invoice_id = old.id and n.status = 'issued'
  ) then
    raise exception 'Void the active credit/debit notes before voiding their source document.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_gst_invoice_void() from public, anon, authenticated, service_role;
create trigger restaurant_invoices_guard_gst_void
  before update of status on public.restaurant_invoices
  for each row execute function public.guard_gst_invoice_void();

drop policy restaurant_notes_staff_read on public.restaurant_notes;
create policy restaurant_notes_finance_read on public.restaurant_notes
  for select to authenticated using (public.has_restaurant_role(restaurant_id, array['owner','manager']));
drop policy restaurant_note_events_staff_read on public.restaurant_note_events;
create policy restaurant_note_events_finance_read on public.restaurant_note_events
  for select to authenticated using (public.has_restaurant_role(restaurant_id, array['owner','manager']));

-- Same read roles as the existing reconciliation and attempt RPCs. No change
-- to IRP applicability, provider wiring, or permission to generate an IRN.
drop policy restaurant_irp_requests_staff_read on public.restaurant_irp_requests;
create policy restaurant_irp_requests_finance_read on public.restaurant_irp_requests
  for select to authenticated using (public.has_restaurant_role(restaurant_id, array['owner','manager']));

-- Enforce the output hold for new links and already-minted tokens.
-- Preserve expiry, revocation, tenant, token-digest, throttling and audit checks.
create or replace function public.create_restaurant_invoice_share_link(p_invoice_id uuid, p_token_hash text)
returns table (share_link_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_invoice public.restaurant_invoices%rowtype;
  v_link_id uuid;
  v_expiry timestamptz := statement_timestamp() + interval '24 hours';
begin
  if v_actor is null then
    raise exception 'Sign in to create a receipt link.' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid receipt-link token.' using errcode = '22023';
  end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = p_invoice_id
   for share;
  if not found then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_invoice.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to share this receipt.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_invoice.restaurant_id) then
    raise exception 'This restaurant is read-only. Restore access before creating a share link.' using errcode = 'P0001';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'Only an issued receipt can be shared.' using errcode = 'P0001';
  end if;
  if v_invoice.document_type = 'gst_tax_invoice' and v_invoice.irp_status <> 'not_required' then
    raise exception 'This document is on IRN hold and cannot be shared as a receipt.' using errcode = 'P0001';
  end if;

  insert into public.restaurant_invoice_share_links (
    restaurant_id, invoice_id, token_hash, created_by, expires_at
  ) values (
    v_invoice.restaurant_id, v_invoice.id, p_token_hash, v_actor, v_expiry
  ) returning id into v_link_id;

  insert into public.restaurant_invoice_share_audit (
    restaurant_id, invoice_id, share_link_id, actor_id, event_type
  ) values (v_invoice.restaurant_id, v_invoice.id, v_link_id, v_actor, 'created');

  return query select v_link_id, v_expiry;
end;
$$;

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
     and i.status = 'issued'
     -- No validated IRN path exists in this release. Old links to held
     -- documents must not expose the buyer/seller snapshot either.
     and (i.document_type <> 'gst_tax_invoice' or i.irp_status = 'not_required')
   for share;
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

revoke all on function public.create_restaurant_invoice_share_link(uuid, text),
  public.read_shared_restaurant_invoice(text) from public, anon, authenticated, service_role;
grant execute on function public.create_restaurant_invoice_share_link(uuid, text) to authenticated;
grant execute on function public.read_shared_restaurant_invoice(text) to anon, authenticated;
