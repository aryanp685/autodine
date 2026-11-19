#!/usr/bin/env node
/**
 * Tests for the demo-seed guard and the `npm run staging:seed-demo` command.
 *
 * The guard exists because the demo seed writes a fictional restaurant into
 * a Supabase project: harmless on a demo project, damaging on Production,
 * where it would put sample data beside real customers' restaurants, orders
 * and money. So the seed is produced only for an approved project, and only
 * with a per-run authorisation that names it.
 *
 * These tests drive the ACTUAL npm script, so the command a person types is
 * the command under test. They also assert that the command opens no
 * database connection: it prints SQL, and applying it is the owner's action.
 *
 * Exit 0 = every check passed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APPROVED = 'juwyhslzchjevqkdvwjm';
const PRODUCTION = 'bdbaqpevwmgdvghszjno';
const PHRASE = `seed-demo:${APPROVED}`;
const ROOT = process.cwd();

/** Run the real npm script with exactly the given environment additions. */
function seedDemo(env = {}) {
  const result = spawnSync('npm', ['run', '--silent', 'staging:seed-demo'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    all: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const approved = (env = {}) => seedDemo({ AUTODINE_DEMO_SEED_TARGET_REF: APPROVED, AUTODINE_DEMO_SEED_AUTHORIZATION: PHRASE, ...env });

test('the npm script is registered', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['staging:seed-demo'], 'npm run staging:seed-demo must exist');
  assert.match(pkg.scripts['staging:seed-demo'], /seed-demo\.ts/);
});

test('refuses without a target project', () => {
  const result = seedDemo();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing-target-ref/);
  assert.ok(!result.stdout.includes('insert into'), 'no SQL may be produced');
});

test('refuses Production, whatever the authorisation says', () => {
  const result = seedDemo({
    AUTODINE_DEMO_SEED_TARGET_REF: PRODUCTION,
    AUTODINE_DEMO_SEED_AUTHORIZATION: `seed-demo:${PRODUCTION}`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production-project-ref/);
  assert.ok(!result.stdout.includes('insert into'), 'no SQL may be produced');
});

test('refuses a project that is not approved for demo data', () => {
  const result = seedDemo({
    AUTODINE_DEMO_SEED_TARGET_REF: 'aaaaaaaaaaaaaaaaaaaa',
    AUTODINE_DEMO_SEED_AUTHORIZATION: 'seed-demo:aaaaaaaaaaaaaaaaaaaa',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unapproved-project-ref/);
  assert.ok(!result.stdout.includes('insert into'));
});

test('refuses without an authorisation, and with one issued for another project', () => {
  const missing = seedDemo({ AUTODINE_DEMO_SEED_TARGET_REF: APPROVED });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing-authorization/);

  const wrong = seedDemo({
    AUTODINE_DEMO_SEED_TARGET_REF: APPROVED,
    AUTODINE_DEMO_SEED_AUTHORIZATION: `seed-demo:${PRODUCTION}`,
  });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /wrong-authorization/);
});

test('refuses a target URL that names another project or Production', () => {
  const other = approved({ AUTODINE_DEMO_SEED_TARGET_URL: `https://aaaaaaaaaaaaaaaaaaaa.supabase.co` });
  assert.equal(other.status, 1);
  assert.match(other.stderr, /target-url-ref-mismatch/);

  const production = approved({
    AUTODINE_DEMO_SEED_TARGET_URL: `postgresql://postgres.${PRODUCTION}:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
  });
  assert.equal(production.status, 1);
  assert.match(production.stderr, /production-target-url/);
  assert.ok(!production.all.includes('password'), 'a refused connection string is never echoed');
});

test('produces the seed for the approved project', () => {
  const result = approved();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /insert into public\.restaurants/);
  assert.match(result.stdout, /insert into public\.dining_tables/);
  assert.match(result.stdout, /NOTHING HAS BEEN WRITTEN/);
  assert.match(result.stdout, new RegExp(APPROVED));
});

test('never prints a credential', () => {
  const secret = 'hunter2-not-a-real-password';
  const refused = approved({
    AUTODINE_DEMO_SEED_TARGET_URL: `postgresql://postgres:${secret}@db.example.com:5432/postgres`,
  });
  assert.equal(refused.status, 1);
  assert.ok(!refused.all.includes(secret), 'the password must never appear in the output');
});

test('refuses SQL that is not confined to the demo fixture', () => {
  // A slug shaped like a row id puts a foreign id into the generated SQL.
  // The command must notice and refuse, rather than print it.
  const result = approved({ AUTODINE_DEMO_SEED_SLUG: '11111111-2222-4333-8444-555555555555' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Demo seed SQL refused/);
  assert.match(result.stderr, /foreign-row-id/);
  assert.ok(!result.stdout.includes('insert into'), 'no SQL may be produced');
});

test('opens no database connection: it prints SQL, it does not apply it', () => {
  const source = readFileSync(join(ROOT, 'scripts/staging/seed-demo.ts'), 'utf8');
  assert.ok(!/from\s+['"]pg['"]/.test(source), 'the command must not import a database client');
  assert.ok(!/\.connect\s*\(/.test(source), 'the command must not connect to anything');
  assert.ok(!/createClient/.test(source), 'the command must not create a client');
  assert.match(source, /checkDemoSeedSqlScope\(/, 'the command must check the SQL it produced');
});
