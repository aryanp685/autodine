-- GST configuration is a financial write, not a general settings update.
-- Forward only: do not infer classifications, opt in outlets or rewrite history.

alter table public.restaurant_gst_config_history
  add column off_declared boolean,
  add column off_declared_at timestamptz,
  add column specified_premises_effective_from date;

create or replace function public.gst_valid_gstin(p_gstin text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_total integer := 0;
  v_digit integer;
begin
  -- Same layout, state range and Mod-36 as lib/gst/gstin.ts. This is not a
  -- registration lookup, and never asserts a business's eligibility.
  if p_gstin is null or p_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
    return false;
  end if;
  if substring(p_gstin, 1, 2)::integer not between 1 and 38 then return false; end if;
  for i in 1..14 loop
    v_digit := (strpos(v_alphabet, substring(p_gstin, i, 1)) - 1) * (1 + (1 - i % 2));
    v_total := v_total + v_digit / 36 + v_digit % 36;
  end loop;
  return substring(p_gstin, 15, 1) = substring(v_alphabet, (36 - v_total % 36) % 36 + 1, 1);
end;
$$;

create or replace function public.gst_profile_rate(p_profile text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_profile when 'other_than_specified_premises' then 500 when 'specified_premises' then 1800 end;
$$;

create or replace function public.restaurant_gst_config_validate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'A GST configuration cannot be moved to another outlet.' using errcode = '42501';
  end if;
  if new.mode = 'off' then
    if not new.off_declared then
      raise exception 'Confirm the Normal Billing declaration before selecting normal receipts.' using errcode = '23514';
    end if;
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
    if public.gst_profile_rate(new.regular_profile) is null then
      raise exception 'Choose one of the two supported Regular GST profiles.' using errcode = '23514';
    end if;
    if new.regular_profile = 'specified_premises' then
      if not new.specified_premises_attested then
        raise exception 'The 18%% specified-premises profile requires the owner attestation.' using errcode = '23514';
      end if;
      if new.specified_premises_effective_from is null
         or new.specified_premises_effective_from not between date '2025-04-01'
           and (statement_timestamp() at time zone 'Asia/Kolkata')::date then
        raise exception 'The specified-premises effective date must be on or after 1 April 2025 and cannot be in the future.' using errcode = '23514';
      end if;
    else
      new.specified_premises_attested := false;
    end if;
  end if;
  return new;
end;
$$;

-- Serialize identity checks only within a commercial account. Independent
-- AutoDine tenants cannot block each other by typing the same identifier.
-- Validation across legal registrations outside the account is the owner's job.
create or replace function public.restaurant_gst_config_shared_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid;
  v_pan text := substr(new.gstin, 3, 10);
begin
  if new.mode = 'off' or new.gstin is null then return new; end if;
  select r.account_id into v_account from public.restaurants r where r.id = new.restaurant_id;
  if v_account is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('gst-account:' || v_account::text, 0));
  if exists (
    select 1 from public.restaurant_gst_config c
    join public.restaurants r on r.id = c.restaurant_id
    where r.account_id = v_account and c.restaurant_id <> new.restaurant_id and c.mode <> 'off'
      and c.gstin = new.gstin
      and (btrim(c.legal_name), c.registration_type, c.state_code)
          is distinct from (btrim(new.legal_name), new.registration_type, new.state_code)
  ) then
    raise exception 'Outlets in this account sharing a GSTIN must have the same legal name, registration type and state code.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.restaurant_gst_config c
    join public.restaurants r on r.id = c.restaurant_id
    where r.account_id = v_account and c.restaurant_id <> new.restaurant_id and c.mode <> 'off'
      and substr(c.gstin, 3, 10) = v_pan and c.registration_type <> new.registration_type
  ) then
    raise exception 'GSTINs under the same PAN in this account must share the same registration type.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Use the same outlet lock as the pricing transaction, including the first
-- insert when there is no config row to lock, and the Composition item gate.
create or replace function public.reject_alcohol_straddle_composition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'items' then
    if not new.is_alcoholic then return new; end if;
    if tg_op = 'UPDATE' and new.is_alcoholic = old.is_alcoholic and new.restaurant_id = old.restaurant_id then
      return new;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('gst-outlet:' || new.restaurant_id::text, 0));
    if exists (select 1 from public.restaurant_gst_config c where c.restaurant_id = new.restaurant_id and c.mode = 'composition') then
      raise exception 'Composition Scheme does not permit alcoholic liquor. Review the registered billing mode before adding or marking an alcoholic item.' using errcode = '23514';
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('gst-outlet:' || new.restaurant_id::text, 0));
    if new.mode = 'composition' and exists (
      select 1 from public.items i where i.restaurant_id = new.restaurant_id and i.is_alcoholic
    ) then
      raise exception 'This outlet has alcoholic items. Composition billing cannot be activated while they exist.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger restaurant_gst_config_no_alcohol on public.restaurant_gst_config;
create trigger restaurant_gst_config_no_alcohol
  before insert or update on public.restaurant_gst_config
  for each row execute function public.reject_alcohol_straddle_composition();
drop trigger items_no_alcohol_under_composition on public.items;
create trigger items_no_alcohol_under_composition
  before insert or update of is_alcoholic, restaurant_id on public.items
  for each row execute function public.reject_alcohol_straddle_composition();

create or replace function public.restaurant_gst_config_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.config_version := 1;
    new.created_at := statement_timestamp();
  else
    new.config_version := old.config_version + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := statement_timestamp();
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
    einvoice_location, einvoice_pincode, einvoice_hsn_sac, changed_by, changed_at
  ) values (
    new.restaurant_id, new.config_version, new.mode, new.regular_profile, new.gstin, new.legal_name,
    new.trade_name, new.address, new.state_code, new.pan, new.registration_type,
    new.composition_acknowledged, new.specified_premises_attested, new.specified_premises_effective_from,
    new.off_declared, new.off_declared_at, new.preceding_fy_turnover_paise,
    new.einvoice_location, new.einvoice_pincode, new.einvoice_hsn_sac, new.updated_by, new.updated_at
  );
  return new;
end;
$$;

-- No raw writes via the Data API, even by an owner. Keep the live-mode read
-- for finance administrators only. Checkout reads its ticket mode from the
-- order, not the entire current registration/turnover profile.
revoke all on public.restaurant_gst_config, public.restaurant_gst_config_history from public, anon, authenticated, service_role;
grant select on public.restaurant_gst_config, public.restaurant_gst_config_history to authenticated;
drop policy restaurant_gst_config_owner_manager_write on public.restaurant_gst_config;
drop policy restaurant_gst_config_owner_manager_update on public.restaurant_gst_config;
drop policy restaurant_gst_config_history_staff_read on public.restaurant_gst_config_history;
create policy restaurant_gst_config_history_finance_read on public.restaurant_gst_config_history
  for select to authenticated using (public.has_restaurant_role(restaurant_id, array['owner','manager']));
drop policy restaurant_gst_config_staff_read on public.restaurant_gst_config;
create policy restaurant_gst_config_finance_read on public.restaurant_gst_config
  for select to authenticated using (public.has_restaurant_role(restaurant_id, array['owner','manager']));

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
    raise exception 'Choose Normal Billing, Regular GST or Composition.' using errcode = '22023';
  end if;
  if v_mode = 'off' then
    if p_settings->'off_has_obligation' is distinct from 'false'::jsonb
       or p_settings->'off_declared' is distinct from 'true'::jsonb then
      raise exception 'Normal receipts require the declaration and cannot be used for a declared GST obligation.' using errcode = '23514';
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

  if v_mode = 'off' then
    -- Keep the last entered registration details for the owner's convenience;
    -- they are inactive and do not contribute to pricing or any document.
    insert into public.restaurant_gst_config (restaurant_id, mode, off_declared)
    values (p_restaurant_id, 'off', true)
    on conflict (restaurant_id) do update set mode = 'off', off_declared = true
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
      preceding_fy_turnover_paise, einvoice_location, einvoice_pincode, einvoice_hsn_sac
    ) values (
      p_restaurant_id, v_mode, v_input.regular_profile, v_input.gstin, v_input.legal_name, v_input.trade_name,
      v_input.address, substr(v_input.gstin, 1, 2), substr(v_input.gstin, 3, 10), v_input.registration_type,
      v_mode = 'composition', coalesce(p_settings->'specified_premises_attested' = 'true'::jsonb, false),
      v_input.specified_premises_effective_from, v_input.preceding_fy_turnover_paise,
      v_input.einvoice_location, v_input.einvoice_pincode, v_input.einvoice_hsn_sac
    ) on conflict (restaurant_id) do update set
      mode = excluded.mode, regular_profile = excluded.regular_profile, gstin = excluded.gstin,
      legal_name = excluded.legal_name, trade_name = excluded.trade_name, address = excluded.address,
      state_code = excluded.state_code, pan = excluded.pan, registration_type = excluded.registration_type,
      composition_acknowledged = excluded.composition_acknowledged,
      specified_premises_attested = excluded.specified_premises_attested,
      specified_premises_effective_from = excluded.specified_premises_effective_from,
      preceding_fy_turnover_paise = excluded.preceding_fy_turnover_paise,
      einvoice_location = excluded.einvoice_location, einvoice_pincode = excluded.einvoice_pincode,
      einvoice_hsn_sac = excluded.einvoice_hsn_sac
    returning config_version into v_version;
  end if;
  return v_version;
end;
$$;

revoke all on function public.gst_valid_gstin(text), public.gst_profile_rate(text),
  public.restaurant_gst_config_validate(), public.restaurant_gst_config_version(),
  public.restaurant_gst_config_history_track(), public.restaurant_gst_config_shared_identity(),
  public.reject_alcohol_straddle_composition(), public.save_restaurant_gst_config(uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_restaurant_gst_config(uuid, integer, jsonb) to authenticated;
