-- Tenant-scoped operational projections. No raw requests, signing key,
-- invoice JWS, arbitrary response text, or lease token reaches the Data API.
create or replace function public.report_irp_register(p_outlet uuid,p_limit integer default 100,
  p_from date default null,p_until date default null,p_followup boolean default false,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  n integer := least(greatest(coalesce(p_limit,100),0),10000);
  skip_rows integer := least(greatest(coalesce(p_offset,0),0),1000000);
  today date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager']) then raise exception 'Outlet finance permission required.' using errcode='42501'; end if;
  if (p_from is null) <> (p_until is null) or p_until<=p_from or p_until-p_from>366 then
    raise exception 'Select a valid India date range of at most 366 days.' using errcode='22023';
  end if;
  return (with config as (
    select c.mode,c.gstin,c.config_version,c.activation->'aato' aato,
      case when c.mode='regular' then public.gst_scoped_irp_facts(c.gstin,c.activation,c.preceding_fy_turnover_paise,today) end irp_facts
    from public.restaurant_gst_config c where c.restaurant_id=p_outlet
  ), rows as (
    select d.id,d.preflight_id,d.phase,d.tier,d.issue_date,least(d.reporting_deadline,d.attempted_deadline,
      case when c.gstin=r.seller_gstin and c.aato->'review_fy'=to_jsonb(public.gst_financial_year_start(today))
        and c.aato->>'reporting_category'='at_least_10cr' and d.phase in ('queued','retryable','expired') then d.issue_date+29 end) reporting_deadline,
      d.reporting_category,d.rule_version,r.available route_available,coalesce(rc.route_id=r.id,false) route_selected,
      (d.phase='accepted' and a.dispatch_id is not null) verified_active,
      d.revision,d.generation_attempts,d.cancellation_attempts,d.lookup_attempts,d.created_at,d.updated_at,
      d.next_action_at,coalesce(j.invoice_id,j.note_id) document_id,
      case when j.invoice_id is not null then 'invoice' else 'note' end kind,
      j.request_payload->'DocDtls'->>'No' number,r.provider_key,r.api_version,
      (select e.code from public.irp_dispatch_events e where e.dispatch_id=d.id order by e.revision desc limit 1) last_code
    from public.irp_dispatches d join public.restaurant_irp_jobs j on j.id=d.preflight_id
      join public.irp_routes r on r.id=d.route_id and r.outlet_id=d.outlet_id
      left join public.irp_verified_artifacts a on a.dispatch_id=d.id and a.tier=d.tier
      left join config c on true left join public.irp_route_choices rc on rc.outlet_id=d.outlet_id
      where d.outlet_id=p_outlet and (p_from is null or d.issue_date>=p_from and d.issue_date<p_until)
        and (not coalesce(p_followup,false) or d.phase not in ('accepted','cancelled') or a.dispatch_id is null)
  ), batches as (
    select tier,phase,count(*) count from rows group by tier,phase
  ), provider_stats as (
    select x.provider_key,x.api_version,x.tier,count(*) filter(where e.latency_ms is not null) calls,
      round(avg(e.latency_ms)) latency_mean_ms,max(e.latency_ms) latency_max_ms,
      count(*) filter(where e.code in ('declined','uncertain','invalid_reply','invalid_request','lease_expired','cancel_blocked')) failures
      from rows x join public.irp_dispatch_events e on e.dispatch_id=x.id group by 1,2,3
  ), missing as (
    select i.id document_id,'invoice' kind,i.invoice_number number,i.issued_at,i.gst_snapshot->'irp_evidence' evidence
    from public.restaurant_invoices i where i.restaurant_id=p_outlet and i.status='issued' and i.document_type='gst_tax_invoice'
      and i.irp_status<>'not_required' and not exists(select 1 from public.restaurant_irp_jobs j where j.outlet_id=p_outlet and j.invoice_id=i.id and j.environment='offline')
    union all
    select n.id,'note',n.document_number,n.issued_at,n.gst_snapshot->'irp_evidence'
    from public.restaurant_notes n where n.restaurant_id=p_outlet and n.status='issued' and n.irp_status<>'not_required'
      and not exists(select 1 from public.restaurant_irp_jobs j where j.outlet_id=p_outlet and j.note_id=n.id and j.environment='offline')
  ), drafts as (
    select j.id,j.created_at,coalesce(j.invoice_id,j.note_id) document_id,j.request_payload->'DocDtls'->>'No' number,
      case when j.invoice_id is not null then 'invoice' else 'note' end kind, j.payload_version
      from public.restaurant_irp_jobs j left join public.restaurant_invoices i on i.id=j.invoice_id and i.restaurant_id=j.outlet_id
      left join public.restaurant_notes k on k.id=j.note_id and k.restaurant_id=j.outlet_id
      where j.outlet_id=p_outlet and j.environment='offline' and coalesce(i.status,k.status)='issued'
        and not exists(select 1 from public.irp_dispatches d where d.preflight_id=j.id)
      order by j.created_at desc,j.id limit 100
  ) select jsonb_build_object('outlet',p_outlet,'total',(select count(*) from rows),
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc,id) from (select * from rows order by created_at desc,id limit n offset skip_rows) x),'[]'),
    'as_of_india',today,'verified_authority',(select count(*) from rows where tier='authority' and verified_active),
    'verified_simulation',(select count(*) from rows where tier='simulation' and verified_active),
    'missing_count',(select count(*) from missing),
    'missing',coalesce((select jsonb_agg(to_jsonb(x) order by issued_at desc,document_id)
      from (select document_id,kind,number,issued_at,evidence->>'applicability' applicability,evidence->>'rule_version' rule_version
        from missing order by issued_at desc,document_id limit 25) x),'[]'),
    'breakdown',coalesce((select jsonb_agg(to_jsonb(b) order by tier,phase) from batches b),'[]'),
    'providers',coalesce((select jsonb_agg(to_jsonb(s) order by tier,provider_key,api_version) from provider_stats s),'[]'),
    'drafts',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc,id) from drafts x),'[]'),
    'routing',coalesce((select jsonb_build_object('route',c.route_id,'revision',c.revision,'available',coalesce(r.available,false))
      from public.irp_route_choices c left join public.irp_routes r on r.id=c.route_id and r.outlet_id=p_outlet where c.outlet_id=p_outlet),
      jsonb_build_object('route',null,'revision',0,'available',false)),
    'routes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'provider',r.provider_key,'tier',r.tier,'api_version',r.api_version,
      'schema_version',r.schema_version) order by r.provider_key,r.id)
      from public.irp_routes r join public.restaurant_gst_config g on g.restaurant_id=r.outlet_id and g.gstin=r.seller_gstin and g.mode='regular'
      where r.outlet_id=p_outlet and r.available),'[]'),
    'eligibility',coalesce((select jsonb_build_object('mode',c.mode,'review_fy',c.aato->'review_fy',
      'mandate',c.irp_facts->>'applicability','reporting_category',c.irp_facts->>'reporting_category','version',c.config_version) from config c),'{}')));
end;
$$;

create or replace function public.read_irp_dispatch(p_outlet uuid,p_job uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager']) then raise exception 'Outlet finance permission required.' using errcode='42501'; end if;
  return (select jsonb_build_object('id',d.id,'phase',d.phase,'revision',d.revision,'tier',d.tier,'number',j.request_payload->'DocDtls'->>'No',
    'generation_attempts',d.generation_attempts,'cancellation_attempts',d.cancellation_attempts,'lookup_attempts',d.lookup_attempts,
    'provider',r.provider_key,'api_version',r.api_version,'schema_version',r.schema_version,'issue_date',d.issue_date,
    'route_available',r.available,'route_selected',coalesce(rc.route_id=d.route_id,false),
    'rule_version',d.rule_version,'reporting_category',d.reporting_category,'reporting_deadline',least(d.reporting_deadline,d.attempted_deadline),
    'next_action_at',d.next_action_at,'cancelled_at',d.cancelled_at,'cancel_reason',d.cancel_reason,'document_id',coalesce(j.invoice_id,j.note_id),
    'kind',case when j.invoice_id is not null then 'invoice' else 'note' end,
    'copy',case when d.phase='accepted' and a.tier=d.tier and coalesce(i.status,k.status)='issued' then jsonb_build_object('tier',a.tier,'reference',a.reference,'number',a.ack_number,
       'at',a.acknowledged_at,'qr',a.signed_qr) end,
    'events',coalesce((select jsonb_agg(jsonb_build_object('revision',e.revision,'phase',e.phase,'code',e.code,'actor',e.actor,'at',e.at,'reason_code',e.reason_code,
      'latency_ms',e.latency_ms,'response_sha256',e.response_sha256) order by e.revision) from public.irp_dispatch_events e where e.dispatch_id=d.id),'[]'))
    from public.irp_dispatches d join public.restaurant_irp_jobs j on j.id=d.preflight_id
      join public.irp_routes r on r.id=d.route_id and r.outlet_id=d.outlet_id left join public.irp_verified_artifacts a on a.dispatch_id=d.id
      left join public.irp_route_choices rc on rc.outlet_id=d.outlet_id
      left join public.restaurant_invoices i on i.id=j.invoice_id and i.restaurant_id=d.outlet_id
      left join public.restaurant_notes k on k.id=j.note_id and k.restaurant_id=d.outlet_id
      where d.outlet_id=p_outlet and d.id=p_job);
end;
$$;

create or replace function public.irp_active_authority(p_outlet uuid,p_document uuid,p_kind text) returns jsonb
language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('tier',a.tier,'reference',a.reference,'number',a.ack_number,'at',a.acknowledged_at,'qr',a.signed_qr)
    from public.irp_dispatches d join public.restaurant_irp_jobs j on j.id=d.preflight_id
      join public.irp_verified_artifacts a on a.dispatch_id=d.id and a.tier='authority'
    where d.outlet_id=p_outlet and j.outlet_id=p_outlet and d.tier='authority' and d.phase='accepted'
      and ((p_kind='invoice' and j.invoice_id=p_document) or (p_kind='note' and j.note_id=p_document))
$$;
create or replace function public.read_active_irp_document(p_outlet uuid,p_document uuid,p_kind text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (p_kind='invoice' and public.has_restaurant_role(p_outlet,array['owner','manager','cashier'])
      and exists(select 1 from public.restaurant_invoices i where i.id=p_document and i.restaurant_id=p_outlet and i.status='issued'
         and i.document_type='gst_tax_invoice' and i.irp_status in ('pending','failed','generated')))
    or (p_kind='note' and public.has_restaurant_role(p_outlet,array['owner','manager'])
      and exists(select 1 from public.restaurant_notes n where n.id=p_document and n.restaurant_id=p_outlet and n.status='issued'
         and n.irp_status in ('pending','failed','generated'))) then
    return public.irp_active_authority(p_outlet,p_document,p_kind);
  end if;
  return null;
end;
$$;
revoke all on function public.report_irp_register(uuid,integer,date,date,boolean,integer),public.read_irp_dispatch(uuid,uuid),public.irp_active_authority(uuid,uuid,text),
  public.read_active_irp_document(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.report_irp_register(uuid,integer,date,date,boolean,integer),public.read_irp_dispatch(uuid,uuid),public.read_active_irp_document(uuid,uuid,text) to authenticated;

-- Same existing adjustment rules, plus a private authoritative release
-- may satisfy the original-IRN gate. Test artifacts can never do so.
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
     and v_invoice.irp_status <> 'not_required'
     and public.irp_active_authority(v_invoice.restaurant_id,v_invoice.id,'invoice') is null then
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
  if not found or v_source.status <> 'issued' or (v_source.irp_status <> 'not_required'
    and public.irp_active_authority(v_source.restaurant_id,v_source.id,'invoice') is null) then
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
