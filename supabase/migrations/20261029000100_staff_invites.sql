-- ============================================================================
-- Team access: staff invitations, redemption, and role-scoped writes
--
-- WHY THIS EXISTS
--
-- public.memberships has carried a role since the first migration --
-- owner / manager / kitchen / cashier -- and nothing could ever create a
-- second row. Every restaurant was one login: the person who signed up was
-- the owner, the cashier and the cook, and a kitchen tablet could only be
-- that same account. The roles were real in the database and unreachable in
-- the product.
--
-- THE SHAPE
--
--   * An owner (or a manager, for the roles a manager may hire) mints an
--     invitation. What comes back is a short code, once. The database stores
--     only sha256(code): a leaked dump cannot be turned back into a working
--     link, and neither the owner nor support can read an old one.
--   * The code is scoped to one restaurant and one role, expires (default 7
--     days, maximum 30), and is single use. Redemption locks the row, so two
--     people racing the same link produce one membership and one honest
--     "already used" for the loser -- never two members and never a silent
--     second join.
--   * The browser cannot write this table at all. There is no INSERT, UPDATE
--     or DELETE grant: every change goes through a SECURITY DEFINER function
--     that derives the actor from auth.uid() and checks the caller's role in
--     that restaurant. An invite cannot be pointed at another restaurant
--     because the restaurant id is read from the invite row, not the client.
--   * Invitations can never mint an owner. Ownership is not transferable
--     through a link; the last owner cannot be removed either, which is what
--     keeps a restaurant from ending up with nobody who can administer it.
--
-- ALSO HERE: THE WRITE POLICIES THE ROLES IMPLIED
--
-- The menu, table and payment policies were written when every member was an
-- owner. They said "any member of this restaurant may write" -- so a kitchen
-- login could have renamed a dish, changed a price, rotated a table's QR
-- code, or inserted a payment row directly. The roles only become meaningful
-- once those policies say what the roles mean:
--
--   * menu, categories, items, variants, add-ons, tables   owner + manager
--   * payments: read                                       owner + manager + cashier
--   * payments: write                                      nobody -- the
--     record_counter_payment RPC is the only door, and it checks the role
--
-- Reads stay open to every member: a cook needs the dish names on a ticket.
--
-- NOT APPLIED ANYWHERE. This migration is on a feature branch only; it has
-- not been run against any Supabase project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The invitation
-- ----------------------------------------------------------------------------

create table if not exists public.restaurant_invites (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role          public.member_role not null,
  -- sha256 of the normalised code, hex. The code itself is never stored.
  code_hash     text not null unique,
  created_by    uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  redeemed_by   uuid references public.profiles(id) on delete cascade,
  redeemed_at   timestamptz,
  revoked_at    timestamptz,
  -- Ownership is granted once, at signup. It cannot be handed out by link.
  constraint restaurant_invites_role_not_owner check (role <> 'owner'),
  -- A redemption is one moment: both columns set, or neither.
  constraint restaurant_invites_redeemed_together
    check ((redeemed_at is null) = (redeemed_by is null)),
  -- An invitation cannot already be expired when it is created.
  constraint restaurant_invites_expires_after_creation check (expires_at > created_at)
);

comment on table public.restaurant_invites is
  'Single-use, expiring staff invitations. Stores only sha256 of the code; writes go through SECURITY DEFINER functions, never the client.';

create index if not exists restaurant_invites_restaurant_idx
  on public.restaurant_invites (restaurant_id, created_at desc);

-- The lookup that redemption actually performs, restricted to links that can
-- still be used. Keeps a table that accumulates expired invitations from
-- turning the redeem path into a scan.
create index if not exists restaurant_invites_live_idx
  on public.restaurant_invites (restaurant_id)
  where redeemed_at is null and revoked_at is null;

alter table public.restaurant_invites enable row level security;

-- Read-only to owners and managers; no write policy exists on purpose.
drop policy if exists restaurant_invites_read on public.restaurant_invites;
create policy restaurant_invites_read on public.restaurant_invites
  for select
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager']));

-- A policy is not a permission. Supabase's default grants on a new table are
-- not something this project relies on (see 20261021000500), so the grants
-- are explicit -- and they name their columns. `code_hash` is deliberately
-- absent: even a member who may read the table cannot read the hashes, so an
-- offline guessing attack has nothing to start from.
revoke all on public.restaurant_invites from anon;
revoke all on public.restaurant_invites from authenticated;
grant select (
  id, restaurant_id, role, created_by, created_at, expires_at, redeemed_at, revoked_at
) on public.restaurant_invites to authenticated;

-- ----------------------------------------------------------------------------
-- Codes
--
-- 16 characters from a 32-symbol alphabet = 80 bits. The four symbols people
-- confuse when reading a code aloud (I, O, 0, 1) are not in the alphabet, so
-- a code can be dictated over the phone without "was that an O or a zero".
-- Normalisation is case- and punctuation-insensitive: a code pasted from
-- WhatsApp with the dashes, or typed without them, hashes the same.
-- ----------------------------------------------------------------------------

create or replace function public.normalise_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

-- pgcrypto/digest are not available on this instance (see
-- 20261023000900); sha256(bytea) is a built-in and is what is used here.
create or replace function public.hash_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(public.normalise_invite_code(p_code), 'UTF8')), 'hex');
$$;

create or replace function public.new_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hex      text := replace(gen_random_uuid()::text, '-', '');
  v_code     text := '';
  i          integer;
begin
  -- Two hex characters per symbol, taken mod 32. 256 / 32 is exact, so the
     -- modulo introduces no bias: every symbol is equally likely.
  for i in 1..16 loop
    v_code := v_code
      || substr(v_alphabet, (('x' || substr(v_hex, i * 2 - 1, 2))::bit(8)::integer % 32) + 1, 1);
    if i % 4 = 0 and i < 16 then
      v_code := v_code || '-';
    end if;
  end loop;

  return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- Mint an invitation
--
-- p_restaurant_id is never taken from the client's word alone: the caller must
-- hold a membership row with a role that may hire. A manager may invite
-- kitchen and cashier; only the owner may invite a manager. Nobody may invite
-- an owner.
-- ----------------------------------------------------------------------------

create or replace function public.create_staff_invite(
  p_restaurant_id uuid,
  p_role          public.member_role,
  p_days          integer default 7
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_caller public.member_role;
  v_days   integer := least(greatest(coalesce(p_days, 7), 1), 30);
  v_code   text;
  v_hash   text;
  i        integer;
begin
  if v_actor is null then
    raise exception 'Sign in to invite staff.' using errcode = '42501';
  end if;

  if p_restaurant_id is null then
    raise exception 'A restaurant is required.' using errcode = '22023';
  end if;

  select m.role into v_caller
  from public.memberships m
  where m.restaurant_id = p_restaurant_id
    and m.user_id = v_actor;

  if not found or v_caller not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can invite staff to this restaurant.'
      using errcode = '42501';
  end if;

  if p_role is null then
    raise exception 'Choose a role for the invitation.' using errcode = '22023';
  end if;

  if p_role = 'owner' then
    raise exception 'Ownership cannot be granted by invitation.' using errcode = '42501';
  end if;

  if p_role = 'manager' and v_caller <> 'owner' then
    raise exception 'Only the owner can invite a manager.' using errcode = '42501';
  end if;

  -- A collision of 80 random bits means something is badly wrong, but the
     -- unique index is the authority, so the insert is retried a few times
     -- rather than trusted. Losing the race is not an error the caller can act
     -- on, so after five attempts it becomes a plain "try again".
  for i in 1..5 loop
    v_code := public.new_invite_code();
    v_hash := public.hash_invite_code(v_code);

    begin
      insert into public.restaurant_invites (restaurant_id, role, code_hash, created_by, expires_at)
      values (p_restaurant_id, p_role, v_hash, v_actor, now() + make_interval(days => v_days));
      return v_code;
    exception when unique_violation then
      -- try another code
    end;
  end loop;

  raise exception 'Could not create an invitation. Please try again.' using errcode = 'P0001';
end;
$$;

-- ----------------------------------------------------------------------------
-- What a link is
--
-- Read-only and consumes nothing, so a staff member can open the link, sign
-- in, and still see what they are joining. Requires a session: an anonymous
-- visitor holding a guessed link learns nothing, including whether it exists.
-- ----------------------------------------------------------------------------

create or replace function public.preview_staff_invite(p_code text)
returns table (
  status          text,
  restaurant_id   uuid,
  restaurant_name text,
  role            public.member_role,
  expires_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invite public.restaurant_invites%rowtype;
  v_name   text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to open this invitation.' using errcode = '42501';
  end if;

  select * into v_invite
  from public.restaurant_invites i
  where i.code_hash = public.hash_invite_code(p_code);

  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::public.member_role, null::timestamptz;
    return;
  end if;

  select r.name into v_name
  from public.restaurants r
  where r.id = v_invite.restaurant_id and r.is_active;

  -- The status ladder is ordered deliberately. A link that was both revoked
     -- and later expired is described as revoked: that is the fact the owner
     -- acted on, and it is the one that explains why a code that looks valid
     -- does not work.
  if not found then
    return query select 'closed'::text, v_invite.restaurant_id, null::text, v_invite.role, v_invite.expires_at;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif v_invite.expires_at <= now() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  elsif exists (
    select 1 from public.memberships m
    where m.restaurant_id = v_invite.restaurant_id
      and m.user_id = auth.uid()
  ) then
    -- Said here rather than only at redemption, so the page can offer "open
       -- your screen" instead of an Accept button that would answer "you are
       -- already on this team".
    return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  else
    return query select 'ok'::text, v_invite.restaurant_id, v_name, v_invite.role, v_invite.expires_at;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Redeem
--
-- One transaction, one row, one member. `for update` is what makes the link
-- single use under concurrency: the second caller blocks, then reads the row
-- with redeemed_at already set and is told the truth. The membership is
-- created for the invite's restaurant -- never one named by the caller -- so
-- a link to restaurant A cannot join B.
-- ----------------------------------------------------------------------------

create or replace function public.redeem_staff_invite(p_code text)
returns table (
  status          text,
  restaurant_id   uuid,
  restaurant_name text,
  role            public.member_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_invite public.restaurant_invites%rowtype;
  v_name   text;
begin
  if v_actor is null then
    raise exception 'Sign in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_invite
  from public.restaurant_invites i
  where i.code_hash = public.hash_invite_code(p_code)
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::public.member_role;
    return;
  end if;

  select r.name into v_name
  from public.restaurants r
  where r.id = v_invite.restaurant_id and r.is_active;

  if not found then
    return query select 'closed'::text, v_invite.restaurant_id, null::text, v_invite.role;
    return;
  elsif v_invite.revoked_at is not null then
    return query select 'revoked'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  elsif v_invite.redeemed_at is not null then
    return query select 'used'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  elsif v_invite.expires_at <= now() then
    return query select 'expired'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  end if;

  -- Already a member: say so, and do NOT burn the code. The person holding a
     -- link for a restaurant they already work in has not used anything up --
     -- the link is still good for the colleague it was sent to.
  if exists (
    select 1 from public.memberships m
    where m.restaurant_id = v_invite.restaurant_id
      and m.user_id = v_actor
  ) then
    return query select 'already_member'::text, v_invite.restaurant_id, v_name, v_invite.role;
    return;
  end if;

  -- The membership's foreign key points at public.profiles. An account can
     -- exist without one -- the normal signup writes it, an account created by
     -- an invitation or by Supabase Auth alone does not. Creating it here is
     -- what makes "accept the link, then sign up" work in either order.
  insert into public.profiles (id) values (v_actor)
  on conflict (id) do nothing;

  insert into public.memberships (restaurant_id, user_id, role)
  values (v_invite.restaurant_id, v_actor, v_invite.role);

  update public.restaurant_invites
     set redeemed_by = v_actor, redeemed_at = now()
   where id = v_invite.id;

  return query select 'ok'::text, v_invite.restaurant_id, v_name, v_invite.role;
end;
$$;

-- ----------------------------------------------------------------------------
-- Revoke an invitation that has not been used
-- ----------------------------------------------------------------------------

create or replace function public.revoke_staff_invite(p_invite_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_invite public.restaurant_invites%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in to change invitations.' using errcode = '42501';
  end if;

  select * into v_invite
  from public.restaurant_invites i
  where i.id = p_invite_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if not public.has_restaurant_role(v_invite.restaurant_id, array['owner', 'manager']) then
    -- Deliberately the same message whether the invite is absent or belongs
       -- to somebody else's restaurant: an id that is not yours must not be
       -- distinguishable from one that does not exist.
    raise exception 'That invitation is not yours to revoke.' using errcode = '42501';
  end if;

  if v_invite.redeemed_at is not null then
    return 'used';
  end if;

  if v_invite.revoked_at is not null then
    return 'revoked';
  end if;

  update public.restaurant_invites
     set revoked_at = now()
   where id = v_invite.id;

  return 'revoked';
end;
$$;

-- ----------------------------------------------------------------------------
-- Remove somebody from the team
--
-- Owner only. A manager can invite a cook; a manager cannot remove the person
-- who owns the restaurant, or another manager.
--
-- THE LAST OWNER CANNOT BE REMOVED. Without this, one tap produces a
-- restaurant nobody can administer: no menus, no settings, no way to grant
-- the role back, since ownership can only be created by the signup path. The
-- check counts owners rather than looking at the caller, because a second
-- owner may exist and any one of them may leave.
-- ----------------------------------------------------------------------------

create or replace function public.remove_staff_member(p_membership_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_membership public.memberships%rowtype;
  v_owners     integer;
begin
  if v_actor is null then
    raise exception 'Sign in to change the team.' using errcode = '42501';
  end if;

  select * into v_membership
  from public.memberships m
  where m.id = p_membership_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if not public.has_restaurant_role(v_membership.restaurant_id, array['owner']) then
    raise exception 'Only the owner can remove a team member.' using errcode = '42501';
  end if;

  if v_membership.role <> 'owner' and v_membership.user_id = v_actor then
    -- An owner removing their own non-owner membership in a restaurant they
       -- own is nonsense; refuse rather than half-apply it.
    raise exception 'You cannot remove your own access to a restaurant you own.'
      using errcode = '42501';
  end if;

  if v_membership.role = 'owner' then
    select count(*) into v_owners
    from public.memberships m
    where m.restaurant_id = v_membership.restaurant_id
      and m.role = 'owner';

    if v_owners <= 1 then
      raise exception 'The last owner cannot be removed. Make somebody else an owner first.'
        using errcode = '42501';
    end if;
  end if;

  delete from public.memberships m where m.id = v_membership.id;

  return 'removed';
end;
$$;

-- ----------------------------------------------------------------------------
-- The email on a team row
--
-- auth.users is a Supabase object, not one of this repository's tables: a
-- plain Postgres built from these migrations (the local harness, a CI scratch
-- database) does not have it. A function that joined it directly would work on
-- Supabase and fail everywhere else, which is the worst possible split.
--
-- to_regclass() is checked BEFORE the select, so the statement is never
-- executed where the relation is absent -- and the column is simply null there.
-- ----------------------------------------------------------------------------

create or replace function public.staff_email(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if to_regclass('auth.users') is null then
    return null;
  end if;

  return (select u.email::text from auth.users u where u.id = p_user_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- The team list
--
-- A SECURITY DEFINER read instead of a wider policy on public.profiles.
-- profiles_self lets a person read only their own row; opening it to
-- co-members would also expose their phone number. This returns the four
-- facts a People screen needs and nothing else: who, what role, since when,
-- and whether it is you. The email is the one an owner needs to tell two
-- "Staff member" rows apart, and is visible to owner/manager only.
-- ----------------------------------------------------------------------------

create or replace function public.list_staff_members(p_restaurant_id uuid)
returns table (
  membership_id uuid,
  user_id       uuid,
  role          public.member_role,
  full_name     text,
  email         text,
  joined_at     timestamptz,
  is_self       boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Sign in to see the team.' using errcode = '42501';
  end if;

  if not public.has_restaurant_role(p_restaurant_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can see the team list.' using errcode = '42501';
  end if;

  return query
    select
      m.id,
      m.user_id,
      m.role,
      nullif(trim(p.full_name), ''),
      public.staff_email(m.user_id),
      m.created_at,
      m.user_id = v_actor
    from public.memberships m
    left join public.profiles p on p.id = m.user_id
    where m.restaurant_id = p_restaurant_id
    order by
      -- Owners first, then managers, then the rest; oldest first inside a
         -- role, so the list does not reshuffle when somebody joins.
      case m.role
        when 'owner' then 0
        when 'manager' then 1
        when 'cashier' then 2
        else 3
      end,
      m.created_at asc;
end;
$$;

-- ----------------------------------------------------------------------------
-- Function grants
--
-- The browser calls these over PostgREST. `anon` gets nothing: every one of
-- them begins by requiring auth.uid(), and granting execute to anon would
-- only move that failure deeper.
-- ----------------------------------------------------------------------------

revoke all on function public.normalise_invite_code(text) from public;
revoke all on function public.hash_invite_code(text) from public;
revoke all on function public.new_invite_code() from public;
revoke all on function public.staff_email(uuid) from public, anon, authenticated;
revoke all on function public.create_staff_invite(uuid, public.member_role, integer) from public, anon;
revoke all on function public.preview_staff_invite(text) from public, anon;
revoke all on function public.redeem_staff_invite(text) from public, anon;
revoke all on function public.revoke_staff_invite(uuid) from public, anon;
revoke all on function public.remove_staff_member(uuid) from public, anon;
revoke all on function public.list_staff_members(uuid) from public, anon;

grant execute on function public.create_staff_invite(uuid, public.member_role, integer) to authenticated;
grant execute on function public.preview_staff_invite(text) to authenticated;
grant execute on function public.redeem_staff_invite(text) to authenticated;
grant execute on function public.revoke_staff_invite(uuid) to authenticated;
grant execute on function public.remove_staff_member(uuid) to authenticated;
grant execute on function public.list_staff_members(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Write policies that honour the roles
--
-- DROPPED AND RECREATED, because a policy cannot be edited. Every one below
-- was `for all using (restaurant_id in (select current_restaurant_ids()))`,
-- which says "any member", and any member included the kitchen.
--
-- Every write policy also checks public.restaurant_can_write(restaurant_id):
-- a restaurant whose trial has expired can still read its menu but cannot
-- change it. The trial gate is a licence check, not an access check, so it
-- belongs in the policy alongside the role check, not only in the RPCs.
-- ----------------------------------------------------------------------------

-- Menus: every member reads (the board and the ledger join through menus),
-- owner and manager write.
--
-- The remote project ships per-command policies (menus_staff_read,
-- menus_staff_insert, menus_staff_update, menus_staff_delete) rather than a
-- single `for all` policy. Both spellings are dropped so this migration
-- produces the same result on a fresh database and on an existing one.
drop policy if exists menus_staff on public.menus;
drop policy if exists menus_staff_read on public.menus;
drop policy if exists menus_staff_insert on public.menus;
drop policy if exists menus_staff_update on public.menus;
drop policy if exists menus_staff_delete on public.menus;
drop policy if exists menus_member_read on public.menus;
drop policy if exists menus_manage on public.menus;
create policy menus_member_read on public.menus
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy menus_manage on public.menus
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- Categories: every member reads, owner and manager write.
--
-- See the menus section above for why both the `for all` and per-command
-- policy spellings are dropped.
drop policy if exists categories_staff on public.categories;
drop policy if exists categories_staff_read on public.categories;
drop policy if exists categories_staff_insert on public.categories;
drop policy if exists categories_staff_update on public.categories;
drop policy if exists categories_staff_delete on public.categories;
drop policy if exists categories_member_read on public.categories;
drop policy if exists categories_manage on public.categories;
create policy categories_member_read on public.categories
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy categories_manage on public.categories
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- Items: every member reads, owner and manager write.
--
-- See the menus section above for why both spellings are dropped.
drop policy if exists items_staff on public.items;
drop policy if exists items_staff_read on public.items;
drop policy if exists items_staff_insert on public.items;
drop policy if exists items_staff_update on public.items;
drop policy if exists items_staff_delete on public.items;
drop policy if exists items_member_read on public.items;
drop policy if exists items_manage on public.items;
create policy items_member_read on public.items
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy items_manage on public.items
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- Variants and add-ons carry their own restaurant_id through a policy that
-- joins items; the write side mirrors items exactly.
--
-- See the menus section above for why both spellings are dropped.
drop policy if exists variants_staff on public.item_variants;
drop policy if exists variants_staff_read on public.item_variants;
drop policy if exists variants_staff_insert on public.item_variants;
drop policy if exists variants_staff_update on public.item_variants;
drop policy if exists variants_staff_delete on public.item_variants;
drop policy if exists variants_member_read on public.item_variants;
drop policy if exists variants_manage on public.item_variants;
create policy variants_member_read on public.item_variants
  for select using (
    exists (
      select 1 from public.items i
      where i.id = item_variants.item_id
        and i.restaurant_id in (select public.current_restaurant_ids())
    )
  );
create policy variants_manage on public.item_variants
  for all
  using (
    exists (
      select 1 from public.items i
      where i.id = item_variants.item_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_variants.item_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  );

-- Add-on groups: same pattern as variants, joined through items.
--
-- These two tables had no old per-command policies, so the `for all` policy
-- below is the only write policy -- which is why the trial gate must be in
-- it rather than somewhere else.
drop policy if exists addon_groups_staff on public.item_addon_groups;
drop policy if exists addon_groups_member_read on public.item_addon_groups;
drop policy if exists addon_groups_manage on public.item_addon_groups;
create policy addon_groups_member_read on public.item_addon_groups
  for select using (
    exists (
      select 1 from public.items i
      where i.id = item_addon_groups.item_id
        and i.restaurant_id in (select public.current_restaurant_ids())
    )
  );
create policy addon_groups_manage on public.item_addon_groups
  for all
  using (
    exists (
      select 1 from public.items i
      where i.id = item_addon_groups.item_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_addon_groups.item_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  );

-- Add-ons: same pattern as add-on groups, joined through groups and items.
--
-- See the add-on groups section above for why the trial gate is in the policy.
drop policy if exists addons_staff on public.item_addons;
drop policy if exists addons_member_read on public.item_addons;
drop policy if exists addons_manage on public.item_addons;
create policy addons_member_read on public.item_addons
  for select using (
    exists (
      select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
      where g.id = item_addons.group_id
        and i.restaurant_id in (select public.current_restaurant_ids())
    )
  );
create policy addons_manage on public.item_addons
  for all
  using (
    exists (
      select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
      where g.id = item_addons.group_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  )
  with check (
    exists (
      select 1
      from public.item_addon_groups g
      join public.items i on i.id = g.item_id
      where g.id = item_addons.group_id
        and public.has_restaurant_role(i.restaurant_id, array['owner', 'manager'])
        and public.restaurant_can_write(i.restaurant_id)
    )
  );

-- Tables and printed codes: every member may read (the board names tables),
-- owner and manager may write. Code rotation itself stays in
-- rotate_table_qr_code(), which checks the write gate.
--
-- See the menus section above for why both spellings are dropped.
drop policy if exists tables_staff on public.dining_tables;
drop policy if exists tables_staff_read on public.dining_tables;
drop policy if exists tables_staff_insert on public.dining_tables;
drop policy if exists tables_staff_update on public.dining_tables;
drop policy if exists tables_staff_delete on public.dining_tables;
drop policy if exists tables_member_read on public.dining_tables;
drop policy if exists tables_manage on public.dining_tables;
create policy tables_member_read on public.dining_tables
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy tables_manage on public.dining_tables
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- QR tokens: every member may read, owner and manager may write.
--
-- See the menus section above for why both spellings are dropped.
drop policy if exists qr_tokens_staff on public.qr_tokens;
drop policy if exists qr_tokens_staff_read on public.qr_tokens;
drop policy if exists qr_tokens_staff_insert on public.qr_tokens;
drop policy if exists qr_tokens_staff_update on public.qr_tokens;
drop policy if exists qr_tokens_staff_delete on public.qr_tokens;
drop policy if exists qr_tokens_member_read on public.qr_tokens;
drop policy if exists qr_tokens_manage on public.qr_tokens;
create policy qr_tokens_member_read on public.qr_tokens
  for select using (restaurant_id in (select public.current_restaurant_ids()));
create policy qr_tokens_manage on public.qr_tokens
  for all
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id))
  with check (public.has_restaurant_role(restaurant_id, array['owner', 'manager'])
    AND public.restaurant_can_write(restaurant_id));

-- Payments are the bill. The kitchen needs the food, not the money.
--
-- The remote project has a legacy payments_staff_read policy in addition to
-- payments_money_read; both are dropped so only the role-scoped read remains.
drop policy if exists payments_staff on public.payments;
drop policy if exists payments_staff_read on public.payments;
drop policy if exists payments_money_read on public.payments;
create policy payments_money_read on public.payments
  for select
  using (public.has_restaurant_role(restaurant_id, array['owner', 'manager', 'cashier']));

-- And no write policy at all: money is recorded by record_counter_payment()
   -- (which checks the role itself and writes under SECURITY DEFINER) or by the
   -- online payment path. Revoking the table privileges makes a direct insert
   -- impossible rather than merely un-policied.
revoke insert, update, delete on public.payments from anon;
revoke insert, update, delete on public.payments from authenticated;

-- SELECT is granted explicitly, in keeping with this repository's rule that a
   -- policy is not a permission (see 20261021000500). Without it the counter and
   -- the bill read nothing at all -- the row-level policy above would never even
   -- be consulted, because the statement fails on the privilege first. This is
   -- also why the local harness matters: on Supabase the default privileges
   -- happen to include SELECT, so a missing grant there is invisible until it is
   -- run somewhere that does not have them.
grant select on public.payments to authenticated;
