-- 20261115000300 — Audited restaurant↔account link changes.
--
-- Hardens D1 (P0) beyond the 20261112000200 client-side guard. That guard
-- stops any JWT-carrying caller from moving restaurants.account_id; it says
-- nothing about what the trusted paths do, so a service-role or maintenance
-- change was invisible. This migration adds an append-only audit row for
-- every applied change, written by the same trigger that enforces the client
-- boundary, so no path can reassign silently.
--
-- Deliberate design choices:
--   * The audit row is written AFTER the client rejection, so only applied
--     changes are recorded; a rejected client attempt aborts with 42501 and
--     never reaches the ledger.
--   * Initial linking (INSERT) does not fire a BEFORE UPDATE trigger, so
--     signup and create_outlet() are unaffected and unaudited by design.
--   * Legitimately authorised operator work (a reviewed SQL repair run as
--     postgres/supabase_admin) is allowed and now VISIBLE: every applied
--     change lands in the ledger with its actor and the before/after link.
--     The trigger reads no GUC whatsoever; the ledger records trustworthy
--     server-side facts only.
--   * service_role (no JWT) is allowed — this is the migration/backfill and
--     operator repair path — and is audited like any other applied change.
--   * No application path, policy, trigger or grant is weakened. authenticated
--     keeps zero ability to move account_id; this migration only ADDS the
--     audit write.
--   * Additive only. No production or staging database is touched by creating
--     this file; it applies through the same reviewed release as its parent.

create table if not exists public.restaurant_account_link_audit (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default statement_timestamp(),
  restaurant_id  uuid not null,
  old_account_id uuid,
  new_account_id uuid,
  actor_role     text not null,
  actor_user     uuid
);

comment on table public.restaurant_account_link_audit is
  'Append-only ledger of every applied change to restaurants.account_id. Written by prevent_restaurant_account_reassignment(); server-role writes blocked by the no_rewrite trigger; client roles cannot read, insert, update or delete.';

create index if not exists restaurant_account_link_audit_restaurant_idx
  on public.restaurant_account_link_audit (restaurant_id, occurred_at desc);

alter table public.restaurant_account_link_audit enable row level security;
-- No client policies: anon/authenticated see and write zero rows. service_role
-- reads through this one policy (the hosted service_role bypasses RLS anyway,
-- so this changes nothing hosted — it makes the support read explicit and
-- lets the disposable harness match hosted behaviour). INSERT/UPDATE/DELETE
-- happen only inside the definer function / no_rewrite trigger.
revoke all on public.restaurant_account_link_audit from public, anon, authenticated;
grant select on public.restaurant_account_link_audit to service_role;
drop policy if exists restaurant_account_link_audit_support_select on public.restaurant_account_link_audit;
create policy restaurant_account_link_audit_support_select on public.restaurant_account_link_audit
  for select to service_role using (true);


create or replace function public.restaurant_account_link_audit_no_rewrite()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Account-link audit rows can never be changed or removed.' using errcode = '42501';
end;
$$;

drop trigger if exists restaurant_account_link_audit_no_rewrite on public.restaurant_account_link_audit;
create trigger restaurant_account_link_audit_no_rewrite
  before update or delete on public.restaurant_account_link_audit
  for each row execute function public.restaurant_account_link_audit_no_rewrite();

revoke all on function public.restaurant_account_link_audit_no_rewrite()
  from public, anon, authenticated, service_role;

create or replace function public.prevent_restaurant_account_reassignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is populated by the signed PostgREST JWT for authenticated
  -- requests. Do not use a caller-settable application GUC as a bypass flag.
  -- The service role and migration runner have no end-user subject and remain
  -- the trusted paths for any operator-approved repair — but every applied
  -- change they make is audited below.
  if old.account_id is distinct from new.account_id then
    if auth.uid() is not null then
      raise exception 'restaurant account link cannot be changed by a client'
        using errcode = '42501';
    end if;

    insert into public.restaurant_account_link_audit
      (restaurant_id, old_account_id, new_account_id, actor_role, actor_user)
    values (
      new.id,
      old.account_id,
      new.account_id,
      current_user,
      auth.uid()
    );
  end if;

  return new;
end;
$$;

comment on function public.prevent_restaurant_account_reassignment() is
  'Rejects authenticated changes to restaurants.account_id; leaves other restaurant updates, initial inserts, trusted service/migration repairs, and nullable legacy links unchanged; audits every applied change to restaurant_account_link_audit.';

-- Trigger functions are invoked by the trigger, not exposed as an RPC.
revoke all on function public.prevent_restaurant_account_reassignment()
  from public, anon, authenticated, service_role;

drop trigger if exists restaurants_account_id_immutable on public.restaurants;
create trigger restaurants_account_id_immutable
  before update on public.restaurants
  for each row
  execute function public.prevent_restaurant_account_reassignment();
