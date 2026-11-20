-- A direct pickup/delivery is a real single-ticket billing session, not a
-- fake dining table or a guest bypass. Existing sittings keep their table IDs.
alter table public.order_sessions alter column table_id drop not null;
alter table public.order_sessions add column fulfilment_kind text;
alter table public.order_sessions add constraint order_sessions_fulfilment_boundary check (
  (table_id is not null and fulfilment_kind is null) or
  (table_id is null and fulfilment_kind is not null and fulfilment_kind in ('takeaway','direct_delivery'))
);

-- The destination is not stored in a kitchen/table-readable relation.
create table public.restaurant_direct_fulfilments (
  session_id uuid primary key references public.order_sessions(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  attempt uuid not null,
  request_sha256 text not null,
  state_code text not null,
  delivery_address text,
  entered_by uuid not null,
  entered_at timestamptz not null default statement_timestamp(),
  unique (restaurant_id, attempt)
);
alter table public.restaurant_direct_fulfilments enable row level security;
revoke all on public.restaurant_direct_fulfilments from public, anon, authenticated, service_role;

-- Until there is verified ship-to support and recipient classification at
-- payment, a Regular delivery must be clear of the B2B IRP requirement even
-- if a registered buyer is selected later. Recheck against new PAN evidence.
create or replace function public.gst_assert_direct_delivery_review(p_config public.restaurant_gst_config,p_date date)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if p_config.mode <> 'regular' then return; end if;
  -- Use the same PAN key as save_restaurant_gst_config. A separately managed
  -- outlet's review and the placement/payment check cannot cross unnoticed.
  perform pg_advisory_xact_lock_shared(hashtextextended(lower(substr(p_config.gstin,3,10)),9132));
  if public.gst_scoped_irp_facts(p_config.gstin,p_config.activation,
       p_config.preceding_fy_turnover_paise,p_date)->>'applicability' is distinct from 'not_required' then
    raise exception 'Direct delivery requires current PAN review clearing the IRN requirement. Shipping for held delivery is not supported. Do not accept payment.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.gst_assert_direct_delivery_review(public.restaurant_gst_config,date) from public, anon, authenticated, service_role;

create or replace function public.place_gst_direct_ticket(
  p_outlet uuid,p_attempt uuid,p_channel text,p_lines jsonb,p_attested boolean,
  p_delivery_state text default null,p_delivery_address text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_slug text;
  v_config public.restaurant_gst_config%rowtype;
  v_prior public.restaurant_direct_fulfilments%rowtype;
  v_hash text;
  v_session uuid;
  v_order uuid;
  v_code text;
  v_state text;
  v_address text := nullif(btrim(p_delivery_address),'');
begin
  perform 1 from public.memberships m where m.restaurant_id=p_outlet and m.user_id=auth.uid()
    and m.role in ('owner','manager','cashier') for share;
  if not found then raise exception 'No counter access for this outlet.' using errcode = '42501'; end if;
  if p_attempt is null or p_attested is distinct from true or p_channel is null or p_channel not in ('takeaway','direct_delivery')
    or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Confirm direct restaurant service and select takeaway or same-state delivery.' using errcode = '23514';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 30 or octet_length(p_lines::text)>12000 then
    raise exception 'Enter 1–30 menu lines.' using errcode = '23514';
  end if;
  if (p_channel='takeaway' and (p_delivery_state is not null or v_address is not null)) or
     (p_channel='direct_delivery' and (not public.gst_supported_outlet_state(p_delivery_state)
       or coalesce(length(v_address),0) not between 5 and 180 or v_address ~ '[[:cntrl:]]')) then
    raise exception 'For delivery, record the actual destination address and supported state; do not use the buyer GSTIN state.' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x(line) where jsonb_typeof(line) <> 'object') then
    raise exception 'Invalid menu lines.' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x(line) where
       (line - array['item_id','qty','variant_id']) <> '{}'::jsonb
       or coalesce(line->>'item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(line->>'qty','') !~ '^[1-9][0-9]?$'
       or (line->>'variant_id' is not null and line->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception 'Use menu items, valid variants and quantities from 1 to 99. Charges, discounts and custom prices are disabled.' using errcode = '23514';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_array(p_channel,p_lines,p_delivery_state,v_address)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('gst-direct:' || p_outlet::text || ':' || p_attempt::text,0));
  select d.* into v_prior from public.restaurant_direct_fulfilments d where d.restaurant_id=p_outlet and d.attempt=p_attempt;
  if found then
    if v_prior.request_sha256 is distinct from v_hash or v_prior.entered_by is distinct from auth.uid() then
      raise exception 'This order attempt has changed. Review the orders already recorded before creating another.' using errcode = '23514';
    end if;
    return v_prior.session_id;
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('gst-outlet:' || p_outlet::text,0));
  select r.slug into v_slug from public.restaurants r where r.id=p_outlet and r.is_active;
  select c.* into v_config from public.restaurant_gst_config c where c.restaurant_id=p_outlet;
  v_state := v_config.activation->>'premises_state_code';
  if v_slug is null or not public.restaurant_can_write(p_outlet) or not public.gst_supported_outlet_state(v_state)
     or v_config.activation is null or (v_config.mode <> 'off' and v_config.state_code is distinct from v_state) then
    raise exception 'Activate and review the outlet billing profile before accepting a direct takeaway or delivery ticket.' using errcode = 'P0001';
  end if;
  if p_channel='direct_delivery' and p_delivery_state is distinct from v_state then
    raise exception 'Cross-state delivery, marketplace and separately charged transport are not supported. Do not collect or guess tax.' using errcode = '23514';
  end if;
  if p_channel='direct_delivery' then
    perform public.gst_assert_direct_delivery_review(v_config,(statement_timestamp() at time zone 'Asia/Kolkata')::date);
  end if;
  -- Pin each selected variant against removal/movement until the pricing core
  -- reads it. An unavailable menu line must never silently become a base item.
  perform 1 from public.item_variants v join jsonb_array_elements(p_lines) x(line)
    on v.id=(line->>'variant_id')::uuid and v.item_id=(line->>'item_id')::uuid for share of v;
  if exists (select 1 from jsonb_array_elements(p_lines) x(line) where line->>'variant_id' is not null and not exists (
    select 1 from public.item_variants v where v.id=(line->>'variant_id')::uuid and v.item_id=(line->>'item_id')::uuid)) then
    raise exception 'A selected variant is unavailable; reload the published menu.' using errcode = 'P0001';
  end if;
  v_code := public.place_public_order_core_with_code_retry(v_slug,p_lines,null,null);
  select o.id into strict v_order from public.orders o where o.restaurant_id=p_outlet and o.code=v_code and o.table_id is null;
  -- No GST-admissibility assumption from a retail legacy item. The core
  -- snapshots class for all modes; this narrow workflow excludes unknowns.
  if exists (select 1 from public.order_items i where i.order_id=v_order and i.is_alcoholic_snapshot is distinct from false) then
    raise exception 'Only classified restaurant food lines are supported for direct tickets.' using errcode = '23514';
  end if;
  insert into public.order_sessions(restaurant_id,table_id,fulfilment_kind)
    values (p_outlet,null,p_channel) returning id into v_session;
  update public.orders set order_session_id=v_session where id=v_order and restaurant_id=p_outlet;
  insert into public.restaurant_direct_fulfilments(session_id,restaurant_id,order_id,attempt,request_sha256,state_code,delivery_address,entered_by)
    values(v_session,p_outlet,v_order,p_attempt,v_hash,v_state,v_address,auth.uid());
  return v_session;
end;
$$;
revoke all on function public.place_gst_direct_ticket(uuid,uuid,text,jsonb,boolean,text,text) from public, anon, authenticated, service_role;
grant execute on function public.place_gst_direct_ticket(uuid,uuid,text,jsonb,boolean,text,text) to authenticated;

-- Apply the same narrow precondition to both session and per-ticket manual
-- payment, without changing cash/amount/idempotency logic for other orders.
create or replace function public.gst_guard_direct_delivery_payment()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_config public.restaurant_gst_config%rowtype;
  v_order public.orders%rowtype;
begin
  if tg_op='UPDATE' and old.status='recorded' then return new; end if;
  select o.* into v_order from public.restaurant_direct_fulfilments d
    join public.order_sessions s on s.id=d.session_id and s.restaurant_id=d.restaurant_id and s.fulfilment_kind='direct_delivery'
    join public.orders o on o.id=d.order_id and o.restaurant_id=d.restaurant_id
    where d.order_id=new.order_id and d.restaurant_id=new.restaurant_id;
  if not found then return new; end if;
  if new.method='online' then
    raise exception 'Online payment is not supported for direct delivery.' using errcode = 'P0001';
  end if;
  if new.status<>'recorded' then return new; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('gst-outlet:' || v_order.restaurant_id::text,0));
  select * into v_config from public.restaurant_gst_config c where c.restaurant_id=v_order.restaurant_id;
  if not found or v_config.config_version is distinct from v_order.gst_config_version or v_config.activation is null then
    raise exception 'Review the saved direct-delivery billing profile before accepting payment.' using errcode = 'P0001';
  end if;
  perform public.gst_pricing_at(v_order.restaurant_id,(v_order.placed_at at time zone 'Asia/Kolkata')::date);
  perform public.gst_assert_direct_delivery_review(v_config,(statement_timestamp() at time zone 'Asia/Kolkata')::date);
  return new;
end;
$$;
revoke all on function public.gst_guard_direct_delivery_payment() from public, anon, authenticated, service_role;
create trigger gst_guard_direct_delivery_payment before insert or update of status on public.payments
  for each row when (new.status in ('pending','recorded')) execute function public.gst_guard_direct_delivery_payment();

-- Attach fulfilment before the immutable invoice is created. Keep its
-- destination out of public share projections and ordinary reports.
create or replace function public.gst_snapshot_direct_fulfilment()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_channel text;
  v_direct public.restaurant_direct_fulfilments%rowtype;
  v_date date;
begin
  select s.fulfilment_kind into v_channel from public.order_sessions s where s.id=new.order_session_id and s.restaurant_id=new.restaurant_id;
  if new.gst_snapshot->>'mode' = 'regular' and new.gst_snapshot->>'activation_effective_from' is not null then
    -- The old issue check tested only the first supply. Test each saved date,
    -- including both 5% and 18% hotel treatments when a sitting crosses FY.
    for v_date in select distinct (o.placed_at at time zone 'Asia/Kolkata')::date from public.orders o
      where o.id=any(new.source_order_ids) and o.restaurant_id=new.restaurant_id loop
      perform public.gst_pricing_at(new.restaurant_id,v_date);
    end loop;
  end if;
  if v_channel is null then return new; end if;
  select d.* into v_direct from public.restaurant_direct_fulfilments d where d.session_id=new.order_session_id and d.restaurant_id=new.restaurant_id;
  if not found or new.source_order_ids is distinct from array[v_direct.order_id]
    or new.seller_snapshot->>'premises_state_code' is distinct from v_direct.state_code
    or (new.document_type in ('gst_tax_invoice','bill_of_supply')
      and new.gst_snapshot->>'place_of_supply_state_code' is distinct from v_direct.state_code) then
    raise exception 'Direct fulfilment and place-of-supply evidence do not match the paid ticket. Review before issuing.' using errcode = '23514';
  end if;
  new.seller_snapshot := new.seller_snapshot || jsonb_build_object('fulfilment_kind',v_channel);
  if v_channel = 'direct_delivery' then
    if new.irp_status <> 'not_required' then
      raise exception 'IRN-held delivery requires a supported shipping evidence workflow. Do not change the buyer or fulfilment to bypass it.' using errcode = 'P0001';
    end if;
    if new.customer_snapshot is not null then
      new.customer_snapshot := new.customer_snapshot || jsonb_build_object('delivery_address',v_direct.delivery_address);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.gst_snapshot_direct_fulfilment() from public, anon, authenticated, service_role;
create trigger restaurant_invoice_snapshot_direct_fulfilment before insert on public.restaurant_invoices
  for each row execute function public.gst_snapshot_direct_fulfilment();

create or replace function public.list_gst_direct_destinations(p_outlet uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager','cashier']) then
    raise exception 'Counter access is required for this outlet.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.session_id) from (
    select d.session_id,d.delivery_address,d.state_code
    from public.restaurant_direct_fulfilments d join public.order_sessions s
      on s.id=d.session_id and s.restaurant_id=d.restaurant_id
    where d.restaurant_id=p_outlet and s.status='open' and d.delivery_address is not null
    order by s.opened_at desc,s.id limit 1000
  ) x),'[]'::jsonb);
end;
$$;
revoke all on function public.list_gst_direct_destinations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_gst_direct_destinations(uuid) to authenticated;

-- An identified B2C direct-delivery invoice needs its actual delivery
-- address on the customer document. Do not present a redacted bearer link
-- as that statutory copy; provide the complete authenticated print instead.
create or replace function public.gst_private_delivery_document(p_seller jsonb,p_customer jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(p_seller->>'fulfilment_kind'='direct_delivery' and p_customer->>'recipient_type'='consumer',false);
$$;
revoke all on function public.gst_private_delivery_document(jsonb,jsonb) from public, anon, authenticated, service_role;

create or replace function public.gst_guard_direct_delivery_share()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.restaurant_invoices i where i.id=new.invoice_id and i.restaurant_id=new.restaurant_id
    and public.gst_private_delivery_document(i.seller_snapshot,i.customer_snapshot)) then
    raise exception 'Print this invoice privately. A redacted link omits required delivery particulars.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.gst_guard_direct_delivery_share() from public, anon, authenticated, service_role;
create trigger gst_guard_direct_delivery_share before insert on public.restaurant_invoice_share_links
  for each row execute function public.gst_guard_direct_delivery_share();

-- A token holder gets the bill particulars, not the private delivery destination.
create or replace function public.read_shared_restaurant_invoice(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.restaurant_invoice_share_links%rowtype;
  v_invoice public.restaurant_invoices%rowtype;
  v_lines jsonb;
  v_timezone text;
  v_allowed boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;

  select h.allowed into v_allowed
    from public.hit_rate_limit('receipt-share:view:' || substr(p_token_hash, 1, 32), 60, 60) h;
  if not coalesce(v_allowed, false) then return null; end if;

  select l.* into v_link
    from public.restaurant_invoice_share_links l
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > statement_timestamp()
   for update;
  if not found then return null; end if;

  select i.* into v_invoice
    from public.restaurant_invoices i
   where i.id = v_link.invoice_id
     and i.restaurant_id = v_link.restaurant_id
     and i.status = 'issued'
     and not public.gst_private_delivery_document(i.seller_snapshot,i.customer_snapshot)
     -- No validated IRN path exists in this release. Old links to held
     -- documents must not expose the buyer/seller snapshot either.
     and (i.document_type <> 'gst_tax_invoice' or i.irp_status = 'not_required')
   for share;
  if not found then return null; end if;

  select coalesce(nullif(r.timezone, ''), 'Asia/Kolkata') into v_timezone
    from public.restaurants r where r.id = v_invoice.restaurant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', il.id,
    'line_snapshot', il.line_snapshot
  ) order by il.line_number), '[]'::jsonb)
    into v_lines
    from public.restaurant_invoice_lines il
   where il.invoice_id = v_invoice.id
     and il.restaurant_id = v_invoice.restaurant_id;

  update public.restaurant_invoice_share_links
     set last_accessed_at = statement_timestamp(), access_count = access_count + 1
   where id = v_link.id;
  insert into public.restaurant_invoice_share_audit (
    restaurant_id, invoice_id, share_link_id, actor_id, event_type
  ) values (v_link.restaurant_id, v_invoice.id, v_link.id, auth.uid(), 'opened');

  return jsonb_build_object(
    'timezone', v_timezone,
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'financial_year', v_invoice.financial_year,
      'document_type', v_invoice.document_type,
      'status', v_invoice.status,
      'issued_at', v_invoice.issued_at,
      'table_label_snapshot', v_invoice.table_label_snapshot,
      'order_session_id', v_invoice.order_session_id,
      'session_opened_at', v_invoice.session_opened_at,
      'session_closed_at', v_invoice.session_closed_at,
      'seller_snapshot', v_invoice.seller_snapshot - array['pan','restaurant_id','einvoice_location','einvoice_pincode','activation_effective_from'],
      'totals_snapshot', v_invoice.totals_snapshot,
      'payment_snapshot', v_invoice.payment_snapshot,
      'gst_snapshot', v_invoice.gst_snapshot - array['irp_evidence','supply_date','issued_local_date','activation_effective_from'],
      'customer_snapshot', v_invoice.customer_snapshot - array['buyer_id','buyer_revision','email','phone']
        - case when v_invoice.seller_snapshot->>'fulfilment_kind'='direct_delivery' then array['delivery_address'] else array[]::text[] end,
      'recipient_name', v_invoice.recipient_name,
      'recipient_gstin', v_invoice.recipient_gstin,
      'recipient_state_code', v_invoice.recipient_state_code,
      'recipient_address', v_invoice.recipient_address,
      'irp_status', v_invoice.irp_status,
      'supersedes_invoice_id', v_invoice.supersedes_invoice_id,
      'void_reason', v_invoice.void_reason
    ),
    'lines', v_lines
  );
end;
$$;

-- The prep board needs a handoff label, not a session ID, payment or
-- destination. Keep the existing operational order grants unchanged.
create or replace function public.list_gst_direct_prep_routes(p_outlet uuid,p_orders uuid[])
returns table(order_id uuid,fulfilment_kind text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager','cashier','kitchen']) then
    raise exception 'No access to this outlet prep board.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_orders),0) not between 1 and 100 then
    raise exception 'Select between 1 and 100 prep tickets.' using errcode = '22023';
  end if;
  return query select d.order_id,s.fulfilment_kind
    from public.restaurant_direct_fulfilments d join public.order_sessions s
      on s.id=d.session_id and s.restaurant_id=d.restaurant_id
    where d.restaurant_id=p_outlet and d.order_id=any(p_orders);
end;
$$;
revoke all on function public.list_gst_direct_prep_routes(uuid,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.list_gst_direct_prep_routes(uuid,uuid[]) to authenticated;
