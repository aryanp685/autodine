-- ============================================================================
-- P4: mark one table session paid, with an auditable internal ledger entry.
--
-- The operator sees one simple tick for the whole table session. There is no
-- payment-mode selector. Internally the settlement is recorded as method
-- 'manual', so dashboard/report revenue remains backed by the same payments
-- ledger as cash/card/UPI and the staff/timestamp are auditable.
--
-- The manual method is not accepted by record_counter_payment and is never
-- exposed as a cashier choice. This RPC derives every amount from locked order
-- rows and existing recorded payments; the caller submits only a session UUID.
-- ============================================================================

-- Keep the existing methods intact and add the internal manual marker. The
-- audit-event table was originally cash-only even though the counter RPC has
-- supported cash/card/UPI since migration 20261020170906; widening this precise
-- set restores those existing paths while adding the manual event.
alter table public.payments
  drop constraint if exists payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method in ('cash', 'card', 'upi', 'online', 'manual'));

alter table public.payment_audit_events
  drop constraint if exists payment_audit_events_method_check;
alter table public.payment_audit_events
  add constraint payment_audit_events_method_check
  check (method in ('cash', 'card', 'upi', 'online', 'manual'));

alter table public.payment_audit_events
  drop constraint if exists payment_audit_events_event_type_check;
alter table public.payment_audit_events
  add constraint payment_audit_events_event_type_check
  check (event_type in ('cash_collected', 'card_collected', 'upi_collected', 'online_collected', 'manual_marked_paid'));

alter table public.order_sessions
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid references public.profiles(id) on delete set null;

comment on column public.order_sessions.paid_at is
  'When staff marked this sitting paid, or the latest settlement time used to show a fully paid session.';
comment on column public.order_sessions.paid_by is
  'Staff member who marked this sitting paid. Null when it was settled only through individual counter payments.';

-- SECURITY DEFINER; derives restaurant and role from the locked session, never
-- trusts a restaurant id, amount, payment method, or actor supplied by client.
create or replace function public.mark_order_session_paid(
  p_order_session_id uuid
) returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id       uuid;
  v_role           public.member_role;
  v_session       public.order_sessions%rowtype;
  v_order         public.orders%rowtype;
  v_paid_paise    bigint;
  v_due_paise     bigint;
  v_payment_id    uuid;
  v_existing      public.payments%rowtype;
  v_key           text;
  v_order_count   integer := 0;
  v_recorded_any  boolean := false;
  v_settled_at    timestamptz;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception 'Sign in with an authorized restaurant account to mark a table paid.'
      using errcode = '42501';
  end if;

  select s.* into v_session
    from public.order_sessions s
    join public.restaurants r on r.id = s.restaurant_id and r.is_active
   where s.id = p_order_session_id
   for update of s;

  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_session.restaurant_id
     and m.user_id = v_actor_id;

  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to settle this table.'
      using errcode = '42501';
  end if;

  if not public.restaurant_can_write(v_session.restaurant_id) then
    raise exception 'This restaurant is in read-only mode. Restore access before marking a table paid.'
      using errcode = 'P0001';
  end if;

  if v_session.status <> 'open' or v_session.closed_at is not null then
    raise exception 'This table session is already closed.' using errcode = 'P0001';
  end if;

  -- One table can have several tickets. Lock them in stable order so a
  -- concurrent counter payment cannot race the balance calculation.
  for v_order in
    select o.*
      from public.orders o
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled'
     order by o.id
     for update
  loop
    v_order_count := v_order_count + 1;

    select coalesce(sum(p.amount_paise), 0)::bigint
      into v_paid_paise
      from public.payments p
     where p.order_id = v_order.id
       and p.status = 'recorded';

    v_due_paise := greatest(v_order.total_paise - v_paid_paise, 0);

    if v_due_paise > 0 then
      v_key := 'manual-session:' || v_session.id::text || ':' || v_order.id::text;

      select * into v_existing
        from public.payments p
       where p.idempotency_key = v_key;

      if found then
        if v_existing.order_id <> v_order.id
           or v_existing.amount_paise <> v_due_paise
           or v_existing.method <> 'manual'
           or v_existing.status <> 'recorded' then
          raise exception 'The manual settlement key conflicts with an existing payment.'
            using errcode = 'P0001';
        end if;
        v_payment_id := v_existing.id;
      else
        insert into public.payments (
          order_id, restaurant_id, method, amount_paise, status,
          provider, recorded_by, idempotency_key
        ) values (
          v_order.id, v_session.restaurant_id, 'manual', v_due_paise, 'recorded',
          'staff_manual', v_actor_id, v_key
        ) returning id into v_payment_id;

        insert into public.payment_audit_events (
          restaurant_id, order_id, payment_id, actor_id,
          event_type, method, amount_paise
        ) values (
          v_session.restaurant_id, v_order.id, v_payment_id, v_actor_id,
          'manual_marked_paid', 'manual', v_due_paise
        ) on conflict (payment_id, event_type) do nothing;

        v_recorded_any := true;
      end if;
    end if;

    update public.orders
       set payment_status = 'paid',
           updated_at = statement_timestamp()
     where id = v_order.id
       and restaurant_id = v_session.restaurant_id;
  end loop;

  if v_order_count = 0 then
    raise exception 'This table has no active tickets to settle.' using errcode = 'P0001';
  end if;

  if v_recorded_any then
    v_settled_at := statement_timestamp();
    update public.order_sessions
       set paid_at = v_settled_at,
           paid_by = v_actor_id
     where id = v_session.id;
  else
    -- Idempotent retry: keep the original marker. For sessions settled through
    -- individual cashier payments, use the latest recorded ledger timestamp.
    select coalesce(
      v_session.paid_at,
      max(p.created_at),
      statement_timestamp()
    ) into v_settled_at
      from public.orders o
      left join public.payments p
        on p.order_id = o.id and p.status = 'recorded'
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled';

    update public.order_sessions
       set paid_at = coalesce(paid_at, v_settled_at),
           paid_by = coalesce(paid_by, v_actor_id)
     where id = v_session.id
     returning paid_at into v_settled_at;
  end if;

  return v_settled_at;
end;
$$;

comment on function public.mark_order_session_paid(uuid) is
  'Atomically marks an open table session paid, derives each remaining order balance server-side, records internal manual ledger/audit rows, and stores staff plus timestamp.';

revoke all on function public.mark_order_session_paid(uuid) from public;
revoke all on function public.mark_order_session_paid(uuid) from anon;
revoke all on function public.mark_order_session_paid(uuid) from authenticated;
grant execute on function public.mark_order_session_paid(uuid) to authenticated;
