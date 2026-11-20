-- Record an explicit onboarding deferral without switching tax mode, making
-- a registration declaration, reserving a number or modifying old profiles.
create table public.restaurant_gst_deferrals (
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  profile_version integer not null check (profile_version >= 0),
  reason text not null check (reason in ('registration','premises','series','review')),
  recorded_by uuid not null,
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (restaurant_id, profile_version)
);
alter table public.restaurant_gst_deferrals enable row level security;
revoke all on public.restaurant_gst_deferrals from public, anon, authenticated, service_role;

create or replace function public.record_gst_outlet_deferral(p_outlet uuid, p_expected_version integer, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_config public.restaurant_gst_config%rowtype;
begin
  if not public.has_restaurant_role(p_outlet,array['owner']) then
    raise exception 'Only the outlet owner can defer billing onboarding.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gst-outlet:' || p_outlet::text, 0));
  perform 1 from public.memberships m where m.restaurant_id=p_outlet and m.user_id=auth.uid() and m.role='owner' for share;
  if not found then raise exception 'Only the outlet owner can defer billing onboarding.' using errcode = '42501'; end if;
  if not public.restaurant_can_write(p_outlet) then raise exception 'This outlet is read-only.' using errcode = 'P0001'; end if;
  select c.* into v_config from public.restaurant_gst_config c where c.restaurant_id=p_outlet;
  if p_expected_version is distinct from coalesce(v_config.config_version,0) then
    raise exception 'Billing settings changed. Reload before recording a deferral.' using errcode = 'P0001';
  end if;
  if v_config.activation is not null then
    raise exception 'Deferral is for onboarding only; it cannot disable an active billing configuration.' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('registration','premises','series','review') then
    raise exception 'Select a reason for deferring onboarding.' using errcode = '23514';
  end if;
  insert into public.restaurant_gst_deferrals(restaurant_id,profile_version,reason,recorded_by)
    values(p_outlet,p_expected_version,p_reason,auth.uid()) on conflict do nothing;
  if not found and not exists (select 1 from public.restaurant_gst_deferrals d where d.restaurant_id=p_outlet
      and d.profile_version=p_expected_version and d.reason=p_reason) then
    raise exception 'A deferral is already recorded for this version; the original decision is retained.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.record_gst_outlet_deferral(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.record_gst_outlet_deferral(uuid,integer,text) to authenticated;

create or replace function public.list_gst_outlet_deferrals(p_outlet uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager']) then
    raise exception 'Owner or Manager permission is required.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.profile_version desc) from (
    select profile_version,reason,recorded_by,recorded_at from public.restaurant_gst_deferrals
     where restaurant_id=p_outlet order by profile_version desc limit 10
  ) d),'[]'::jsonb);
end;
$$;
revoke all on function public.list_gst_outlet_deferrals(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_gst_outlet_deferrals(uuid) to authenticated;

-- New 5% hotel saves must cover the supply year as well as the preceding
-- hotel's actual accommodation records. Opt-out cannot trump the room test.
create or replace function public.gst_valid_hotel_review(p_review jsonb,p_date date)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_fy integer := public.gst_financial_year_start(p_date);
  v_decl_fy integer;
  v_filed date;
begin
  if jsonb_typeof(p_review) is distinct from 'object'
     or p_review->'treatment_fy' is distinct from to_jsonb(v_fy)
     or p_review->'room_fy' is distinct from to_jsonb(v_fy-1)
     or coalesce(length(btrim(p_review->>'reference')),0) not between 2 and 120
     or p_review->'confirmed' is distinct from 'true'::jsonb then return false; end if;
  if p_review->>'room_basis' = 'actual' then
    if coalesce(p_review->>'max_room_paise','') !~ '^[0-9]{1,6}$'
        or (p_review->>'max_room_paise')::int not between 1 and 750000 then return false; end if;
  elsif p_review->>'room_basis' is distinct from 'no_supplies' or p_review->>'max_room_paise' is not null then return false;
  end if;
  if p_review->>'declaration_status' = 'none_in_force' then
    return p_review->>'opt_out_fy' is null and p_review->>'opt_out_filed' is null and p_review->>'opt_out_reference' is null;
  end if;
  if p_review->>'declaration_status' is distinct from 'opted_out'
     or coalesce(length(btrim(p_review->>'opt_out_reference')),0) not between 2 and 120
     or coalesce(p_review->>'opt_out_fy','') !~ '^[0-9]{4}$'
     or coalesce(p_review->>'opt_out_filed','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  v_decl_fy := (p_review->>'opt_out_fy')::int;
  v_filed := (p_review->>'opt_out_filed')::date;
  return v_decl_fy between 2025 and v_fy and v_filed between make_date(v_decl_fy,1,1) and make_date(v_decl_fy,3,31)
    and v_filed <= p_date;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.gst_valid_hotel_review(jsonb,date) from public, anon, authenticated, service_role;

-- Rule 10 registration can take effect before ARN. Filing remains ARN+15.
-- Additional places (15/2025-CTR) are not inferred from a normal ARN; no APoB route here.
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
  if p_evidence->>'basis' = 'room_supply' then return p_route is null and p_decl_fy is null
    and p_effective is not distinct from make_date(v_treatment,4,1); end if;
  if p_decl_fy is null or p_decl_fy not between 2025 and v_treatment
     or (p_decl_fy = 2025 and v_treatment > 2025) or p_effective is null then return false; end if;
  v_from := (p_evidence->>'filing_from')::date;
  v_through := (p_evidence->>'filing_through')::date;
  v_filed := (p_evidence->>'filed_on')::date;
  if p_route = 'annexure_vii' then
    return v_from = make_date(p_decl_fy,1,1) and v_through = make_date(p_decl_fy,3,31)
      and p_effective = make_date(v_treatment,4,1);
  elsif p_route = 'annexure_viii' then
    return p_registered is not null and p_registered >= date '2025-04-01' and p_registered <= p_today
      and public.gst_financial_year_start(p_registered) = p_decl_fy
      and v_through = v_from + 15 and v_filed between v_from and v_through
      and (case when p_decl_fy = v_treatment then p_effective = p_registered
              else p_effective = make_date(v_treatment,4,1) end);
  end if;
  return false;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;

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
     and not public.gst_valid_hotel_review(v_input->'hotel_review',p_today) then
    raise exception 'Record the preceding FY hotel room review and applicable declaration status before activating the five percent rate.' using errcode = '23514';
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
  return jsonb_build_object('version',3, 'effective_from',to_char(p_today,'YYYY-MM-DD'),
    'confirmed_at',statement_timestamp(), 'confirmed_by',auth.uid(),
    'premises_address',btrim(v_input->>'premises_address'),'premises_state_code',v_state,
    'invoice_phone',btrim(v_input->>'invoice_phone'),'series',v_series,'external_prefixes',v_external,
    'review_status',case when v_review is null then 'owner_attested' else 'adviser_reference_recorded' end,
    'adviser_reference',v_review,'declaration_route',case when v_decl_fy is not null then v_input->>'declaration_route' end,
    'declaration_fy',v_decl_fy, 'registration_effective_on',case when v_input->>'declaration_route' = 'annexure_viii' and v_decl_fy is not null then (v_input->>'registration_effective_on')::date end,
    'hotel_not_specified_confirmed',coalesce(p_mode = 'regular' and p_settings->>'business_type' = 'hotel' and p_settings->>'regular_profile' = 'other_than_specified_premises',false),
    'hotel_review',case when p_mode = 'regular' and p_settings->>'business_type' = 'hotel'
      and p_settings->>'regular_profile' = 'other_than_specified_premises' then (v_input->'hotel_review') - array(
        select k from jsonb_object_keys(v_input->'hotel_review') as keys(k)
        where k not in ('treatment_fy','room_fy','reference','confirmed','room_basis','max_room_paise',
          'declaration_status','opt_out_fy','opt_out_filed','opt_out_reference')) end,
    'aato',v_aato);
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Review the activation date, evidence and turnover formats.' using errcode = '23514';
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
     or (v_config.mode = 'regular' and v_rate = 500 and v_config.business_type = 'hotel'
       and (v_config.activation is null or case when v_config.activation->>'version' = '3'
         then not public.gst_valid_hotel_review(v_config.activation->'hotel_review',p_india_date)
         -- v2 had an affirmative review but no period field; do not extend it beyond the activation FY.
         else not coalesce(v_config.activation->'hotel_not_specified_confirmed' = 'true'::jsonb,false)
           or public.gst_financial_year_start((v_config.activation->>'effective_from')::date)
             is distinct from public.gst_financial_year_start(p_india_date) end))
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

