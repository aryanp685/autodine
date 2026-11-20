import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { cleanPgClientEnv, pgServiceFields, withPgService } from './lib-pg-service.mjs';

const url = 'postgresql://sample%40user:private%3Apassword@127.0.0.1:5432/testdb?sslmode=require&connect_timeout=7';

test('URI fields retain percent-encoded credentials and safe options', () => {
  assert.deepEqual(pgServiceFields(url), {
    host: '127.0.0.1', port: '5432', user: 'sample@user', dbname: 'testdb',
    password: 'private:password', sslmode: 'require', connect_timeout: '7',
  });
  assert.equal(pgServiceFields('postgresql://user:pass@[::1]:5432/db').host, '::1');
});

test('target overrides, service injection, line injection, duplicates and ambiguous inputs fail closed', () => {
  for (const input of [
    `${url}&host=example.com`, `${url}&hostaddr=192.0.2.1`, `${url}&user=other`,
    `${url}&service=evil`, `${url}&passfile=/tmp/evil`, `${url}&sslmode=disable`,
    'postgresql://user:pass%0Ahost%3Devil@127.0.0.1/db',
    'postgresql://user:pass@127.0.0.1/db%3Dother',
    'postgresql://user:pass@127.0.0.1/db?application_name=%20leading',
    'postgresql://user:pass@127.0.0.1/db?application_name=trailing%20',
    'postgresql://user:pass@127.0.0.1/db?application_name=%FF',
    'postgresql://user:pass@127.0.0.1/db?application_name=%ZZ',
    'postgresql://user:pass%0Dhost%3Devil@127.0.0.1/db',
    'postgresql://user:pass%00suffix@127.0.0.1/db',
    'postgresql://user:pass@127.0.0.1/db#extra',
    'postgresql://user:pass@%31%32%37.0.0.1/db',
    'postgresql://user:pass@host1,host2/db',
  ]) assert.throws(() => pgServiceFields(input));
});

test('service values have a libpq-safe byte length and reject trimmed or injected whitespace', () => {
  const makeUrl = (password) => `postgresql://user:${encodeURIComponent(password)}@127.0.0.1/db`;
  assert.equal(pgServiceFields(makeUrl('x'.repeat(1012))).password.length, 1012);
  assert.equal(pgServiceFields(makeUrl('é'.repeat(506))).password.length, 506);
  for (const password of ['x'.repeat(1013), 'é'.repeat(507), ' leading', 'trailing ', 'x\ny', 'x\ty']) {
    assert.throws(() => pgServiceFields(makeUrl(password)));
  }
});

// PQconndefaults reads PGSERVICEFILE but never connects or creates a database.
// The embedded package contains actual PostgreSQL 17 libpq on Linux x64.
test('PostgreSQL 17 libpq parses generated service values byte-for-byte without a connection', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, () => {
  const library = path.resolve('node_modules/@embedded-postgres/linux-x64/native/lib/libpq.so');
  assert.ok(existsSync(library), 'embedded PostgreSQL 17 libpq is required');
  const python = `
import ctypes, json, sys
class Option(ctypes.Structure):
    _fields_ = [(name, ctypes.c_char_p) for name in ('keyword', 'envvar', 'compiled', 'val', 'label', 'dispchar')] + [('dispsize', ctypes.c_int)]
pq = ctypes.CDLL(sys.argv[1])
pq.PQlibVersion.restype = ctypes.c_int
if pq.PQlibVersion() // 10000 != 17: sys.exit(2)
pq.PQconndefaults.restype = ctypes.POINTER(Option)
pq.PQconninfoFree.argtypes = [ctypes.POINTER(Option)]
opts = pq.PQconndefaults()
if not opts: sys.exit(3)
expected = json.load(sys.stdin)
actual = {}
i = 0
while opts[i].keyword:
    k = opts[i].keyword.decode('utf-8')
    if k in expected: actual[k] = opts[i].val.decode('utf-8') if opts[i].val is not None else None
    i += 1
pq.PQconninfoFree(opts)
if actual != expected: sys.exit(4)
`;
  const slash = String.fromCharCode(92);
  const special = `space #='${slash}%`;
  const keys = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslcrl', 'sslcrldir', 'channel_binding', 'connect_timeout', 'application_name', 'fallback_application_name', 'keepalives', 'keepalives_idle', 'keepalives_interval', 'keepalives_count', 'tcp_user_timeout', 'gssencmode', 'target_session_attrs', 'options'];
  const query = keys.map((key) => `${key}=${encodeURIComponent(special)}`).join('&');
  const passwords = ["single'quote", `back${slash}slash`, 'inside space', '#hash', 'equals=sign', 'percent%encoded', `café%#= ${slash}'`, 'x'.repeat(1012), 'é'.repeat(506)];
  for (const password of passwords) {
    const user = `user ${slash}'#=%`;
    const encodedUser = encodeURIComponent(user).replaceAll("'", '%27');
    const encodedPassword = encodeURIComponent(password).replaceAll("'", '%27');
    const connection = `postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:5432/db%20name?${query}`;
    const expected = pgServiceFields(connection);
    assert.equal(expected.user, user);
    assert.equal(expected.dbname, 'db name');
    assert.equal(expected.password, password);
    for (const key of keys) assert.equal(expected[key], special);
    withPgService(connection, ({ env }) => {
      const result = spawnSync('python3', ['-c', python, library], {
        env: { ...env, PGSERVICE: 'autodine' }, input: JSON.stringify(expected), encoding: 'utf8',
      });
      assert.equal(result.status, 0, `libpq parsing failed (status ${result.status})`);
    });
  }
});

test('spawned child argv and environment omit connection material; private service is cleaned on success and failure', () => {
  for (const status of [0, 9]) {
    let serviceDir;
    const exercise = () => withPgService(url, ({ env, dbname }) => {
      const file = env.PGSERVICEFILE;
      serviceDir = path.dirname(file);
      assert.equal(statSync(serviceDir).mode & 0o777, 0o700);
      assert.equal(statSync(file).mode & 0o777, 0o600);
      const text = readFileSync(file, 'utf8');
      assert.ok(text.includes('password=private:password\n'));
      assert.ok(text.includes('sslmode=require\n'));
      const child = spawnSync(process.execPath, ['-e', `
        const fs = require('node:fs');
        const actual = process.argv.slice(1).join(' ');
        const file = process.env.PGSERVICEFILE;
        if (actual.includes('postgresql://') || actual.includes('private:password')) process.exit(10);
        if (process.env.PGPASSWORD || process.env.AUTODINE_BACKUP_SOURCE_URL || process.env.B2_SECRET_ACCESS_KEY) process.exit(11);
        if (!fs.readFileSync(file, 'utf8').includes('password=private:password')) process.exit(12);
        process.exit(${status});
      `, '--', '--dbname', dbname], { env: { ...env, PGPASSWORD: undefined }, encoding: 'utf8' });
      assert.equal(child.status, status);
      if (status) throw new Error('simulated client failure');
    });
    if (status) assert.throws(exercise, /simulated client failure/); else exercise();
    assert.equal(existsSync(serviceDir), false);
  }
});

test('client environment permits runtime settings but rejects arbitrary ambient secrets', () => {
  const source = { PATH: '/bin', HOME: '/home/test', LC_ALL: 'C', DATABASE_URL: 'synthetic-db', AWS_SECRET_ACCESS_KEY: 'synthetic-key', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-role', NODE_OPTIONS: '--import=bad', PGHOST: 'override', LD_LIBRARY_PATH: '/hostile', LD_PRELOAD: '/hostile.so', DYLD_LIBRARY_PATH: '/hostile', DYLD_INSERT_LIBRARIES: '/hostile.dylib' };
  assert.deepEqual(cleanPgClientEnv(source), { PATH: '/bin', HOME: '/home/test', LC_ALL: 'C' });
});

test('ambient PostgreSQL and application secrets are not passed to the client', () => {
  const saved = { ...process.env };
  process.env.PGPASSWORD = 'synthetic-pg-secret';
  process.env.PGHOST = 'malicious-host';
  process.env.AUTODINE_BACKUP_SOURCE_URL = url;
  process.env.AUTODINE_BACKUP_PASSPHRASE = 'synthetic-passphrase';
  process.env.B2_SECRET_ACCESS_KEY = 'synthetic-b2-secret';
  for (const key of ['LD_LIBRARY_PATH', 'LD_PRELOAD', 'DYLD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES']) process.env[key] = '/synthetic-hostile';
  try {
    withPgService(url, ({ env, dbname }) => {
      for (const key of ['PGPASSWORD', 'PGHOST', 'AUTODINE_BACKUP_SOURCE_URL', 'AUTODINE_BACKUP_PASSPHRASE', 'B2_SECRET_ACCESS_KEY', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'DYLD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES']) assert.equal(env[key], undefined);
      const child = spawnSync(process.execPath, ['-e', `for (const k of ['LD_LIBRARY_PATH','LD_PRELOAD','DYLD_LIBRARY_PATH','DYLD_INSERT_LIBRARIES']) if (process.env[k]) process.exit(1)`, '--', '--dbname', dbname], { env });
      assert.equal(child.status, 0);
      assert.ok(env.PGSERVICEFILE);
    });
  } finally {
    for (const key of ['PGPASSWORD', 'PGHOST', 'AUTODINE_BACKUP_SOURCE_URL', 'AUTODINE_BACKUP_PASSPHRASE', 'B2_SECRET_ACCESS_KEY', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'DYLD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test('encoded reserved database path is refused when libpq and node-postgres disagree', () => {
  for (const encoded of ['db%2Fother', 'db%3Fother', 'db%23other', 'db%40other']) {
    assert.throws(() => pgServiceFields(`postgresql://user:synthetic@127.0.0.1:5432/${encoded}`), /unsupported host or database name/);
  }
});
