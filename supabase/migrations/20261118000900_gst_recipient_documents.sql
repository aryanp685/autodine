-- Reusable outlet-local buyer records. Editing a profile does not update any
-- issued document. ACLs/RLS do not grant raw table writes to an API role.
create table public.restaurant_gst_buyers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  gstin text not null,
  revision integer not null default 1 check (revision > 0),
  details jsonb not null,
  changed_at timestamptz not null default statement_timestamp(),
  changed_by uuid not null,
  unique (restaurant_id, gstin)
);
alter table public.restaurant_gst_buyers enable row level security;
revoke all on public.restaurant_gst_buyers from public, anon, authenticated, service_role;
grant select on public.restaurant_gst_buyers to authenticated;
create policy restaurant_gst_buyers_finance_read on public.restaurant_gst_buyers for select to authenticated
  using (public.has_restaurant_role(restaurant_id,array['owner','manager','cashier']));

create table public.restaurant_gst_buyer_history (
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  buyer_id uuid not null references public.restaurant_gst_buyers(id) on delete restrict,
  revision integer not null,
  details jsonb not null,
  changed_at timestamptz not null,
  changed_by uuid not null,
  primary key (buyer_id,revision)
);
alter table public.restaurant_gst_buyer_history enable row level security;
revoke all on public.restaurant_gst_buyer_history from public, anon, authenticated, service_role;
grant select on public.restaurant_gst_buyer_history to authenticated;
create policy restaurant_gst_buyer_history_finance_read on public.restaurant_gst_buyer_history for select to authenticated
  using (public.has_restaurant_role(restaurant_id,array['owner','manager']));

create or replace function public.gst_normalize_buyer(p_data jsonb)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_name text := btrim(p_data->>'name');
  v_gstin text := upper(btrim(p_data->>'gstin'));
  v_address text := btrim(p_data->>'address');
  v_state text := p_data->>'state_code';
  v_email text := lower(nullif(btrim(p_data->>'email'),''));
  v_phone text := nullif(btrim(p_data->>'phone'),'');
  v_city text := btrim(p_data->>'location');
  v_pin text := p_data->>'pincode';
begin
  if jsonb_typeof(p_data) is distinct from 'object' or not public.gst_valid_gstin(v_gstin)
     or v_gstin is null then
    raise exception 'Enter a buyer GSTIN with a valid format, state code and checksum.' using errcode = '23514';
  end if;
  if coalesce(v_state,left(v_gstin,2)) is distinct from left(v_gstin,2) then
    raise exception 'The buyer state does not match the recipient GSTIN.' using errcode = '23514';
  end if;
  if coalesce(p_data->>'recipient_type','registered') <> 'registered' then
    raise exception 'Only ordinary domestic registered buyers can use the B2B invoice workflow.' using errcode = '23514';
  end if;
  if coalesce(length(v_name),0) not between 2 and 160
     or coalesce(length(v_address),0) not between 5 and 300
     or coalesce(length(v_city),0) not between 2 and 50
     or coalesce(v_pin,'') !~ '^[1-9][0-9]{5}$' then
    raise exception 'Enter the buyer legal name, billing address, city and six-digit PIN.' using errcode = '23514';
  end if;
  if (v_email is not null and (length(v_email) > 100 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'))
     or (v_phone is not null and v_phone !~ '^[+0-9][0-9 ()+.-]{5,23}$') then
    raise exception 'The buyer contact information is not usable.' using errcode = '23514';
  end if;
  return jsonb_build_object('name',v_name,'gstin',v_gstin,'state_code',left(v_gstin,2),
    'address',v_address,'location',v_city,'pincode',v_pin,'email',v_email,'phone',v_phone,
    'recipient_type','registered');
end;
$$;

create or replace function public.save_restaurant_gst_buyer(p_outlet uuid, p_expected_revision integer, p_details jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_details jsonb;
  v_buyer public.restaurant_gst_buyers%rowtype;
begin
  perform 1 from public.memberships m where m.restaurant_id = p_outlet and m.user_id = auth.uid() and m.role = 'owner' for share;
  if not found then raise exception 'Only the outlet owner can edit saved buyers.' using errcode = '42501'; end if;
  if not public.restaurant_can_write(p_outlet) then raise exception 'This outlet is read-only.' using errcode = 'P0001'; end if;
  v_details := public.gst_normalize_buyer(p_details);
  if p_expected_revision = 0 then
    insert into public.restaurant_gst_buyers (restaurant_id,gstin,details,changed_by)
    values(p_outlet,v_details->>'gstin',v_details,auth.uid())
    on conflict (restaurant_id,gstin) do nothing returning * into v_buyer;
  else
    update public.restaurant_gst_buyers set details = v_details, revision = revision + 1,
      changed_by = auth.uid(), changed_at = statement_timestamp()
    where restaurant_id = p_outlet and gstin = v_details->>'gstin' and revision = p_expected_revision
    returning * into v_buyer;
  end if;
  if not found then raise exception 'This buyer already exists or changed. Reload the saved buyer before editing.' using errcode = 'P0001'; end if;
  insert into public.restaurant_gst_buyer_history (restaurant_id,buyer_id,revision,details,changed_at,changed_by)
    values(p_outlet,v_buyer.id,v_buyer.revision,v_buyer.details,v_buyer.changed_at,v_buyer.changed_by);
  return jsonb_build_object('id',v_buyer.id,'revision',v_buyer.revision,'details',v_buyer.details);
end;
$$;
revoke all on function public.gst_normalize_buyer(jsonb), public.save_restaurant_gst_buyer(uuid,integer,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_restaurant_gst_buyer(uuid,integer,jsonb) to authenticated;

-- Store the effective IRP decision, never use today's config to backfill an
-- old filed document. A known previous year above threshold is sufficient
-- to require IRN; a clearing decision needs attested, current-year coverage.
create or replace function public.gst_b2b_irp_facts(p_activation jsonb, p_previous bigint, p_date date)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_aato jsonb := p_activation->'aato';
  v_max bigint;
  v_reporting text := 'unknown';
  v_status text := 'unknown';
begin
  if p_date >= date '2023-08-01' and v_aato->'review_fy' = to_jsonb(public.gst_financial_year_start(p_date)) then
    v_max := (v_aato->>'highest_prior_fy_paise')::bigint;
    if v_max is not null and v_max >= coalesce(p_previous,0) then
      v_status := case when v_max > 5000000000 then 'required' else 'not_required' end;
      v_reporting := v_aato->>'reporting_category';
    end if;
  end if;
  if p_previous > 5000000000 and p_date >= date '2023-08-01' then v_status := 'required'; end if;
  return jsonb_build_object('rule_version','13-2020-amended-10-2023','applicability',v_status,
    'reporting_category',v_reporting,'highest_prior_fy_paise',v_max);
end;
$$;
revoke all on function public.gst_b2b_irp_facts(jsonb,bigint,date) from public, anon, authenticated, service_role;

-- Read-only aggregate of known same-PAN facts. Never return another outlet's
-- row. Historical explicit reviews cannot silently disappear when a sibling
-- changes modes; an inaccurate historic attestation needs reconciliation.
create or replace function public.gst_known_pan_turnover_paise(p_gstin text)
returns bigint language plpgsql set search_path = public, pg_temp as $$
declare
  v_pan text := substr(p_gstin,3,10);
  v_known bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(v_pan),9132));
  select max(t.paise) into v_known from (
    select greatest(c.preceding_fy_turnover_paise,(c.activation->'aato'->>'highest_prior_fy_paise')::bigint) paise
    from public.restaurant_gst_config c where c.mode='regular' and c.pan=v_pan
    union all
    select (h.activation->'aato'->>'highest_prior_fy_paise')::bigint
    from public.restaurant_gst_config_history h where h.mode='regular' and h.pan=v_pan and h.activation is not null
  ) t;
  return v_known;
end;
$$;
revoke all on function public.gst_known_pan_turnover_paise(text) from public, anon, authenticated, service_role;

create or replace function public.gst_scoped_irp_facts(p_gstin text, p_activation jsonb, p_previous bigint, p_date date)
returns jsonb language sql set search_path = public, pg_temp as $$
  select public.gst_b2b_irp_facts(p_activation,greatest(p_previous,public.gst_known_pan_turnover_paise(p_gstin)),p_date);
$$;
revoke all on function public.gst_scoped_irp_facts(text,jsonb,bigint,date) from public, anon, authenticated, service_role;

-- Existing numbers remain valid with NULL prefix. Newly configured prefixes
-- do not change the sequence key or reset the transactional counter.
alter table public.restaurant_invoices add column series_prefix text check (series_prefix ~ '^[A-Z1-9][A-Z0-9]{1,2}$');
alter table public.restaurant_invoices drop constraint restaurant_invoices_format_check;
alter table public.restaurant_invoices add constraint restaurant_invoices_format_check check (
  invoice_number ~ '^[A-Z0-9/-]{1,16}$'
  and invoice_number = coalesce(series_prefix, series_code, 'INV') || '/' || financial_year || '/' || lpad(sequence_number::text, 6, '0')
  and (series_code is null or series_code = case document_type when 'gst_tax_invoice' then 'INV' when 'bill_of_supply' then 'BOS' when 'receipt' then 'RBL' end)
);
alter table public.restaurant_notes add column series_prefix text check (series_prefix ~ '^[A-Z1-9][A-Z0-9]{1,2}$');
alter table public.restaurant_notes drop constraint restaurant_notes_format_check;
alter table public.restaurant_notes add constraint restaurant_notes_format_check check (
  document_number ~ '^[A-Z0-9/-]{1,16}$'
  and document_number = coalesce(series_prefix, case document_type when 'credit_note' then 'CN' else 'DN' end)
    || '/' || financial_year || '/' || lpad(sequence_number::text, 6, '0')
);

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
  v_prefix text;
  v_irp_facts jsonb;
  v_recipient jsonb := p_recipient;
  v_buyer public.restaurant_gst_buyers%rowtype;
  v_consumer boolean := false;
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
   where m.restaurant_id = v_session.restaurant_id and m.user_id = v_actor for share;
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
    if p_recipient is not null and (case when p_recipient ? 'buyer_id' then
        (p_recipient->>'buyer_id',p_recipient->>'revision') is distinct from
        (v_existing.customer_snapshot->>'buyer_id',v_existing.customer_snapshot->>'buyer_revision')
      else (upper(btrim(p_recipient->>'gstin')),btrim(p_recipient->>'name'),btrim(p_recipient->>'address')) is distinct from
        (v_existing.customer_snapshot->>'gstin',v_existing.customer_snapshot->>'name',v_existing.customer_snapshot->>'address') end) then
      raise exception 'This sitting already has an immutable document with another recipient. Review invoice history.' using errcode = 'P0001';
    end if;
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

  -- New invoices cannot infer a supply type or POS from a buyer GSTIN.
  -- Preserve support for old explicit inline buyer records under the legacy
  -- configuration, but never use legacy turnover alone to clear a new hold.
  if v_recipient is not null then
    if v_gst_doc_type <> 'gst_tax_invoice' then
      raise exception 'A buyer GSTIN can only be recorded on a Regular GST tax invoice. Registered buyers on a Bill of Supply require a supported workflow.' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_recipient) <> 'object' then
      raise exception 'Send a buyer details object or omit buyer details.' using errcode = '22023';
    end if;
    if coalesce(v_recipient->>'supply_kind','direct_restaurant') <> 'direct_restaurant'
       or coalesce(v_recipient->>'place_of_supply_state_code',v_gst.state_code) is distinct from v_gst.state_code then
      raise exception 'Only direct restaurant services at the outlet place of supply are supported. Do not change tax based on the buyer state.' using errcode = '23514';
    end if;
    if v_recipient ? 'buyer_id' then
      if coalesce(v_recipient->>'buyer_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         or coalesce(v_recipient->>'revision','') !~ '^[1-9][0-9]{0,8}$'
         or v_recipient - array['buyer_id','revision'] <> '{}'::jsonb then
        raise exception 'Reload the saved buyer and select its current revision.' using errcode = '23514';
      end if;
      select b.* into v_buyer from public.restaurant_gst_buyers b where b.id = (v_recipient->>'buyer_id')::uuid
        and b.restaurant_id = v_session.restaurant_id and b.revision = (v_recipient->>'revision')::integer for share;
      if not found then raise exception 'Saved buyer is unavailable for this outlet or changed. Reload before issuing.' using errcode = 'P0001'; end if;
      v_recipient := v_buyer.details;
    end if;
    v_consumer := coalesce(v_recipient->>'recipient_type' = 'consumer',false);
    if v_consumer then
      if v_gst.activation is null or v_recipient->>'gstin' is not null
         or coalesce(length(btrim(v_recipient->>'name')),0) not between 2 and 160
         or coalesce(length(btrim(v_recipient->>'address')),0) not between 5 and 300
         or coalesce(v_recipient->>'state_code','') !~ '^(0[1-9]|[12][0-9]|3[0-8])$'
         or v_recipient->>'state_code' in ('25','28') then
        raise exception 'For an identified unregistered buyer enter name, billing address and state, without GSTIN.' using errcode = '23514';
      end if;
      v_customer := jsonb_build_object('recipient_type','consumer','name',btrim(v_recipient->>'name'),
        'address',btrim(v_recipient->>'address'),'state_code',v_recipient->>'state_code',
        'delivery_address',v_gst.activation->>'premises_address');
    elsif v_gst.activation is not null or v_buyer.id is not null then
      v_customer := public.gst_normalize_buyer(v_recipient);
      v_customer := v_customer || jsonb_build_object('buyer_id',v_buyer.id,'buyer_revision',v_buyer.revision);
    else
      if coalesce(v_recipient->>'recipient_type','registered') <> 'registered' then
        raise exception 'Only ordinary domestic registered buyers can use the B2B invoice workflow.' using errcode = '23514';
      end if;
      v_r_name := nullif(btrim(v_recipient->>'name'), '');
      v_r_gstin := upper(nullif(btrim(v_recipient->>'gstin'), ''));
      v_r_address := nullif(btrim(v_recipient->>'address'), '');
      v_r_email := lower(nullif(btrim(v_recipient->>'email'), ''));
      if v_r_name is null or char_length(v_r_name) not between 2 and 160 then
        raise exception 'Enter the buyer legal name for the GST invoice.' using errcode = 'P0001';
      end if;
      if v_r_gstin is null then raise exception 'Enter the buyer GSTIN.' using errcode = 'P0001'; end if;
      if not public.gst_valid_gstin(v_r_gstin) then
        raise exception 'The buyer GSTIN format, state code or checksum is not valid.' using errcode = 'P0001';
      end if;
      v_r_state := substr(v_r_gstin, 1, 2);
      if coalesce(v_recipient->>'state_code',v_r_state) <> v_r_state then
        raise exception 'The buyer state does not match the recipient GSTIN.' using errcode = '23514';
      end if;
      if v_r_address is null or char_length(v_r_address) not between 5 and 300 then
        raise exception 'The buyer billing address must be 5–300 characters.' using errcode = '23514';
      end if;
      if v_r_email is not null and (char_length(v_r_email) > 254 or v_r_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$') then
        raise exception 'The buyer email address does not look usable.' using errcode = 'P0001';
      end if;
      v_customer := jsonb_build_object('recipient_type','registered','name',v_r_name,'gstin',v_r_gstin,
        'state_code',v_r_state,'address',v_r_address,'email',v_r_email);
    end if;
    if not v_consumer then
      v_r_name := v_customer->>'name'; v_r_gstin := v_customer->>'gstin'; v_r_state := v_customer->>'state_code';
      v_r_address := v_customer->>'address'; v_r_email := v_customer->>'email';
    end if;
  end if;

  if v_r_gstin is not null and v_r_gstin = v_gst.gstin then
    raise exception 'Buyer GSTIN cannot equal the seller GSTIN.' using errcode = '23514';
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
    -- A B2C payment QR is not an IRP-signed QR. The known >500 crore
    -- category is not supported without a reviewed QR/cross-reference workflow.
    if v_r_gstin is null and public.gst_known_pan_turnover_paise(v_gst.gstin) > 500000000000 then
      raise exception 'This B2C invoice may require a dynamic payment QR or approved cross-reference. Reconcile before issuing.' using errcode = 'P0001';
    end if;
    if v_taxable >= 5000000 and v_customer is null then
      raise exception 'Rule 46 requires the recipient particulars for this taxable amount. Enter the buyer details before issuing.' using errcode = '23514';
    end if;
    v_profile_notification := case v_gst.regular_profile
      when 'specified_premises' then '11/2017-CT(R) 7(vi), 05/2025 specified premises'
      else '11/2017-CT(R) 7(ii), as amended' end;
    if v_r_gstin is not null then
      v_irp_facts := public.gst_scoped_irp_facts(v_gst.gstin,v_gst.activation,v_gst.preceding_fy_turnover_paise,
         (v_issued_at at time zone 'Asia/Kolkata')::date);
      if v_irp_facts->>'applicability' <> 'not_required' then v_irp_status := 'pending'; end if;
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

  v_prefix := coalesce(v_gst.activation->'series'->>v_series, v_series);
  if v_gst.gstin is not null or v_retail then
    perform public.gst_bind_number_namespace(v_session.restaurant_id,v_gst.gstin,v_fy,v_series,v_prefix);
  end if;
  insert into public.restaurant_invoice_series as s (restaurant_id, financial_year, series_code, next_number)
  values (v_session.restaurant_id, v_fy, v_series, 2)
  on conflict (restaurant_id, financial_year, series_code) do update
    set next_number = s.next_number + 1 where s.next_number < 1000000
  returning next_number - 1 into v_sequence;
  if not found then
    raise exception 'This document series has reached its six-digit limit for the financial year.' using errcode = '22003';
  end if;

  v_invoice_number := v_prefix || '/' || v_fy || '/' || lpad(v_sequence::text, 6, '0');
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
  if v_gst.activation is not null then
    v_seller := v_seller || jsonb_build_object('premises_address',v_gst.activation->>'premises_address',
      'premises_state_code',v_gst.activation->>'premises_state_code','phone',v_gst.activation->>'invoice_phone',
      'retail_bill',v_retail,'activation_effective_from',v_gst.activation->>'effective_from','einvoice_location',v_gst.einvoice_location,'einvoice_pincode',v_gst.einvoice_pincode);
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
      'recipient_supplied', (v_customer is not null),
      'recipient_type', case when v_r_gstin is not null then 'B2B' else 'B2C' end,
      'issued_local_date',v_local_date, 'supply_date',v_first_supply_date,
      'activation_effective_from',v_gst.activation->>'effective_from',
      'irp_evidence',v_irp_facts - 'highest_prior_fy_paise', 'reverse_charge',false,
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
    sequence_number, series_code, series_prefix, document_type, issued_at, issued_by,
    table_label_snapshot, session_opened_at, session_closed_at,
    seller_snapshot, customer_snapshot, totals_snapshot, payment_snapshot,
    source_order_ids, supersedes_invoice_id,
    gst_snapshot, irp_status,
    recipient_name, recipient_gstin, recipient_state_code,
    recipient_address, recipient_email
  ) values (
    v_session.restaurant_id, v_session.id, v_invoice_number, v_fy,
    v_sequence, case when v_gst.fssai_number is not null then v_series end,
    case when v_gst.activation is not null then v_prefix end, v_gst_doc_type, v_issued_at, v_actor,
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
  v_kind text;
  v_cfg public.restaurant_gst_config%rowtype;
  v_facts jsonb;
  v_supply_date date;
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
   where m.restaurant_id = v_invoice.restaurant_id and m.user_id = v_actor for share;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can issue a note.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_invoice.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;

  if v_invoice.seller_snapshot->>'activation_effective_from' is not null and v_role <> 'owner' then
    raise exception 'Only the outlet owner can issue an adjustment under an activated GST configuration.' using errcode = '42501';
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

  v_local_date := (v_now at time zone 'Asia/Kolkata')::date;
  v_fy_start := public.gst_financial_year_start(v_local_date);
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');
  v_kind := case p_document_type when 'credit_note' then 'CN' else 'DN' end;
  perform pg_advisory_xact_lock_shared(hashtextextended('gst-outlet:' || v_invoice.restaurant_id::text, 0));
  select c.* into v_cfg from public.restaurant_gst_config c where c.restaurant_id = v_invoice.restaurant_id;
  if v_invoice.seller_snapshot->>'activation_effective_from' is not null
     and v_cfg.gstin is distinct from v_invoice.seller_snapshot->>'gstin' then
    raise exception 'The original registration is no longer active here. Reconcile the adjustment with the supplier.' using errcode = 'P0001';
  end if;
  v_prefix := coalesce((case when v_cfg.gstin = v_invoice.seller_snapshot->>'gstin' then v_cfg.activation end)->'series'->>v_kind,v_kind);
  -- Reassess the new adjustment's IRP applicability for the same seller,
  -- but never rewrite the original decision, buyer, value or references.
  if v_invoice.seller_snapshot->>'activation_effective_from' is not null
     and v_invoice.irp_status <> 'not_required' then
    raise exception 'The original GST document is held. Reconcile it before ordering an adjustment.' using errcode = 'P0001';
  end if;
  if v_invoice.recipient_gstin is not null then
    v_facts := public.gst_scoped_irp_facts(v_invoice.seller_snapshot->>'gstin',case when v_cfg.gstin = v_invoice.seller_snapshot->>'gstin' then v_cfg.activation end,
      case when v_cfg.gstin = v_invoice.seller_snapshot->>'gstin' then v_cfg.preceding_fy_turnover_paise end,v_local_date);
    if v_facts->>'applicability' <> 'not_required' then v_irp_status := 'pending'; end if;
    v_gst_snapshot := v_gst_snapshot || jsonb_build_object('irp_evidence',v_facts - 'highest_prior_fy_paise');
  end if;
  perform public.gst_bind_number_namespace(v_invoice.restaurant_id,v_invoice.seller_snapshot->>'gstin',v_fy,v_kind,v_prefix);
  v_gst_snapshot := v_gst_snapshot || jsonb_build_object('issued_local_date',v_local_date);
  v_supply_date := (v_invoice.gst_snapshot->>'supply_date')::date;
  if p_document_type = 'credit_note' and v_supply_date is not null and v_invoice.document_type = 'gst_tax_invoice'
    and v_local_date > make_date(public.gst_financial_year_start(v_supply_date)+1,11,30) then
    raise exception 'The statutory credit-note reporting cutoff passed for this supply. Reconcile outside GST-adjusting issuance.' using errcode = '23514';
  end if;

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
    sequence_number, series_prefix, reason_code, reason,
    taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
    gst_snapshot, seller_snapshot, customer_snapshot, totals_snapshot,
    irp_status, source_document_number, source_issued_at, issued_by
  ) values (
    v_invoice.restaurant_id, v_invoice.id, p_document_type, v_document_number, v_fy,
    v_sequence, v_prefix, p_reason_code, btrim(p_reason),
    v_taxable, v_cgst, v_sgst, v_igst, v_total,
    v_gst_snapshot, v_invoice.seller_snapshot, v_invoice.customer_snapshot, v_totals,
    v_irp_status, v_invoice.invoice_number, v_invoice.issued_at, v_actor
  ) returning id into v_note_id;

  insert into public.restaurant_note_events (note_id, restaurant_id, event, reason, actor)
  values (v_note_id, v_invoice.restaurant_id, 'issued', p_reason_code || ': ' || btrim(p_reason), v_actor);

  return v_note_id;
end;
$$;


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
   where m.restaurant_id = v_note.restaurant_id and m.user_id = v_actor for share;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can void a note.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_note.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;
  if v_note.seller_snapshot->>'activation_effective_from' is not null and v_role <> 'owner' then
    raise exception 'Only the outlet owner can void an adjustment under an activated GST configuration.' using errcode = '42501';
  end if;
  if v_note.irp_status in ('generated','cancelled') or exists (
    select 1 from public.restaurant_irp_requests r where r.note_id=v_note.id and r.restaurant_id=v_note.restaurant_id
      and r.provider <> 'sandbox' and r.status in ('submitted','accepted','transport_error')
  ) then
    raise exception 'Reconcile the IRP status before local void. This does not cancel a registered document.' using errcode = 'P0001';
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
   where m.restaurant_id = v_invoice.restaurant_id and m.user_id = v_actor for share;
  if not found or v_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can void a receipt.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(v_invoice.restaurant_id) then
    raise exception 'This restaurant is in read-only mode.' using errcode = 'P0001';
  end if;
  if v_invoice.seller_snapshot->>'activation_effective_from' is not null and v_role <> 'owner' then
    raise exception 'Only the outlet owner can void a document under an activated billing configuration.' using errcode = '42501';
  end if;
  if v_invoice.irp_status in ('generated','cancelled') or exists (
    select 1 from public.restaurant_irp_requests r where r.invoice_id=v_invoice.id and r.restaurant_id=v_invoice.restaurant_id
      and r.provider <> 'sandbox' and r.status in ('submitted','accepted','transport_error')
  ) then
    raise exception 'Reconcile the IRP status before local void. This does not cancel a registered document.' using errcode = 'P0001';
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

comment on function public.void_restaurant_invoice(uuid,text) is 'Audited local void, not IRP cancellation or payment refund. Activated documents are owner-only.';

-- Token holders receive the saved document particulars, not contact or buyer-master metadata.
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
      'seller_snapshot', v_invoice.seller_snapshot - array['pan','restaurant_id','einvoice_location','einvoice_pincode','activation_effective_from'],
      'totals_snapshot', v_invoice.totals_snapshot,
      'payment_snapshot', v_invoice.payment_snapshot,
      'gst_snapshot', v_invoice.gst_snapshot - array['irp_evidence','supply_date','issued_local_date','activation_effective_from'],
      'customer_snapshot', v_invoice.customer_snapshot - array['buyer_id','buyer_revision','email','phone'],
      'recipient_name', v_invoice.recipient_name,
      'recipient_gstin', v_invoice.recipient_gstin,
      'recipient_state_code', v_invoice.recipient_state_code,
      'recipient_address', v_invoice.recipient_address,
      'irp_status', v_invoice.irp_status,
      'supersedes_invoice_id', v_invoice.supersedes_invoice_id,
      'void_reason', v_invoice.void_reason
    ),
    'lines', v_lines
  );
end;
$$;
