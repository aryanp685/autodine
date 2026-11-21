-- Versioned status-returning API: failed order work rolls back inside a
-- subtransaction, while admission counters outside it commit with the result.
-- Valid QR sessions only; 60 attempts/session and 120/tenant per ten minutes,
-- separately from unchanged 30/session and 60/tenant successful-order caps.
create or replace function public.place_public_order_attempt(
  p_slug text, p_lines jsonb, p_note text default null,
  p_session_token text default null, p_guest_token uuid default null,
  p_ip_hash text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_restaurant uuid; v_code text; v_allowed boolean; v_retry integer;
  v_error text; v_state text; v_hint text;
begin
  select s.restaurant_id into v_restaurant from public.current_table_session(p_session_token) s
    where s.restaurant_slug=btrim(coalesce(p_slug,''));
  if v_restaurant is null then
    return jsonb_build_object('code',null,'error',jsonb_build_object('code','P0001','message','Scan your table QR code again before ordering.','hint',''));
  end if;
  -- Serialize matching retries before checking either budget.
  if p_guest_token is not null then
    perform pg_advisory_xact_lock(hashtext('guest:' || p_guest_token::text));
    select o.code into v_code from public.orders o where o.restaurant_id=v_restaurant and o.guest_token=p_guest_token limit 1;
    if v_code is not null then return jsonb_build_object('code',v_code,'error',null); end if;
  end if;
  select a.allowed,a.retry_after_seconds into v_allowed,v_retry from public.hit_rate_limit(
    'po:attempt:s:' || encode(sha256(p_session_token::bytea),'hex'),60,600) a;
  if v_allowed then
    select a.allowed,a.retry_after_seconds into v_allowed,v_retry from public.hit_rate_limit(
      'po:attempt:t:' || v_restaurant::text,120,600) a;
  end if;
  if v_allowed is distinct from true then
    return jsonb_build_object('code',null,'error',jsonb_build_object('code','P0001',
      'message',format('Too many orders right now. Please wait %s seconds and try again.',coalesce(v_retry,60)),'hint','rate-limited'));
  end if;
  begin
    v_code:=public.place_public_order(p_slug,p_lines,p_note,p_session_token,p_guest_token,p_ip_hash);
    return jsonb_build_object('code',v_code,'error',null);
  exception when others then
    get stacked diagnostics v_error=MESSAGE_TEXT,v_state=RETURNED_SQLSTATE,v_hint=PG_EXCEPTION_HINT;
    return jsonb_build_object('code',null,'error',jsonb_build_object('code',v_state,'message',v_error,'hint',v_hint));
  end;
end;
$$;
revoke all on function public.place_public_order_attempt(text,jsonb,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.place_public_order_attempt(text,jsonb,text,text,uuid,text) to anon, authenticated;
-- Old API remains available internally to the definer but is no longer a
-- public bypass around committed failed-attempt counters.
revoke all on function public.place_public_order(text,jsonb,text,text,uuid,text) from public, anon, authenticated;

-- Readiness follows the active public admission API.
create or replace function public.operational_schema_readiness()
returns jsonb language sql stable security definer set search_path = pg_catalog, public
as $$
 select jsonb_object_agg(probe, present and coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false))
 from (
  select v.probe,v.signature,exists(select 1 from pg_attribute a where a.attrelid=to_regclass(v.relation) and a.attname=v.column_name and not a.attisdropped) present
  from (values
   ('orderSessions','public.orders','order_session_id','public.place_public_order_attempt(text,jsonb,text,text,uuid,text)'),
   ('settlement','public.order_sessions','paid_at','public.mark_order_session_paid(uuid)'),
   ('invoices','public.restaurant_invoices','invoice_number','public.close_order_session_and_issue_receipt(uuid)'),
   ('paymentReceipts','public.restaurant_payment_receipts','snapshot','public.close_order_session_and_issue_receipt(uuid)'),
   ('announcementClaims','public.kitchen_announcement_claims','order_id','public.claim_kitchen_order_announcement(uuid)')
  ) v(probe,relation,column_name,signature)
 ) checks
$$;
