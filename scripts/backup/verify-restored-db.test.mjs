/**
 * Restore-verification contract tests (disposable embedded PostgreSQL only).
 *
 * Covers the fail-closed manifest contract for BOTH backup formats:
 *   - Mode B (built-in dump) end-to-end: backup -> restore -> verify passes
 *     with every comparison actually performed;
 *   - Mode A (pg_dump) manifest generation — via a hermetic pg_dump stub,
 *     because this environment ships no pg_dump/pg_restore (the real
 *     custom-format round trip is exercised by the CI native-database job).
 *     The stub replaces only the external binary; the manifest expectations
 *     are measured from the real fixture database inside the exported
 *     snapshot the stub is handed, and the Mode A manifest is then verified
 *     against the restored database like any other;
 *   - missing/malformed verification evidence fails closed (exit 1) instead
 *     of the old silent pass;
 *   - mismatched counts and financial expectations fail (exit 1);
 *   - artifact/manifest pairing is enforced by name and SHA-256;
 *   - non-loopback targets are refused (exit 2) before any connection.
 *
 * No hosted database, bucket, or credential is involved; every database
 * here is created and destroyed inside this test file.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { withPgService } from './lib-pg-service.mjs';

const BACKUP = path.join(import.meta.dirname, 'backup-logical.mjs');
const RESTORE = path.join(import.meta.dirname, 'restore-logical.mjs');
const VERIFY = path.join(import.meta.dirname, 'verify-restored-db.mjs');
const VERIFY_FILE = path.join(import.meta.dirname, 'verify-backup-file.mjs');
const PASSPHRASE = 'restore-contract-test-passphrase';

const EXPECTED_COUNTS = { tables: 3, rows: 6, functions: 1, policies: 1 };
const EXPECTED_FINANCIAL = { payments_amount_paise: 1200, subscription_payments_amount_paise: 999 };

let server;
let scratch;
let urlFor;
const run = (script, argv, env) => spawnSync(process.execPath, [script, ...argv], {
  encoding: 'utf8',
  env: { ...process.env, ...env },
});

before(async () => {
  scratch = mkdtempSync(path.join(tmpdir(), 'autodine-verify-contract-'));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  const password = `local-${crypto.randomUUID().replaceAll('-', '')}`;
  server = new EmbeddedPostgres({
    databaseDir: path.join(scratch, 'cluster'), port, user: 'postgres', password,
    persistent: false, onLog: () => {}, onError: () => {},
  });
  urlFor = (db) => `postgresql://postgres:${password}@127.0.0.1:${port}/${db}`;
  await server.initialise();
  await server.start();
  const admin = new pg.Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  await admin.query('create database contract_source');
  await admin.query('create database contract_restored');
  await admin.query('create database contract_failure_target');
  await admin.end();

  const src = new pg.Client({ connectionString: urlFor('contract_source') });
  await src.connect();
  await src.query(`
    create table public.payments (id bigint primary key, amount_paise bigint not null);
    create table public.subscription_payments (id bigint primary key, amount_paise bigint not null);
    create table public.orders (id bigint primary key, total_paise bigint not null);
    insert into public.payments values (1, 500), (2, 700);
    insert into public.subscription_payments values (1, 999);
    insert into public.orders values (1, 100), (2, 200), (3, 300);
    create function public.drill_add(a int, b int) returns int language sql immutable as $$ select a + b $$;
    alter table public.orders enable row level security;
    create policy orders_drill_select on public.orders for select using (true);
  `);
  await src.end();
});

after(async () => {
  await server?.stop().catch(() => {});
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const backupOnce = (extraArgs, extraEnv = {}) => {
  const outDir = mkdtempSync(path.join(scratch, 'backup-'));
  const res = run(BACKUP, ['--out-dir', outDir, ...extraArgs], {
    AUTODINE_BACKUP_SOURCE_URL: urlFor('contract_source'),
    AUTODINE_BACKUP_PASSPHRASE: PASSPHRASE,
    ...extraEnv,
  });
  assert.equal(res.status, 0, res.stderr);
  const printed = JSON.parse(res.stdout);
  assert.equal(printed.ok, true);
  const files = readdirSync(outDir).filter((file) => /\.(sql\.gz\.enc|dump\.enc)$/.test(file));
  assert.equal(files.length, 1);
  const manifestPath = path.join(outDir, files[0].replace(/\.(sql\.gz\.enc|dump\.enc)$/, '.manifest.json'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return { outDir, manifest, manifestPath, artifactPath: path.join(outDir, files[0]) };
};

const verifyAgainstRestored = (manifestPath, artifactPath, extraEnv = {}) => run(VERIFY, ['--manifest', manifestPath, '--artifact', artifactPath], {
  AUTODINE_RESTORE_TARGET_URL: urlFor('contract_restored'),
  ...extraEnv,
});

const writeVariant = (manifest, mutate) => {
  const copy = JSON.parse(JSON.stringify(manifest));
  mutate(copy);
  const p = path.join(scratch, `variant-${Math.random().toString(36).slice(2)}.manifest.json`);
  writeFileSync(p, JSON.stringify(copy, null, 2) + '\n');
  return p;
};

// Shared across the sequential tests below (node:test runs them in order).
// Exercise real libpq service-file parsing and local authentication where the
// embedded Linux package supplies libpq. Never use hosted credentials.
test('real PostgreSQL libpq connects to the disposable database using the private service', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, () => {
  const library = path.resolve('node_modules/@embedded-postgres/linux-x64/native/lib/libpq.so');
  assert.ok(existsSync(library), 'embedded PostgreSQL libpq must exist');
  const program = `import ctypes,sys\np=ctypes.CDLL(sys.argv[1])\np.PQconnectdb.argtypes=[ctypes.c_char_p]; p.PQconnectdb.restype=ctypes.c_void_p\np.PQstatus.argtypes=[ctypes.c_void_p]; p.PQstatus.restype=ctypes.c_int\np.PQfinish.argtypes=[ctypes.c_void_p]\nc=p.PQconnectdb(b'service=autodine')\nok=p.PQstatus(c)==0\np.PQfinish(c)\nsys.exit(0 if ok else 1)`;
  withPgService(urlFor('contract_source'), ({ env, dbname }) => {
    assert.equal(dbname, 'service=autodine');
    const result = spawnSync('python3', ['-c', program, library], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, 'libpq must connect using the generated service file');
  });
});
let modeB;
let modeA;

test('Mode B: manifest carries the full contract; restore verifies with every comparison performed', async () => {
  modeB = backupOnce(['--pg-dump', '0']);
  assert.equal(modeB.manifest.format, 'autodine-logical-1');
  assert.deepEqual(
    { tables: modeB.manifest.counts.tables, rows: modeB.manifest.counts.rows, functions: modeB.manifest.counts.functions, policies: modeB.manifest.counts.policies },
    EXPECTED_COUNTS,
  );
  assert.deepEqual(modeB.manifest.financialSpotChecks, EXPECTED_FINANCIAL);
  const artifactSha = createHash('sha256').update(readFileSync(modeB.artifactPath)).digest('hex');
  assert.equal(modeB.manifest.sha256, artifactSha);
  assert.equal(modeB.manifest.file, path.basename(modeB.artifactPath));

  const restore = run(RESTORE, ['--file', modeB.artifactPath, '--confirm-empty-db'], {
    AUTODINE_RESTORE_TARGET_URL: urlFor('contract_restored'),
    AUTODINE_BACKUP_PASSPHRASE: PASSPHRASE,
  });
  assert.equal(restore.status, 0, restore.stderr);

  const verify = verifyAgainstRestored(modeB.manifestPath, modeB.artifactPath);
  assert.equal(verify.status, 0, verify.stderr);
  const report = JSON.parse(verify.stdout);
  assert.equal(report.verified, true);
  assert.deepEqual(report.matches, {
    tables: true, policies: true, functions: true, totalRows: true,
    indexesValid: true, constraintsValidated: true,
    payments_amount_paise: true, subscription_payments_amount_paise: true,
  });
  assert.equal(report.artifactSha256, artifactSha);
});

test('Mode A (pg_dump): manifest generation carries the same contract, measured in the exported snapshot', () => {
  // Hermetic pg_dump stub: records argv, writes PGDMP-headed fixture bytes.
  const stubDir = mkdtempSync(path.join(scratch, 'stubbin-'));
  const argvRecord = path.join(scratch, 'pg-dump-argv.json');
  writeFileSync(path.join(stubDir, 'pg_dump'), `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('pg_dump (PostgreSQL) 17.0\\n'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(argvRecord)}, JSON.stringify(argv));
const fileArg = argv.find((a) => a.startsWith('--file='));
fs.writeFileSync(fileArg.slice('--file='.length), Buffer.concat([Buffer.from('PGDMP'), require('node:crypto').randomBytes(600)]));
`);
  chmodSync(path.join(stubDir, 'pg_dump'), 0o755);

  modeA = backupOnce([], { PATH: `${stubDir}:${process.env.PATH}` });
  assert.equal(modeA.manifest.format, 'pg_dump-custom');
  assert.deepEqual(
    { tables: modeA.manifest.counts.tables, rows: modeA.manifest.counts.rows, functions: modeA.manifest.counts.functions, policies: modeA.manifest.counts.policies },
    EXPECTED_COUNTS,
  );
  assert.deepEqual(modeA.manifest.financialSpotChecks, EXPECTED_FINANCIAL);
  const argv = JSON.parse(readFileSync(argvRecord, 'utf8'));
  assert.ok(argv.some((a) => a.startsWith('--snapshot=')), 'pg_dump must receive the exported snapshot');
  assert.ok(argv.includes('service=autodine'));
  assert.ok(!argv.some((a) => a.includes('postgresql://') || a.includes(new URL(urlFor('contract_source')).password)), 'pg_dump argv must not contain the source URL or password');

  // The encrypted artifact round-trips through the standard file verifier
  // (magic + manifest sha256 + decrypt + PGDMP payload sanity).
  const fileCheck = run(VERIFY_FILE, [modeA.artifactPath], { AUTODINE_BACKUP_PASSPHRASE: PASSPHRASE });
  assert.equal(fileCheck.status, 0, fileCheck.stderr);

  // And the pg_dump-mode manifest verifies against the restored database —
  // the exact path that used to exit 0 with every comparison skipped.
  const verify = verifyAgainstRestored(modeA.manifestPath, modeA.artifactPath);
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).verified, true);
});

test('missing or malformed verification evidence fails closed (never a silent pass)', () => {
  const cases = [
    ['counts removed', (m) => { delete m.counts; }, /carries no counts/],
    ['counts.rows removed', (m) => { delete m.counts.rows; }, /counts\.rows is missing/],
    ['counts.tables negative', (m) => { m.counts.tables = -1; }, /counts\.tables is missing or invalid/],
    ['financialSpotChecks removed', (m) => { delete m.financialSpotChecks; }, /no financialSpotChecks/],
    ['financial value malformed', (m) => { m.financialSpotChecks.payments_amount_paise = 'lots'; }, /financialSpotChecks\.payments_amount_paise/],
    ['unknown format', (m) => { m.format = 'something-else'; }, /format is missing or unknown/],
    ['sha256 malformed', (m) => { m.sha256 = 'xyz'; }, /well-formed sha256/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const variant = writeVariant(modeB.manifest, mutate);
    const res = verifyAgainstRestored(variant, modeB.artifactPath);
    assert.equal(res.status, 1, label);
    assert.match(res.stderr, pattern, label);
  }
  const garbage = path.join(scratch, 'garbage.manifest.json');
  writeFileSync(garbage, 'this is not json');
  const res = verifyAgainstRestored(garbage, modeB.artifactPath);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not valid JSON/);
});

test('mismatched counts and financial expectations fail verification', () => {
  const byRows = writeVariant(modeB.manifest, (m) => { m.counts.rows += 1; });
  let res = verifyAgainstRestored(byRows, modeB.artifactPath);
  assert.equal(res.status, 1);
  assert.equal(JSON.parse(res.stdout).matches.totalRows, false);
  assert.match(res.stderr, /MISMATCH/);

  const byTables = writeVariant(modeB.manifest, (m) => { m.counts.tables += 1; });
  res = verifyAgainstRestored(byTables, modeB.artifactPath);
  assert.equal(res.status, 1);
  assert.equal(JSON.parse(res.stdout).matches.tables, false);

  const byMoney = writeVariant(modeB.manifest, (m) => { m.financialSpotChecks.payments_amount_paise += 1; });
  res = verifyAgainstRestored(byMoney, modeB.artifactPath);
  assert.equal(res.status, 1);
  assert.equal(JSON.parse(res.stdout).matches.payments_amount_paise, false);
});

test('artifact/manifest pairing is enforced by name and by SHA-256', () => {
  // Manifest names a different artifact than the one presented.
  const renamed = writeVariant(modeB.manifest, (m) => { m.file = 'autodine-other-20990101T000000.sql.gz.enc'; });
  let res = verifyAgainstRestored(renamed, modeB.artifactPath);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /pairing mismatch/);

  // Right manifest, wrong artifact bytes (a different backup's artifact).
  const second = backupOnce(['--pg-dump', '0']);
  res = verifyAgainstRestored(modeB.manifestPath, second.artifactPath);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /pairing mismatch/);

  // Artifact that does not exist at all.
  res = verifyAgainstRestored(modeB.manifestPath, path.join(scratch, 'nope.sql.gz.enc'));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /missing or unreadable/);
});

test('non-loopback targets are refused before any connection (exit 2)', () => {
  const res = run(VERIFY, ['--manifest', modeB.manifestPath, '--artifact', modeB.artifactPath], {
    AUTODINE_RESTORE_TARGET_URL: 'postgresql://postgres:secret@db.example.com:5432/production',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /REFUSING non-disposable target/);
  assert.ok(!res.stderr.includes('secret'), 'refusal must not echo credentials');
});

test('both backup modes refuse financial sums beyond the exact JSON integer range', async () => {
  const src = new pg.Client({ connectionString: urlFor('contract_source') });
  await src.connect();
  try {
    await src.query('insert into public.payments values (99, 9007199254740993)');
    const bin = mkdtempSync(path.join(scratch, 'unsafe-sum-client-'));
    const stub = path.join(bin, 'pg_dump');
    writeFileSync(stub, `#!/usr/bin/env node\nif (process.argv.includes('--version')) { console.log('pg_dump (PostgreSQL) 17.0'); process.exit(0); }\nprocess.exit(9);\n`);
    chmodSync(stub, 0o755);
    for (const mode of ['0', '1']) {
      const dir = mkdtempSync(path.join(scratch, 'unsafe-sum-backup-'));
      const res = run(BACKUP, ['--out-dir', dir, '--pg-dump', mode], {
        AUTODINE_BACKUP_SOURCE_URL: urlFor('contract_source'), AUTODINE_BACKUP_PASSPHRASE: PASSPHRASE,
        PATH: `${bin}:${process.env.PATH}`, PG_CLIENT_BIN_DIR: '', PG_CLIENT_VERSION: '',
        BACKUP_ALERT_WEBHOOK: '', DR_ALERT_WEBHOOK: '',
      });
      assert.equal(res.status, 1, `mode ${mode}: ${res.stderr}`);
      assert.match(res.stderr, /payments_amount_paise is not a non-negative safe integer/);
      assert.deepEqual(readdirSync(dir), [], 'refused backup must not leave a misleading artifact or manifest');
    }
  } finally {
    await src.query('delete from public.payments where id = 99');
    await src.end();
  }
});

test('an unvalidated restored constraint fails even when counts and sums match', async () => {
  const restored = new pg.Client({ connectionString: urlFor('contract_restored') });
  await restored.connect();
  try {
    await restored.query('alter table public.orders add constraint unvalidated_drill_check check (total_paise > 1000000) not valid');
    const result = verifyAgainstRestored(modeB.manifestPath, modeB.artifactPath);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.matches.totalRows, true);
    assert.equal(report.matches.constraintsValidated, false);
    assert.equal(report.catalogHealth.unvalidatedConstraints, 1);
    assert.equal(report.verified, false);
  } finally {
    await restored.query('alter table public.orders drop constraint if exists unvalidated_drill_check');
    await restored.end();
  }
});

test('an invalid restored index fails even when counts and sums match', async () => {
  const restored = new pg.Client({ connectionString: urlFor('contract_restored') });
  await restored.connect();
  try {
    // Disposable local PostgreSQL only: simulate an interrupted index build.
    await restored.query('set allow_system_table_mods = on');
    await restored.query("update pg_index set indisvalid = false where indexrelid = 'public.orders_pkey'::regclass");
    const result = verifyAgainstRestored(modeB.manifestPath, modeB.artifactPath);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.matches.totalRows, true);
    assert.equal(report.matches.indexesValid, false);
    assert.equal(report.catalogHealth.invalidIndexes, 1);
    assert.equal(report.verified, false);
  } finally {
    await restored.query("update pg_index set indisvalid = true where indexrelid = 'public.orders_pkey'::regclass");
    await restored.end();
  }
});

test('failed pg_dump hides child stderr and source connection while cleaning partial plaintext', () => {
  const bin = mkdtempSync(path.join(scratch, 'unsafe-dump-client-'));
  const file = path.join(bin, 'pg_dump');
  const record = path.join(scratch, 'failed-dump-child.json');
  writeFileSync(file, `#!/usr/bin/env node\nconst fs = require('node:fs');\nif (process.argv.includes('--version')) { console.log('pg_dump (PostgreSQL) 17.0'); process.exit(0); }\nconst service = process.env.PGSERVICEFILE; fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({argv: process.argv.slice(2), privateFile: (fs.statSync(service).mode & 0o777) === 0o600, hasPassword: fs.readFileSync(service,'utf8').includes('password='), sourceEnv: !!process.env.AUTODINE_BACKUP_SOURCE_URL, passEnv: !!process.env.AUTODINE_BACKUP_PASSPHRASE, service}));\nconsole.error(fs.readFileSync(service,'utf8'), 'synthetic-child-private'); process.exit(9);\n`);
  chmodSync(file, 0o755);
  const dir = mkdtempSync(path.join(scratch, 'failed-dump-'));
  const source = urlFor('contract_source');
  const result = run(BACKUP, ['--out-dir', dir, '--pg-dump', '1'], {
    AUTODINE_BACKUP_SOURCE_URL: source, AUTODINE_BACKUP_PASSPHRASE: PASSPHRASE,
    PG_CLIENT_BIN_DIR: bin, PG_CLIENT_VERSION: '17', BACKUP_ALERT_WEBHOOK: '',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pg_dump failed \(exit 9\)/);
  assert.ok(!result.stderr.includes(source));
  assert.ok(!result.stderr.includes(new URL(source).password));
  assert.doesNotMatch(result.stderr, /synthetic-child-private/);
  const child = JSON.parse(readFileSync(record, 'utf8'));
  assert.ok(child.argv.includes('service=autodine'));
  assert.ok(!child.argv.some((a) => a.includes(source) || a.includes(new URL(source).password)));
  assert.equal(child.privateFile, true);
  assert.equal(child.hasPassword, true);
  assert.equal(child.sourceEnv, false);
  assert.equal(child.passEnv, false);
  assert.equal(existsSync(child.service), false);
  assert.deepEqual(readdirSync(dir), []);
});

test('failed pg_restore hides child stderr and target connection while cleaning plaintext', () => {
  const bin = mkdtempSync(path.join(scratch, 'unsafe-restore-client-'));
  const file = path.join(bin, 'pg_restore');
  const record = path.join(scratch, 'failed-restore-child.json');
  writeFileSync(file, `#!/usr/bin/env node\nconst fs = require('node:fs');\nif (process.argv.includes('--version')) { console.log('pg_restore (PostgreSQL) 17.0'); process.exit(0); }\nif (!process.argv.includes('--exit-on-error')) process.exit(8); const service = process.env.PGSERVICEFILE; fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({argv: process.argv.slice(2), privateFile: (fs.statSync(service).mode & 0o777) === 0o600, hasPassword: fs.readFileSync(service,'utf8').includes('password='), targetEnv: !!process.env.AUTODINE_RESTORE_TARGET_URL, passEnv: !!process.env.AUTODINE_BACKUP_PASSPHRASE, service})); console.error(fs.readFileSync(service,'utf8'), 'synthetic-child-private'); process.exit(9);\n`);
  chmodSync(file, 0o755);
  const tmp = mkdtempSync(path.join(scratch, 'failed-restore-tmp-'));
  const target = urlFor('contract_failure_target');
  const result = run(RESTORE, ['--file', modeA.artifactPath, '--confirm-empty-db'], {
    AUTODINE_RESTORE_TARGET_URL: target, AUTODINE_BACKUP_PASSPHRASE: PASSPHRASE,
    PG_CLIENT_BIN_DIR: bin, PG_CLIENT_VERSION: '17', TMPDIR: tmp,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pg_restore failed \(exit 9\)/);
  assert.ok(!result.stderr.includes(target));
  assert.ok(!result.stderr.includes(new URL(target).password));
  assert.doesNotMatch(result.stderr, /synthetic-child-private/);
  const child = JSON.parse(readFileSync(record, 'utf8'));
  assert.ok(child.argv.includes('service=autodine'));
  assert.ok(!child.argv.some((a) => a.includes(target) || a.includes(new URL(target).password)));
  assert.equal(child.privateFile, true);
  assert.equal(child.hasPassword, true);
  assert.equal(child.targetEnv, false);
  assert.equal(child.passEnv, false);
  assert.equal(existsSync(child.service), false);
  assert.deepEqual(readdirSync(tmp), []);
});
