import { defineConfig, devices } from '@playwright/test';

function loopback(name: string): URL {
  const url = new URL(process.env[name] ?? 'invalid:');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) {
    throw new Error('Use npm run test:e2e:journey; no external endpoint can be selected.');
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
  // Never hand fixture-session credentials or the cluster admin URL to Next.
  JOURNEY_DB_URL: '', JOURNEY_FIXTURES: '', JOURNEY_CONTROL: '',
};

export default defineConfig({
  testDir: './e2e/journey',
  workers: 1, retries: 0, timeout: 85_000,
  forbidOnly: true,
  use: {
    baseURL: app.origin,
    trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 12_000, navigationTimeout: 24_000,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox'],
    },
  },
  projects: [
    { name: 'desktop', testMatch: '*.desktop.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', testMatch: '*.phone.spec.ts', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${nextPort}`,
    url: `http://127.0.0.1:${nextPort}`, timeout: 240_000, reuseExistingServer: false,
    stdout: 'pipe', stderr: 'pipe', env,
  },
});
