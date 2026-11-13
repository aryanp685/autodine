import { randomUUID } from 'node:crypto';

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Phase 6D pre-migration proof failed: ${message}`);
}

/**
 * Prove the exact pre-guard authorization behavior inside the fresh local
 * replay. All synthetic rows and attempted changes are rolled back.
 */
export async function proveAccountLinkWasClientMutable(client) {
  const privileges = (await client.query(`
    select has_table_privilege('authenticated', 'public.restaurants', 'UPDATE') as table_update,
           has_column_privilege('authenticated', 'public.restaurants', 'account_id', 'UPDATE') as account_update
  `)).rows[0];
  requireCondition(privileges.table_update && privileges.account_update,
    'authenticated no longer has the table/column UPDATE privilege expected from the historical migrations');

  const policy = (await client.query(`
    select qual, with_check from pg_policies
     where schemaname='public' and tablename='restaurants' and policyname='restaurants_update'
  `)).rows[0];
  requireCondition(policy && /can_manage_restaurant/i.test(policy.qual ?? '') &&
    /can_manage_restaurant/i.test(policy.with_check ?? ''),
  'the owner/manager row policy was not present in its expected USING/WITH CHECK form');
  requireCondition(!/account_id/i.test(`${policy.qual ?? ''} ${policy.with_check ?? ''}`),
    'the historical row policy unexpectedly contains an account_id restriction');

  const existingGuard = await client.query(`
    select 1 from pg_trigger
     where tgrelid='public.restaurants'::regclass and not tgisinternal
       and tgname='restaurants_account_id_immutable'
  `);
  requireCondition(existingGuard.rowCount === 0, 'the new account-link guard exists before its migration');

  await client.query('begin');
  try {
    const owner = randomUUID();
    const manager = randomUUID();
    const secondOwner = randomUUID();
    const restaurant = (await client.query(
      'select public.create_account_with_restaurant($1,$2,$3,$4) id',
      [`Phase 6D pre-guard ${owner}`, `phase6d-pre-${owner}`, 'Asia/Kolkata', owner],
    )).rows[0].id;
    const otherRestaurant = (await client.query(
      'select public.create_account_with_restaurant($1,$2,$3,$4) id',
      [`Phase 6D target ${secondOwner}`, `phase6d-target-${secondOwner}`, 'Asia/Kolkata', secondOwner],
    )).rows[0].id;
    const account = (await client.query('select account_id from public.restaurants where id=$1', [restaurant])).rows[0].account_id;
    const otherAccount = (await client.query('select account_id from public.restaurants where id=$1', [otherRestaurant])).rows[0].account_id;

    await client.query('insert into public.profiles(id) values($1)', [manager]);
    await client.query(
      "insert into public.memberships(restaurant_id,user_id,role) values($1,$2,'manager')",
      [restaurant, manager],
    );
    // Make the account entitlement fail while its old legacy restaurant trial
    // fields remain current. Detachment will therefore demonstrate the exact
    // account -> legacy fallback switch, not merely a changed UUID.
    await client.query(
      "update public.accounts set plan_status='expired', trial_ends_at=now()-interval '1 day' where id=$1",
      [account],
    );
    await client.query(
      "update public.restaurants set trial_started_at=now()-interval '1 day' where id=$1",
      [restaurant],
    );
    requireCondition(!(await client.query('select public.restaurant_can_write($1) ok', [restaurant])).rows[0].ok,
      'the linked fixture was not read-only before the attempted change');
    requireCondition((await client.query('select public.restaurant_can_write($1) ok', [otherRestaurant])).rows[0].ok,
      'the reassignment target was not writable before the attempted change');

    // Owner detachment: the existing row policy permits the write, and the
    // nullable legacy fallback changes the same restaurant from read-only to
    // writable. The savepoint rolls back the synthetic mutation.
    await client.query('savepoint phase6d_detach');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await client.query('set local role authenticated');
    const detached = await client.query(
      'update public.restaurants set account_id=null where id=$1 returning account_id', [restaurant],
    );
    requireCondition(detached.rowCount === 1 && detached.rows[0].account_id === null,
      'the pre-guard owner detachment did not pass the historical policy/grant');
    requireCondition((await client.query('select public.restaurant_can_write($1) ok', [restaurant])).rows[0].ok,
      'detaching did not expose the legacy write-gate fallback');
    await client.query('rollback to savepoint phase6d_detach');

    // Manager reassignment: both the account entitlement and account-scoped
    // account-read policy follow the caller-controlled restaurant link.
    await client.query('savepoint phase6d_reassign');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [manager]);
    await client.query('set local role authenticated');
    const reassigned = await client.query(
      'update public.restaurants set account_id=$1 where id=$2 returning account_id',
      [otherAccount, restaurant],
    );
    requireCondition(reassigned.rowCount === 1 && reassigned.rows[0].account_id === otherAccount,
      'the pre-guard manager reassignment did not pass the historical policy/grant');
    requireCondition((await client.query('select public.restaurant_can_write($1) ok', [restaurant])).rows[0].ok,
      'the reassigned restaurant did not inherit the target account entitlement');
    const accountRows = await client.query('select id from public.accounts where id=$1', [otherAccount]);
    requireCondition(accountRows.rowCount === 1,
      'the reassignment did not expose the target account through accounts_read RLS');
    await client.query('rollback to savepoint phase6d_reassign');

    const restored = (await client.query(
      'select account_id, public.restaurant_can_write(id) can_write from public.restaurants where id=$1', [restaurant],
    )).rows[0];
    requireCondition(restored.account_id === account && restored.can_write === false,
      'the pre-migration demonstrations did not roll back to their original synthetic state');
  } finally {
    await client.query('rollback');
  }

  console.log('[Phase 6D] reproduced pre-guard owner detachment / legacy-gate bypass and manager reassignment / account-RLS change; all synthetic mutations rolled back.');
}
