-- Outlet activation v2. NULL marks an untouched earlier configuration; no
-- implied activation, registration verification, history edit or renumbering.
alter table public.restaurant_gst_config add column activation jsonb;
alter table public.restaurant_gst_config_history add column activation jsonb;

-- Private numbering reservation across every AutoDine outlet on a GSTIN.
-- Even a void retains its number. Other systems are only knowable from the
-- owner's explicit namespace declaration, not a query of external books.
create table public.restaurant_gst_number_namespaces (
  identity_key text not null,
  financial_year text not null,
  prefix text not null check (prefix ~ '^[A-Z1-9][A-Z0-9]{1,2}$'),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  document_kind text not null check (document_kind in ('INV','BOS','RBL','CN','DN')),
  reserved_at timestamptz not null default statement_timestamp(),
  primary key (identity_key, financial_year, prefix),
  unique (restaurant_id, financial_year, document_kind)
);
alter table public.restaurant_gst_number_namespaces enable row level security;
revoke all on public.restaurant_gst_number_namespaces from public, anon, authenticated, service_role;

create or replace function public.gst_bind_number_namespace(
  p_outlet uuid, p_gstin text, p_fy text, p_kind text, p_prefix text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_identity text := coalesce('gst:' || upper(p_gstin), 'outlet:' || p_outlet::text);
  v_existing public.restaurant_gst_number_namespaces%rowtype;
begin
  if p_prefix is null or p_prefix !~ '^[A-Z1-9][A-Z0-9]{1,2}$' then
    raise exception 'Use a two or three character invoice series prefix.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gst-number:' || v_identity, 0));
  select n.* into v_existing from public.restaurant_gst_number_namespaces n
   where n.restaurant_id = p_outlet and n.financial_year = p_fy and n.document_kind = p_kind;
  if found then
    if (v_existing.identity_key, v_existing.prefix) is distinct from (v_identity, p_prefix) then
      raise exception 'A numbering series is already reserved for this outlet, document type and financial year. Keep the series or reconcile the conflict.' using errcode = '23514';
    end if;
    return;
  end if;
  -- Existing per-kind sequence continues even if issued under an old
  -- schema. Do not create a mid-FY hole by changing that kind's prefix.
  if exists (select 1 from public.restaurant_invoices i where i.restaurant_id = p_outlet
      and i.financial_year = p_fy and coalesce(i.series_code,'INV') = p_kind
      and split_part(i.invoice_number,'/',1) <> p_prefix)
    or exists (select 1 from public.restaurant_notes n where n.restaurant_id = p_outlet and n.financial_year = p_fy
      and (case n.document_type when 'credit_note' then 'CN' else 'DN' end) = p_kind
      and split_part(n.document_number,'/',1) <> p_prefix) then
    raise exception 'An existing document pins this outlet series for the financial year.' using errcode = '23514';
  end if;
  if exists (select 1 from public.restaurant_gst_number_namespaces n
       where n.identity_key = v_identity and n.financial_year = p_fy and n.prefix = p_prefix)
    or exists (select 1 from public.restaurant_invoices i
       where p_gstin is not null and i.seller_snapshot->>'gstin' = p_gstin
         and i.financial_year = p_fy and split_part(i.invoice_number, '/', 1) = p_prefix
         and (i.restaurant_id <> p_outlet or coalesce(i.series_code,'INV') <> p_kind))
    or exists (select 1 from public.restaurant_notes n
       where p_gstin is not null and n.seller_snapshot->>'gstin' = p_gstin
         and n.financial_year = p_fy and split_part(n.document_number, '/', 1) = p_prefix
         and (n.restaurant_id <> p_outlet or (case n.document_type when 'credit_note' then 'CN' else 'DN' end) <> p_kind)) then
    raise exception 'Numbering series conflicts with another document series for this registration and financial year.' using errcode = '23514';
  end if;
  insert into public.restaurant_gst_number_namespaces (identity_key, financial_year, prefix, restaurant_id, document_kind)
  values (v_identity, p_fy, p_prefix, p_outlet, p_kind);
exception when unique_violation then
  raise exception 'Numbering series conflicts with a reserved registration namespace.' using errcode = '23514';
end;
$$;
revoke all on function public.gst_bind_number_namespace(uuid,text,text,text,text) from public, anon, authenticated, service_role;

-- Domestic restaurant scope uses supplier/premises state, never buyer GSTIN
-- state as place of supply. Unsupported code/UTGST or off-premises cases
-- must not fall back to CGST/SGST. No inferred mailing-address geocoding.
create or replace function public.gst_supported_outlet_state(p_code text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(p_code ~ '^(0[1-9]|[12][0-9]|3[0-8])$'
    and p_code not in ('04','25','26','28','31','35','38'), false);
$$;

-- Enforce the notified filing windows only for the new attested workflow.
-- Older evidence is not rewritten. A current-FY attestation is still needed
-- for a carried-forward declaration; do not infer that it was not opted out.
create or replace function public.gst_declared_premises_window(
  p_evidence jsonb, p_route text, p_decl_fy integer, p_effective date, p_today date, p_registered date
) returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_treatment integer := public.gst_financial_year_start(p_today);
  v_from date;
  v_through date;
  v_filed date;
begin
  if not public.gst_valid_premises_evidence(p_evidence,p_today) then return false; end if;
  if p_evidence->>'basis' = 'room_supply' then return p_route is null and p_decl_fy is null; end if;
  if p_decl_fy is null or p_decl_fy not between 2025 and v_treatment
     or (p_decl_fy = 2025 and v_treatment > 2025) or p_effective is null then return false; end if;
  v_from := (p_evidence->>'filing_from')::date;
  v_through := (p_evidence->>'filing_through')::date;
  v_filed := (p_evidence->>'filed_on')::date;
  if p_route = 'annexure_vii' then
    return v_from = make_date(p_decl_fy,1,1) and v_through = make_date(p_decl_fy,3,31)
      and p_effective = make_date(v_treatment,4,1);
  elsif p_route = 'annexure_viii' then
    return p_registered is not null and p_registered >= v_from and p_registered <= p_today
      and public.gst_financial_year_start(p_registered) = p_decl_fy
      and v_through = v_from + 15 and v_filed between v_from and v_through
      and (case when p_decl_fy = v_treatment then p_effective = p_registered
              else p_effective = make_date(v_treatment,4,1) end);
  end if;
  return false;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.gst_supported_outlet_state(text),
  public.gst_declared_premises_window(jsonb,text,integer,date,date,date) from public, anon, authenticated, service_role;

create or replace function public.gst_build_outlet_activation(p_mode text, p_settings jsonb, p_today date)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_input jsonb := p_settings->'activation';
  v_series jsonb := v_input->'series';
  v_external jsonb := v_input->'external_prefixes';
  v_state text := v_input->>'premises_state_code';
  v_aato jsonb := nullif(v_input->'aato', 'null'::jsonb);
  v_max bigint;
  v_reporting text;
  v_review text := nullif(btrim(v_input->>'adviser_reference'), '');
  v_decl_fy integer;
begin
  if jsonb_typeof(v_input) is distinct from 'object' or v_input->'confirm' is distinct from 'true'::jsonb
     or v_input->'series_confirmed' is distinct from 'true'::jsonb then
    raise exception 'Confirm activation for this outlet and confirm numbering does not overlap external books.' using errcode = '23514';
  end if;
  if v_input->>'effective_from' is distinct from to_char(p_today, 'YYYY-MM-DD') then
    raise exception 'Choose today in India as the activation date. Future schedules and backdating are not supported.' using errcode = '23514';
  end if;
  if coalesce(length(btrim(v_input->>'premises_address')),0) not between 5 and 300
     or coalesce(v_input->>'invoice_phone','') !~ '^[+0-9][0-9 ()+.-]{5,23}$'
     or not public.gst_supported_outlet_state(v_state) then
    raise exception 'Enter the supported outlet state, licensed premises address and invoice phone.' using errcode = '23514';
  end if;
  if p_mode <> 'off' and v_state is distinct from left(upper(btrim(p_settings->>'gstin')),2) then
    raise exception 'The supplier GSTIN and restaurant premises state must match. Cross-state, SEZ and UTGST setup is not supported.' using errcode = '23514';
  end if;
  if jsonb_typeof(v_series) is distinct from 'object' or jsonb_typeof(v_external) is distinct from 'array' then
    raise exception 'Enter document series and any exact external prefixes.' using errcode = '23514';
  end if;
  if jsonb_array_length(v_external) > 30
     or v_series - array['INV','BOS','RBL','CN','DN'] <> '{}'::jsonb
     or (select count(*) from jsonb_each(v_series)) <> 5
     or (select count(distinct value) from jsonb_each_text(v_series)) <> 5
     or exists (select 1 from jsonb_each(v_series) p where jsonb_typeof(p.value) <> 'string' or p.value #>> '{}' !~ '^[A-Z1-9][A-Z0-9]{1,2}$')
     or exists (select 1 from jsonb_array_elements(v_external) e where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ '^[A-Z1-9][A-Z0-9]{1,2}$') then
    raise exception 'Use five distinct 2–3 character prefixes (A–Z, 0–9) and at most 30 external prefixes.' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_each_text(v_series) p where v_external ? p.value) then
    raise exception 'An AutoDine numbering prefix overlaps a declared external series.' using errcode = '23514';
  end if;
  if coalesce(length(v_review),0) > 120 then
    raise exception 'The optional adviser reference must be 120 characters or fewer.' using errcode = '23514';
  end if;
  if p_mode = 'regular' and p_settings->>'business_type' = 'hotel'
     and p_settings->>'regular_profile' = 'other_than_specified_premises'
     and v_input->'hotel_not_specified_confirmed' is distinct from 'true'::jsonb then
    raise exception 'Confirm the hotel is not Specified Premises before activating the five percent rate; do not infer this from missing evidence.' using errcode = '23514';
  end if;
  if p_mode = 'regular' and p_settings->>'regular_profile' = 'specified_premises' then
    if v_input->>'declaration_fy' is not null then
      if v_input->>'declaration_fy' !~ '^[0-9]{4}$' then raise exception 'Enter a declaration financial year.' using errcode = '23514'; end if;
      v_decl_fy := (v_input->>'declaration_fy')::integer;
    end if;
    if not public.gst_declared_premises_window(p_settings->'premises_evidence', v_input->>'declaration_route',
      v_decl_fy, (p_settings->>'specified_premises_effective_from')::date, p_today, (v_input->>'registration_effective_on')::date) then
      raise exception 'The Specified Premises declaration or filing window does not cover the recorded treatment. Review it before activation.' using errcode = '23514';
    end if;
  end if;
  if v_aato is not null then
    if p_mode <> 'regular' or jsonb_typeof(v_aato) <> 'object'
       or coalesce(v_aato->>'highest_prior_fy_paise', '') !~ '^[0-9]{1,15}$'
       or coalesce(length(btrim(v_aato->>'reference')),0) not between 2 and 120
       or coalesce(v_aato->>'reporting_category','') not in ('under_10cr','at_least_10cr','unknown') then
      raise exception 'Record the highest PAN-wide prior-year turnover, evidence reference and IRP reporting category, or leave turnover unknown.' using errcode = '23514';
    end if;
    v_max := (v_aato->>'highest_prior_fy_paise')::bigint;
    v_reporting := v_aato->>'reporting_category';
    if v_max > 100000000000000
       or v_max < coalesce((p_settings->>'preceding_fy_turnover_paise')::bigint,0)
       or (v_reporting = 'under_10cr' and v_max >= 10000000000)
       or (v_reporting = 'at_least_10cr' and v_max < 10000000000) then
      raise exception 'The turnover figures or the reporting category conflict. Record unknown until reconciled.' using errcode = '23514';
    end if;
    v_aato := jsonb_build_object('highest_prior_fy_paise',v_max,'reference',btrim(v_aato->>'reference'),
      'reporting_category',v_reporting,'review_fy',public.gst_financial_year_start(p_today));
  end if;
  return jsonb_build_object('version',2, 'effective_from',to_char(p_today,'YYYY-MM-DD'),
    'confirmed_at',statement_timestamp(), 'confirmed_by',auth.uid(),
    'premises_address',btrim(v_input->>'premises_address'),'premises_state_code',v_state,
    'invoice_phone',btrim(v_input->>'invoice_phone'),'series',v_series,'external_prefixes',v_external,
    'review_status',case when v_review is null then 'owner_attested' else 'adviser_reference_recorded' end,
    'adviser_reference',v_review,'declaration_route',case when v_decl_fy is not null then v_input->>'declaration_route' end,
    'declaration_fy',v_decl_fy, 'registration_effective_on',case when v_input->>'declaration_route' = 'annexure_viii' and v_decl_fy is not null then (v_input->>'registration_effective_on')::date end,
    'hotel_not_specified_confirmed',coalesce(p_mode = 'regular' and p_settings->>'business_type' = 'hotel' and p_settings->>'regular_profile' = 'other_than_specified_premises',false),
    'aato',v_aato);
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Review the activation date, evidence and turnover formats.' using errcode = '23514';
end;
$$;
revoke all on function public.gst_build_outlet_activation(text,jsonb,date) from public, anon, authenticated, service_role;

create or replace function public.restaurant_gst_config_history_track()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.restaurant_gst_config_history (
    restaurant_id, config_version, mode, regular_profile, gstin, legal_name,
    trade_name, address, state_code, pan, registration_type,
    composition_acknowledged, specified_premises_attested, specified_premises_effective_from,
    off_declared, off_declared_at, preceding_fy_turnover_paise,
    einvoice_location, einvoice_pincode, einvoice_hsn_sac,
    fssai_number, business_type, service_sac, premises_evidence, retail_phone, activation, changed_by, changed_at
  ) values (
    new.restaurant_id, new.config_version, new.mode, new.regular_profile, new.gstin, new.legal_name,
    new.trade_name, new.address, new.state_code, new.pan, new.registration_type,
    new.composition_acknowledged, new.specified_premises_attested, new.specified_premises_effective_from,
    new.off_declared, new.off_declared_at, new.preceding_fy_turnover_paise,
    new.einvoice_location, new.einvoice_pincode, new.einvoice_hsn_sac,
    new.fssai_number, new.business_type, new.service_sac, new.premises_evidence, new.retail_phone, new.activation, new.updated_by, new.updated_at
  );
  return new;
end;
$$;

create or replace function public.save_restaurant_gst_config(
  p_restaurant_id uuid,
  p_expected_version integer,
  p_settings jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current integer;
  v_input public.restaurant_gst_config%rowtype;
  v_mode text;
  v_version integer;
  v_activation jsonb;
  v_today date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  v_fy text;
  v_kind text;
begin
  if not public.has_restaurant_role(p_restaurant_id, array['owner']) then
    raise exception 'Only the outlet owner can change GST settings.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gst-outlet:' || p_restaurant_id::text, 0));
  -- Membership may have changed while this save waited for the outlet.
  -- Pin the current owner row until the version/history write commits so a
  -- concurrent removal or demotion cannot authorize a stale request.
  perform 1 from public.memberships m
   where m.restaurant_id = p_restaurant_id and m.user_id = auth.uid() and m.role = 'owner'
   for share;
  if not found then
    raise exception 'Only the outlet owner can change GST settings.' using errcode = '42501';
  end if;
  if not public.restaurant_can_write(p_restaurant_id) then
    raise exception 'This outlet is read-only. Restore access before changing GST settings.' using errcode = 'P0001';
  end if;
  select c.config_version into v_current from public.restaurant_gst_config c where c.restaurant_id = p_restaurant_id;
  if p_expected_version is distinct from coalesce(v_current, 0) then
    raise exception 'GST settings changed since you opened the form. Reload before saving.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'Send a GST settings object.' using errcode = '22023';
  end if;
  v_mode := p_settings->>'mode';
  if v_mode is null or v_mode not in ('off','regular','composition') then
    raise exception 'Choose GST or No-GST (unregistered or Composition).' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings->'fssai_number') is distinct from 'string'
     or (p_settings->>'fssai_number') !~ '^[0-9]{14}$' then
    raise exception 'Enter an FSSAI number with exactly 14 digits.' using errcode = '23514';
  end if;
  if v_mode = 'off' then
    if nullif(btrim(p_settings->>'gstin'), '') is not null then
      raise exception 'Unregistered retail billing cannot carry a GSTIN.' using errcode = '23514';
    end if;
    if p_settings->'off_has_obligation' is distinct from 'false'::jsonb
       or p_settings->'off_declared' is distinct from 'true'::jsonb then
      raise exception 'Unregistered billing requires the declaration and cannot be used for a declared GST obligation.' using errcode = '23514';
    end if;
  elsif (v_mode = 'composition' and p_settings->'composition_acknowledged' is distinct from 'true'::jsonb)
     or (v_mode = 'regular' and p_settings->>'regular_profile' = 'specified_premises'
         and p_settings->'specified_premises_attested' is distinct from 'true'::jsonb) then
    raise exception 'Confirm the eligibility acknowledgment for the selected GST mode and profile.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.order_sessions s join public.orders o on o.order_session_id = s.id
    where s.restaurant_id = p_restaurant_id and o.restaurant_id = p_restaurant_id
      and s.status = 'open' and o.prep_status <> 'cancelled'
  ) then
    raise exception 'Close all sittings with active tickets before changing GST settings. Existing tickets keep their billing configuration.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.order_sessions s
    join public.orders o on o.order_session_id = s.id and o.restaurant_id = s.restaurant_id
    where s.restaurant_id = p_restaurant_id and s.status = 'closed' and o.prep_status <> 'cancelled'
      and not exists (select 1 from public.restaurant_invoices i
        where i.restaurant_id = s.restaurant_id and i.order_session_id = s.id)
  ) then
    raise exception 'Review closed sittings without a document before changing GST settings.' using errcode = 'P0001';
  end if;

  v_activation := public.gst_build_outlet_activation(v_mode,p_settings,v_today);
  v_fy := to_char(make_date(public.gst_financial_year_start(v_today),1,1),'YY') || '-'
       || to_char(make_date(public.gst_financial_year_start(v_today)+1,1,1),'YY');
  if v_mode <> 'off' then
    if not public.gst_valid_gstin(upper(btrim(p_settings->>'gstin'))) or p_settings->>'gstin' is null then
      raise exception 'GSTIN format, state or checksum is invalid.' using errcode = '23514';
    end if;
    -- Same PAN, same year, same evidence. Unknown at another outlet does
    -- not negate known facts. See the issue-side conservative check too.
    perform pg_advisory_xact_lock(hashtextextended(lower(btrim(p_settings->>'gstin')),9131));
    perform pg_advisory_xact_lock(hashtextextended(lower(substr(btrim(p_settings->>'gstin'),3,10)),9132));
    if exists (select 1 from public.restaurant_gst_config c where c.restaurant_id <> p_restaurant_id
      and c.pan = substr(upper(btrim(p_settings->>'gstin')),3,10) and c.mode = 'regular'
      and v_mode = 'regular' and v_activation->'aato'->>'review_fy' is not null
      and ((c.activation->'aato'->>'review_fy' = v_activation->'aato'->>'review_fy'
        and (c.activation->'aato'->>'highest_prior_fy_paise' is distinct from v_activation->'aato'->>'highest_prior_fy_paise'
         or (c.activation->'aato'->>'reporting_category' <> 'unknown' and v_activation->'aato'->>'reporting_category' <> 'unknown'
           and c.activation->'aato'->>'reporting_category' <> v_activation->'aato'->>'reporting_category')))
        or coalesce(c.preceding_fy_turnover_paise,0) > (v_activation->'aato'->>'highest_prior_fy_paise')::bigint)) then
      raise exception 'PAN-wide turnover evidence conflicts with another AutoDine outlet. Record unknown or reconcile the evidence.' using errcode = '23514';
    end if;
  end if;
  if v_mode = 'off' then
    perform public.gst_bind_number_namespace(p_restaurant_id,null,v_fy,'RBL',v_activation->'series'->>'RBL');
  else
    -- Serialize issue-time reservations across the same registration. Any
    -- validation error rolls back the reservation as well as the save.
    foreach v_kind in array (case when v_mode = 'regular' then array['INV','CN','DN'] else array['BOS','CN','DN'] end) loop
      perform public.gst_bind_number_namespace(p_restaurant_id,upper(btrim(p_settings->>'gstin')),
        v_fy,v_kind,v_activation->'series'->>v_kind);
    end loop;
  end if;

  if v_mode = 'off' then
    insert into public.restaurant_gst_config (restaurant_id, mode, off_declared, fssai_number, activation)
    values (p_restaurant_id, 'off', true, p_settings->>'fssai_number', v_activation)
    on conflict (restaurant_id) do update set mode = 'off', off_declared = true,
      activation = excluded.activation, fssai_number = excluded.fssai_number, business_type = null, service_sac = null, premises_evidence = null
    returning config_version into v_version;
  else
    -- Only the listed fields are writable; outlet, version, actor and times
    -- are never taken from the JSON. Derive PAN and state from the GSTIN.
    select * into v_input from jsonb_populate_record(null::public.restaurant_gst_config,
      jsonb_build_object(
        'gstin', upper(nullif(btrim(p_settings->>'gstin'), '')),
        'registration_type', p_settings->>'registration_type',
        'legal_name', nullif(btrim(p_settings->>'legal_name'), ''),
        'trade_name', nullif(btrim(p_settings->>'trade_name'), ''),
        'address', nullif(btrim(p_settings->>'address'), ''),
        'regular_profile', p_settings->>'regular_profile',
        'fssai_number', p_settings->>'fssai_number',
        'business_type', p_settings->>'business_type',
        'service_sac', p_settings->>'service_sac',
        'premises_evidence', p_settings->'premises_evidence',
        'specified_premises_effective_from', case when p_settings->>'regular_profile' = 'specified_premises'
          then p_settings->>'specified_premises_effective_from' else '2025-04-01' end,
        'preceding_fy_turnover_paise', p_settings->'preceding_fy_turnover_paise',
        'einvoice_location', nullif(btrim(p_settings->>'einvoice_location'), ''),
        'einvoice_pincode', nullif(btrim(p_settings->>'einvoice_pincode'), ''),
        'einvoice_hsn_sac', nullif(btrim(p_settings->>'einvoice_hsn_sac'), '')
      ));
    insert into public.restaurant_gst_config (
      restaurant_id, mode, regular_profile, gstin, legal_name, trade_name, address, state_code, pan,
      registration_type, composition_acknowledged, specified_premises_attested, specified_premises_effective_from,
      preceding_fy_turnover_paise, einvoice_location, einvoice_pincode, einvoice_hsn_sac,
      fssai_number, business_type, service_sac, premises_evidence, activation
    ) values (
      p_restaurant_id, v_mode, v_input.regular_profile, v_input.gstin, v_input.legal_name, v_input.trade_name,
      v_input.address, substr(v_input.gstin, 1, 2), substr(v_input.gstin, 3, 10), v_input.registration_type,
      v_mode = 'composition', coalesce(p_settings->'specified_premises_attested' = 'true'::jsonb, false),
      v_input.specified_premises_effective_from, v_input.preceding_fy_turnover_paise,
      v_input.einvoice_location, v_input.einvoice_pincode, v_input.einvoice_hsn_sac,
      v_input.fssai_number, v_input.business_type, v_input.service_sac, v_input.premises_evidence, v_activation
    ) on conflict (restaurant_id) do update set
      mode = excluded.mode, regular_profile = excluded.regular_profile, gstin = excluded.gstin,
      legal_name = excluded.legal_name, trade_name = excluded.trade_name, address = excluded.address,
      state_code = excluded.state_code, pan = excluded.pan, registration_type = excluded.registration_type,
      composition_acknowledged = excluded.composition_acknowledged,
      specified_premises_attested = excluded.specified_premises_attested,
      specified_premises_effective_from = excluded.specified_premises_effective_from,
      preceding_fy_turnover_paise = excluded.preceding_fy_turnover_paise,
      einvoice_location = excluded.einvoice_location, einvoice_pincode = excluded.einvoice_pincode,
      einvoice_hsn_sac = excluded.einvoice_hsn_sac,
      fssai_number = excluded.fssai_number, business_type = excluded.business_type,
      service_sac = excluded.service_sac, premises_evidence = excluded.premises_evidence, activation = excluded.activation
    returning config_version into v_version;
  end if;
  return v_version;
end;
$$;

create or replace function public.gst_pricing_at(p_restaurant_id uuid, p_india_date date)
returns table(mode text, rate_bps integer, config_version integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_config public.restaurant_gst_config%rowtype;
  v_rate integer;
begin
  select c.* into v_config from public.restaurant_gst_config c where c.restaurant_id = p_restaurant_id;
  if v_config.activation is not null and
     p_india_date < (v_config.activation->>'effective_from')::date then
    raise exception 'The saved outlet configuration was not active on the supply date. Review the legacy sitting.' using errcode = 'P0001';
  end if;
  if not found or v_config.mode = 'off' then
    -- Unconfigured legacy billing stays operational until explicit enrollment.
    -- A reviewed unregistered business always quotes zero, not the old add-on.
    return query select 'off'::text, case when v_config.fssai_number is not null then 0 end,
      coalesce(v_config.config_version, 0);
    return;
  end if;
  v_rate := case when v_config.mode = 'composition' then 0 else public.gst_profile_rate(v_config.regular_profile) end;
  if coalesce(v_config.fssai_number, '') !~ '^[0-9]{14}$'
     or (v_config.mode = 'regular' and (
       coalesce(v_config.business_type, '') not in ('standalone','hotel')
       or coalesce(v_config.service_sac, '') !~ '^[0-9]{6}$'))
     or not public.gst_valid_gstin(v_config.gstin)
     or v_config.state_code is distinct from substr(v_config.gstin, 1, 2)
     or (v_config.pan is not null and v_config.pan <> substr(v_config.gstin, 3, 10))
     or v_config.registration_type is distinct from v_config.mode
     or coalesce(char_length(btrim(v_config.legal_name)), 0) < 2
     or coalesce(char_length(btrim(v_config.address)), 0) < 5
     or v_rate is null
     or (v_config.mode = 'composition' and (not v_config.composition_acknowledged or exists (
       select 1 from public.items i where i.restaurant_id = p_restaurant_id and i.is_alcoholic
     )))
     or (v_rate = 1800 and (v_config.business_type is distinct from 'hotel'
       or not v_config.specified_premises_attested
       or public.gst_valid_premises_evidence(v_config.premises_evidence, p_india_date) is not true
       or v_config.specified_premises_effective_from is null
       or v_config.specified_premises_effective_from not between date '2025-04-01' and p_india_date)) then
    raise exception 'This outlet needs to review its GST settings before pricing new orders. Please ask staff.' using errcode = 'P0001';
  end if;
  return query select v_config.mode, v_rate, v_config.config_version;
end;
$$;

