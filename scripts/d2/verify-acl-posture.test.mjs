/**
 * End-to-end test of the D2 catalog probe against a disposable PG17 cluster:
 * poisoned fixture → exit 1 with the finding named; revoked → exit 0 clean.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { default: EmbeddedPostgres } = await import('embedded-postgres');
const root = mkdtempSync(path.join(tmpdir(), 'autodine-d2-test-'));
const password = `local-${randomUUID().replaceAll('-', '')}`;
const port = 20000 + Math.floor(Math.random() * 20000);
const server = new EmbeddedPostgres({ databaseDir: path.join(root, 'cluster'), port, user: 'postgres', password, persistent: false, onLog: () => {}, onError: () => {} });
const url = () => `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
const SCRIPT = path.resolve('scripts/d2/verify-acl-posture.mjs');

const run = (env = {}) =>
  spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, AUTODINE_D2_VERIFY_URL: url(), ...env },
    encoding: 'utf8',
  });

before(async () => {
  await server.initialise();
  await server.start();
  const client = new pg.Client({ connectionString: url() });
  client.on('error', () => {});
  await client.connect();
  await client.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table public.d2_probe_fixture (id int primary key);
    grant select, insert, update, delete on public.d2_probe_fixture to authenticated;
    grant maintain on public.d2_probe_fixture to authenticated;
    grant truncate on public.d2_probe_fixture to anon;
    alter default privileges in schema public grant maintain on tables to authenticated;
  `);
  await client.end();
});

after(async () => {
  await server.stop();
  rmSync(root, { recursive: true, force: true });
});

test('exits 1 and names the poisoned grants', () => {
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /d2_probe_fixture/);
  assert.match(result.stdout, /authenticated/);
});

test('after the revokes, exits 0 clean and prints a fingerprint', async () => {
  const client = new pg.Client({ connectionString: url() });
  client.on('error', () => {});
  await client.connect();
  await client.query(`
    revoke maintain on public.d2_probe_fixture from authenticated;
    revoke truncate on public.d2_probe_fixture from anon;
    alter default privileges in schema public revoke maintain on tables from authenticated;
  `);
  await client.end();
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /CLEAN/);
  assert.match(result.stdout, /fingerprint [0-9a-f]{64}/);
});
