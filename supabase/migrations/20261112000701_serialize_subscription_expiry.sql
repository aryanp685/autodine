-- 20261112000700 — Make subscription expiry transition idempotent.
--
-- expire_subscriptions() selected candidate rows with an unlocked read, then
-- updated each row and wrote one 'expired' history event per row. Two runs
-- overlapping (the 15-minute scheduler plus a manual invocation, or two
-- invocations racing each other) could both select the same account and both
-- write the 'expired' event: the UPDATE matched either way because it did
-- not re-check the state it was transitioning from.
--
-- This migration keeps the signature, the SECURITY DEFINER mode, the fixed
-- search_path and the EXECUTE grant. It changes the UPDATE to re-check the
-- transition inside the statement and only writes the event for rows this
-- call actually transitioned, so repeated or concurrent runs converge to one
-- 'expired' event per account.
--
-- Expired accounts remain read-only and intact: nothing is deleted, and the
-- event text is unchanged.

create or replace function public.expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_expired uuid;
  v_count integer := 0;
begin
  for r in
    select a.id
      from public.accounts a
     -- 'cancelled' belongs here too: it still gets the period it paid for, and
     -- when that period ends the account is expired, not merely cancelled.
     where a.plan_status in ('trialing', 'active', 'past_due', 'cancel_requested', 'cancelled')
       and case
             when a.plan in ('starter', 'professional', 'business') then a.plan_expires_at
             else coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days')
           end < now()
  loop
    -- Re-check the transition inside the UPDATE: whatever committed first wins
    -- the row, a concurrent run blocks on the row lock and then finds nothing
    -- to transition, and no second 'expired' event is written.
    update public.accounts a
       set plan_status        = 'expired',
           -- The requested cancellation has now happened: nothing left to run.
           cancel_effective_at = coalesce(a.cancel_effective_at, now()),
           updated_at         = now()
     where a.id = r.id
       and a.plan_status in ('trialing', 'active', 'past_due', 'cancel_requested', 'cancelled')
       and case
             when a.plan in ('starter', 'professional', 'business') then a.plan_expires_at
             else coalesce(a.trial_ends_at, a.trial_started_at + interval '21 days')
           end < now()
    returning a.id into v_expired;

    if v_expired is null then
      continue;
    end if;

    insert into public.subscription_events (account_id, kind, actor, note)
    values (v_expired, 'expired', 'system',
            'The subscription period ended. Every outlet and every row of data is preserved and readable.');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_subscriptions() to service_role;
