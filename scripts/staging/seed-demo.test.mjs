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

/**
 * A project the owner has designated for demo data, supplied the way the
 * CLI requires it: from outside the repository, per run.
 */
const DESIGNATED = 'aaaaaaaaaaaaaaaaaaaa';
/**
 * The historical candidate project. It was never owner-designated, so it
 * must not be seedable unless the owner designates it for this run.
 */
const HISTORICAL_CANDIDATE = 'juwyhslzchjevqkdvwjm';
const PRODUCTION = 'bdbaqpevwmgdvghszjno';
const PHRASE = `seed-demo:${DESIGNATED}`;
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

const approved = (env = {}) =>
  seedDemo({
    AUTODINE_DEMO_SEED_APPROVED_REFS: DESIGNATED,
    AUTODINE_DEMO_SEED_TARGET_REF: DESIGNATED,
    AUTODINE_DEMO_SEED_AUTHORIZATION: PHRASE,
    ...env,
  });

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
    AUTODINE_DEMO_SEED_APPROVED_REFS: PRODUCTION,
    AUTODINE_DEMO_SEED_TARGET_REF: PRODUCTION,
    AUTODINE_DEMO_SEED_AUTHORIZATION: `seed-demo:${PRODUCTION}`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production-project-ref/);
  assert.ok(!result.stdout.includes('insert into'), 'no SQL may be produced');
});

test('refuses a project that is not designated for demo data', () => {
  const result = seedDemo({
    AUTODINE_DEMO_SEED_APPROVED_REFS: DESIGNATED,
    AUTODINE_DEMO_SEED_TARGET_REF: 'bbbbbbbbbbbbbbbbbbbb',
    AUTODINE_DEMO_SEED_AUTHORIZATION: 'seed-demo:bbbbbbbbbbbbbbbbbbbb',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /undesignated-project-ref/);
  assert.ok(!result.stdout.includes('insert into'));
});

test('refuses when no designated list is supplied at all', () => {
  const result = seedDemo({
    AUTODINE_DEMO_SEED_TARGET_REF: DESIGNATED,
    AUTODINE_DEMO_SEED_AUTHORIZATION: PHRASE,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no-designated-projects/);
  assert.ok(!result.stdout.includes('insert into'));
});

test('the historical candidate project cannot be seeded by default', () => {
  // The regression this guards: the candidate ref was hard-coded as "the
  // approved project" and is not owner-designated. Naming it and presenting
  // the matching phrase must still be refused.
  const result = seedDemo({
    AUTODINE_DEMO_SEED_TARGET_REF: HISTORICAL_CANDIDATE,
    AUTODINE_DEMO_SEED_AUTHORIZATION: `seed-demo:${HISTORICAL_CANDIDATE}`,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no-designated-projects/);
  assert.ok(!result.stdout.includes('insert into'), 'no SQL may be produced');

  // And with a designated list that does not name it.
  const listed = seedDemo({
    AUTODINE_DEMO_SEED_APPROVED_REFS: DESIGNATED,
    AUTODINE_DEMO_SEED_TARGET_REF: HISTORICAL_CANDIDATE,
    AUTODINE_DEMO_SEED_AUTHORIZATION: `seed-demo:${HISTORICAL_CANDIDATE}`,
  });
  assert.equal(listed.status, 1);
  assert.match(listed.stderr, /undesignated-project-ref/);
  assert.ok(!listed.stdout.includes('insert into'));
});

test('the repository hard-codes no demo project ref', () => {
  const source = readFileSync(join(ROOT, 'lib/staging/demo-seed-isolation.ts'), 'utf8');
  assert.ok(
    !/['\"][a-z0-9]{20}['\"]/.test(source),
    'the guard must not carry a project ref in code',
  );
});

test('refuses without an authorisation, and with one issued for another project', () => {
  const missing = seedDemo({ AUTODINE_DEMO_SEED_APPROVED_REFS: DESIGNATED, AUTODINE_DEMO_SEED_TARGET_REF: DESIGNATED });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing-authorization/);

  const wrong = seedDemo({
    AUTODINE_DEMO_SEED_APPROVED_REFS: DESIGNATED,
    AUTODINE_DEMO_SEED_TARGET_REF: DESIGNATED,
    AUTODINE_DEMO_SEED_AUTHORIZATION: `seed-demo:${PRODUCTION}`,
  });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /wrong-authorization/);
});

test('refuses a target URL that names another project or Production', () => {
  const other = approved({ AUTODINE_DEMO_SEED_TARGET_URL: `https://bbbbbbbbbbbbbbbbbbbb.supabase.co` });
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
  assert.match(result.stdout, new RegExp(DESIGNATED));
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
