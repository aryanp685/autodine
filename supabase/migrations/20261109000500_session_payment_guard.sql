-- Preserve manual session settlement, but do not collect against in-flight gateway money.
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
    if exists (select 1 from public.payments p
               where p.order_id = v_order.id and p.method = 'online' and p.status = 'pending') then
      raise exception 'An online payment is in progress. Resolve it before settling this table.' using errcode = 'P0001';
    end if;


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
