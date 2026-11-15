import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAcceptanceEnv, SPEC_FILE_KEYS } from './verify-acceptance-env.mjs';

const hex64 = (c) => c.repeat(64);

function validEnv() {
  const cards = {};
  const labels = ['E2E-T1', 'E2E-T2', 'E2E-T3', 'E2E-T4'];
  SPEC_FILE_KEYS.forEach((key, index) => { cards[key] = { token: hex64(String(index + 1)), label: labels[index] }; });
  return {
    E2E_BASE_URL: 'https://new-git-arena-3711df6a-autodine-iamjarvis9896-3988s-projects.vercel.app',
    E2E_SLUG: 'arena-e2e-00000000-0000-0000-0000-000000000001',
    E2E_OWNER_EMAIL: 'arena-00000000-0000-0000-0000-000000000001@example.invalid',
    E2E_OWNER_PASSWORD: hex64('a'),
    E2E_QR_TOKEN: hex64('1'),
    E2E_TABLE_CODE: '424242',
    E2E_TABLE_LABEL: 'E2E-T1',
    E2E_REVOKED_QR_TOKEN: hex64('e'),
    E2E_EXPIRED_SESSION_TOKEN: hex64('f'),
    E2E_OTHER_ORDER_ID: '00000000-0000-4000-8000-0000000000aa',
    E2E_CARDS_JSON: JSON.stringify(cards),
  };
}

test('accepts the exact provisioned isolated-staging fixture shape', () => {
  const result = validateAcceptanceEnv(validEnv());
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('refuses the production project reference anywhere in the environment', () => {
  const env = { ...validEnv(), E2E_BASE_URL: 'https://bdbaqpevwmgdvghszjno-x.vercel.app' };
  const result = validateAcceptanceEnv(env);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('E2E_BASE_URL')));
});

test('refuses any non-approved origin or extra path', () => {
  for (const bad of ['https://autodine-production.vercel.app', 'http://new-git-arena-3711df6a-autodine-iamjarvis9896-3988s-projects.vercel.app', 'https://new-git-arena-3711df6a-autodine-iamjarvis9896-3988s-projects.vercel.app/path']) {
    assert.equal(validateAcceptanceEnv({ ...validEnv(), E2E_BASE_URL: bad }).ok, false, bad);
  }
});

test('refuses missing or truncated secrets and fixtures', () => {
  for (const key of ['E2E_OWNER_PASSWORD', 'E2E_QR_TOKEN', 'E2E_REVOKED_QR_TOKEN', 'E2E_EXPIRED_SESSION_TOKEN', 'E2E_CARDS_JSON']) {
    const missing = { ...validEnv() };
    delete missing[key];
    assert.equal(validateAcceptanceEnv(missing).ok, false, `${key} missing`);
    assert.equal(validateAcceptanceEnv({ ...validEnv(), [key]: 'abc' }).ok, false, `${key} truncated`);
  }
});

test('refuses non-synthetic owner identities', () => {
  assert.equal(validateAcceptanceEnv({ ...validEnv(), E2E_OWNER_EMAIL: 'real-owner@example.com' }).ok, false);
  assert.equal(validateAcceptanceEnv({ ...validEnv(), E2E_SLUG: 'some-restaurant' }).ok, false);
});

test('refuses duplicate card tokens and unexpected card keys', () => {
  const cards = {};
  for (const key of SPEC_FILE_KEYS) cards[key] = { token: hex64('9'), label: 'E2E-T1' };
  const dup = validateAcceptanceEnv({ ...validEnv(), E2E_CARDS_JSON: JSON.stringify(cards) });
  assert.equal(dup.ok, false);
  assert.ok(dup.problems.some((p) => p.includes('duplicate-card-token')));

  const extra = { ...JSON.parse(validEnv().E2E_CARDS_JSON), 'mystery.spec.ts': { token: hex64('8'), label: 'E2E-T8' } };
  assert.equal(validateAcceptanceEnv({ ...validEnv(), E2E_CARDS_JSON: JSON.stringify(extra) }).ok, false);
});

test('refuses a card map missing one of the provisioned suites', () => {
  const cards = JSON.parse(validEnv().E2E_CARDS_JSON);
  delete cards['security-flow.spec.ts'];
  const result = validateAcceptanceEnv({ ...validEnv(), E2E_CARDS_JSON: JSON.stringify(cards) });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('security-flow')));
});
