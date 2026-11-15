#!/usr/bin/env node
/**
 * Offline validator for the isolated staging hosted-acceptance environment.
 *
 * WHAT IT DOES
 *
 * Checks the E2E_* environment that provision-e2e.mjs writes and
 * playwright.staging.config.ts requires, refusing anything that is not the
 * approved isolated fixture shape. It never prints values — only key names,
 * shapes and rule ids — and never contacts a network.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not provision fixtures, run browsers, or verify that the target is
 * healthy. It exists so a misconfigured secret (production reference pasted
 * into a staging secret, a truncated token, a missing adversarial fixture)
 * fails as a 3-second local check instead of as a confusing hosted run.
 *
 * Exit codes: 0 = environment is the approved isolated shape; 1 = violations
 * found (one line per violation, key names and rule ids only).
 */

export const APPROVED_REF = 'juwyhslzchjevqkdvwjm';
export const APPROVED_ORIGIN = 'https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app';
export const PRODUCTION_REF = 'bdbaqpevwmgdvghszjno';
export const SPEC_FILE_KEYS = ['guest-order-flow.spec.ts', 'kitchen-flow.spec.ts', 'cashier-flow.spec.ts', 'security-flow.spec.ts'];

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_32_PASSWORD = /^[0-9a-f]{64}$/; // provision-e2e uses 32 random bytes hex
const SIX_DIGITS = /^\d{6}$/;
const SLUG = /^arena-e2e-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYNTHETIC_EMAIL = /^arena-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.invalid$/;
const CARD_LABEL = /^E2E-T[1-8]$/;

const containsProduction = (value) => String(value ?? '').includes(PRODUCTION_REF);

export function validateAcceptanceEnv(env) {
  const problems = [];
  const fail = (key, rule) => problems.push(`${key}: ${rule}`);

  const base = env.E2E_BASE_URL;
  if (!base) fail('E2E_BASE_URL', 'missing');
  else if (containsProduction(base)) fail('E2E_BASE_URL', 'contains-production-project-ref');
  else {
    try {
      const parsed = new URL(base);
      if (parsed.origin !== APPROVED_ORIGIN || parsed.pathname !== '/') fail('E2E_BASE_URL', 'not-the-approved-isolated-staging-origin');
    } catch { fail('E2E_BASE_URL', 'not-a-url'); }
  }

  const slug = env.E2E_SLUG;
  if (!slug) fail('E2E_SLUG', 'missing');
  else if (containsProduction(slug) || !SLUG.test(slug)) fail('E2E_SLUG', 'not-an-arena-e2e-synthetic-fixture-slug');

  const email = env.E2E_OWNER_EMAIL;
  if (!email) fail('E2E_OWNER_EMAIL', 'missing');
  else if (containsProduction(email) || !SYNTHETIC_EMAIL.test(email)) fail('E2E_OWNER_EMAIL', 'not-a-synthetic-example.invalid-fixture-owner');

  const password = env.E2E_OWNER_PASSWORD;
  if (!password) fail('E2E_OWNER_PASSWORD', 'missing');
  else if (containsProduction(password) || !HEX_32_PASSWORD.test(password)) fail('E2E_OWNER_PASSWORD', 'not-a-64-hex-fixture-password');

  const token = env.E2E_QR_TOKEN;
  if (!token) fail('E2E_QR_TOKEN', 'missing');
  else if (containsProduction(token) || !HEX_64.test(token)) fail('E2E_QR_TOKEN', 'not-a-64-hex-card-token');

  const tableCode = env.E2E_TABLE_CODE;
  if (!tableCode) fail('E2E_TABLE_CODE', 'missing');
  else if (!SIX_DIGITS.test(tableCode)) fail('E2E_TABLE_CODE', 'not-a-six-digit-on-site-code');

  if (env.E2E_TABLE_LABEL !== undefined && !CARD_LABEL.test(env.E2E_TABLE_LABEL)) fail('E2E_TABLE_LABEL', 'not-an-e2e-fixture-table-label');

  for (const key of ['E2E_REVOKED_QR_TOKEN', 'E2E_EXPIRED_SESSION_TOKEN']) {
    const value = env[key];
    if (!value) fail(key, 'missing-adversarial-fixture');
    else if (containsProduction(value) || !HEX_64.test(value)) fail(key, 'not-a-64-hex-fixture-token');
  }
  const otherOrder = env.E2E_OTHER_ORDER_ID;
  if (!otherOrder) fail('E2E_OTHER_ORDER_ID', 'missing-adversarial-fixture');
  else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(otherOrder)) fail('E2E_OTHER_ORDER_ID', 'not-a-uuid-of-a-synthetic-other-tenant-order');

  const raw = env.E2E_CARDS_JSON;
  if (!raw) fail('E2E_CARDS_JSON', 'missing');
  else if (containsProduction(raw)) fail('E2E_CARDS_JSON', 'contains-production-project-ref');
  else {
    let cards = null;
    try { cards = JSON.parse(raw); } catch { fail('E2E_CARDS_JSON', 'not-json'); }
    if (cards && (typeof cards !== 'object' || Array.isArray(cards))) { fail('E2E_CARDS_JSON', 'not-a-map'); cards = null; }
    if (cards) {
      const keys = Object.keys(cards);
      for (const key of SPEC_FILE_KEYS) {
        if (!keys.includes(key)) fail('E2E_CARDS_JSON', `missing-card-for-${key}`);
      }
      for (const key of keys) {
        if (!SPEC_FILE_KEYS.includes(key)) fail('E2E_CARDS_JSON', `unexpected-key-${key.slice(0, 40)}`);
      }
      const tokens = new Set();
      for (const [key, card] of Object.entries(cards)) {
        if (!card || typeof card !== 'object') { fail('E2E_CARDS_JSON', `card-${key}-not-an-object`); continue; }
        if (typeof card.token !== 'string' || !HEX_64.test(card.token)) fail('E2E_CARDS_JSON', `card-${key}-token-not-64-hex`);
        else if (tokens.has(card.token)) fail('E2E_CARDS_JSON', 'duplicate-card-token');
        else tokens.add(card.token);
        if (typeof card.label !== 'string' || !CARD_LABEL.test(card.label)) fail('E2E_CARDS_JSON', `card-${key}-label-not-e2e-fixture`);
      }
    }
  }

  // Global sweep: no value anywhere may carry the production project ref.
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('E2E_') && containsProduction(value)) {
      if (!problems.some((p) => p.startsWith(`${key}:`))) fail(key, 'contains-production-project-ref');
    }
  }

  return { ok: problems.length === 0, problems, checkedKeys: Object.keys(env).filter((k) => k.startsWith('E2E_')).length };
}

const invoked = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invoked) {
  const result = validateAcceptanceEnv(process.env);
  if (result.ok) {
    console.log(`ACCEPTANCE ENV OK — ${result.checkedKeys} E2E_* keys present and matching the approved isolated-staging fixture shape. Values were not printed and no network was contacted.`);
    process.exit(0);
  }
  console.error('ACCEPTANCE ENV REFUSED — fix these before any hosted run (key names and rule ids only, no values):');
  for (const problem of result.problems) console.error(`  ${problem}`);
  process.exit(1);
}
