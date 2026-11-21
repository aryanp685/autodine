-- P8 hardening: a table session must be fully settled before checkout can
-- close it and issue its final receipt. UI gating is helpful, but this check
-- belongs in the SECURITY DEFINER transaction so direct RPC calls cannot
-- strand an unpaid bill in history.
--
-- The outstanding balance is derived per ticket from recorded ledger rows;
-- pending, failed, and refunded attempts do not count as received money.
-- Replays of an already-issued receipt remain idempotent, including later
-- payments against that immutable receipt. A closed legacy session without an
-- invoice is not allowed to receive a new unpaid invoice through this RPC.

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
    -- Defensive handling for a closed row with no issued receipt. This is not
    -- the normal path: the supported close RPC commits both or neither.
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
  'Atomically closes only a fully settled table session and creates/returns its final receipt. An unpaid or partially paid session remains open. Replays of an already-issued receipt are idempotent.';

-- Invoice issuance is only allowed through the settlement-gated close RPC;
-- do not leave the lower-level helper callable directly by an authenticated
-- client, which could otherwise issue an unpaid receipt for a legacy closed row.
revoke all on function public.issue_closed_session_receipt(uuid) from public, anon, authenticated, service_role;
revoke all on function public.close_order_session_and_issue_receipt(uuid) from public, anon, authenticated;
grant execute on function public.close_order_session_and_issue_receipt(uuid) to authenticated;
