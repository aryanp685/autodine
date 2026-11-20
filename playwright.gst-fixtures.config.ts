import { defineConfig } from '@playwright/test';

// Targeted screen/HTTP evidence only. Never connects to a hosted backend or
// joins the real Supabase integration project. No server reuse or retries.
const origin = 'http://127.0.0.1:3119';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'gst-http-fixtures.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  use: {
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox'],
    },
  },
  webServer: [
    { command: 'node e2e/fixtures/gst-api.mjs', url: 'http://127.0.0.1:3118/ready' },
    {
      command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3119',
      port: 3119,
      timeout: 90_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3118',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_gst_fixture',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '',
        AUTODINE_EXPECTED_PROJECT_REF: '', AUTODINE_MODE: '', AUTODINE_IRP_PROVIDER: 'sandbox', AUTODINE_IRP_SIMULATION: 'true', VERCEL_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
