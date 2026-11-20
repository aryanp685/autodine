import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encryptBuffer } from './lib-crypto.mjs';

test('restore CLI always closes the mocked client on replay, target-count and connection failures', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'autodine-restore-mock-'));
  try {
    const marker = path.join(dir, 'calls');
    const fixture = path.join(dir, 'fixture.sql.gz.enc');
    const preload = path.join(dir, 'mock-pg.mjs');
    const pgModule = pathToFileURL(path.resolve('node_modules/pg/lib/index.js')).href;
    const script = path.join(import.meta.dirname, 'restore-logical.mjs');
    const passphrase = 'synthetic-passphrase-1234';
    const secret = 'synthetic-private-db-error';
    writeFileSync(fixture, encryptBuffer(Buffer.from('select 1; -- synthetic mock only'), passphrase));
    writeFileSync(preload, `
import pg from ${JSON.stringify(pgModule)};
import { appendFileSync } from 'node:fs';
const record = (event) => appendFileSync(process.env.MOCK_MARKER, event + '\\n');
pg.Client = class {
  async connect() { record('connect'); if (process.env.MOCK_CASE === 'connect') throw new Error(process.env.MOCK_SECRET); }
  async query() {
    record('query');
    if (!this.seen) { this.seen = true; if (process.env.MOCK_CASE === 'count') throw new Error(process.env.MOCK_SECRET); return { rows: [{ n: process.env.MOCK_CASE === 'populated' ? 1 : 0 }] }; }
    if (process.env.MOCK_CASE === 'auth') { const e = new Error('schema "auth" does not exist'); e.code = '3F000'; throw e; }
    throw new Error(process.env.MOCK_SECRET);
  }
  async end() { record('end'); }
};
`);
    for (const scenario of ['replay', 'auth', 'count', 'populated', 'connect', 'production']) {
      writeFileSync(marker, '');
      const target = scenario === 'production'
        ? 'postgresql://user:synthetic-password@db.bdbaqpevwmgdvghszjno.supabase.co/postgres'
        : 'postgresql://user:synthetic-password@127.0.0.1/test';
      const result = spawnSync(process.execPath, ['--import', preload, script, '--file', fixture, '--confirm-empty-db'], {
        encoding: 'utf8', timeout: 10000,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, AUTODINE_RESTORE_TARGET_URL: target, AUTODINE_BACKUP_PASSPHRASE: passphrase, MOCK_CASE: scenario, MOCK_SECRET: secret, MOCK_MARKER: marker },
      });
      assert.equal(result.status, 1, `${scenario} must fail`);
      const calls = readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean);
      if (scenario === 'production') {
        assert.deepEqual(calls, []);
        assert.match(result.stderr, /PRODUCTION project/);
      } else {
        assert.equal(calls[0], 'connect');
        assert.equal(calls.at(-1), 'end');
        assert.equal(calls.filter((event) => event === 'end').length, 1);
        if (scenario === 'populated') { assert.equal(calls.filter((event) => event === 'query').length, 1); assert.match(result.stderr, /refusing to overwrite/); }
        if (scenario === 'replay') assert.match(result.stderr, /replay failed/);
        if (scenario === 'auth') assert.match(result.stderr, /schema "auth" does not exist/);
      }
      assert.ok(!(result.stdout + result.stderr).includes(secret));
      assert.ok(!(result.stdout + result.stderr).includes('synthetic-password'));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
