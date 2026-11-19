/**
 * Regression tests for the PR #191 review findings R1–R3.
 *
 * These are source-invariant tests on purpose: the behaviours they pin
 * (no trace/screenshot capture, no artifact upload, anonymous context
 * built with an explicit base URL, one shared URL allowlist pattern)
 * are exactly the ones that silently regress when someone "temporarily"
 * re-enables evidence capture or a copied regex drifts. The validator
 * behaviour itself is covered functionally in check-preview.test.mjs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
async function read(path) {
  return readFile(new URL(path, root), 'utf8');
}

describe('R1: no credential-bearing browser state is captured', () => {
  it('playwright config disables traces, screenshots and video', async () => {
    const config = await read('playwright.preview.config.ts');
    assert.match(config, /trace:\s*'off'/);
    assert.match(config, /screenshot:\s*'off'/);
    assert.match(config, /video:\s*'off'/);
    assert.ok(!config.includes('retain-on-failure'), 'trace retention must stay off');
    assert.ok(!config.includes('only-on-failure'), 'failure capture must stay off');
  });

  it('workflow uploads no artifacts', async () => {
    const workflow = await read('.github/workflows/preview-checks.yml');
    assert.ok(!workflow.includes('upload-artifact'), 'no downloadable browser artifacts');
    assert.ok(!workflow.includes('test-results'), 'no test-results path referenced');
  });

  it('workflow references exactly the three Preview-scoped secrets', async () => {
    const workflow = await read('.github/workflows/preview-checks.yml');
    const referenced = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(referenced)].sort(),
      ['PREVIEW_TEST_EMAIL', 'PREVIEW_TEST_PASSWORD', 'VERCEL_AUTOMATION_BYPASS_SECRET'],
    );
  });
});

describe('R2: one allowlist pattern, shared verbatim', () => {
  it('checker and playwright config carry the identical host pattern', async () => {
    const checker = await read('scripts/preview/check-preview.mjs');
    const config = await read('playwright.preview.config.ts');
    const extract = (text) => {
      const m = text.match(/PREVIEW_HOST_PATTERN\s*=\s*\n?\s*(\/.+\/);/);
      assert.ok(m, 'PREVIEW_HOST_PATTERN present');
      return m[1];
    };
    assert.equal(extract(config), extract(checker));
    assert.match(extract(checker), /new-git-/);
    for (const text of [checker, config]) {
      assert.ok(text.includes("'main'"), 'production alias explicitly denied');
    }
  });
});

describe('R3: anonymous probe is anonymous by construction', () => {
  it('spec passes PREVIEW_URL explicitly to the anonymous context', async () => {
    const spec = await read('e2e/preview/auth-flows.spec.ts');
    const anonBlock = spec.match(/playwright\.request\.newContext\(\{[\s\S]*?\}\);/);
    assert.ok(anonBlock, 'anonymous context creation present');
    assert.match(anonBlock[0], /baseURL:\s*process\.env\.PREVIEW_URL/);
    assert.match(anonBlock[0], /extraHTTPHeaders:\s*\{\}/);
  });
});
