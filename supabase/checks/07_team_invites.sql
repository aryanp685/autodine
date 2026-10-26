-- ============================================================================
-- Team invitations: behaviour, not shape
--
-- WHAT THIS IS
--   A runnable proof that migration 20261029000100 does what its comments say:
--   invitations are single-use, scoped to one restaurant, expiring, hash-only,
--   and governed by roles that are enforced in the database rather than by the
--   screen that drew them.
--
-- WHERE IT CAN RUN
--   A LOCAL or BRANCH database built from this repository's migrations, as a
--   superuser. It creates four fake accounts in auth.uid()'s shape, exercises
--   the functions as those callers, and ROLLS EVERYTHING BACK at the end, so it
--   can be run repeatedly against the same database.
--
--   It cannot run against production, and it must not be pointed at one: the
--   fixtures insert restaurants and profiles directly, which is exactly what a
--   real deployment must never let a script do.
--
-- WHAT IT DOES NOT PROVE
--   * Concurrency. Two sessions racing the same link are serialised by
--     `for update` inside redeem_staff_invite(); a single session can only show
--     the sequential case (the second call answers 'used').
--   * That Supabase's PostgREST exposes the functions as the app calls them.
--     That is a deployment question, not a SQL one.
--
-- RUN
--   psql -d <db> -f supabase/checks/07_team_invites.sql
--   Every line of output should start with PASS.
-- ============================================================================

begin;

/* ---------------------------------------------------------------------------
   ONE HARNESS DIFFERENCE, MADE EXPLICIT
   
   Supabase grants the `authenticated` role table privileges by default; a
   plain Postgres built from these migrations does not, and this repository
   grants per table rather than relying on those defaults. Without the line
   below, an UPDATE as a kitchen login fails on the PRIVILEGE and never reaches
   the row-level policy, so the check would prove the wrong thing. payments is
   deliberately NOT granted INSERT here: the migration revokes it, and that
   refusal is one of the things being checked.
   --------------------------------------------------------------------------- */
grant select, insert, update, delete on public.items to authenticated;

do $$
declare
  -- Fixtures. Fixed ids so a failure can be read against a known row.
  v_owner_a   uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_manager_a uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_cook      uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  v_owner_b   uuid := 'aaaaaaaa-0000-4000-8000-000000000004';
  v_second    uuid := 'aaaaaaaa-0000-4000-8000-000000000005';
  v_cashier   uuid := 'aaaaaaaa-0000-4000-8000-000000000006';

  v_rest_a uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  v_rest_b uuid := 'bbbbbbbb-0000-4000-8000-000000000002';

  v_code     text;
  v_hash     text;
  v_status   text;
  v_name     text;
  v_role     public.member_role;
  v_invite   uuid;
  v_member   uuid;
  v_count    integer;
  v_changed  integer;
  v_msg      text;
  v_email    text;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into public.profiles (id, full_name) values
    (v_owner_a,   'Asha Rao'),
    (v_manager_a, 'Manoj Patil'),
    (v_cook,      'Cook'),
    (v_owner_b,   'Bela Shah'),
    (v_second,    'Second Cook'),
    (v_cashier,   'Counter');

  insert into public.restaurants (id, slug, name, timezone) values
    (v_rest_a, 'check-team-a', 'Maddi A', 'Asia/Kolkata'),
    (v_rest_b, 'check-team-b', 'Maddi B', 'Asia/Kolkata');

  insert into public.memberships (restaurant_id, user_id, role) values
    (v_rest_a, v_owner_a,   'owner'),
    (v_rest_a, v_manager_a, 'manager'),
    (v_rest_b, v_owner_b,   'owner');

  insert into public.items (restaurant_id, name, price_paise) values (v_rest_a, 'Butter Naan', 4500);
  insert into public.orders (restaurant_id, code, prep_status, payment_status)
    values (v_rest_a, 'CHK-1', 'new', 'pending');
  insert into public.payments (order_id, restaurant_id, method, amount_paise, status)
    select o.id, v_rest_a, 'cash', 100, 'recorded' from public.orders o where o.code = 'CHK-1';

  -- ==========================================================================
  -- 1. Minting: a code comes back once, and only its hash is stored
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';

  v_code := public.create_staff_invite(v_rest_a, 'kitchen', 7);

  execute 'reset role';

  if v_code is null or length(replace(v_code, '-', '')) <> 16 then
    raise exception 'FAIL 1: expected a 16-character code, got %', coalesce(v_code, 'null');
  end if;

  select count(*), min(code_hash) into v_count, v_hash
  from public.restaurant_invites
  where restaurant_id = v_rest_a;

  if v_count <> 1 then
    raise exception 'FAIL 1: expected one invitation row, found %', v_count;
  end if;

  if v_hash = v_code or v_hash like '%' || v_code || '%' then
    raise exception 'FAIL 1: the plaintext code is stored';
  end if;

  if length(v_hash) <> 64 or v_hash <> public.hash_invite_code(v_code) then
    raise exception 'FAIL 1: stored value is not sha256(code)';
  end if;

  raise notice 'PASS 1: a code is returned once and only its sha256 is stored';

  select id into v_invite from public.restaurant_invites
  where restaurant_id = v_rest_a and role = 'kitchen';

  -- ==========================================================================
  -- 2. A signed-in outsider sees what the link is, without consuming it
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_cook::text, true);
  execute 'set local role authenticated';

  select status, restaurant_name, role into v_status, v_name, v_role
  from public.preview_staff_invite(v_code);
  select status into v_status from public.preview_staff_invite('ZZZZ-ZZZZ-ZZZZ-ZZZZ') limit 1;

  execute 'reset role';

  if v_name is distinct from 'Maddi A' or v_role is distinct from 'kitchen' then
    raise exception 'FAIL 2: preview returned % / %', v_name, v_role;
  end if;

  if v_status <> 'not_found' then
    raise exception 'FAIL 2: an unknown code answered %', v_status;
  end if;

  select count(*) into v_count from public.memberships where user_id = v_cook;
  if v_count <> 0 then
    raise exception 'FAIL 2: previewing created a membership';
  end if;

  raise notice 'PASS 2: preview names the restaurant and role, consumes nothing, and an unknown code is not_found';

  -- ==========================================================================
  -- 3. Redemption: single use, and the role comes from the invitation
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_cook::text, true);
  execute 'set local role authenticated';

  select status, role into v_status, v_role from public.redeem_staff_invite(v_code);
  select status into v_status from public.redeem_staff_invite(v_code) limit 1;

  execute 'reset role';

  if v_role is distinct from 'kitchen' then
    raise exception 'FAIL 3: redeemed as % instead of kitchen', v_role;
  end if;

  if v_status <> 'used' then
    raise exception 'FAIL 3: second redemption answered %', v_status;
  end if;

  select count(*) into v_count
  from public.memberships
  where user_id = v_cook and restaurant_id = v_rest_a and role = 'kitchen';

  if v_count <> 1 then
    raise exception 'FAIL 3: expected exactly one membership, found %', v_count;
  end if;

  raise notice 'PASS 3: one link makes one membership, and a second attempt answers used';

  -- ==========================================================================
  -- 4. A revoked link never works
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_code := public.create_staff_invite(v_rest_a, 'cashier', 7);
  select id into v_invite from public.restaurant_invites
  where restaurant_id = v_rest_a and role = 'cashier' and redeemed_at is null;
  select public.revoke_staff_invite(v_invite) into v_status;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_second::text, true);
  execute 'set local role authenticated';
  select status into v_status from public.redeem_staff_invite(v_code) limit 1;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  select public.revoke_staff_invite(v_invite) into v_status;
  execute 'reset role';

  if v_status <> 'revoked' then
    raise exception 'FAIL 4: revoking twice answered %', v_status;
  end if;

  select count(*) into v_count from public.memberships where user_id = v_second;
  if v_count <> 0 then
    raise exception 'FAIL 4: a revoked link created a membership';
  end if;

  raise notice 'PASS 4: a revoked link cannot be redeemed, and revoking twice is idempotent';

  -- ==========================================================================
  -- 5. An expired link never works
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  v_code := public.create_staff_invite(v_rest_a, 'kitchen', 1);
  execute 'reset role';

  /* Age it, as the clock would: both timestamps move, because the table
     refuses an invitation that expires before it was created -- which is the
     point of restaurant_invites_expires_after_creation. */
  update public.restaurant_invites
     set created_at = now() - interval '2 days',
         expires_at = now() - interval '1 day'
   where restaurant_id = v_rest_a and redeemed_at is null and revoked_at is null;

  perform set_config('request.jwt.claim.sub', v_second::text, true);
  execute 'set local role authenticated';
  select status into v_status from public.redeem_staff_invite(v_code) limit 1;
  execute 'reset role';

  if v_status <> 'expired' then
    raise exception 'FAIL 5: expired link answered %', v_status;
  end if;
  raise notice 'PASS 5: an expired link answers expired and grants nothing';

  -- ==========================================================================
  -- 6. Cross-restaurant: the invite decides the restaurant, not the caller
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  execute 'set local role authenticated';
  v_code := public.create_staff_invite(v_rest_b, 'cashier', 7);
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_second::text, true);
  execute 'set local role authenticated';
  select status into v_status from public.redeem_staff_invite(v_code) limit 1;
  execute 'reset role';

  select count(*) into v_count
  from public.memberships
  where user_id = v_second and restaurant_id = v_rest_b and role = 'cashier';

  if v_status <> 'ok' or v_count <> 1 then
    raise exception 'FAIL 6: cross-restaurant redeem answered % with % memberships', v_status, v_count;
  end if;

  select count(*) into v_count
  from public.memberships
  where user_id = v_second and restaurant_id = v_rest_a;

  if v_count <> 0 then
    raise exception 'FAIL 6: an invite for B granted access to A';
  end if;

  raise notice 'PASS 6: an invitation grants its own restaurant only';

  -- ==========================================================================
  -- 7. Already a member: said plainly, and the code is NOT burnt
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_manager_a::text, true);
  execute 'set local role authenticated';
  v_code := public.create_staff_invite(v_rest_a, 'kitchen', 7);
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_cook::text, true);
  execute 'set local role authenticated';
  select status into v_status from public.redeem_staff_invite(v_code) limit 1;
  execute 'reset role';

  select count(*) into v_count
  from public.restaurant_invites
  where code_hash = public.hash_invite_code(v_code) and redeemed_at is null;

  if v_status <> 'already_member' or v_count <> 1 then
    raise exception 'FAIL 7: answered % and left % unredeemed rows', v_status, v_count;
  end if;

  raise notice 'PASS 7: an existing member is told so, and the link stays available for a colleague';

  -- ==========================================================================
  -- 8. Who may invite whom
  -- ==========================================================================
  -- A kitchen login may not invite anybody.
  perform set_config('request.jwt.claim.sub', v_cook::text, true);
  execute 'set local role authenticated';
  begin
    v_code := public.create_staff_invite(v_rest_a, 'cashier', 7);
    raise exception 'FAIL 8: a kitchen login created an invitation';
  exception when sqlstate '42501' then
    raise notice 'PASS 8a: a kitchen login cannot invite';
  end;

  -- A manager may hire a cashier...
  perform set_config('request.jwt.claim.sub', v_manager_a::text, true);
  execute 'set local role authenticated';
  v_code := public.create_staff_invite(v_rest_a, 'cashier', 7);
  raise notice 'PASS 8b: a manager can invite a cashier';

  -- ...but not another manager.
  begin
    v_code := public.create_staff_invite(v_rest_a, 'manager', 7);
    raise exception 'FAIL 8: a manager invited a manager';
  exception when sqlstate '42501' then
    raise notice 'PASS 8c: a manager cannot invite a manager';
  end;

  execute 'reset role';

  -- Nobody may invite an owner.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  begin
    v_code := public.create_staff_invite(v_rest_a, 'owner', 7);
    raise exception 'FAIL 8: an owner invitation was minted';
  exception when sqlstate '42501' then
    raise notice 'PASS 8d: ownership cannot be granted by link';
  end;
  execute 'reset role';

  -- And nobody may revoke somebody else's invitation.
  select id into v_invite from public.restaurant_invites
  where restaurant_id = v_rest_a and role = 'cashier' and redeemed_at is null and revoked_at is null
  limit 1;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  execute 'set local role authenticated';
  begin
    perform public.revoke_staff_invite(v_invite);
    raise exception 'FAIL 8: another restaurant revoked an invitation';
  exception when sqlstate '42501' then
    raise notice 'PASS 8e: an invitation cannot be revoked from another restaurant';
  end;
  execute 'reset role';

  -- ==========================================================================
  -- 9. The last owner cannot be removed
  -- ==========================================================================
  select id into v_member from public.memberships where user_id = v_owner_a and restaurant_id = v_rest_a;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  begin
    perform public.remove_staff_member(v_member);
    raise exception 'FAIL 9: the last owner was removed';
  exception when sqlstate '42501' then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%last owner%' then
      raise exception 'FAIL 9: refused with the wrong reason: %', v_msg;
    end if;
    raise notice 'PASS 9a: the last owner cannot be removed';
  end;
  execute 'reset role';

  /* A second owner makes removal legitimate again. v_second is a member of B
     only at this point, so this is a fresh membership rather than a
     conflicting second row for an existing member. */
  insert into public.memberships (restaurant_id, user_id, role) values (v_rest_a, v_second, 'owner');
  select id into v_member
  from public.memberships
  where user_id = v_second and restaurant_id = v_rest_a and role = 'owner';

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  select public.remove_staff_member(v_member) into v_status;
  execute 'reset role';

  if v_status <> 'removed' then
    raise exception 'FAIL 9: removing a second owner answered %', v_status;
  end if;
  raise notice 'PASS 9b: with two owners, one may be removed';

  -- ==========================================================================
  -- 10. The team list is a definer read, not a wider profiles policy
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  select count(*), min(email) into v_count, v_email
  from public.list_staff_members(v_rest_a);
  execute 'reset role';

  if v_count < 2 then
    raise exception 'FAIL 10: the team list returned % rows', v_count;
  end if;

  if v_email is not null then
    raise exception 'FAIL 10: an email came from a database that has no auth.users';
  end if;

  perform set_config('request.jwt.claim.sub', v_cook::text, true);
  execute 'set local role authenticated';
  begin
    perform 1 from public.list_staff_members(v_rest_a);
    raise exception 'FAIL 10: a kitchen login read the team list';
  exception when sqlstate '42501' then
    raise notice 'PASS 10a: the team list is owner/manager only';
  end;
  execute 'reset role';

  raise notice 'PASS 10b: the team list resolves without auth.users and drops the email to null there';

  -- ==========================================================================
  -- 11. Grants: the hash and the writes are not reachable from a browser role
  -- ==========================================================================
  select count(*) into v_count
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'restaurant_invites'
    and grantee = 'authenticated'
    and column_name = 'code_hash';

  if v_count <> 0 then
    raise exception 'FAIL 11: code_hash is granted to authenticated';
  end if;

  select count(*) into v_count
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'restaurant_invites'
    and grantee = 'authenticated'
    and column_name = 'id'
    and privilege_type = 'SELECT';

  if v_count <> 1 then
    raise exception 'FAIL 11: the readable columns are not granted';
  end if;

  if has_function_privilege('anon', 'public.redeem_staff_invite(text)', 'execute') then
    raise exception 'FAIL 11: anon may execute redeem_staff_invite';
  end if;

  if not has_function_privilege('authenticated', 'public.redeem_staff_invite(text)', 'execute') then
    raise exception 'FAIL 11: authenticated may not execute redeem_staff_invite';
  end if;

  if not has_function_privilege('authenticated', 'public.create_staff_invite(uuid, public.member_role, integer)', 'execute') then
    raise exception 'FAIL 11: authenticated may not execute create_staff_invite';
  end if;

  raise notice 'PASS 11: the hash is unreadable and the functions are signed-in only';

  -- ==========================================================================
  -- 12. RLS: a kitchen login reads no money and writes no menu
  -- ==========================================================================
  perform set_config('request.jwt.claim.sub', v_cook::text, true);
  execute 'set local role authenticated';

  select count(*) into v_count from public.payments where restaurant_id = v_rest_a;
  if v_count <> 0 then
    raise exception 'FAIL 12: a kitchen login read % payment rows', v_count;
  end if;

  select count(*) into v_count from public.restaurant_invites where restaurant_id = v_rest_a;
  if v_count <> 0 then
    raise exception 'FAIL 12: a kitchen login read % invitation rows', v_count;
  end if;

  update public.items set name = 'Changed by the kitchen' where restaurant_id = v_rest_a;
  get diagnostics v_changed = row_count;
  if v_changed <> 0 then
    raise exception 'FAIL 12: a kitchen login changed % menu items', v_changed;
  end if;

  execute 'reset role';

  -- A cashier sees the money it collects, and still cannot write the menu.
  insert into public.memberships (restaurant_id, user_id, role) values (v_rest_a, v_cashier, 'cashier');

  perform set_config('request.jwt.claim.sub', v_cashier::text, true);
  execute 'set local role authenticated';

  select count(*) into v_count from public.payments where restaurant_id = v_rest_a;
  if v_count = 0 then
    raise exception 'FAIL 12: a cashier cannot read the payments they collect';
  end if;

  begin
    insert into public.payments (order_id, restaurant_id, method, amount_paise, status)
    select o.id, v_rest_a, 'cash', 999, 'recorded' from public.orders o where o.code = 'CHK-1';
    raise exception 'FAIL 12: a cashier inserted a payment row directly';
  exception when insufficient_privilege then
    raise notice 'PASS 12: kitchen reads no money and cannot write the menu; a cashier reads payments but cannot insert one';
  end;

  -- The owner still can.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  execute 'set local role authenticated';
  update public.items set name = 'Butter Naan (owner)' where restaurant_id = v_rest_a;
  get diagnostics v_changed = row_count;
  execute 'reset role';

  if v_changed <> 1 then
    raise exception 'FAIL 12: the owner could not change the menu (% rows)', v_changed;
  end if;

  raise notice 'PASS 12b: the owner can still change the menu';

  raise notice 'ALL TEAM-INVITATION CHECKS PASSED (rolled back)';
end $$;

rollback;
