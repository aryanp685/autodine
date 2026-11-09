import { defineConfig, devices } from '@playwright/test';
if(!process.env.E2E_BASE_URL||!process.env.E2E_OWNER_EMAIL||!process.env.E2E_OWNER_PASSWORD||!process.env.E2E_QR_TOKEN||!process.env.E2E_SLUG||!process.env.E2E_TABLE_CODE)throw new Error('Staging fixtures are required; missing credentials must fail, not silently skip the run.');
if(!process.env.E2E_OTHER_ORDER_ID||!process.env.E2E_REVOKED_QR_TOKEN||!process.env.E2E_EXPIRED_SESSION_TOKEN)throw new Error('Adversarial staging fixtures required; refusing skipped coverage.');
export default defineConfig({
 testDir:'./e2e/integration',
 testMatch:/(guest-order-flow|kitchen-flow|cashier-flow|security-flow)\.spec\.ts/,
 globalSetup:'./scripts/staging/browser-access.ts',
 workers:1,fullyParallel:false,retries:0,timeout:60_000,maxFailures:3,globalTimeout:600_000,
 reporter:[['list'],['json',{outputFile:'.staging-private/results.json'}]],
 use:{...devices['Desktop Chrome'],baseURL:process.env.E2E_BASE_URL,storageState:'.staging-private/browser-access.json',reducedMotion:'reduce',trace:'off',screenshot:'off',video:'off'},
});
