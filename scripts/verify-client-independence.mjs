#!/usr/bin/env node
/**
 * The backup suites must not depend on which PostgreSQL client the host
 * happens to have.
 *
 * WHY THIS EXISTS
 *
 * A suite that silently takes the custom-format backup path when a
 * `pg_dump` is on PATH passes on a developer machine with no client
 * installed and fails on CI, whose image ships a `pg_dump` 16 that
 * refuses to dump the PG 17 server the suites run against. The failure
 * reads like a broken backup when it is really an environment
 * difference — and it was invisible locally for exactly that reason.
 *
 * So the environment-sensitive suites are re-run here with an OLDER
 * client stubbed in front of PATH, reproducing the runner's condition.
 * A suite that passes both ways is proving something about itself; one
 * that only passes without a client is depending on the machine.
 *
 * This is not the custom-format drill. That one is the CI
 * `native-database` job, against real PostgreSQL 15, 17 and 18.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STUB_DIR = path.join(ROOT, 'scripts', 'ci', 'fixtures', 'older-pg-client');

const SUITES = [
  ['test:dr', ['run', 'test:dr']],
  ['test:db:logical-restore', ['run', 'test:db:logical-restore']],
];

let failed = 0;

// The gate is about PATH resolution, so the pinned-directory mechanism
// is deliberately switched OFF here. It is also removed defensively: a
// leaked PG_CLIENT_BIN_DIR (pointing at a temp dir a test has since
// deleted) would make `resolvePgClient` find no client at all, and the
// suites would take the logical path for the wrong reason - the gate
// would pass while proving nothing.
const env = {
  ...process.env,
  PATH: `${STUB_DIR}${path.delimiter}${process.env.PATH ?? ''}`,
};
delete env.PG_CLIENT_BIN_DIR;
delete env.PG_CLIENT_VERSION;

for (const [name, args] of SUITES) {
  const run = spawnSync('npm', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  const code = run.status ?? 1;
  if (code !== 0) {
    failed += 1;
    process.stderr.write(`${run.stdout ?? ''}${run.stderr ?? ''}`);
  }
  process.stdout.write(
    `${code === 0 ? 'ok' : 'not ok'} - ${name} passes with an older PostgreSQL client on PATH\n`,
  );
}

if (failed > 0) {
  process.stderr.write(
    `\n${failed} suite(s) depend on the host's PostgreSQL client. Pin the backup path explicitly (--pg-dump 0 for the logical path) so the suite proves the same thing on every machine.\n`,
  );
}
process.exitCode = failed === 0 ? 0 : 1;
