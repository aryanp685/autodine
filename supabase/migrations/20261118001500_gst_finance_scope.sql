-- Finance V2: one database statement/snapshot, selected outlet or finance
-- memberships within that outlet's account. Account ownership alone never
-- expands the caller's role. V1 remains for already-deployed clients.
create or replace function public.gst_finance_lifecycle(p_status text,p_irp_status text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case when p_irp_status='cancelled' then 'cancelled' when p_status='voided' then 'voided'
    when p_status='issued' and p_irp_status='not_required' then 'issued' else 'held' end;
$$;
revoke all on function public.gst_finance_lifecycle(text,text) from public, anon, authenticated, service_role;

create or replace function public.report_gst_finance(
  p_outlet uuid, p_from date, p_until date, p_fy text default null,
  p_series text default null, p_audience text default null,
  p_effective_from date default null, p_reference text default null,
  p_detail_limit integer default 0, p_scope text default 'selected',
  p_profile text default null, p_status text default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_account uuid;
  v_from timestamptz;
  v_until timestamptz;
  v_limit integer := coalesce(p_detail_limit,0);
  v_response jsonb;
begin
  select r.account_id into v_account from public.restaurants r
    join public.memberships m on m.user_id=auth.uid() and m.restaurant_id=r.id and m.role in ('owner','manager')
    where r.id=p_outlet;
  if not found then
    raise exception 'Owner or Manager permission is required for this outlet report.' using errcode = '42501';
  end if;
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
     or p_until - p_from not between 1 and 366 or v_limit not between 0 and 10001
     or p_scope is null or p_scope not in ('selected','account')
     or (p_status is not null and p_status not in ('issued','held','voided','cancelled'))
     or (p_profile is not null and p_profile not in ('specified_premises','other_than_specified_premises','composition','unregistered','legacy','unknown'))
     or (p_fy is not null and p_fy !~ '^[0-9]{2}-[0-9]{2}$')
     or (p_series is not null and p_series !~ '^[A-Z0-9]{2,3}$')
     or (p_reference is not null and p_reference !~ '^[A-Z0-9/-]{1,16}$')
     or (p_audience is not null and p_audience not in ('B2B','B2C','unknown')) then
    raise exception 'Invalid GST date range or document filter.' using errcode = '22023';
  end if;
  v_from := p_from::timestamp at time zone 'Asia/Kolkata';
  v_until := p_until::timestamp at time zone 'Asia/Kolkata';
  with scope as materialized (
    select r.id,r.name from public.restaurants r join public.memberships m
      on m.restaurant_id=r.id and m.user_id=auth.uid() and m.role in ('owner','manager')
    where r.id=p_outlet or (p_scope='account' and v_account is not null and r.account_id=v_account)
  ), docs as (
    select i.restaurant_id as outlet_id,i.id, i.invoice_number as number, i.issued_at, i.financial_year,
      i.seller_snapshot->>'gstin' as supplier_gstin,i.seller_snapshot->>'fulfilment_kind' as fulfilment,
      i.gst_snapshot->>'config_version' as profile_version,(i.gst_snapshot->>'rate_bps')::integer as rate_bps,
      coalesce(i.gst_snapshot->>'regular_profile',case i.document_type when 'bill_of_supply' then 'composition'
        when 'receipt' then case i.series_code when 'RBL' then 'unregistered' else 'legacy' end else 'unknown' end) as profile,
      i.voided_at,null::uuid as source_id,null::timestamptz as source_issued_at,i.supersedes_invoice_id,
      coalesce(i.series_prefix,i.series_code,'INV') as series,
      case when i.series_code = 'RBL' then 'retail_bill' else i.document_type end as kind,
      case when i.document_type = 'gst_tax_invoice' then 'regular' when i.document_type = 'bill_of_supply' then 'composition'
        when i.series_code = 'RBL' then 'unregistered' else 'legacy' end as billing,
      case when i.recipient_gstin is not null then 'B2B' when i.document_type = 'gst_tax_invoice' or i.series_code = 'RBL'
        then 'B2C' else 'unknown' end as audience,
      i.status, i.irp_status, coalesce(i.gst_snapshot->>'activation_effective_from',i.seller_snapshot->>'activation_effective_from')::date as effective_from,
      i.recipient_gstin as buyer_gstin, null::text as source_number,
      (i.totals_snapshot->>'total_paise')::bigint as gross,
      (i.gst_snapshot->>'taxable_paise')::bigint as taxable,
      (i.gst_snapshot->>'cgst_paise')::bigint as cgst, (i.gst_snapshot->>'sgst_paise')::bigint as sgst,
      (i.gst_snapshot->>'igst_paise')::bigint as igst,
      (i.totals_snapshot->>'amount_paid_paise')::bigint as paid_at_issue,
      (i.totals_snapshot->>'gst_rounding_delta_paise')::bigint as rounding_delta
    from public.restaurant_invoices i join scope s on s.id=i.restaurant_id
    where i.issued_at >= v_from and i.issued_at < v_until
    union all
    select n.restaurant_id,n.id,n.document_number,n.issued_at,n.financial_year,
      n.seller_snapshot->>'gstin',n.seller_snapshot->>'fulfilment_kind',n.gst_snapshot->>'config_version',
      (n.gst_snapshot->>'rate_bps')::integer,
      coalesce(n.gst_snapshot->>'regular_profile',case when i.document_type='bill_of_supply' then 'composition' else 'unknown' end),
      n.voided_at,n.invoice_id,n.source_issued_at,null::uuid,
      coalesce(n.series_prefix,case n.document_type when 'credit_note' then 'CN' else 'DN' end),
      n.document_type,case when i.document_type = 'bill_of_supply' then 'composition' else 'regular' end,
      case when i.recipient_gstin is not null then 'B2B' when i.document_type = 'gst_tax_invoice' then 'B2C' else 'unknown' end,
      n.status,n.irp_status,(n.gst_snapshot->>'activation_effective_from')::date,
      i.recipient_gstin,n.source_document_number,n.total_paise,n.taxable_paise,n.cgst_paise,n.sgst_paise,n.igst_paise,null,null
    from public.restaurant_notes n join public.restaurant_invoices i on i.id=n.invoice_id and i.restaurant_id=n.restaurant_id
    join scope s on s.id=n.restaurant_id
    where n.issued_at >= v_from and n.issued_at < v_until
  ), states as (
    select d.*,public.gst_finance_lifecycle(d.status,d.irp_status) as lifecycle
    from docs d
  ), filtered as (
    select d.* from states d where (p_fy is null or d.financial_year = p_fy)
      and (p_profile is null or d.profile=p_profile) and (p_status is null or d.lifecycle=p_status)
      and (p_series is null or d.series = p_series) and (p_audience is null or d.audience = p_audience)
      and (p_effective_from is null or d.effective_from = p_effective_from)
      and (p_reference is null or d.buyer_gstin = p_reference or left(d.number,length(p_reference)) = p_reference
        or left(d.source_number,length(p_reference)) = p_reference)
  ), summaries as (
    select f.outlet_id,f.financial_year,f.series,f.kind,f.billing,f.profile,f.rate_bps,f.audience,f.lifecycle,f.status,f.irp_status,
      count(*) as count, sum(f.gross) as gross_paise,
      count(*) filter (where f.taxable is null or f.cgst is null or f.sgst is null or f.igst is null) as missing_tax_count,
      case when count(f.taxable)=count(*) then sum(f.taxable) end as taxable_paise,
      case when count(f.cgst)=count(*) then sum(f.cgst) end as cgst_paise,
      case when count(f.sgst)=count(*) then sum(f.sgst) end as sgst_paise,
      case when count(f.igst)=count(*) then sum(f.igst) end as igst_paise,
      sum(f.rounding_delta) as rounding_delta_paise
    from filtered f group by f.outlet_id,f.financial_year,f.series,f.kind,f.billing,f.profile,f.rate_bps,f.audience,f.lifecycle,f.status,f.irp_status
  ), detail as (
    select f.* from filtered f order by f.issued_at desc,f.outlet_id,f.number,f.id limit v_limit
  ), payments as (
    -- Each payment row only once. Void replacements and notes never join
    -- directly to a payment and cannot inflate this ledger.
    select p.restaurant_id as outlet_id,p.status,p.amount_paise,case
      when o.prep_status = 'cancelled' then 'cancelled_ticket'
      when o.order_session_id is null then 'unattached_ticket'
      when exists (select 1 from public.restaurant_invoices i where i.restaurant_id = o.restaurant_id
        and i.order_session_id = o.order_session_id and i.status='issued' and i.irp_status='not_required' and o.id = any(i.source_order_ids)) then 'issued_sitting'
      when exists (select 1 from public.restaurant_invoices i where i.restaurant_id = o.restaurant_id
        and i.order_session_id = o.order_session_id and i.status='issued' and i.irp_status not in ('not_required','cancelled') and o.id = any(i.source_order_ids)) then 'held_sitting'
      when exists (select 1 from public.restaurant_invoices i where i.restaurant_id = o.restaurant_id
        and i.order_session_id = o.order_session_id and i.irp_status='cancelled' and o.id = any(i.source_order_ids)) then 'irp_cancelled_sitting'
      when exists (select 1 from public.restaurant_invoices i where i.restaurant_id = o.restaurant_id
        and i.order_session_id = o.order_session_id and i.status='voided' and o.id = any(i.source_order_ids)) then 'void_only_sitting'
      else 'no_document' end as linked_to
    from public.payments p join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
    join scope s on s.id=p.restaurant_id
    where p.status in ('recorded','refunded')
      and coalesce(p.recorded_at,p.created_at) >= v_from and coalesce(p.recorded_at,p.created_at) < v_until
  ), money as (
    select p.outlet_id,p.status,p.linked_to,count(*) as count,sum(p.amount_paise) as amount_paise
    from payments p group by p.outlet_id,p.status,p.linked_to
  )
  select jsonb_build_object(
    'schema_version',2,'outlet',p_outlet,'scope',p_scope,'outlets',
    coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from scope o),'[]'::jsonb),'from',p_from,'until',p_until,'document_count',(select count(*) from filtered),
    'buckets',coalesce((select jsonb_agg(to_jsonb(s) order by s.outlet_id,s.financial_year,s.series,s.kind,s.billing,s.profile,s.rate_bps,s.audience,s.status,s.irp_status) from summaries s),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.issued_at desc,d.outlet_id,d.number,d.id) from detail d),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(m) order by m.outlet_id,m.status,m.linked_to) from money m),'[]'::jsonb)
  ) into v_response;
  return v_response;
end;
$$;
revoke all on function public.report_gst_finance(uuid,date,date,text,text,text,date,text,integer,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.report_gst_finance(uuid,date,date,text,text,text,date,text,integer,text,text,text) to authenticated;
comment on function public.report_gst_finance(uuid,date,date,text,text,text,date,text,integer,text,text,text) is
  'Scoped internal India-date reconciliation, not a GST return. Document filters do not filter cash. Payment rows marked refunded are shown by original recording date, never as inferred refund events or note amounts.';
