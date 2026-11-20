-- Private outbox/evidence format: only offline preparation can be recorded
-- by the current application. There is no dispatch credential, worker grant,
-- acknowledgment RPC, fake signed artifact, or route to release an IRN hold.
create table public.restaurant_irp_jobs (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.restaurants(id) on delete restrict,
  invoice_id uuid references public.restaurant_invoices(id) on delete restrict,
  note_id uuid references public.restaurant_notes(id) on delete restrict,
  environment text not null check (environment in ('offline','provider_test','provider_live')),
  document_key text not null,
  canonical_sha256 text not null check (canonical_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  payload_version text not null check (payload_version = '1.1'),
  request_payload jsonb not null,
  status text not null check (status in ('prepared_offline','prepared','dispatching','reconcile','retryable','rejected','verified','cancel_dispatching','cancelled')),
  provider_id text,
  response_snapshot jsonb,
  requested_by uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (environment,document_key),
  check ((invoice_id is null) <> (note_id is null)),
  check ((status = 'prepared_offline') = (environment = 'offline')),
  check (environment <> 'offline' or (response_snapshot is null and provider_id is null))
);
alter table public.restaurant_irp_jobs enable row level security;
revoke all on public.restaurant_irp_jobs from public, anon, authenticated, service_role;

-- Match the application projection exactly using integer-quotient/remainder
-- arithmetic. Allocations split saved paise, not reprice a finalized line.
create or replace function public.gst_irp_allocate_paise(p_weights bigint[],p_total bigint)
returns bigint[] language sql immutable set search_path = pg_catalog as $$
  with weights as (
    select ord, case when sum(weight) over () = 0 then 1 else weight end::numeric as weight
    from unnest(p_weights) with ordinality w(weight,ord)
  ), parts as (
    select ord, div(weight*p_total,sum(weight) over ())::bigint as base,
      mod(weight*p_total,sum(weight) over ()) as frac
    from weights
  ), ranked as (
    select ord, base, p_total-sum(base) over () as remainder, row_number() over (order by frac desc,ord) as priority
    from parts
  )
  select array_agg(base + case when priority <= remainder then 1 else 0 end order by ord) from ranked;
$$;
revoke all on function public.gst_irp_allocate_paise(bigint[],bigint) from public, anon, authenticated, service_role;

create or replace function public.record_gst_irp_preflight(
  p_outlet uuid, p_document uuid, p_kind text, p_canonical_sha256 text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_document record;
  v_seller text;
  v_doc_type text;
  v_doc_date date;
  v_source uuid;
  v_items jsonb;
  v_phone text;
  v_buyer_phone text;
  v_weights bigint[];
  v_gross bigint;
  v_taxable bigint[];
  v_cgst bigint[];
  v_sgst bigint[];
  v_key text;
  v_fingerprint text;
  v_job public.restaurant_irp_jobs%rowtype;
  v_existing boolean := false;
begin
  perform 1 from public.memberships m where m.restaurant_id=p_outlet and m.user_id=auth.uid() and m.role='owner' for share;
  if not found then raise exception 'Only the outlet owner can record offline IRP preparation.' using errcode = '42501'; end if;
  if not public.restaurant_can_write(p_outlet) then raise exception 'This outlet is read-only.' using errcode = 'P0001'; end if;
  if p_kind = 'invoice' then
    select i.id as source_id,i.status,i.irp_status,i.document_type,i.invoice_number as number,i.issued_at,i.seller_snapshot,i.customer_snapshot,i.gst_snapshot,i.totals_snapshot,
      null::text as source_document_number, null::timestamptz as source_issued_at
      into v_document from public.restaurant_invoices i
      where i.id=p_document and i.restaurant_id=p_outlet for share;
  elsif p_kind = 'note' then
    select n.invoice_id as source_id,n.status,n.irp_status,n.document_type,n.document_number as number,n.issued_at,n.seller_snapshot,n.customer_snapshot,n.gst_snapshot,n.totals_snapshot,
      n.source_document_number,n.source_issued_at into v_document from public.restaurant_notes n
      where n.id=p_document and n.restaurant_id=p_outlet for share;
  else raise exception 'Invalid document kind.' using errcode = '22023';
  end if;
  if not found or v_document.status <> 'issued' or v_document.irp_status not in ('pending','failed') then
    raise exception 'No issued IRN-held document in this outlet.' using errcode = 'P0001';
  end if;
  -- A note must still reference an issued, same-outlet source. Use a shared
  -- row lock so a concurrent void cannot invalidate this evidence mid-write.
  if p_kind = 'note' then
    perform 1 from public.restaurant_invoices i
      where i.id=v_document.source_id and i.restaurant_id=p_outlet and i.status='issued'
        and i.document_type='gst_tax_invoice' and i.invoice_number=v_document.source_document_number
        and i.issued_at=v_document.source_issued_at for share;
    if not found then raise exception 'Offline note source is unavailable.' using errcode = '23514'; end if;
  end if;
  v_phone := nullif(regexp_replace(v_document.seller_snapshot->>'phone','[^0-9]','','g'),'');
  v_buyer_phone := nullif(regexp_replace(v_document.customer_snapshot->>'phone','[^0-9]','','g'),'');
  v_doc_type := case v_document.document_type when 'gst_tax_invoice' then 'INV' when 'credit_note' then 'CRN' when 'debit_note' then 'DBN' end;
  v_source := v_document.source_id;
  v_items := p_payload->'ItemList';
  v_seller := v_document.seller_snapshot->>'gstin';
  v_doc_date := (v_document.issued_at at time zone 'Asia/Kolkata')::date;
  if v_doc_type is null or v_seller is null or v_document.customer_snapshot->>'gstin' is null
     or v_document.gst_snapshot->'irp_evidence'->>'rule_version' is distinct from '13-2020-amended-10-2023'
     or v_document.gst_snapshot->'irp_evidence'->>'applicability' is distinct from 'required'
     or v_document.gst_snapshot->>'issued_local_date' is distinct from to_char(v_doc_date,'YYYY-MM-DD')
     or coalesce(p_canonical_sha256,'') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 524288
     or p_payload - array['Version','TranDtls','DocDtls','SellerDtls','BuyerDtls','ItemList','ValDtls','RefDtls'] <> '{}'::jsonb
     or p_payload->'TranDtls' is distinct from '{"TaxSch":"GST","SupTyp":"B2B","RegRev":"N","IgstOnIntra":"N"}'::jsonb
     or (p_payload->'DocDtls') - array['No','Typ','Dt'] <> '{}'::jsonb
     or (p_payload->'SellerDtls') - array['Gstin','LglNm','Addr1','Addr2','Loc','Pin','Stcd','Ph'] <> '{}'::jsonb
     or (p_payload->'BuyerDtls') - array['Gstin','LglNm','Addr1','Addr2','Loc','Pin','Stcd','Pos','Ph','Em'] <> '{}'::jsonb
     or (p_payload->'ValDtls') - array['AssVal','CgstVal','SgstVal','IgstVal','TotInvVal'] <> '{}'::jsonb
     or p_payload->>'Version' is distinct from '1.1'
     or p_payload->'DocDtls'->>'No' is distinct from v_document.number
     or p_payload->'DocDtls'->>'Typ' is distinct from v_doc_type
     or p_payload->'DocDtls'->>'Dt' is distinct from to_char(v_doc_date,'DD/MM/YYYY')
     or p_payload->'SellerDtls'->>'Gstin' is distinct from v_seller
     or p_payload->'BuyerDtls'->>'Gstin' is distinct from v_document.customer_snapshot->>'gstin'
     or p_payload->'SellerDtls'->>'LglNm' is distinct from v_document.seller_snapshot->>'legal_name'
     or p_payload->'SellerDtls'->>'Stcd' is distinct from v_document.seller_snapshot->>'state_code'
     or p_payload->'SellerDtls'->'Ph' is distinct from to_jsonb(v_phone)
     or coalesce(v_phone,'000000') !~ '^[0-9]{6,12}$'
     or p_payload->'BuyerDtls'->'Ph' is distinct from to_jsonb(v_buyer_phone)
     or coalesce(v_buyer_phone,'000000') !~ '^[0-9]{6,12}$'
     or p_payload->'BuyerDtls'->'Em' is distinct from to_jsonb(v_document.customer_snapshot->>'email')
     or coalesce(length(v_document.customer_snapshot->>'email'),0) > 100
     or p_payload->'SellerDtls'->>'Loc' is distinct from v_document.seller_snapshot->>'einvoice_location'
     or p_payload->'SellerDtls'->'Pin' is distinct from to_jsonb((v_document.seller_snapshot->>'einvoice_pincode')::integer)
     or concat(p_payload->'SellerDtls'->>'Addr1', p_payload->'SellerDtls'->>'Addr2') is distinct from regexp_replace(btrim(v_document.seller_snapshot->>'address'),'[[:space:]]+',' ','g')
     or p_payload->'BuyerDtls'->>'LglNm' is distinct from v_document.customer_snapshot->>'name'
     or p_payload->'BuyerDtls'->>'Stcd' is distinct from v_document.customer_snapshot->>'state_code'
     or p_payload->'BuyerDtls'->>'Loc' is distinct from v_document.customer_snapshot->>'location'
     or p_payload->'BuyerDtls'->'Pin' is distinct from to_jsonb((v_document.customer_snapshot->>'pincode')::integer)
     or concat(p_payload->'BuyerDtls'->>'Addr1', p_payload->'BuyerDtls'->>'Addr2') is distinct from regexp_replace(btrim(v_document.customer_snapshot->>'address'),'[[:space:]]+',' ','g')
     or p_payload->'ValDtls' is distinct from jsonb_build_object(
       'AssVal',(v_document.gst_snapshot->>'taxable_paise')::numeric/100,
       'CgstVal',(v_document.gst_snapshot->>'cgst_paise')::numeric/100,
       'SgstVal',(v_document.gst_snapshot->>'sgst_paise')::numeric/100,
       'IgstVal',(v_document.gst_snapshot->>'igst_paise')::numeric/100,
       'TotInvVal',(v_document.totals_snapshot->>'total_paise')::numeric/100)
     or p_payload->'BuyerDtls'->>'Pos' is distinct from v_document.gst_snapshot->>'place_of_supply_state_code'
     or (p_kind='invoice' and p_payload ? 'RefDtls')
     or (p_kind='note' and p_payload->'RefDtls' is distinct from jsonb_build_object('PrecDocDtls',jsonb_build_array(jsonb_build_object(
       'InvNo',v_document.source_document_number,'InvDt',to_char(v_document.source_issued_at at time zone 'Asia/Kolkata','DD/MM/YYYY'))))) then
    raise exception 'Offline payload does not match the immutable document evidence.' using errcode = '23514';
  end if;
  if jsonb_typeof(v_items) is distinct from 'array' then
    raise exception 'The offline request needs an item array.' using errcode = '23514';
  end if;
  select array_agg((l.line_snapshot->>'amount_paise')::bigint order by l.line_number),sum((l.line_snapshot->>'amount_paise')::bigint)
    into v_weights,v_gross from public.restaurant_invoice_lines l where l.invoice_id=v_source and l.restaurant_id=p_outlet;
  if jsonb_array_length(v_items) not between 1 and 1000 or jsonb_array_length(v_items) is distinct from cardinality(v_weights)
     or v_gross is distinct from (v_document.totals_snapshot->>'total_paise')::bigint
     or array_position(v_weights,null) is not null then
    raise exception 'Offline request line count does not match the saved invoice.' using errcode = '23514';
  end if;
  v_taxable := public.gst_irp_allocate_paise(v_weights,(v_document.gst_snapshot->>'taxable_paise')::bigint);
  v_cgst := public.gst_irp_allocate_paise(v_taxable,(v_document.gst_snapshot->>'cgst_paise')::bigint);
  v_sgst := public.gst_irp_allocate_paise(v_taxable,(v_document.gst_snapshot->>'sgst_paise')::bigint);
  if (v_document.gst_snapshot->>'igst_paise')::bigint is distinct from 0::bigint
     or (v_document.gst_snapshot->>'taxable_paise')::bigint + (v_document.gst_snapshot->>'cgst_paise')::bigint
       + (v_document.gst_snapshot->>'sgst_paise')::bigint is distinct from v_gross
     or exists (select 1 from jsonb_array_elements(v_items) with ordinality a(item,num)
       left join public.restaurant_invoice_lines l on l.invoice_id=v_source and l.restaurant_id=p_outlet and l.line_number=a.num
       where l.id is null or a.item is distinct from jsonb_build_object(
         'SlNo',a.num::text,'PrdDesc',coalesce(nullif(left(btrim(l.line_snapshot->>'item_name'),300),''),'Item '||a.num::text),
         'IsServc','Y','HsnCd',v_document.gst_snapshot->>'service_sac','Qty',l.line_snapshot->'quantity',
         'UnitPrice',round(v_taxable[a.num]::numeric / nullif((l.line_snapshot->>'quantity')::numeric,0) / 100,3),
         'TotAmt',v_taxable[a.num]::numeric/100,'Discount',0,'AssAmt',v_taxable[a.num]::numeric/100,
         'GstRt',(v_document.gst_snapshot->>'rate_bps')::numeric/100,'CgstAmt',v_cgst[a.num]::numeric/100,
         'SgstAmt',v_sgst[a.num]::numeric/100,'IgstAmt',0,'TotItemVal',(v_taxable[a.num]+v_cgst[a.num]+v_sgst[a.num])::numeric/100
       )) then
    raise exception 'Offline request line values do not match the saved document allocation.' using errcode = '23514';
  end if;
  if v_document.gst_snapshot->'irp_evidence'->>'reporting_category' = 'at_least_10cr' then
    if (statement_timestamp() at time zone 'Asia/Kolkata')::date > v_doc_date + 29 then
      raise exception 'The supported 30-day IRP reporting window has expired.' using errcode = '23514';
    end if;
  elsif v_document.gst_snapshot->'irp_evidence'->>'reporting_category' is distinct from 'under_10cr' then
    raise exception 'The reporting category is not known. No payload recorded.' using errcode = '23514';
  end if;
  if (statement_timestamp() at time zone 'Asia/Kolkata')::date < v_doc_date then
    raise exception 'The issue date is in the future.' using errcode = '23514';
  end if;
  v_key := v_seller || ':' || public.gst_financial_year_start(v_doc_date)::text || ':' || v_doc_type || ':' || upper(v_document.number);
  v_fingerprint := encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  insert into public.restaurant_irp_jobs (outlet_id,invoice_id,note_id,environment,document_key,canonical_sha256,
    request_sha256,payload_version,request_payload,status,requested_by)
    values (p_outlet,case when p_kind='invoice' then p_document end,case when p_kind='note' then p_document end,
      'offline',v_key,p_canonical_sha256,v_fingerprint,'1.1',p_payload,'prepared_offline',auth.uid())
    on conflict (environment,document_key) do nothing returning * into v_job;
  if not found then
    select j.* into v_job from public.restaurant_irp_jobs j where j.environment='offline' and j.document_key=v_key;
    v_existing := true;
    if v_job.outlet_id is distinct from p_outlet or coalesce(v_job.invoice_id,v_job.note_id) is distinct from p_document
      or v_job.canonical_sha256 is distinct from p_canonical_sha256 or v_job.request_sha256 is distinct from v_fingerprint then
      raise exception 'An IRP identity is already reserved with different evidence; reconcile rather than resubmit.' using errcode = '23514';
    end if;
  end if;
  return jsonb_build_object('id',v_job.id,'duplicate',v_existing,'status','prepared_offline','request_sha256',v_job.request_sha256);
end;
$$;
revoke all on function public.record_gst_irp_preflight(uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_gst_irp_preflight(uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.list_gst_irp_preflights(p_outlet uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager']) then
    raise exception 'Owner or Manager permission is required for this outlet.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from (
    select j.id,j.invoice_id,j.note_id,j.status,j.request_sha256,j.created_at
    from public.restaurant_irp_jobs j where j.outlet_id=p_outlet and j.environment='offline'
    order by j.created_at desc,j.id limit 100
  ) x),'[]'::jsonb);
end;
$$;
revoke all on function public.list_gst_irp_preflights(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_gst_irp_preflights(uuid) to authenticated;
