-- CA-approved issued documents and independent series. Do not rewrite old
-- invoice, line, payment, link or config rows. Historic INV numbers and the
-- existing INV counter are retained, including all voided numbers.
alter table public.restaurant_invoice_series
  add column series_code text not null default 'INV' check (series_code in ('INV','BOS','RBL'));
alter table public.restaurant_invoice_series drop constraint restaurant_invoice_series_pkey;
alter table public.restaurant_invoice_series add primary key (restaurant_id, financial_year, series_code);

alter table public.restaurant_invoices add column series_code text;
alter table public.restaurant_invoices drop constraint restaurant_invoices_sequence_unique;
alter table public.restaurant_invoices drop constraint restaurant_invoices_format_check;
create unique index restaurant_invoices_series_sequence_unique
  on public.restaurant_invoices (restaurant_id, financial_year, (coalesce(series_code, 'INV')), sequence_number);
alter table public.restaurant_invoices add constraint restaurant_invoices_format_check check (
  invoice_number ~ '^[A-Z0-9/-]{1,16}$'
  and invoice_number = coalesce(series_code, 'INV') || '/' || financial_year || '/' || lpad(sequence_number::text, 6, '0')
  and (series_code is null or series_code = case document_type
    when 'gst_tax_invoice' then 'INV' when 'bill_of_supply' then 'BOS' when 'receipt' then 'RBL' end)
);

comment on table public.restaurant_invoice_series is
  'Private row-locked counters per outlet, India financial year and document series. Voids and billing mode changes never reset a counter.';

comment on column public.restaurant_invoices.series_code is
  'Immutable approved document series; NULL means a legacy INV number. Number and sequence remain reserved after void.';

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
  v_series text;
  v_retail boolean := false;
  v_first_supply_date date;
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
  perform pg_advisory_xact_lock_shared(hashtextextended('gst-outlet:' || v_session.restaurant_id::text, 0));
  select c.* into v_gst from public.restaurant_gst_config c
   where c.restaurant_id = v_session.restaurant_id;
  v_gst.mode := coalesce(v_gst.mode, 'off');
  v_rate_bps := case when v_gst.mode = 'regular' then public.gst_profile_rate(v_gst.regular_profile) else 0 end;
  v_retail := v_gst.mode = 'off' and v_gst.fssai_number is not null;
  if v_gst.mode = 'regular' then
    v_gst_doc_type := 'gst_tax_invoice';
  elsif v_gst.mode = 'composition' then
    v_gst_doc_type := 'bill_of_supply';
  elsif not v_retail and (nullif(btrim(v_restaurant.name), '') is null or nullif(btrim(v_restaurant.address), '') is null) then
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
         array_agg(o.id order by o.placed_at, o.id),
         min((o.placed_at at time zone 'Asia/Kolkata')::date)
    into v_order_count, v_subtotal, v_discount, v_ticket_tax, v_total, v_order_ids, v_first_supply_date
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
      or ((v_gst.mode <> 'off' or v_retail) and (o.gst_config_version, o.tax_rate_bps_snapshot)
          is distinct from (v_gst.config_version, v_rate_bps)))
  ) then
    raise exception 'This sitting contains tickets priced under a different GST configuration. Do not reprice or collect again; ask the owner to review it.' using errcode = 'P0001';
  end if;

  if v_retail and (v_gst.retail_phone is null or v_gst.legal_name is null or v_gst.address is null or v_ticket_tax <> 0) then
    raise exception 'The saved retail billing identity or zero-tax ticket amounts are incomplete. Ask the owner to review.' using errcode = 'P0001';
  end if;

  if v_gst.mode <> 'off' then
    if exists (
      select 1 from public.order_items oi where oi.order_id = any(v_order_ids) and oi.is_alcoholic_snapshot is distinct from false
    ) then
      raise exception 'This sitting contains alcoholic or unclassified historical lines. Ask the owner to review it before issuing a GST document.' using errcode = 'P0001';
    end if;
    -- Validate the reviewed profile as of supply, not a later print/issue
    -- date. An already-placed ticket can cross the FY boundary at checkout.
    perform public.gst_pricing_at(v_session.restaurant_id, v_first_supply_date);
    if exists (
      select 1 from public.orders o
      left join lateral (
        select sum(oi.qty * oi.unit_price_paise) as gross from public.order_items oi where oi.order_id = o.id
      ) lines on true
      where o.id = any(v_order_ids)
        and (o.total_paise is distinct from lines.gross or o.subtotal_paise <> o.total_paise
          or o.tax_paise <> o.total_paise - public.gst_inclusive_taxable(o.total_paise, v_rate_bps)
          or (v_rate_bps = 1800 and (
            (o.placed_at at time zone 'Asia/Kolkata')::date < v_gst.specified_premises_effective_from
            or public.gst_financial_year_start((o.placed_at at time zone 'Asia/Kolkata')::date)
               <> public.gst_financial_year_start(v_first_supply_date))))
    ) then
      raise exception 'Ticket amounts or supply dates do not match the saved GST profile. Ask the owner to review the sitting.' using errcode = 'P0001';
    end if;
  end if;

  -- A direct GST issue/re-issue cannot bypass settlement. Keep the legacy
  -- off-mode path for already-closed, unpaid receipts and supplemental
  -- payments; the supported atomic close still checks every ticket in all
  -- modes. A surplus on one ticket cannot fund another.
  if (v_gst.mode <> 'off' or v_retail) and exists (
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

  -- India financial year at the date of issue. Series do not change on
  -- mode saves. The existing INV counter continues for this outlet/FY.
  v_local_date := (v_issued_at at time zone 'Asia/Kolkata')::date;
  v_fy_start := public.gst_financial_year_start(v_local_date);
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');
  v_series := case when v_gst_doc_type = 'bill_of_supply' then 'BOS' when v_retail then 'RBL' else 'INV' end;

  insert into public.restaurant_invoice_series as s (restaurant_id, financial_year, series_code, next_number)
  values (v_session.restaurant_id, v_fy, v_series, 2)
  on conflict (restaurant_id, financial_year, series_code) do update
    set next_number = s.next_number + 1 where s.next_number < 1000000
  returning next_number - 1 into v_sequence;
  if not found then
    raise exception 'This document series has reached its six-digit limit for the financial year.' using errcode = '22003';
  end if;

  v_invoice_number := v_series || '/' || v_fy || '/' || lpad(v_sequence::text, 6, '0');
  if v_gst_doc_type = 'receipt' then
    v_seller := jsonb_build_object(
      'restaurant_id', v_restaurant.id,
      'name', case when v_retail then v_gst.legal_name else btrim(v_restaurant.name) end,
      'address', case when v_retail then v_gst.address else btrim(v_restaurant.address) end,
      'phone', case when v_retail then v_gst.retail_phone else nullif(btrim(v_restaurant.phone), '') end,
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
  if v_gst.fssai_number is not null then
    v_seller := v_seller || jsonb_build_object('fssai_number', v_gst.fssai_number);
  end if;
  if v_gst_doc_type = 'gst_tax_invoice' or v_gst_doc_type = 'bill_of_supply' then
    v_gst_snapshot := jsonb_build_object(
      'mode', v_gst.mode,
      'regular_profile', v_gst.regular_profile,
      'service_sac', v_gst.service_sac,
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
        then 'Composition taxable person, not eligible to collect tax on supplies'
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
    sequence_number, series_code, document_type, issued_at, issued_by,
    table_label_snapshot, session_opened_at, session_closed_at,
    seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot,
    source_order_ids, supersedes_invoice_id,
    gst_snapshot, irp_status,
    recipient_name, recipient_gstin, recipient_state_code,
    recipient_address, recipient_email
  ) values (
    v_session.restaurant_id, v_session.id, v_invoice_number, v_fy,
    v_sequence, case when v_gst.fssai_number is not null then v_series end, v_gst_doc_type, v_issued_at, v_actor,
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

-- Preserve the established report endpoint and ACL. The added fields keep
-- legacy INV history distinct and expose FY/series without seller/buyer data.
drop function public.report_gst_documents(uuid, timestamptz, timestamptz);
create or replace function public.report_gst_documents(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns table (
  document_type text, document_status text, rate_bps integer, irn_held boolean,
  document_count integer, total_paise bigint, taxable_paise bigint,
  cgst_paise bigint, sgst_paise bigint, igst_paise bigint,
  rounding_delta_paise bigint, missing_rounding_count integer,
  financial_year text, series_code text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Owner or Manager permission is required to read GST reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
     or p_from >= p_to then
    raise exception 'Choose a valid GST report range of at most 400 days.' using errcode = '22023';
  end if;
  if p_to - p_from > interval '400 days' then
    raise exception 'Choose a valid GST report range of at most 400 days.' using errcode = '22023';
  end if;

  return query
  with documents as (
    select case when i.series_code = 'RBL' then 'retail_bill' else i.document_type end as kind,
           i.status as status, (i.gst_snapshot->>'rate_bps')::integer as rate,
           i.irp_status <> 'not_required' as held,
           (i.totals_snapshot->>'total_paise')::bigint as gross,
           (i.gst_snapshot->>'taxable_paise')::bigint as taxable,
           (i.gst_snapshot->>'cgst_paise')::bigint as cgst,
           (i.gst_snapshot->>'sgst_paise')::bigint as sgst,
           (i.gst_snapshot->>'igst_paise')::bigint as igst,
           (i.totals_snapshot->>'gst_rounding_delta_paise')::bigint as delta,
           i.financial_year as fy, i.series_code as series
      from public.restaurant_invoices i
     where i.restaurant_id = p_restaurant_id and i.issued_at >= p_from and i.issued_at < p_to
       and (i.document_type in ('gst_tax_invoice', 'bill_of_supply') or i.series_code = 'RBL')
    union all
    select n.document_type, n.status, (n.gst_snapshot->>'rate_bps')::integer,
           n.irp_status <> 'not_required', n.total_paise, n.taxable_paise,
           n.cgst_paise, n.sgst_paise, n.igst_paise, null::bigint, n.financial_year,
           case n.document_type when 'credit_note' then 'CN' else 'DN' end
      from public.restaurant_notes n
     where n.restaurant_id = p_restaurant_id and n.issued_at >= p_from and n.issued_at < p_to
  )
  select d.kind, d.status, d.rate, d.held,
         count(*)::integer, sum(d.gross)::bigint, sum(d.taxable)::bigint,
         sum(d.cgst)::bigint, sum(d.sgst)::bigint, sum(d.igst)::bigint,
         sum(d.delta)::bigint,
         (count(*) filter (where d.kind = 'gst_tax_invoice' and d.delta is null))::integer,
         d.fy, d.series
    from documents d
    group by d.kind, d.status, d.rate, d.held, d.fy, d.series
    order by d.kind, d.status, d.rate, d.held, d.fy, d.series;
end;
$$;

comment on function public.report_gst_documents(uuid, timestamptz, timestamptz) is
  'Owner/Manager only. Immutable amounts grouped by issue financial year, series, type, rate, issued/voided status and IRN hold. Includes reviewed retail bills; legacy plain receipts stay in invoice history. No cash, no netting notes, no recalculation of historical GST; missing rounding history stays missing.';

revoke all on function public.report_gst_documents(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.report_gst_documents(uuid, timestamptz, timestamptz) to authenticated;
