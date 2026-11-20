-- Local document particulars and lock-order correction. No DML, identifier
-- backfill, change of treatment, or new API permissions. The existing owner
-- save, audit and issue RPCs already carry service_sac through to the snapshot.
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
  if new.mode <> 'regular' and (new.business_type is not null or new.premises_evidence is not null) then
    raise exception 'Business type and premises evidence apply only to Regular GST.' using errcode = '23514';
  end if;
  if new.mode = 'off' and new.service_sac is not null then
    raise exception 'Unregistered billing does not use the GST service SAC.' using errcode = '23514';
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
    if coalesce(new.service_sac, '') !~ '^[0-9]{6}$' then
      raise exception 'Enter the reviewed six-digit service SAC for the Composition Bill of Supply.' using errcode = '23514';
    end if;
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
  if v_config.mode = 'composition' and coalesce(v_config.service_sac,'') !~ '^[0-9]{6}$' then
    raise exception 'The Composition Bill of Supply requires a reviewed service SAC. Stop and ask the owner before billing.' using errcode = 'P0001';
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

-- Turnover readers already serialize against the writer's exclusive PAN lock.
-- Match the delivery path's shared lock; upgrading a shared lock in this
-- function deadlocks two concurrently admitted deliveries for the same PAN.
create or replace function public.gst_known_pan_turnover_paise(p_gstin text)
returns bigint language plpgsql set search_path = public, pg_temp as $$
declare
  v_pan text := substr(p_gstin,3,10);
  v_known bigint;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended(lower(v_pan),9132));
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

-- New notes need the original's recorded particulars. Current buyer master,
-- outlet settings, or a new form are not evidence of the original recipient.
-- A BEFORE INSERT refusal rolls back any provisional number reservation.
-- Preserve historical rows (including BOS adjustments) without rewriting them.
create or replace function public.gst_guard_note_particulars()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_source public.restaurant_invoices%rowtype;
  v_buyer jsonb := new.customer_snapshot;
  v_state text := v_buyer->>'state_code';
  v_gstin text := nullif(v_buyer->>'gstin','');
begin
  select i.* into v_source from public.restaurant_invoices i
    where i.id=new.invoice_id and i.restaurant_id=new.restaurant_id for share;
  if not found or v_source.status <> 'issued' or v_source.irp_status <> 'not_required' then
    raise exception 'The original document is unavailable, voided or held. Reconcile the original before issuing an adjustment.' using errcode = 'P0001';
  end if;
  if (new.source_document_number,new.source_issued_at,new.seller_snapshot,new.customer_snapshot)
      is distinct from (v_source.invoice_number,v_source.issued_at,v_source.seller_snapshot,v_source.customer_snapshot)
    or new.gst_snapshot->>'source_document_type' is distinct from v_source.document_type
    or jsonb_typeof(new.gst_snapshot->'rate_bps') is distinct from 'number'
    or new.gst_snapshot->'rate_bps' is distinct from v_source.gst_snapshot->'rate_bps'
    or nullif(btrim(coalesce(new.seller_snapshot->>'legal_name',new.seller_snapshot->>'name')),'') is null
    or nullif(btrim(new.seller_snapshot->>'address'),'') is null
    or not coalesce(public.gst_valid_gstin(new.seller_snapshot->>'gstin'),false) then
    raise exception 'The original lacks the saved supplier, reference or rate required for a GST adjustment.' using errcode = '23514';
  end if;
  if v_source.document_type <> 'gst_tax_invoice' then
    raise exception 'Bill of Supply corrections need owner review outside tax-note issuance. Do not recast the original as a tax invoice.' using errcode = '23514';
  end if;
  if new.document_type = 'credit_note' and v_source.gst_snapshot->>'supply_date' is null then
    raise exception 'The original supply date is not recorded. Review the credit-note reporting period outside this workflow.' using errcode = '23514';
  end if;
  if nullif(btrim(v_buyer->>'name'),'') is null or nullif(btrim(v_buyer->>'address'),'') is null
    or (v_gstin is not null and not coalesce(public.gst_valid_gstin(v_gstin),false))
    or (v_gstin is null and (v_buyer->>'recipient_type' is distinct from 'consumer'
      or coalesce(v_state,'') !~ '^(0[1-9]|[12][0-9]|3[0-8])$' or v_state in ('25','28')
      or nullif(btrim(v_buyer->>'delivery_address'),'') is null)) then
    raise exception 'Rule 53 requires original recipient particulars. Do not fill them from current settings; ask the owner to reconcile.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.gst_guard_note_particulars() from public, anon, authenticated, service_role;
create trigger gst_guard_note_particulars before insert on public.restaurant_notes
  for each row execute function public.gst_guard_note_particulars();
