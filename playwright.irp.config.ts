import { defineConfig, devices } from '@playwright/test';

/**
 * Interactive IRP rehearsal, run only by the local journey harness.
 *
 * A normal deployment keeps the offline-preflight gate closed. This config
 * therefore declares the same hermetic rehearsal identity the demo build uses
 * (CI + test demo build + VERCEL_ENV=test + a loopback data origin) and opts
 * into the synthetic provider explicitly. The strict CSP stays untouched,
 * because the app still runs as a production build. It proves the UI and SQL
 * contract; it is not a hosted acceptance run and never contacts a provider.
 */
function loopback(name: string): URL {
  const url = new URL(process.env[name] ?? 'invalid:');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) {
    throw new Error('Use npm run test:e2e:irp; no external endpoint can be selected.');
  }
  return url;
}
const app = loopback('JOURNEY_BASE_URL');
const bridge = loopback('JOURNEY_BRIDGE_URL');
const nextPort = Number(process.env.JOURNEY_NEXT_PORT);
if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) throw new Error('Run from the local journey harness.');
const env: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: bridge.origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.JOURNEY_APP_KEY ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '',
  AUTODINE_MODE: '', VERCEL_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1',
  // Hermetic rehearsal identity (loopback only) plus the synthetic provider.
  GITHUB_ACTIONS: 'true', CI: 'true', AUTODINE_TEST_DEMO_BUILD: 'true',
  AUTODINE_IRP_PROVIDER: 'sandbox', AUTODINE_IRP_SIMULATION: 'true',
  JOURNEY_DB_URL: '', JOURNEY_FIXTURES: '', JOURNEY_CONTROL: '',
};

export default defineConfig({
  testDir: './e2e/journey',
  testMatch: '*.simulation.spec.ts',
  workers: 1, retries: 0, timeout: 240_000,
  forbidOnly: true,
  use: {
    baseURL: app.origin,
    trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 30_000, navigationTimeout: 90_000,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox'],
    },
  },
  projects: [{ name: 'irp-simulation', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${nextPort}`,
    url: `http://127.0.0.1:${nextPort}`, timeout: 300_000, reuseExistingServer: false,
    stdout: 'pipe', stderr: 'pipe', env,
  },
});
