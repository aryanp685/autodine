-- Reconcile issued documents separately from tickets and money recorded on
-- payments. This is an operational document summary, not a GST return or a
-- mechanism for posting credit notes as cash refunds.
create or replace function public.report_gst_documents(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns table (
  document_type text, document_status text, rate_bps integer, irn_held boolean,
  document_count integer, total_paise bigint, taxable_paise bigint,
  cgst_paise bigint, sgst_paise bigint, igst_paise bigint,
  rounding_delta_paise bigint, missing_rounding_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Owner or Manager permission is required to read GST reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
     or p_from >= p_to then
    raise exception 'Choose a valid GST report range of at most 400 days.' using errcode = '22023';
  end if;
  if p_to - p_from > interval '400 days' then
    raise exception 'Choose a valid GST report range of at most 400 days.' using errcode = '22023';
  end if;

  return query
  with documents as (
    select i.document_type as kind, i.status as status, (i.gst_snapshot->>'rate_bps')::integer as rate,
           i.irp_status <> 'not_required' as held,
           (i.totals_snapshot->>'total_paise')::bigint as gross,
           (i.gst_snapshot->>'taxable_paise')::bigint as taxable,
           (i.gst_snapshot->>'cgst_paise')::bigint as cgst,
           (i.gst_snapshot->>'sgst_paise')::bigint as sgst,
           (i.gst_snapshot->>'igst_paise')::bigint as igst,
           (i.totals_snapshot->>'gst_rounding_delta_paise')::bigint as delta
      from public.restaurant_invoices i
     where i.restaurant_id = p_restaurant_id and i.issued_at >= p_from and i.issued_at < p_to
       and i.document_type in ('gst_tax_invoice', 'bill_of_supply')
    union all
    select n.document_type, n.status, (n.gst_snapshot->>'rate_bps')::integer,
           n.irp_status <> 'not_required', n.total_paise, n.taxable_paise,
           n.cgst_paise, n.sgst_paise, n.igst_paise, null::bigint
      from public.restaurant_notes n
     where n.restaurant_id = p_restaurant_id and n.issued_at >= p_from and n.issued_at < p_to
  )
  select d.kind, d.status, d.rate, d.held,
         count(*)::integer, sum(d.gross)::bigint, sum(d.taxable)::bigint,
         sum(d.cgst)::bigint, sum(d.sgst)::bigint, sum(d.igst)::bigint,
         sum(d.delta)::bigint,
         (count(*) filter (where d.kind = 'gst_tax_invoice' and d.delta is null))::integer
    from documents d
    group by d.kind, d.status, d.rate, d.held
    order by d.kind, d.status, d.rate, d.held;
end;
$$;

comment on function public.report_gst_documents(uuid, timestamptz, timestamptz) is
  'Owner/Manager only. Immutable amounts grouped by document issue date range, type, rate, current issued/voided status and IRN hold. No cash, no netting notes, no recalculation of historical GST; missing rounding history stays missing.';

revoke all on function public.report_gst_documents(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.report_gst_documents(uuid, timestamptz, timestamptz) to authenticated;
