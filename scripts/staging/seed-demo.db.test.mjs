#!/usr/bin/env node
/**
 * The demo seed, applied to a real PostgreSQL: does it stay inside its own
 * restaurant?
 *
 * This is the proof that the guard's claims are true of the SQL it lets
 * through. It runs against a DISPOSABLE embedded PostgreSQL carrying the
 * repository's own schema (the Supabase shim plus the full migration chain),
 * so the tables, constraints and foreign keys are the real ones.
 *
 * The experiment:
 *
 *   1. Put a second restaurant in the database — a stand-in for a real
 *      customer, with its own id, slug, name and phone.
 *   2. Apply the SQL that `npm run staging:seed-demo` produces.
 *   3. Check that the demo restaurant was created, that the other restaurant
 *      is byte-for-byte unchanged, and that every table and every QR token
 *      the seed created belongs to the demo restaurant and to nobody else.
 *   4. Apply it a second time: the seed claims to be idempotent, so the
 *      counts must not move.
 *
 * Nothing here touches a hosted project. The cluster listens on loopback
 * with a random password and is destroyed when the command exits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const ROOT = process.cwd();
const APPROVED = 'juwyhslzchjevqkdvwjm';
const PHRASE = `seed-demo:${APPROVED}`;
const DEMO_RESTAURANT_ID = '00000000-0000-4000-8000-000000000001';
/** A stand-in for a real customer's restaurant. */
const OTHER = {
  id: '11111111-2222-4333-8444-555555555555',
  slug: 'real-customer-restaurant',
  name: 'A Real Customer Restaurant',
  tagline: 'Their tagline',
  phone: '+91 999 000 0000',
  gstin: '29AAAAA0000A1Z5',
};

const adminUrl = process.env.READINESS_PG_ADMIN_URL;
if (!adminUrl) {
  throw new Error(
    'READINESS_PG_ADMIN_URL is missing. Run this through scripts/local-pg/with-embedded-postgres.mjs, ' +
      'which creates a disposable cluster and destroys it afterwards.',
  );
}

/** The SQL the real npm script produces, header comments and all. */
function seedSql() {
  const result = spawnSync('npm', ['run', '--silent', 'staging:seed-demo'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTODINE_DEMO_SEED_TARGET_REF: APPROVED,
      AUTODINE_DEMO_SEED_AUTHORIZATION: PHRASE,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function withSchema(client) {
  await client.query(readFileSync(join(ROOT, 'scripts/local-pg/000_supabase_shim.sql'), 'utf8'));
  const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    await client.query(readFileSync(join(ROOT, 'supabase/migrations', file), 'utf8'));
  }
  return migrations.length;
}

test('the demo seed creates only its own restaurant and touches no other tenant', async () => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const migrations = await withSchema(client);
    assert.ok(migrations > 0, 'the migration chain must have applied');

    // A second restaurant stands in for a real customer.
    await client.query(
      `insert into public.restaurants (id, slug, name, tagline, phone, gstin, timezone, tax_rate_bps)
       values ($1, $2, $3, $4, $5, $6, 'Asia/Kolkata', 500)`,
      [OTHER.id, OTHER.slug, OTHER.name, OTHER.tagline, OTHER.phone, OTHER.gstin],
    );
    const before = (await client.query('select * from public.restaurants where id = $1', [OTHER.id])).rows[0];

    const sql = seedSql();
    await client.query(sql);

    // The demo restaurant exists, with the fixture's own id and slug.
    const demo = (await client.query('select * from public.restaurants where id = $1', [DEMO_RESTAURANT_ID])).rows[0];
    assert.ok(demo, 'the demo restaurant must have been created');
    assert.equal(demo.slug, 'saffron-smoke');

    // The other restaurant is untouched, field for field.
    const after = (await client.query('select * from public.restaurants where id = $1', [OTHER.id])).rows[0];
    for (const field of ['slug', 'name', 'tagline', 'phone', 'gstin', 'timezone', 'tax_rate_bps', 'is_active']) {
      assert.deepEqual(after[field], before[field], `the other restaurant's ${field} must not change`);
    }
    assert.equal(after.created_at.getTime(), before.created_at.getTime());

    // Nothing the seed created belongs to anybody else.
    const tables = (await client.query('select restaurant_id, count(*)::int as n from public.dining_tables group by 1')).rows;
    assert.deepEqual(
      tables.map((row) => row.restaurant_id),
      [DEMO_RESTAURANT_ID],
      'every dining table must belong to the demo restaurant',
    );
    const tokens = (await client.query('select restaurant_id, count(*)::int as n from public.qr_tokens group by 1')).rows;
    assert.deepEqual(
      tokens.map((row) => row.restaurant_id),
      [DEMO_RESTAURANT_ID],
      'every QR token must belong to the demo restaurant',
    );
    assert.equal(
      (await client.query('select count(*)::int as n from public.dining_tables where restaurant_id = $1', [OTHER.id])).rows[0].n,
      0,
      'the other restaurant must have no dining tables',
    );
    assert.equal(
      (await client.query('select count(*)::int as n from public.qr_tokens where restaurant_id = $1', [OTHER.id])).rows[0].n,
      0,
      'the other restaurant must have no QR tokens',
    );

    // The menu is the demo restaurant's own.
    const menuRows = (await client.query('select count(*)::int as n from public.menus where restaurant_id = $1', [DEMO_RESTAURANT_ID])).rows[0].n;
    assert.equal(menuRows, 1);
    const otherMenus = (await client.query('select count(*)::int as n from public.menus where restaurant_id = $1', [OTHER.id])).rows[0].n;
    assert.equal(otherMenus, 0);

    // Idempotent: a second run must not duplicate anything.
    const countBefore = (await client.query('select count(*)::int as n from public.dining_tables')).rows[0].n;
    await client.query(sql);
    const countAfter = (await client.query('select count(*)::int as n from public.dining_tables')).rows[0].n;
    assert.equal(countAfter, countBefore, 'the seed must be idempotent');

    // And the other restaurant is still untouched after the second run.
    const final = (await client.query('select * from public.restaurants where id = $1', [OTHER.id])).rows[0];
    assert.deepEqual(final, after);
  } finally {
    await client.end();
  }
});
