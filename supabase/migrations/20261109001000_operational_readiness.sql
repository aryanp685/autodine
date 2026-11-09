-- Schema-only health must not SELECT restricted financial tables with the
-- service role: those table grants are deliberately revoked. Expose only
-- fixed catalog booleans to the server, never tenant rows or error strings.
create or replace function public.operational_schema_readiness()
returns jsonb language sql stable security definer set search_path = pg_catalog, public
as $$
 select jsonb_object_agg(probe, present and coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false))
 from (
  select v.probe,v.signature,exists(select 1 from pg_attribute a where a.attrelid=to_regclass(v.relation) and a.attname=v.column_name and not a.attisdropped) present
  from (values
   ('orderSessions','public.orders','order_session_id','public.place_public_order(text,jsonb,text,text,uuid,text)'),
   ('settlement','public.order_sessions','paid_at','public.mark_order_session_paid(uuid)'),
   ('invoices','public.restaurant_invoices','invoice_number','public.close_order_session_and_issue_receipt(uuid)'),
   ('paymentReceipts','public.restaurant_payment_receipts','snapshot','public.close_order_session_and_issue_receipt(uuid)'),
   ('announcementClaims','public.kitchen_announcement_claims','order_id','public.claim_kitchen_order_announcement(uuid)')
  ) v(probe,relation,column_name,signature)
 ) checks
$$;
revoke all on function public.operational_schema_readiness() from public,anon,authenticated;
grant execute on function public.operational_schema_readiness() to service_role;
