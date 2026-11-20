-- CA-approved two-mode onboarding. Storage values off/regular/composition
-- distinguish treatments, not three product modes. NULL new fields identify
-- unreviewed legacy rows; no outlet is enrolled or history changed by DDL.
alter table public.restaurant_gst_config
  add column fssai_number text,
  add column business_type text,
  add column service_sac text,
  add column premises_evidence jsonb,
  add column retail_phone text;

alter table public.restaurant_gst_config_history
  add column fssai_number text,
  add column business_type text,
  add column service_sac text,
  add column premises_evidence jsonb,
  add column retail_phone text;

create or replace function public.gst_financial_year_start(p_india_date date)
returns integer language sql immutable strict set search_path = pg_catalog
as $$
  select extract(year from p_india_date)::integer
       - case when extract(month from p_india_date) < 4 then 1 else 0 end;
$$;

-- Proof is a reviewed evidence reference, not a claim of portal validation.
-- Dates for the applicable opt-in period are supplied by the adviser; this
-- function checks the filed date against that period, not an invented window.
create or replace function public.gst_valid_premises_evidence(p_evidence jsonb, p_india_date date)
returns boolean language plpgsql immutable set search_path = public, pg_temp
as $$
declare
  v_fy integer;
  v_filed date;
  v_from date;
  v_through date;
begin
  if p_india_date is null or not isfinite(p_india_date)
     or jsonb_typeof(p_evidence) is distinct from 'object'
     or jsonb_typeof(p_evidence->'reference') is distinct from 'string'
     or length(btrim(p_evidence->>'reference')) not between 2 and 120
     or jsonb_typeof(p_evidence->'treatment_fy_start') is distinct from 'number'
     or (p_evidence->>'treatment_fy_start') !~ '^[0-9]{4}$' then
    return false;
  end if;
  v_fy := (p_evidence->>'treatment_fy_start')::integer;
  if v_fy <> public.gst_financial_year_start(p_india_date) then return false; end if;
  case p_evidence->>'basis'
    when 'room_supply' then
      if p_evidence - array['basis','reference','treatment_fy_start','room_supply_fy_start','room_value_paise'] <> '{}'::jsonb
         or p_evidence->'room_supply_fy_start' is distinct from to_jsonb(v_fy - 1)
         or jsonb_typeof(p_evidence->'room_value_paise') is distinct from 'number'
         or (p_evidence->>'room_value_paise') !~ '^[0-9]{1,15}$' then return false; end if;
      return (p_evidence->>'room_value_paise')::bigint > 750000;
    when 'opt_in' then
      if p_evidence - array['basis','reference','treatment_fy_start','filed_on','filing_from','filing_through'] <> '{}'::jsonb
         or coalesce(p_evidence->>'filed_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or coalesce(p_evidence->>'filing_from', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or coalesce(p_evidence->>'filing_through', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
      v_filed := (p_evidence->>'filed_on')::date;
      v_from := (p_evidence->>'filing_from')::date;
      v_through := (p_evidence->>'filing_through')::date;
      return v_filed between v_from and v_through and v_filed <= p_india_date;
    else return false;
  end case;
exception when invalid_datetime_format or datetime_field_overflow then
  return false;
end;
$$;

alter table public.restaurant_gst_config drop constraint restaurant_gst_config_registration_type_check;
alter table public.restaurant_gst_config add constraint restaurant_gst_config_registration_type_check
  check (registration_type in ('regular','composition','unregistered'));

create or replace function public.restaurant_gst_config_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_today date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
begin
  if coalesce(new.fssai_number, '') !~ '^[0-9]{14}$' then
    raise exception 'Enter an FSSAI number with exactly 14 digits.' using errcode = '23514';
  end if;
  if new.mode <> 'regular' and (new.business_type is not null or new.service_sac is not null or new.premises_evidence is not null) then
    raise exception 'Business type, SAC and premises evidence apply only to GST tax invoices.' using errcode = '23514';
  end if;
  new.retail_phone := null;
  if tg_op = 'UPDATE' and new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'A GST configuration cannot be moved to another outlet.' using errcode = '42501';
  end if;
  if new.mode = 'off' then
    if not new.off_declared then
      raise exception 'Confirm the unregistered declaration before selecting retail bills.' using errcode = '23514';
    end if;
    -- Register the actual outlet details for the retail document. Historical
    -- GST identities remain in history, never in the active unregistered row.
    select nullif(btrim(r.name), ''), nullif(btrim(r.address), ''), nullif(btrim(r.phone), '')
      into new.legal_name, new.address, new.retail_phone
      from public.restaurants r where r.id = new.restaurant_id;
    if new.legal_name is null or new.address is null or new.retail_phone is null then
      raise exception 'Save the business name, address and phone in Settings before enabling unregistered billing.' using errcode = '23514';
    end if;
    new.gstin := null;
    new.pan := null;
    new.state_code := null;
    new.trade_name := null;
    new.registration_type := 'unregistered';
    new.preceding_fy_turnover_paise := null;
    new.einvoice_location := null;
    new.einvoice_pincode := null;
    new.einvoice_hsn_sac := null;
    new.off_declared_at := statement_timestamp();
    new.regular_profile := null;
    new.composition_acknowledged := false;
    new.specified_premises_attested := false;
    return new;
  end if;

  new.off_declared := false;
  new.off_declared_at := null;
  if new.mode not in ('regular', 'composition') or new.registration_type is distinct from new.mode then
    raise exception 'The selected GST mode must match the registration type.' using errcode = '23514';
  end if;
  if not public.gst_valid_gstin(new.gstin) then
    raise exception 'Enter a GSTIN with a valid format, state code and checksum.' using errcode = '23514';
  end if;
  if new.state_code is distinct from substr(new.gstin, 1, 2) then
    raise exception 'The state code must match the first two digits of the GSTIN.' using errcode = '23514';
  end if;
  if new.pan is distinct from substr(new.gstin, 3, 10) then
    raise exception 'The PAN must match the PAN embedded in the GSTIN.' using errcode = '23514';
  end if;
  if coalesce(char_length(btrim(new.legal_name)), 0) not between 2 and 160
     or coalesce(char_length(btrim(new.address)), 0) not between 5 and 300
     or coalesce(char_length(new.trade_name), 0) > 160 then
    raise exception 'Enter the legal name and registered address as shown on the GST registration.' using errcode = '23514';
  end if;
  if new.mode = 'composition' then
    if new.regular_profile is not null or not new.composition_acknowledged then
      raise exception 'Composition requires the eligibility acknowledgment and cannot use a regular tax profile.' using errcode = '23514';
    end if;
    new.specified_premises_attested := false;
  else
    new.composition_acknowledged := false;
    if new.business_type is null or new.business_type not in ('standalone','hotel')
       or coalesce(new.service_sac, '') !~ '^[0-9]{6}$' then
      raise exception 'GST billing requires a business type and the six-digit service SAC confirmed by your adviser.' using errcode = '23514';
    end if;
    if public.gst_profile_rate(new.regular_profile) is null then
      raise exception 'Choose one of the two supported Regular GST profiles.' using errcode = '23514';
    end if;
    if new.regular_profile = 'specified_premises' then
      if new.business_type <> 'hotel' or not new.specified_premises_attested
         or public.gst_valid_premises_evidence(new.premises_evidence, v_today) is not true then
        raise exception '18%% requires a hotel restaurant and reviewed Specified Premises evidence for this financial year.' using errcode = '23514';
      end if;
      if new.specified_premises_effective_from is null
         or new.specified_premises_effective_from not between date '2025-04-01' and v_today
         or public.gst_financial_year_start(new.specified_premises_effective_from) <> public.gst_financial_year_start(v_today) then
        raise exception 'Enter the reviewed Specified Premises effective date within this financial year and not in the future.' using errcode = '23514';
      end if;
    else
      if new.premises_evidence is not null or new.specified_premises_attested then
        raise exception 'The 5%% profile does not use Specified Premises evidence.' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

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
    fssai_number, business_type, service_sac, premises_evidence, retail_phone, changed_by, changed_at
  ) values (
    new.restaurant_id, new.config_version, new.mode, new.regular_profile, new.gstin, new.legal_name,
    new.trade_name, new.address, new.state_code, new.pan, new.registration_type,
    new.composition_acknowledged, new.specified_premises_attested, new.specified_premises_effective_from,
    new.off_declared, new.off_declared_at, new.preceding_fy_turnover_paise,
    new.einvoice_location, new.einvoice_pincode, new.einvoice_hsn_sac,
    new.fssai_number, new.business_type, new.service_sac, new.premises_evidence, new.retail_phone, new.updated_by, new.updated_at
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

  if v_mode = 'off' then
    insert into public.restaurant_gst_config (restaurant_id, mode, off_declared, fssai_number)
    values (p_restaurant_id, 'off', true, p_settings->>'fssai_number')
    on conflict (restaurant_id) do update set mode = 'off', off_declared = true,
      fssai_number = excluded.fssai_number, business_type = null, service_sac = null, premises_evidence = null
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
      fssai_number, business_type, service_sac, premises_evidence
    ) values (
      p_restaurant_id, v_mode, v_input.regular_profile, v_input.gstin, v_input.legal_name, v_input.trade_name,
      v_input.address, substr(v_input.gstin, 1, 2), substr(v_input.gstin, 3, 10), v_input.registration_type,
      v_mode = 'composition', coalesce(p_settings->'specified_premises_attested' = 'true'::jsonb, false),
      v_input.specified_premises_effective_from, v_input.preceding_fy_turnover_paise,
      v_input.einvoice_location, v_input.einvoice_pincode, v_input.einvoice_hsn_sac,
      v_input.fssai_number, v_input.business_type, v_input.service_sac, v_input.premises_evidence
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
      service_sac = excluded.service_sac, premises_evidence = excluded.premises_evidence
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

create or replace function public.gst_pricing(p_restaurant_id uuid)
returns table(mode text, rate_bps integer, config_version integer)
language sql stable security definer set search_path = public, pg_temp
as $$
  select * from public.gst_pricing_at(p_restaurant_id, (statement_timestamp() at time zone 'Asia/Kolkata')::date);
$$;

create or replace function public.public_order_pricing(p_slug text)
returns table(tax_treatment text, tax_rate_bps integer)
language sql
stable
security definer
set search_path = public, pg_temp
rows 1
as $$
  select case when p.mode = 'regular' then 'inclusive' when p.rate_bps = 0 then 'none' else 'exclusive' end,
         coalesce(p.rate_bps, r.tax_rate_bps)
    from (select id, tax_rate_bps from public.restaurants where slug = nullif(btrim(p_slug), '') and is_active limit 1) r
    cross join lateral public.gst_pricing(r.id) p;
$$;

-- Existing admission core; only rate resolution changes. Keep the wrapper, locks and existing line pricing.
create or replace function public.place_public_order_core(
  p_slug text,
  p_lines jsonb,
  p_note text default null,
  p_session_token text default null
) returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  k_max_lines constant int := 100;
  k_max_qty   constant int := 99;
  k_max_note  constant int := 300;
  k_max_addons_per_line constant int := 20;
  k_default_tax_bps constant int := 500;
  k_alphabet constant text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  k_uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  v_session public.table_verification_sessions%rowtype;
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_restaurant_tax_bps int;
  v_gst_mode text := 'off';
  v_gst_rate int;
  v_gst_version int := 0;
  v_inclusive_paise bigint;
  v_table_id uuid;
  v_tax_bps int;
  v_note text;
  v_line_count int;
  v_subtotal_paise bigint := 0;
  v_discount_paise bigint := 0;
  v_taxable_paise bigint := 0;
  v_tax_paise bigint := 0;
  v_total_paise bigint := 0;
  v_code text;
  v_prefix text;
  v_order_id uuid;
  v_written int := 0;
begin
  if p_session_token is not null then
    if p_session_token !~ '^[A-Fa-f0-9]{64}$' then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select s.* into v_session
      from public.table_verification_sessions s
     where s.token_hash = encode(sha256(p_session_token::bytea), 'hex')
       and s.expires_at > statement_timestamp()
       and s.revoked_at is null;

    if not found then
      raise exception 'Your table verification has expired. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.table_qr_codes q
       where q.id = v_session.qr_code_id
         and q.revoked_at is null
         and q.table_id = v_session.table_id
         and q.restaurant_id = v_session.restaurant_id
    ) then
      raise exception 'Your table verification is no longer valid. Please ask staff for the current code.'
        using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.id = v_session.restaurant_id
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
    end if;

    select t.id into v_table_id
      from public.dining_tables t
     where t.id = v_session.table_id
       and t.restaurant_id = v_restaurant_id
       and t.is_active = true;

    if v_table_id is null then
      raise exception 'This table is not taking orders right now. Please ask staff.'
        using errcode = 'P0001';
    end if;

    if p_slug is not null and btrim(p_slug) <> '' then
      if not exists (
        select 1 from public.restaurants r
         where r.id = v_restaurant_id and r.slug = btrim(p_slug)
      ) then
        raise exception 'This order is for a different restaurant. Please open the menu again.'
          using errcode = 'P0001';
      end if;
    end if;
  else
    if p_slug is null or btrim(p_slug) = '' then
      raise exception 'No restaurant was given.' using errcode = 'P0001';
    end if;

    select r.id, r.name, r.tax_rate_bps
      into v_restaurant_id, v_restaurant_name, v_restaurant_tax_bps
      from public.restaurants r
     where r.slug = btrim(p_slug)
       and r.is_active = true;

    if v_restaurant_id is null then
      raise exception 'That restaurant is not taking orders.' using errcode = 'P0001';
    end if;

    v_table_id := null;
  end if;

  if not public.restaurant_can_write(v_restaurant_id) then
    raise exception 'That restaurant is not taking orders right now.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from public.menus m
     where m.restaurant_id = v_restaurant_id
       and m.is_published = true
  ) then
    raise exception 'That restaurant has no published menu.' using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count = 0 then
    raise exception 'The order contained no items.' using errcode = 'P0001';
  end if;

  if v_line_count > k_max_lines then
    raise exception 'That is more than % dishes in one order.', k_max_lines
      using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > k_max_note then
    v_note := left(v_note, k_max_note);
  end if;

  create temporary table if not exists tt_order_lines (
    item_id uuid not null,
    name_snapshot text not null,
    unit_price_paise bigint not null,
    qty int not null,
    is_veg boolean,
    sort_order int not null,
    variant_id uuid,
    variant_snapshot text,
    addon_ids uuid[] not null default '{}'
  ) on commit drop;

  create temporary table if not exists tt_line_addons (
    sort_order int not null,
    pick int not null,
    name text not null,
    price_paise bigint not null
  ) on commit drop;

  truncate tt_order_lines;
  truncate tt_line_addons;

  insert into tt_order_lines (
    item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_id, variant_snapshot, addon_ids
  )
  select
    i.id,
    i.name,
    coalesce(v.price_paise, i.price_paise),
    least(greatest((line->>'qty')::int, 1), k_max_qty),
    i.is_veg,
    ord,
    v.id,
    v.name,
    coalesce((
      select array_agg(ids.v)
        from (
          select distinct t.v
            from jsonb_array_elements_text(
                   case
                     when jsonb_typeof(line->'addon_ids') = 'array' then line->'addon_ids'
                     when jsonb_typeof(line->'addonIds') = 'array' then line->'addonIds'
                     else '[]'::jsonb
                   end
                 ) as t(v)
           where t.v ~ k_uuid_pattern
           limit k_max_addons_per_line
        ) ids
    ), '{}')::uuid[]
  from jsonb_array_elements(p_lines) with ordinality as t(line, ord)
  join lateral (
    select i.id, i.name, i.price_paise, i.is_veg
      from public.items i
      join public.categories c on c.id = i.category_id
      join public.menus m
        on m.id = c.menu_id
       and m.restaurant_id = v_restaurant_id
       and m.is_published = true
     where i.id = nullif(coalesce(line->>'item_id', line->>'itemId'), '')::uuid
       and i.is_available = true
       and i.restaurant_id = v_restaurant_id
     limit 1
  ) i on true
  left join public.item_variants v
    on v.id = nullif(coalesce(line->>'variant_id', line->>'variantId'), '')::uuid
   and v.item_id = i.id
  where jsonb_typeof(line) = 'object'
    and (line->>'qty') ~ '^[0-9]+$'
    and (line->>'qty')::int > 0;

  select count(*) into v_written from tt_order_lines;

  if v_written = 0 then
    raise exception 'None of those dishes are available right now.' using errcode = 'P0001';
  end if;

  insert into tt_line_addons (sort_order, pick, name, price_paise)
  select line_ord, pick, name, price_paise
    from (
      select l.sort_order as line_ord,
             a.name,
             a.price_paise,
             row_number() over (partition by l.sort_order, g.id order by want.ord) as pick,
             g.max_select
        from tt_order_lines l
        cross join lateral unnest(l.addon_ids) with ordinality as want(id, ord)
        join public.item_addons a
          on a.id = want.id
         and a.is_available = true
        join public.item_addon_groups g
          on g.id = a.group_id
         and g.item_id = l.item_id
    ) picked
   where pick <= max_select
   order by line_ord, pick;

  -- THE FIX. This was `update tt_order_lines ... ;` with no predicate, which
  -- safeupdate refuses. A line with no add-ons was only ever having zero added
  -- to it, so restricting the update to the lines that do have add-ons is the
  -- same arithmetic with an honest predicate.
  update tt_order_lines l
     set unit_price_paise = l.unit_price_paise + priced.sum_paise
    from (
      select x.sort_order, sum(x.price_paise)::bigint as sum_paise
        from tt_line_addons x
       group by x.sort_order
    ) priced
   where priced.sort_order = l.sort_order;

  select coalesce(sum(unit_price_paise * qty), 0)::bigint
    into v_subtotal_paise
    from tt_order_lines;

  -- Legacy off carries its old rate; reviewed off and composition carry
  -- no tax. 'regular' treats the menu price as
  -- tax-inclusive and extracts tax at document level (one rounding).
  select p.mode, p.rate_bps, p.config_version
    into v_gst_mode, v_gst_rate, v_gst_version
    from public.gst_pricing(v_restaurant_id) p;

  v_discount_paise := 0;
  if v_gst_mode = 'composition' then
    v_tax_bps := 0;
    v_taxable_paise := greatest(v_subtotal_paise, 0);
    v_tax_paise := 0;
    v_total_paise := v_taxable_paise;
  elsif v_gst_mode = 'regular' then
    v_tax_bps := v_gst_rate;
    v_inclusive_paise := greatest(v_subtotal_paise, 0);
    v_taxable_paise := round(v_inclusive_paise::numeric * 10000 / (10000 + v_tax_bps))::bigint;
    v_tax_paise := v_inclusive_paise - v_taxable_paise;
    v_total_paise := v_inclusive_paise;
  else
    v_gst_mode := 'off';
    v_gst_version := coalesce(v_gst_version, 0);
    v_tax_bps := coalesce(v_gst_rate, v_restaurant_tax_bps, k_default_tax_bps);
    v_taxable_paise := greatest(v_subtotal_paise - v_discount_paise, 0);
    v_tax_paise := round(v_taxable_paise::numeric * v_tax_bps / 10000.0)::bigint;
    v_total_paise := v_taxable_paise + v_tax_paise;
  end if;

  v_prefix := upper(left(regexp_replace(coalesce(v_restaurant_name, 'AU'), '[^a-zA-Z]', '', 'g'), 2));
  if char_length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  v_code := v_prefix || '-' || (
    select string_agg(
             substr(k_alphabet, 1 + floor(random() * length(k_alphabet))::int, 1),
             ''
           )
      from generate_series(1, 5)
  );

  insert into public.orders (
    restaurant_id,
    table_id,
    code,
    customer_note,
    prep_status,
    payment_status,
    subtotal_paise,
    discount_paise,
    tax_paise,
    total_paise,
    gst_mode_snapshot,
    gst_config_version,
    tax_rate_bps_snapshot
  ) values (
    v_restaurant_id,
    v_table_id,
    v_code,
    v_note,
    'new',
    'pending',
    v_subtotal_paise,
    v_discount_paise,
    v_tax_paise,
    v_total_paise,
    v_gst_mode,
    v_gst_version,
    v_tax_bps
  )
  returning id into v_order_id;

  if v_order_id is null then
    raise exception 'The order could not be recorded.' using errcode = 'P0001';
  end if;

  insert into public.order_items (
    order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot, addons_snapshot
  )
  select
    v_order_id, item_id, name_snapshot, unit_price_paise, qty, is_veg, sort_order,
    variant_snapshot,
    coalesce((
      select array_agg(x.name order by x.pick)
        from tt_line_addons x
       where x.sort_order = tt_order_lines.sort_order
    ), array[]::text[])
    from tt_order_lines
   order by sort_order;

  return v_code;
end;
$$;

-- CREATE OR REPLACE preserves reviewed ACLs. New helpers inherit no client grants.
revoke all on function public.gst_financial_year_start(date), public.gst_valid_premises_evidence(jsonb,date),
  public.gst_pricing_at(uuid,date) from public, anon, authenticated, service_role;

comment on table public.restaurant_gst_config is
  'Outlet GST billing: regular = GST; off = No-GST unregistered; composition = No-GST Bill of Supply. NULL FSSAI identifies legacy rows, not completed onboarding.';

-- Keep the legacy fields and permissions for historical billing only.
create or replace function public.guard_restaurant_billing_configuration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.tax_rate_bps is distinct from old.tax_rate_bps
     or new.gstin is distinct from old.gstin then
    if v_actor is null or not public.has_restaurant_role(new.id, array['owner']) then
      raise exception 'Only the restaurant owner can change billing or tax configuration.'
        using errcode = '42501';
    end if;
    if exists (select 1 from public.restaurant_gst_config c where c.restaurant_id = old.id
      and (c.mode <> 'off' or c.fssai_number is not null)) then
      raise exception 'Legacy tax and GSTIN are inactive for this billing configuration.' using errcode = 'P0001';
    end if;
  end if;

  if new.tax_rate_bps is distinct from old.tax_rate_bps
     and (new.tax_rate_bps is null or new.tax_rate_bps < 0 or new.tax_rate_bps > 3000) then
    raise exception 'Enter a valid tax rate between 0 and 30 percent.'
      using errcode = '23514';
  end if;

  if new.gstin is distinct from old.gstin
     and new.gstin is not null
     and new.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Enter a GSTIN in the 15-character format or leave it blank.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_restaurant_billing_configuration() from public, anon, authenticated, service_role;

comment on function public.guard_restaurant_billing_configuration() is
  'Owner-only legacy tax/GSTIN updates; not writable for reviewed billing or a registered GST configuration.';
