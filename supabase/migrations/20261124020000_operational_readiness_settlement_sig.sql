-- The readiness probe referenced stale function signatures/grants:
-- - mark_order_session_paid is now (uuid, text, text) granted to authenticated
-- - close_order_session_and_issue_receipt is now (uuid, jsonb) granted to authenticated
-- - place_public_order is granted to service_role only (guests call it via the server)
create or replace function public.operational_schema_readiness()
returns jsonb language sql stable security definer set search_path = pg_catalog, public
as $$
 select jsonb_object_agg(probe, present and coalesce(has_function_privilege(grantee,to_regprocedure(signature),'EXECUTE'),false))
 from (
  select v.probe,v.signature,v.grantee,exists(select 1 from pg_attribute a where a.attrelid=to_regclass(v.relation) and a.attname=v.column_name and not a.attisdropped) present
  from (values
   ('orderSessions','public.orders','order_session_id','public.place_public_order(text,jsonb,text,text,uuid,text)','service_role'),
   ('settlement','public.order_sessions','paid_at','public.mark_order_session_paid(uuid,text,text)','authenticated'),
   ('invoices','public.restaurant_invoices','invoice_number','public.close_order_session_and_issue_receipt(uuid,jsonb)','authenticated'),
   ('paymentReceipts','public.restaurant_payment_receipts','snapshot','public.close_order_session_and_issue_receipt(uuid,jsonb)','authenticated'),
   ('announcementClaims','public.kitchen_announcement_claims','order_id','public.claim_kitchen_order_announcement(uuid)','authenticated')
  ) v(probe,relation,column_name,signature,grantee)
 ) checks
$$;
revoke all on function public.operational_schema_readiness() from public,anon,authenticated;
grant execute on function public.operational_schema_readiness() to service_role;
