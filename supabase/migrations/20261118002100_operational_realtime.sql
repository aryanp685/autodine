-- Local candidate. A committed revision is a wake-up, never a business row.
-- Bound storage to one current revision per outlet. Nothing queues a payment,
-- issues a document, or depends on an external worker publishing after commit.

alter type public.member_role add value if not exists 'waiter';

-- Keep existing broad staff policies at exactly their previous role scope.
-- Waiters enter only through explicitly floor-scoped projections below.
create or replace function public.current_restaurant_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.restaurant_id from public.memberships m
   where m.user_id = auth.uid() and m.role::text in ('owner','manager','cashier','kitchen');
$$;
create or replace function public.is_member(p_restaurant_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.memberships m where m.user_id = auth.uid()
    and m.restaurant_id = p_restaurant_id and m.role::text in ('owner','manager','cashier','kitchen'));
$$;
create policy memberships_own_floor_read on public.memberships for select to authenticated
  using (user_id = auth.uid() and role::text = 'waiter');
-- Keep the old session read scope; waiters receive only the occupancy projection.
drop policy order_sessions_staff on public.order_sessions;
create policy order_sessions_staff on public.order_sessions for select to authenticated
  using (public.is_member(restaurant_id));

create function public.list_my_waiter_outlets()
returns table (id uuid, name text, slug text, timezone text) language sql stable security definer
set search_path = public, pg_temp as $$
  select r.id, r.name, r.slug, r.timezone from public.restaurants r
  join public.memberships m on m.restaurant_id=r.id
  where m.user_id=auth.uid() and m.role::text='waiter' order by r.id;
$$;
revoke all on function public.list_my_waiter_outlets() from public, anon, authenticated, service_role;
grant execute on function public.list_my_waiter_outlets() to authenticated;

create table public.outlet_live_revisions (
  outlet_id uuid primary key references public.restaurants(id) on delete cascade,
  event_id uuid not null,
  version bigint not null check (version > 0),
  changed_at timestamptz not null
);
alter table public.outlet_live_revisions enable row level security;
revoke all on public.outlet_live_revisions from public, anon, authenticated, service_role;
grant select on public.outlet_live_revisions to authenticated;
create policy outlet_live_revisions_staff_read on public.outlet_live_revisions for select to authenticated
  using (public.has_restaurant_role(outlet_id, array['owner','manager','kitchen','cashier','waiter']));
comment on table public.outlet_live_revisions is
  'Versioned, content-free outlet invalidation. No order, waiter, customer, auth or finance fields. Commit atomically; recover by scoped snapshot reads.';

-- No source writes are initiated from here. Deferred row triggers publish at
-- commit time, after business locks are acquired. Collapse all changes for
-- this outlet in the same transaction using the revision row's system xmin.
create function public.signal_operational_revision() returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_outlet uuid;
begin
  if tg_op = 'UPDATE' then
    case tg_table_name
      when 'order_sessions' then
        if (new.table_id,new.status,new.closed_at,new.paid_at,new.fulfilment_kind) is not distinct from
           (old.table_id,old.status,old.closed_at,old.paid_at,old.fulfilment_kind) then return null; end if;
      when 'orders' then
        if (new.prep_status,new.payment_status,new.table_id,new.order_session_id,new.confirmed_at,new.hold_required,
            new.customer_note,new.total_paise,new.kitchen_announcement_status) is not distinct from
           (old.prep_status,old.payment_status,old.table_id,old.order_session_id,old.confirmed_at,old.hold_required,
            old.customer_note,old.total_paise,old.kitchen_announcement_status) then return null; end if;
      when 'table_waiter_calls' then
        if (new.status,new.acknowledged_at,new.announcement_status) is not distinct from
           (old.status,old.acknowledged_at,old.announcement_status) then return null; end if;
      else null;
    end case;
  end if;
  if tg_table_name = 'order_items' then
    select o.restaurant_id into v_outlet from public.orders o
     where o.id = case when tg_op = 'DELETE' then old.order_id else new.order_id end;
    -- Cascading line deletes need no lookup after the order itself is gone:
    -- the parent DELETE has its own deferred signal.
  else
    v_outlet := case when tg_op = 'DELETE' then old.restaurant_id else new.restaurant_id end;
  end if;

  insert into public.outlet_live_revisions as revision (outlet_id,event_id,version,changed_at)
    select r.id, gen_random_uuid(), 1, clock_timestamp()
      from public.restaurants r where r.id=v_outlet
    on conflict (outlet_id) do update set event_id=excluded.event_id,
      version=revision.version+1, changed_at=clock_timestamp()
    where revision.xmin <> pg_current_xact_id()::xid;
  return null;
end;
$$;
revoke all on function public.signal_operational_revision() from public, anon, authenticated, service_role;

alter table public.table_waiter_calls add column acknowledged_at timestamptz;
alter table public.table_waiter_calls add column acknowledged_by uuid references public.profiles(id) on delete set null;
alter table public.table_waiter_calls add constraint table_waiter_calls_ack_check
  check (acknowledged_at is not null or acknowledged_by is null);
-- The live projections need operational fields, not QR hash, actor identity
-- or per-guest request key. RPCs retain their owner privileges for writes.
revoke select on public.table_waiter_calls from public, anon, authenticated;
grant select (id, restaurant_id, table_id, table_label_snapshot, status, created_at,
  acknowledged_at, resolved_at, announcement_status, announcement_error)
  on public.table_waiter_calls to authenticated;

create constraint trigger operational_orders_changed after insert or update or delete on public.orders
  deferrable initially deferred for each row execute function public.signal_operational_revision();
create constraint trigger operational_lines_changed after insert or update or delete on public.order_items
  deferrable initially deferred for each row execute function public.signal_operational_revision();
create constraint trigger operational_payments_changed after insert or update or delete on public.payments
  deferrable initially deferred for each row execute function public.signal_operational_revision();
create constraint trigger operational_sittings_changed after insert or update or delete on public.order_sessions
  deferrable initially deferred for each row execute function public.signal_operational_revision();
create constraint trigger operational_tables_changed after insert or update or delete on public.dining_tables
  deferrable initially deferred for each row execute function public.signal_operational_revision();
create constraint trigger operational_cards_changed after insert or update or delete on public.table_qr_codes
  deferrable initially deferred for each row execute function public.signal_operational_revision();
create constraint trigger operational_calls_changed after insert or update or delete on public.table_waiter_calls
  deferrable initially deferred for each row execute function public.signal_operational_revision();

do $$
begin
  -- DELETE events are not safely row-filterable in Postgres Changes. This
  -- publication is empty after P3; fail if the operator added other tables,
  -- rather than changing their publication semantics without review.
  if exists (select 1 from pg_catalog.pg_publication p where p.pubname='supabase_realtime' and p.puballtables)
     or exists (select 1 from pg_catalog.pg_publication_tables p where p.pubname='supabase_realtime'
       and (p.schemaname,p.tablename) <> ('public','outlet_live_revisions')) then
    raise exception 'Unexpected Realtime publication; reconcile before applying.';
  end if;
  if exists (select 1 from pg_catalog.pg_publication p where p.pubname='supabase_realtime') then
    alter publication supabase_realtime set (publish='insert, update');
    alter publication supabase_realtime add table public.outlet_live_revisions;
  end if;
end;
$$;

-- Staff acknowledgement is distinct from the device's speech claim.
-- A repeated tap preserves the first actor/time and never reopens a call.
create function public.acknowledge_waiter_call(p_outlet uuid,p_call_id uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_call public.table_waiter_calls%rowtype;
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager','cashier','kitchen','waiter']) then
    raise exception 'Floor staff permission is required.' using errcode='42501';
  end if;
  select * into v_call from public.table_waiter_calls c
   where c.id=p_call_id and c.restaurant_id=p_outlet for update;
  if not found then return 'not_found'; end if;
  if v_call.status='resolved' then return 'resolved'; end if;
  if v_call.acknowledged_at is not null then return 'acknowledged'; end if;
  if not public.restaurant_can_write(p_outlet) then
    raise exception 'Restaurant is read-only.' using errcode='42501';
  end if;
  update public.table_waiter_calls set acknowledged_at=statement_timestamp(),acknowledged_by=auth.uid()
    where id=v_call.id;
  return 'acknowledged';
end;
$$;
revoke all on function public.acknowledge_waiter_call(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_waiter_call(uuid,uuid) to authenticated;

create function public.finish_waiter_call(p_outlet uuid,p_call_id uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_call public.table_waiter_calls%rowtype;
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager','cashier','kitchen','waiter']) then
    raise exception 'Floor staff permission is required.' using errcode='42501';
  end if;
  select * into v_call from public.table_waiter_calls c
   where c.id=p_call_id and c.restaurant_id=p_outlet for update;
  if not found then return 'not_found'; end if;
  if v_call.status='resolved' then return 'resolved'; end if;
  if not public.restaurant_can_write(p_outlet) then
    raise exception 'Restaurant is read-only.' using errcode='42501';
  end if;
  update public.table_waiter_calls set status='resolved', resolved_at=statement_timestamp(), resolved_by=auth.uid()
    where id=v_call.id;
  return 'resolved';
end;
$$;
revoke all on function public.finish_waiter_call(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_waiter_call(uuid,uuid) to authenticated;

-- Preserve the existing signature for older clients; they also go through the
-- same role/write/row lock checks now. Do not reveal a foreign call's state.
create or replace function public.resolve_table_waiter_call(p_call_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_outlet uuid;
begin
  select c.restaurant_id into v_outlet from public.table_waiter_calls c where c.id=p_call_id
    and public.has_restaurant_role(c.restaurant_id,array['owner','manager','cashier','kitchen']);
  if not found then return false; end if;
  return public.finish_waiter_call(v_outlet,p_call_id)='resolved';
end;
$$;

create function public.floor_service_snapshot(p_outlet uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager','cashier','kitchen','waiter']) then
    raise exception 'Floor staff permission is required.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'tables', coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'label',q.label,'active',q.is_active,
      'sitting',q.sitting,'openedAt',q.opened_at) order by q.label,q.id) from (
        select t.id,t.label,t.is_active,s.id as sitting,s.opened_at from public.dining_tables t
        left join public.order_sessions s on s.table_id=t.id and s.restaurant_id=p_outlet and s.status='open'
        where t.restaurant_id=p_outlet order by t.label,t.id limit 200) q), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'tableId',q.table_id,
      'table',q.table_label_snapshot,'createdAt',q.created_at,'acknowledgedAt',q.acknowledged_at) order by q.created_at,q.id) from (
        select c.id,c.table_id,c.table_label_snapshot,c.created_at,c.acknowledged_at from public.table_waiter_calls c
        where c.restaurant_id=p_outlet and c.status='open' order by c.created_at,c.id limit 100) q), '[]'::jsonb),
    'tablesTruncated', exists(select 1 from public.dining_tables where restaurant_id=p_outlet offset 200),
    'callsTruncated', exists(select 1 from public.table_waiter_calls where restaurant_id=p_outlet and status='open' offset 100),
    'canWork', public.restaurant_can_write(p_outlet));
end;
$$;
revoke all on function public.floor_service_snapshot(uuid) from public, anon, authenticated, service_role;
grant execute on function public.floor_service_snapshot(uuid) to authenticated;

-- Route while a sitting moves. Keep admitted table_id, bearer capability and
-- original ticket snapshots; the current table is the sitting's table.
create function public.list_order_floor_labels(p_outlet uuid,p_orders uuid[])
returns table (order_id uuid, table_label text) language sql stable security definer set search_path=public,pg_temp as $$
  select o.id,t.label from public.orders o left join public.order_sessions s
    on s.id=o.order_session_id and s.restaurant_id=o.restaurant_id
  join public.dining_tables t on t.id=coalesce(s.table_id,o.table_id) and t.restaurant_id=o.restaurant_id
  where public.has_restaurant_role(p_outlet,array['owner','manager','cashier','kitchen'])
    and cardinality(p_orders) <= 100 and o.restaurant_id=p_outlet and o.id=any(p_orders);
$$;
revoke all on function public.list_order_floor_labels(uuid,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.list_order_floor_labels(uuid,uuid[]) to authenticated;

create table public.sitting_table_moves (
  request_id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  sitting_id uuid not null references public.order_sessions(id) on delete restrict,
  from_table_id uuid not null references public.dining_tables(id) on delete restrict,
  to_table_id uuid not null references public.dining_tables(id) on delete restrict,
  moved_by uuid references public.profiles(id) on delete set null,
  moved_at timestamptz not null default statement_timestamp(),
  check (from_table_id <> to_table_id)
);
alter table public.sitting_table_moves enable row level security;
revoke all on public.sitting_table_moves from public, anon, authenticated, service_role;
grant select on public.sitting_table_moves to authenticated;
create policy sitting_table_moves_management_read on public.sitting_table_moves for select to authenticated
  using (public.has_restaurant_role(restaurant_id,array['owner','manager']));

create function public.transfer_open_sitting(p_outlet uuid,p_sitting uuid,p_from uuid,p_to uuid,p_request uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tables integer; v_move public.sitting_table_moves%rowtype;
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager']) then
    raise exception 'Manager or owner permission is required.' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from=p_to or p_request is null then return 'unavailable'; end if;
  -- Block new table orders/verification inserts at either table (FK key-share).
  -- The same ordering is used even when simultaneous moves go opposite ways.
  perform 1 from public.dining_tables t where t.restaurant_id=p_outlet and t.id in (p_from,p_to)
    order by t.id for update;
  get diagnostics v_tables = row_count;
  if v_tables <> 2 then return 'unavailable'; end if;
  select * into v_move from public.sitting_table_moves m where m.request_id=p_request and m.restaurant_id=p_outlet;
  if found then
    return case when (v_move.sitting_id,v_move.from_table_id,v_move.to_table_id)=(p_sitting,p_from,p_to)
      then 'already_recorded' else 'unavailable' end;
  end if;
  if not public.restaurant_can_write(p_outlet) then
    raise exception 'Restaurant is read-only.' using errcode='42501';
  end if;
  perform 1 from public.order_sessions s where s.id=p_sitting and s.restaurant_id=p_outlet
    and s.table_id=p_from and s.status='open' and s.closed_at is null and s.paid_at is null for update;
  if not found or not exists (select 1 from public.dining_tables where id=p_to and is_active) then return 'unavailable'; end if;
  if exists (select 1 from public.order_sessions s where s.table_id=p_to and s.status='open') then return 'occupied'; end if;
  if exists (select 1 from public.table_waiter_calls c where c.table_id in (p_from,p_to) and c.status='open') then return 'call_open'; end if;
  if exists (select 1 from public.orders o where o.order_session_id=p_sitting and
       (o.payment_status <> 'pending' or (o.prep_status <> 'cancelled' and o.hold_required and o.confirmed_at is null)))
     or exists (select 1 from public.payments p join public.orders o on o.id=p.order_id
       where o.order_session_id=p_sitting and p.status in ('pending','recorded'))
     or exists (select 1 from public.restaurant_invoices i where i.order_session_id=p_sitting) then return 'held_or_paid'; end if;

  update public.order_sessions set table_id=p_to where id=p_sitting;
  -- Old verification proves physical presence at the old location, not at the
  -- new one. Existing order links remain valid, but additions require a fresh scan.
  update public.table_verification_sessions set revoked_at=statement_timestamp()
    where table_id in (p_from,p_to) and restaurant_id=p_outlet and revoked_at is null and expires_at>statement_timestamp();
  insert into public.sitting_table_moves(request_id,restaurant_id,sitting_id,from_table_id,to_table_id,moved_by)
    values(p_request,p_outlet,p_sitting,p_from,p_to,auth.uid());
  return 'moved';
exception when unique_violation then
  -- A competing writer or reused request could not move a second sitting.
  -- The subtransaction rolls back the table assignment and revocations too.
  return 'unavailable';
end;
$$;
revoke all on function public.transfer_open_sitting(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.transfer_open_sitting(uuid,uuid,uuid,uuid,uuid) to authenticated;

-- A guest insert may have read admission just before waiting at the table FK.
-- Once the order can be stamped, reject a verification revoked by the move,
-- without reimplementing checkout/pricing or altering its public signatures.
create function public.check_live_table_stamp() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if not exists (select 1 from public.table_verification_sessions s where s.id=new.table_session_id
      and s.restaurant_id=new.restaurant_id and s.table_id=new.table_id and s.revoked_at is null) then
    raise exception 'Your table verification is no longer valid. Please ask staff for the current code.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.check_live_table_stamp() from public, anon, authenticated, service_role;
create trigger order_stamp_requires_live_table after update of table_session_id on public.orders
  for each row when (new.table_session_id is not null and new.table_session_id is distinct from old.table_session_id)
  execute function public.check_live_table_stamp();

-- The guest can compare only their own order. Keep a numeric version rather
-- than a wall-clock cursor (two updates inside one statement can share a time).
alter table public.orders add column guest_live_version bigint not null default 0;
create function public.bump_guest_order_version() returns trigger language plpgsql
set search_path=public,pg_temp as $$
begin
  new.guest_live_version := old.guest_live_version+1;
  return new;
end;
$$;
revoke all on function public.bump_guest_order_version() from public, anon, authenticated, service_role;
-- The quantity RPC SETs total_paise even when the same priced basket changes.
-- Voice claim/result updates don't invalidate a guest's bill.
create trigger guest_order_content_changed before update of prep_status,payment_status,confirmed_at,hold_required,
  customer_note,total_paise on public.orders for each row execute function public.bump_guest_order_version();

create function public.get_guest_order_status(p_slug text,p_code text,p_token uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('prep_status',o.prep_status,'payment_status',o.payment_status,
    'placed_at',o.placed_at,'hold_required',o.hold_required,'confirmed_at',o.confirmed_at,
    'revision',o.guest_live_version::text)
  from public.orders o join public.restaurants r on r.id=o.restaurant_id
  where r.slug=p_slug and o.code=p_code and o.guest_token=p_token;
$$;
revoke all on function public.get_guest_order_status(text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_guest_order_status(text,text,uuid) to anon, authenticated;

create function public.read_outlet_live_version(p_outlet uuid) returns text language plpgsql stable
security definer set search_path=public,pg_temp as $$
begin
  if not public.has_restaurant_role(p_outlet,array['owner','manager','cashier','kitchen','waiter']) then
    raise exception 'Outlet membership is required.' using errcode='42501';
  end if;
  return coalesce((select v.version::text from public.outlet_live_revisions v where v.outlet_id=p_outlet),'0');
end;
$$;
revoke all on function public.read_outlet_live_version(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_outlet_live_version(uuid) to authenticated;

-- Audit operational mutations, not delivery. No notes, token, prices,
-- provider IDs or guest profile. Existing cancel_reason remains on the order.
create table public.order_operation_history (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  operation text not null check (operation in ('prep','accept','quantity')),
  line_id uuid,
  before_qty integer,
  after_qty integer,
  before_prep text,
  after_prep text,
  changed_at timestamptz not null default statement_timestamp()
);
create index order_operation_history_order_idx on public.order_operation_history(restaurant_id,order_id,changed_at);
alter table public.order_operation_history enable row level security;
revoke all on public.order_operation_history from public, anon, authenticated, service_role;
grant select on public.order_operation_history to authenticated;
create policy order_operation_history_management_read on public.order_operation_history for select to authenticated
  using (public.has_restaurant_role(restaurant_id,array['owner','manager']));

create function public.audit_order_operation() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if tg_table_name='orders' then
    if new.prep_status is distinct from old.prep_status then
      insert into public.order_operation_history(restaurant_id,order_id,actor_id,operation,before_prep,after_prep)
      values(new.restaurant_id,new.id,(select id from public.profiles where id=auth.uid()),'prep',old.prep_status,new.prep_status);
    end if;
    if old.confirmed_at is null and new.confirmed_at is not null then
      insert into public.order_operation_history(restaurant_id,order_id,actor_id,operation)
      values(new.restaurant_id,new.id,(select id from public.profiles where id=auth.uid()),'accept');
    end if;
  else
    insert into public.order_operation_history(restaurant_id,order_id,actor_id,operation,line_id,before_qty,after_qty)
    select o.restaurant_id,o.id,(select id from public.profiles where id=auth.uid()),'quantity',old.id,old.qty,
      case when tg_op='DELETE' then 0 else new.qty end
    from public.orders o where o.id=old.order_id;
  end if;
  return null;
end;
$$;
revoke all on function public.audit_order_operation() from public, anon, authenticated, service_role;
create trigger audit_ticket_lifecycle after update of prep_status,confirmed_at on public.orders
  for each row execute function public.audit_order_operation();
create trigger audit_ticket_quantity after update of qty on public.order_items
  for each row when (old.qty is distinct from new.qty) execute function public.audit_order_operation();
create trigger audit_ticket_line_removal after delete on public.order_items
  for each row execute function public.audit_order_operation();

-- A request that began before transfer can still be waiting on the table
-- lock. Do a fresh admission check before creating a call after this wait.
create function public.check_live_waiter_session() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if not exists (select 1 from public.table_verification_sessions s
    join public.table_qr_codes q on q.id=s.qr_code_id and q.revoked_at is null
    where s.token_hash=new.table_session_hash and s.restaurant_id=new.restaurant_id and s.table_id=new.table_id
      and s.revoked_at is null and s.expires_at>statement_timestamp()) then
    raise exception 'Your table session has expired. Scan the code on your table again.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.check_live_waiter_session() from public, anon, authenticated, service_role;
create trigger waiter_call_requires_live_table before insert on public.table_waiter_calls
  for each row execute function public.check_live_waiter_session();

-- Same guest authority and fields; add the version read with the full bill.
create or replace function public.get_public_order(
  p_slug text,
  p_code text,
  p_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'revision', o.guest_live_version::text,
    'prep_status', o.prep_status,
    'payment_status', o.payment_status,
    'subtotal_paise', o.subtotal_paise,
    'tax_paise', o.tax_paise,
    'total_paise', o.total_paise,
    'customer_note', o.customer_note,
    'placed_at', o.placed_at,
    'hold_required', o.hold_required,
    'confirmed_at', o.confirmed_at,
    'table_label', t.label,
    'lines', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'name', i.name_snapshot,
                 'qty', i.qty,
                 'unit_price_paise', i.unit_price_paise,
                 'is_veg', i.is_veg,
                 'variant', i.variant_snapshot,
                 'addons', i.addons_snapshot
               )
               order by i.sort_order
             )
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.dining_tables t on t.id = o.table_id
  where r.slug = p_slug
    and o.code = p_code
    and p_token is not null
    and o.guest_token = p_token
  limit 1;
$$;

-- Check before accepting an edit from a stale or duplicated guest tab. Take
-- the same sitting -> order locks as the pricing RPC; don't create a second
-- calculator or override the existing role/token/time/payment checks.
create function public.set_guest_order_lines_at_version(p_order_id uuid,p_guest_token uuid,p_version text,p_lines jsonb)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_version text;
begin
  if p_guest_token is null then return 'not_found'; end if;
  perform 1 from public.order_sessions s join public.orders o on o.order_session_id=s.id
    where o.id=p_order_id and o.guest_token=p_guest_token and o.restaurant_id=s.restaurant_id for update of s;
  select o.guest_live_version::text into v_version from public.orders o
    where o.id=p_order_id and o.guest_token=p_guest_token for update;
  if not found then return 'not_found'; end if;
  if v_version is distinct from p_version then return 'stale'; end if;
  perform public.set_order_line_quantities(p_order_id,p_lines,p_guest_token);
  return 'updated';
end;
$$;
revoke all on function public.set_guest_order_lines_at_version(uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_guest_order_lines_at_version(uuid,uuid,text,jsonb) to anon, authenticated;

-- Nothing about who called or who is on the floor. Exact existing verified
-- location + live card; QR expiry/revocation also stops this projection.
create function public.read_verified_waiter_state(p_slug text,p_table_label text,p_session_token text)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select case when c.id is null then 'idle'
    when c.acknowledged_at is null then 'waiting' else 'acknowledged' end
    from public.table_verification_sessions s
    join public.dining_tables t on t.id=s.table_id and t.is_active and t.restaurant_id=s.restaurant_id
    join public.restaurants r on r.id=s.restaurant_id and r.is_active
    join public.table_qr_codes q on q.id=s.qr_code_id and q.revoked_at is null and q.table_id=t.id and q.restaurant_id=r.id
    left join public.table_waiter_calls c on c.table_id=t.id and c.restaurant_id=r.id and c.status='open'
    where s.token_hash=encode(sha256(p_session_token::bytea),'hex') and p_session_token ~ '^[A-Fa-f0-9]{64}$'
      and s.revoked_at is null and s.expires_at>statement_timestamp() and r.slug=p_slug and t.label=p_table_label),'expired');
$$;
revoke all on function public.read_verified_waiter_state(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.read_verified_waiter_state(text,text,text) to anon, authenticated;

create function public.call_verified_waiter_at(p_slug text,p_table_label text,p_session_token text,p_request_key uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.read_verified_waiter_state(p_slug,p_table_label,p_session_token)='expired' then
    raise exception 'Your table session has expired. Scan the code on your table again.' using errcode='P0001';
  end if;
  return public.call_waiter(p_session_token,p_request_key);
end;
$$;
revoke all on function public.call_verified_waiter_at(text,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.call_verified_waiter_at(text,text,text,uuid) to anon, authenticated;
