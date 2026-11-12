-- Keep checkout and final receipt issuance behind full recorded settlement.
-- Staging already has this guard; the Production catalog's checkout body does
-- not. This forward-only replacement aligns the active checkout RPC without
-- rewriting earlier migration history or changing any customer/payment rows.
-- The session lock serializes this balance check with order, counter-payment,
-- online-attempt, and online-settlement RPCs that take the same lock first.
create or replace function public.close_order_session_and_issue_receipt(
  p_order_session_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.order_sessions%rowtype;
  v_role public.member_role;
  v_invoice_id uuid;
  v_outstanding_paise bigint := 0;
begin
  if v_actor is null then
    raise exception 'Sign in with an authorized restaurant account to close this table.'
      using errcode = '42501';
  end if;

  select s.* into v_session
    from public.order_sessions s
   where s.id = p_order_session_id
   for update;
  if not found then
    raise exception 'Table session not found.' using errcode = 'P0002';
  end if;

  select m.role into v_role
    from public.memberships m
   where m.restaurant_id = v_session.restaurant_id and m.user_id = v_actor;
  if not found or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'You do not have permission to check out this table.' using errcode = '42501';
  end if;

  if v_session.status = 'open' then
    if not public.restaurant_can_write(v_session.restaurant_id) then
      raise exception 'This restaurant is in read-only mode. Restore access before checkout.'
        using errcode = 'P0001';
    end if;

    select coalesce(sum(greatest(o.total_paise - coalesce(p.recorded_paise, 0), 0)), 0)::bigint
      into v_outstanding_paise
      from public.orders o
      left join lateral (
        select coalesce(sum(pay.amount_paise), 0)::bigint as recorded_paise
          from public.payments pay
         where pay.order_id = o.id
           and pay.restaurant_id = v_session.restaurant_id
           and pay.status = 'recorded'
      ) p on true
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled';

    if v_outstanding_paise > 0 then
      raise exception 'Collect the full outstanding balance before closing this table session.'
        using errcode = 'P0001';
    end if;

    update public.order_sessions
       set status = 'closed',
           closed_at = statement_timestamp(),
           closed_by = v_actor
     where id = v_session.id;
  elsif v_session.closed_at is null then
    raise exception 'The closed table session has no close timestamp; ask an owner to review it.'
      using errcode = 'P0001';
  elsif not exists (
    select 1 from public.restaurant_invoices i
     where i.order_session_id = v_session.id and i.status = 'issued'
  ) then
    -- A closed legacy session with no live invoice is not a reason to skip the
    -- balance check on retry/reissue. Voiding an invoice never implies money
    -- was collected, and a replacement must remain financially reconciled.
    select coalesce(sum(greatest(o.total_paise - coalesce(p.recorded_paise, 0), 0)), 0)::bigint
      into v_outstanding_paise
      from public.orders o
      left join lateral (
        select coalesce(sum(pay.amount_paise), 0)::bigint as recorded_paise
          from public.payments pay
         where pay.order_id = o.id
           and pay.restaurant_id = v_session.restaurant_id
           and pay.status = 'recorded'
      ) p on true
     where o.order_session_id = v_session.id
       and o.restaurant_id = v_session.restaurant_id
       and o.prep_status <> 'cancelled';

    if v_outstanding_paise > 0 then
      raise exception 'Collect the full outstanding balance before issuing this session receipt.'
        using errcode = 'P0001';
    end if;
  end if;

  v_invoice_id := public.issue_closed_session_receipt(v_session.id);
  return v_invoice_id;
end;
$$;

comment on function public.close_order_session_and_issue_receipt(uuid) is
  'Atomically closes a table session only after every non-cancelled ticket is fully covered by recorded payments, then creates/returns the final receipt. Retries of an already-issued invoice remain idempotent.';

revoke all on function public.close_order_session_and_issue_receipt(uuid) from public, anon, authenticated;
grant execute on function public.close_order_session_and_issue_receipt(uuid) to authenticated;
