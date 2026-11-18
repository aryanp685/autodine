/**
 * Unit tests for the Preview deployment checker.
 *
 * A local stub plays the two roles the real deployment has: Vercel's
 * edge (SSO redirect for anonymous/wrong-bypass traffic) and the app
 * (auth forms behind a correct bypass, app login wall, webhook 401).
 * No real secret, no real deployment, no personal data anywhere here.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { exitCodeFor, redactUrl, runChecks, validatePreviewUrl } from './check-preview.mjs';

const SECRET = 'test-bypass-value-not-a-real-secret';

function startStub({ protectionOn = true } = {}) {
  const server = createServer((req, res) => {
    const bypass = req.headers['x-vercel-protection-bypass'];
    if (protectionOn && bypass !== SECRET) {
      res.writeHead(307, { location: 'https://vercel.com/login?next=%2Fsso-api' });
      res.end();
      return;
    }
    if (req.url === '/login') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<form><input name="email"><input name="password"></form>');
      return;
    }
    if (req.url === '/signup') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<form><input name="fullName"><input name="restaurantName"></form>');
      return;
    }
    if (req.url === '/forgot-password') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<form><input name="email"></form>');
      return;
    }
    if (req.url === '/dashboard') {
      res.writeHead(307, { location: '/login' });
      res.end();
      return;
    }
    if (req.url === '/signup/confirmation-pending') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<form><input name="email"></form>');
      return;
    }
    if (req.url === '/api/email/brevo/webhook' && req.method === 'POST') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function byId(results) {
  return Object.fromEntries(results.map((r) => [r.check, r.result]));
}

describe('redactUrl', () => {
  it('strips query and hash so credentials cannot reach logs', () => {
    assert.equal(
      redactUrl('https://preview.example/login?x-vercel-protection-bypass=abc#frag'),
      'https://preview.example/login',
    );
  });
});

describe('validatePreviewUrl (R2: only permitted branch aliases)', () => {
  const ALIAS =
    'https://new-git-arena-2670dd12-autodine-iamjarvis9896-3988s-projects.vercel.app';

  it('accepts an explicit branch-alias host and normalizes to origin', () => {
    assert.deepEqual(validatePreviewUrl(ALIAS), { ok: true, origin: ALIAS });
    assert.equal(validatePreviewUrl(`${ALIAS}/login`).ok, true);
  });

  it('rejects the Production branch alias', () => {
    assert.deepEqual(
      validatePreviewUrl('https://new-git-main-iamjarvis9896-3988s-projects.vercel.app'),
      { ok: false, reason: 'production_alias' },
    );
  });

  it('rejects unique per-deployment URLs, custom domains and arbitrary hosts', () => {
    for (const bad of [
      'https://new-oh80ddkqy-iamjarvis9896-3988s-projects.vercel.app',
      'https://autodine.example.com',
      'https://evil.example',
      'https://new-git-arena-2670dd12-autodine-iamjarvis9896-3988s-projects.vercel.app.evil.example',
    ]) {
      assert.equal(validatePreviewUrl(bad).ok, false, bad);
      assert.equal(validatePreviewUrl(bad).reason, 'host_not_permitted', bad);
    }
  });

  it('rejects malformed, non-https, credentialed and query/fragment URLs', () => {
    assert.equal(validatePreviewUrl('').reason, 'missing');
    assert.equal(validatePreviewUrl('not a url').reason, 'malformed');
    assert.equal(validatePreviewUrl(ALIAS.replace('https:', 'http:')).reason, 'not_https');
    assert.equal(
      validatePreviewUrl(ALIAS.replace('https://', 'https://user:pass@')).reason,
      'credentials_in_url',
    );
    assert.equal(validatePreviewUrl(`${ALIAS}?x-vercel-protection-bypass=x`).reason, 'query_or_fragment');
    assert.equal(validatePreviewUrl(`${ALIAS}#frag`).reason, 'query_or_fragment');
    assert.equal(validatePreviewUrl(`${ALIAS}:8443`).reason, 'explicit_port');
  });
});

describe('runChecks against a protected stub', () => {
  let stub;
  before(async () => {
    stub = await startStub();
  });
  after(() => stub.server.close());

  it('passes posture and all full checks with the bypass secret', async () => {
    const results = await runChecks({ baseUrl: stub.base, secret: SECRET });
    const map = byId(results);
    assert.equal(map.protection_on, 'pass');
    assert.equal(map.fail_closed, 'pass');
    assert.equal(map.login_page, 'pass');
    assert.equal(map.signup_page, 'pass');
    assert.equal(map.reset_page, 'pass');
    assert.equal(map.app_auth_intact, 'pass');
    assert.equal(map.pending_page, 'pass');
    assert.equal(map.webhook_app_auth, 'pass');
    assert.equal(exitCodeFor(results), 0);
    assert.ok(!JSON.stringify(results).includes(SECRET), 'output must never contain the secret');
  });

  it('marks full checks blocked (exit 2) when the secret is absent, posture still passes', async () => {
    const results = await runChecks({ baseUrl: stub.base, secret: '' });
    const map = byId(results);
    assert.equal(map.protection_on, 'pass');
    assert.equal(map.login_page, 'blocked');
    assert.equal(exitCodeFor(results), 2);
    assert.equal(exitCodeFor(results, { postureOnly: true }), 0);
  });

  it('fails loudly (exit 1) when protection is off', async () => {
    const open = await startStub({ protectionOn: false });
    try {
      const results = await runChecks({ baseUrl: open.base, secret: SECRET });
      assert.equal(byId(results).protection_on, 'fail');
      assert.equal(exitCodeFor(results), 1);
    } finally {
      open.server.close();
    }
  });

  it('fails when a wrong bypass value reaches the app', async () => {
    // A stub that treats any bypass header as valid must be caught by
    // the fail_closed probe.
    const lax = createServer((req, res) => {
      if (req.headers['x-vercel-protection-bypass']) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<form><input name="email"><input name="password"></form>');
        return;
      }
      res.writeHead(307, { location: 'https://vercel.com/login' });
      res.end();
    });
    await new Promise((resolve) => lax.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${lax.address().port}`;
      const results = await runChecks({ baseUrl: base, secret: SECRET });
      assert.equal(byId(results).fail_closed, 'fail');
      assert.equal(exitCodeFor(results), 1);
    } finally {
      lax.close();
    }
  });
});
