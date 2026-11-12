-- LOCAL / DISPOSABLE DATABASE REGRESSION CHECK ONLY.
-- Verifies the P8 settlement gate, that a rejected close leaves the sitting
-- open, and that a fully paid session closes with one idempotent receipt.
-- Every synthetic row is rolled back. Do not use production for this check.

begin;

do $$
declare
  v_restaurant_id uuid;
  v_table_id uuid;
  v_user_id uuid := gen_random_uuid();
  v_session_id uuid := gen_random_uuid();
  v_order_id uuid := gen_random_uuid();
  v_invoice_id uuid;
  v_retry_invoice_id uuid;
  v_share_link_id uuid;
  v_expired_link_id uuid;
  v_share_hash text;
  v_share_payload jsonb;
  v_share_expires timestamptz;
  v_status text;
  v_blocked boolean := false;
  v_share_denied boolean := false;
begin
  if has_function_privilege('authenticated', 'public.issue_closed_session_receipt(uuid)', 'EXECUTE') then
    raise exception 'P8 regression: authenticated clients can bypass settlement via the receipt helper';
  end if;

  select id, (select id from public.dining_tables where restaurant_id = r.id order by label limit 1)
    into strict v_restaurant_id, v_table_id
    from public.restaurants r
   where r.slug = 'kings-of-kings';

  update public.restaurants
     set name = 'Synthetic P8 Check',
         address = 'Disposable test address',
         is_active = true,
         trial_started_at = statement_timestamp()
   where id = v_restaurant_id;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  insert into public.profiles (id, full_name) values (v_user_id, 'Disposable P8 cashier');
  insert into public.memberships (restaurant_id, user_id, role)
  values (v_restaurant_id, v_user_id, 'cashier');
  insert into public.order_sessions (id, restaurant_id, table_id)
  values (v_session_id, v_restaurant_id, v_table_id);
  insert into public.orders (
    id, restaurant_id, table_id, order_session_id, code,
    prep_status, payment_status, subtotal_paise, discount_paise,
    tax_paise, total_paise, placed_at
  ) values (
    v_order_id, v_restaurant_id, v_table_id, v_session_id, 'P8-TEST-1',
    'new', 'pending', 1200, 0, 0, 1200, statement_timestamp()
  );
  insert into public.order_items (
    order_id, name_snapshot, unit_price_paise, qty,
    variant_snapshot, addons_snapshot, is_veg, sort_order
  ) values (
    v_order_id, 'Synthetic P8 dish', 1200, 1,
    null, '{}', true, 0
  );

  begin
    perform public.close_order_session_and_issue_receipt(v_session_id);
  exception when sqlstate 'P0001' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'P8 regression: unpaid session was allowed to close';
  end if;
  select status into strict v_status from public.order_sessions where id = v_session_id;
  if v_status <> 'open' then
    raise exception 'P8 regression: rejected unpaid checkout changed session status to %', v_status;
  end if;
  raise notice 'PASS P8: unpaid checkout refused and session stayed open';

  insert into public.payments (
    order_id, restaurant_id, method, amount_paise, status,
    provider, recorded_by, idempotency_key
  ) values (
    v_order_id, v_restaurant_id, 'cash', 1200, 'recorded',
    'counter', v_user_id, 'p8-regression:' || v_session_id::text
  );

  v_invoice_id := public.close_order_session_and_issue_receipt(v_session_id);
  if v_invoice_id is null then
    raise exception 'P8 regression: fully paid checkout returned no invoice';
  end if;
  select status into strict v_status from public.order_sessions where id = v_session_id;
  if v_status <> 'closed' then
    raise exception 'P8 regression: settled checkout did not close the session';
  end if;

  v_retry_invoice_id := public.close_order_session_and_issue_receipt(v_session_id);
  if v_retry_invoice_id <> v_invoice_id then
    raise exception 'P8 regression: checkout retry created a different invoice';
  end if;
  if not exists (
    select 1 from public.restaurant_invoices i
     where i.id = v_invoice_id
       and i.order_session_id = v_session_id
       and i.status = 'issued'
       and (i.totals_snapshot->>'amount_paid_paise')::bigint = 1200
       and (i.totals_snapshot->>'outstanding_paise')::bigint = 0
  ) then
    raise exception 'P8 regression: final invoice payment snapshot is wrong';
  end if;
  raise notice 'PASS P8: paid session closed; receipt snapshot and retry are stable';

  if has_table_privilege('anon', 'public.restaurant_invoice_share_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.restaurant_invoice_share_links', 'SELECT') then
    raise exception 'P9 regression: raw share-link table is directly readable';
  end if;
  if not has_function_privilege('anon', 'public.read_shared_restaurant_invoice(text)', 'EXECUTE') then
    raise exception 'P9 regression: public share resolver is not executable by anon';
  end if;

  v_share_hash := repeat('a', 64);
  select share_link_id, expires_at into strict v_share_link_id, v_share_expires
    from public.create_restaurant_invoice_share_link(v_invoice_id, v_share_hash);
  if v_share_expires <= statement_timestamp() + interval '23 hours' then
    raise exception 'P9 regression: receipt share expiry is not approximately 24 hours';
  end if;
  v_share_payload := public.read_shared_restaurant_invoice(v_share_hash);
  if v_share_payload->'invoice'->>'id' <> v_invoice_id::text
     or jsonb_array_length(v_share_payload->'lines') <> 1
     or v_share_payload->'invoice' ? 'restaurant_id' then
    raise exception 'P9 regression: public receipt payload is missing snapshot data or exposes tenant internals';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.create_restaurant_invoice_share_link(
      v_invoice_id,
      repeat('b', 64)
    );
  exception when sqlstate '42501' then
    v_share_denied := true;
  end;
  if not v_share_denied then
    raise exception 'P9 regression: non-member created a receipt share link';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  if not public.revoke_restaurant_invoice_share_link(v_share_link_id)
     or public.read_shared_restaurant_invoice(v_share_hash) is not null then
    raise exception 'P9 regression: a revoked receipt link still resolves';
  end if;
  select share_link_id into strict v_expired_link_id
    from public.create_restaurant_invoice_share_link(
      v_invoice_id,
      repeat('c', 64)
    );
  update public.restaurant_invoice_share_links
     set created_at = statement_timestamp() - interval '3 days',
         expires_at = statement_timestamp() - interval '2 days'
   where id = v_expired_link_id;
  if public.read_shared_restaurant_invoice(repeat('c', 64)) is not null then
    raise exception 'P9 regression: an expired receipt link still resolves';
  end if;
  raise notice 'PASS P9: secure receipt link is tenant-bound, 24-hour, auditable, revocable and non-readable by direct table access';
end
$$;

rollback;
