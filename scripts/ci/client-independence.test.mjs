#!/usr/bin/env node
/**
 * The client-independence check must actually reproduce the CI runner's
 * condition — and the stub it uses must keep doing so.
 *
 * WHY THIS EXISTS
 *
 * A suite that silently takes the custom-format backup path when a
 * `pg_dump` happens to be on PATH passes on a machine with no client
 * installed and fails on CI, whose image ships a `pg_dump` 16 that
 * refuses to dump the PG 17 server the suites run against.
 *
 * The check only catches that if the stub really is what the runner
 * has. So these tests pin the stub's behaviour, and prove that the
 * check puts it in front of the suites.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const STUB_DIR = path.join(ROOT, 'scripts', 'ci', 'fixtures', 'older-pg-client');
const STUB = path.join(STUB_DIR, 'pg_dump');

test('the older-client stub exists and is executable', () => {
  assert.ok(readFileSync(STUB, 'utf8').length > 0, 'the stub must not be empty');
  assert.doesNotThrow(() => accessSync(STUB, constants.X_OK), 'the stub must be executable');
});

test('the stub reports an older major version, like the runner image', () => {
  const out = execFileSync(STUB, ['--version'], { encoding: 'utf8' });
  assert.match(out, /pg_dump \(PostgreSQL\) 16\./, 'the stub must report PostgreSQL 16');
});

test('the stub refuses to dump a newer server, like the runner image', () => {
  const run = spawnSync(STUB, ['--dbname', 'postgres://x'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0, 'the stub must fail a dump');
  assert.match(
    `${run.stdout ?? ''}${run.stderr ?? ''}`,
    /aborting because of server version mismatch/,
    'the stub must fail with the runner\'s own message',
  );
});

test('the backup tool really does pick the stub up when it is on PATH', () => {
  // If the stub were not selected, the check would prove nothing: the
  // suites would pass with no client in front of them, exactly as they
  // do on a developer machine.
  const probe = spawnSync(
    process.execPath,
    ['-e', `import { resolvePgClient } from './scripts/backup/lib-pg-client.mjs';
      const found = resolvePgClient('pg_dump');
      process.stdout.write(String(found && found.version));`],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${STUB_DIR}${path.delimiter}${process.env.PATH ?? ''}` },
    },
  );
  assert.equal(probe.status, 0, `the probe failed: ${probe.stderr}`);
  assert.equal(probe.stdout.trim(), '16', 'the stub must be the client the tool resolves');
});

test('the client-independence check is wired to a script that exists', () => {
  // The check itself is NOT run here: it runs `test:dr`, and this file
  // is part of `test:dr`. Running it would re-enter the suite.
  const check = path.join(ROOT, 'scripts', 'verify-client-independence.mjs');
  assert.ok(readFileSync(check, 'utf8').length > 0, 'the check must exist');
  const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  assert.match(
    scripts['test:client-independence'] ?? '',
    /verify-client-independence\.mjs/,
    'the check must be reachable as an npm script, or the gate and the CI step cannot run it',
  );
});
