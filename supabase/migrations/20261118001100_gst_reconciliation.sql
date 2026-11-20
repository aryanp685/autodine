-- Owner/Manager GST and payment reconciliation. Immutable billed amounts,
-- separate current cash statuses, no tax recomputation or return submission.
-- Bounded JSON response avoids an unnoticed Data API row cap on exports.
create or replace function public.report_gst_reconciliation(
  p_outlet uuid, p_from date, p_until date, p_fy text default null,
  p_series text default null, p_audience text default null,
  p_effective_from date default null, p_reference text default null,
  p_detail_limit integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_from timestamptz;
  v_until timestamptz;
  v_limit integer := coalesce(p_detail_limit,0);
  v_response jsonb;
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager']) then
    raise exception 'Owner or Manager permission is required for this outlet report.' using errcode = '42501';
  end if;
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
     or p_until - p_from not between 1 and 366 or v_limit not between 0 and 10001
     or (p_fy is not null and p_fy !~ '^[0-9]{2}-[0-9]{2}$')
     or (p_series is not null and p_series !~ '^[A-Z0-9]{2,3}$')
     or (p_reference is not null and p_reference !~ '^[A-Z0-9/-]{1,16}$')
     or (p_audience is not null and p_audience not in ('B2B','B2C','unknown')) then
    raise exception 'Invalid GST date range or document filter.' using errcode = '22023';
  end if;
  v_from := p_from::timestamp at time zone 'Asia/Kolkata';
  v_until := p_until::timestamp at time zone 'Asia/Kolkata';
  with docs as (
    select i.id, i.invoice_number as number, i.issued_at, i.financial_year,
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
    from public.restaurant_invoices i
    where i.restaurant_id = p_outlet and i.issued_at >= v_from and i.issued_at < v_until
    union all
    select n.id,n.document_number,n.issued_at,n.financial_year,
      coalesce(n.series_prefix,case n.document_type when 'credit_note' then 'CN' else 'DN' end),
      n.document_type,case when i.document_type = 'bill_of_supply' then 'composition' else 'regular' end,
      case when i.recipient_gstin is not null then 'B2B' when i.document_type = 'gst_tax_invoice' then 'B2C' else 'unknown' end,
      n.status,n.irp_status,(n.gst_snapshot->>'activation_effective_from')::date,
      i.recipient_gstin,n.source_document_number,n.total_paise,n.taxable_paise,n.cgst_paise,n.sgst_paise,n.igst_paise,null,null
    from public.restaurant_notes n join public.restaurant_invoices i on i.id=n.invoice_id and i.restaurant_id=n.restaurant_id
    where n.restaurant_id = p_outlet and n.issued_at >= v_from and n.issued_at < v_until
  ), filtered as (
    select d.* from docs d where (p_fy is null or d.financial_year = p_fy)
      and (p_series is null or d.series = p_series) and (p_audience is null or d.audience = p_audience)
      and (p_effective_from is null or d.effective_from = p_effective_from)
      and (p_reference is null or d.buyer_gstin = p_reference or left(d.number,length(p_reference)) = p_reference)
  ), summaries as (
    select f.financial_year,f.series,f.kind,f.billing,f.audience,f.status,f.irp_status,
      count(*) as count, sum(f.gross) as gross_paise,sum(f.taxable) as taxable_paise,
      sum(f.cgst) as cgst_paise,sum(f.sgst) as sgst_paise,sum(f.igst) as igst_paise,
      sum(f.rounding_delta) as rounding_delta_paise
    from filtered f group by f.financial_year,f.series,f.kind,f.billing,f.audience,f.status,f.irp_status
  ), detail as (
    select f.* from filtered f order by f.issued_at desc,f.number,f.id limit v_limit
  ), payments as (
    -- Each payment row only once. Void replacements and notes never join
    -- directly to a payment and cannot inflate this ledger.
    select p.status,p.amount_paise,case
      when o.prep_status = 'cancelled' then 'cancelled_ticket'
      when o.order_session_id is null then 'unattached_ticket'
      when exists (select 1 from public.restaurant_invoices i where i.restaurant_id = p_outlet
        and i.order_session_id = o.order_session_id and i.status='issued' and i.irp_status='not_required' and o.id = any(i.source_order_ids)) then 'issued_sitting'
      when exists (select 1 from public.restaurant_invoices i where i.restaurant_id = p_outlet
        and i.order_session_id = o.order_session_id and i.status='issued' and i.irp_status<>'not_required' and o.id = any(i.source_order_ids)) then 'held_sitting'
      when exists (select 1 from public.restaurant_invoices i where i.restaurant_id = p_outlet
        and i.order_session_id = o.order_session_id and i.status='voided' and o.id = any(i.source_order_ids)) then 'void_only_sitting'
      else 'no_document' end as linked_to
    from public.payments p join public.orders o on o.id=p.order_id and o.restaurant_id=p.restaurant_id
    where p.restaurant_id = p_outlet and p.status in ('recorded','refunded')
      and coalesce(p.recorded_at,p.created_at) >= v_from and coalesce(p.recorded_at,p.created_at) < v_until
  ), money as (
    select p.status,p.linked_to,count(*) as count,sum(p.amount_paise) as amount_paise
    from payments p group by p.status,p.linked_to
  )
  select jsonb_build_object(
    'schema_version',1,'outlet',p_outlet,'from',p_from,'until',p_until,'document_count',(select count(*) from filtered),
    'buckets',coalesce((select jsonb_agg(to_jsonb(s) order by s.financial_year,s.series,s.kind,s.billing,s.audience,s.status,s.irp_status) from summaries s),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.issued_at desc,d.number,d.id) from detail d),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(m) order by m.status,m.linked_to) from money m),'[]'::jsonb)
  ) into v_response;
  return v_response;
end;
$$;
revoke all on function public.report_gst_reconciliation(uuid,date,date,text,text,text,date,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.report_gst_reconciliation(uuid,date,date,text,text,text,date,text,integer) to authenticated;
comment on function public.report_gst_reconciliation(uuid,date,date,text,text,text,date,text,integer) is
  'Scoped internal India-date reconciliation, not a GST return. Document filters do not filter cash. Payment rows marked refunded are shown by original recording date, never as inferred refund events or note amounts.';
