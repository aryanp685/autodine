#!/usr/bin/env node
/**
 * Runs one command against a PostgreSQL that exists only for that command.
 *
 *   node scripts/local-pg/with-embedded-postgres.mjs node scripts/verify-database.mjs
 *
 * The cluster listens on loopback, on a random port, with a random password,
 * and its data directory is deleted when the command exits. Its admin URL is
 * exported as READINESS_PG_ADMIN_URL and RECONCILE_PG_ADMIN_URL. Nothing here
 * reads application environment or reaches a hosted database.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/local-pg/with-embedded-postgres.mjs <command> [args...]');
  process.exitCode = 2;
} else {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  const dataDir = await mkdtemp(path.join(tmpdir(), 'autodine-pg-'));
  const password = `local-${randomUUID().replaceAll('-', '')}`;
  const server = new EmbeddedPostgres({
    databaseDir: path.join(dataDir, 'cluster'),
    port,
    user: 'postgres',
    password,
    persistent: false,
    onLog: (message) => process.env.LOCAL_PG_VERBOSE && process.stderr.write(String(message)),
    onError: (error) => process.stderr.write(`${error?.message ?? error}\n`),
  });
  try {
    await server.initialise();
    await server.start();
    const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
    console.log(`Disposable PostgreSQL on 127.0.0.1:${port}; it is destroyed when the command exits.`);
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, READINESS_PG_ADMIN_URL: url, RECONCILE_PG_ADMIN_URL: url },
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  } finally {
    await server.stop().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
}
