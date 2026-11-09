import { defineConfig, devices } from '@playwright/test';
if(!process.env.E2E_BASE_URL||!process.env.E2E_OWNER_EMAIL||!process.env.E2E_OWNER_PASSWORD||!process.env.E2E_QR_TOKEN||!process.env.E2E_SLUG||!process.env.E2E_TABLE_CODE)throw new Error('Staging fixtures are required; missing credentials must fail, not silently skip the run.');
export default defineConfig({
 testDir:'./e2e/integration',
 testMatch:/(guest-order-flow|kitchen-flow|cashier-flow|security-flow)\.spec\.ts/,
 globalSetup:'./scripts/staging/browser-access.ts',
 workers:1,fullyParallel:false,retries:0,timeout:120_000,
 reporter:[['list'],['json',{outputFile:'.staging-private/results.json'}]],
 use:{...devices['Desktop Chrome'],baseURL:process.env.E2E_BASE_URL,storageState:'.staging-private/browser-access.json',reducedMotion:'reduce',trace:'off',screenshot:'off',video:'off'},
});
