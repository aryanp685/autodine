/** Called only by the disposable PostgreSQL runner, never by the app. */
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { PRIVATE_DETAIL } from './sentinel.mjs';
import pg from 'pg';
import { startBridge } from './bridge.mjs';
import { seedJourney } from './seed.mjs';
import { installRealtimeFixture } from './realtime.mjs';

export async function runJourney(connectionString, options = {}) {
  const location = new URL(connectionString);
  if (location.hostname !== '127.0.0.1' || !/^\/autodine_check_[a-f0-9]{16}$/.test(location.pathname)) {
    throw new Error('The journey runner requires its own disposable PostgreSQL cluster.');
  }
  // Next reads .env files even in child processes. Refuse them without reading
  // their contents: this harness must not start with any hosted configuration.
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (existsSync(file)) throw new Error('Run the journey in a checkout without local application env files.');
  }
  const db = new pg.Client({ connectionString });
  await db.connect();
  let bridge;
  try {
    const { key, identities, sessions, outlets } = await seedJourney(db);
    const control = randomBytes(24).toString('hex');
    const login = randomBytes(24).toString('hex');
    // PostgREST's local authenticator can assume API roles; the bridge itself
    // has no superuser or service-role login or client-controlled role setting.
    await db.query(`alter role authenticator login noinherit password '${login}'; revoke service_role from authenticator;`);
    const bridgeUrl = new URL(connectionString);
    bridgeUrl.username = 'authenticator';
    bridgeUrl.password = login;
    const portProbe = createServer();
    await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve); });
    const { port } = portProbe.address();
    await new Promise(resolve => portProbe.close(resolve));
    await installRealtimeFixture(db);
    bridge = await startBridge({ connectionString: bridgeUrl.href, key, identities, sessions, control, appPort: port });
    const env = Object.fromEntries(['PATH','HOME','TMPDIR','LD_LIBRARY_PATH','AWS_EXECUTION_ENV','PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH','CI','FORCE_COLOR']
      .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
    Object.assign(env, {
      JOURNEY_BASE_URL: bridge.origin,
      JOURNEY_NEXT_PORT: String(port),
      JOURNEY_BRIDGE_URL: bridge.origin,
      JOURNEY_DB_URL: connectionString,
      JOURNEY_FIXTURES: JSON.stringify({ outlets, sessions }),
      JOURNEY_APP_KEY: key, JOURNEY_CONTROL: control,
    });
    console.log(options.irp
      ? 'IRP simulation journey: development server, disposable PostgreSQL, synthetic provider worker (no hosted provider, no legal IRN).'
      : 'Browser journey: disposable PostgreSQL, synthetic identities, same-origin loopback HTTP/WebSocket adapters (not PostgREST/Auth/Realtime).');
    const selection = process.env.JOURNEY_GREP ? ['--grep', process.env.JOURNEY_GREP] : [];
    const config = options.irp ? 'playwright.irp.config.ts' : 'playwright.journey.config.ts';
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', config, ...selection], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    // Inspect only application log lines; never retain credential/driver
    // text in the run's evidence if an assertion catches a regression.
    const tags = [PRIVATE_DETAIL, key, control, login, ...identities.keys()];
    let loggedPrivate = false;
    for (const [source, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      createInterface({ input: source }).on('line', line => {
        if (line.startsWith('[WebServer]') && tags.some(token => line.includes(token))) {
          loggedPrivate = true;
          target.write('[WebServer] (synthetic private diagnostic suppressed)\n');
        } else target.write(`${line}\n`);
      });
    }
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (loggedPrivate) throw new Error('Unexpected synthetic private data in application logs.');
    if (code !== 0) throw new Error(`Journey Chromium run failed (${code}).`);
    if (bridge.unsupported.size) throw new Error(`Unmodelled journey API queries: ${[...bridge.unsupported].join(', ')}`);
  } finally {
    await bridge?.close();
    await db.end();
  }
}
