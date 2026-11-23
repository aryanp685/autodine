#!/usr/bin/env node
/**
 * Permanent Preview deployment checks for AutoDine (Hobby-safe).
 *
 * WHY THIS EXISTS
 *
 * Vercel Deployment Protection (Vercel Authentication) is ON for Preview
 * and stays ON. On the Hobby plan only ONE external user per account can
 * ever be granted deployment access, so approving collaborator requests
 * for automation is a dead end. The supported zero-cost path for tools is
 * Protection Bypass for Automation: the project secret travels as the
 * `x-vercel-protection-bypass` header (docs:
 * vercel.com/docs/deployment-protection — Protection Bypass for
 * Automation, available on all plans). Humans use the stable
 * branch-alias URL while signed in to Vercel as the team owner, which
 * passes SSO silently and never generates an approval request.
 *
 * WHAT IT CHECKS
 *
 * Posture (needs no secret, runs always):
 *   1. `protection_on`     — requesting /login with no credentials does
 *      NOT reach the app; it lands on Vercel's SSO. If app HTML comes
 *      back, Deployment Protection is off and this fails loudly.
 *   2. `fail_closed`       — a deliberately wrong bypass value also does
 *      NOT reach the app.
 *
 * Full (needs VERCEL_AUTOMATION_BYPASS_SECRET in the environment):
 *   3. `login_page`        — /login serves the sign-in form via bypass.
 *   4. `signup_page`       — /signup serves the workspace signup form.
 *   5. `reset_page`        — /forgot-password serves the reset form.
 *   6. `app_auth_intact`   — /dashboard without an app session redirects
 *      to /login (the edge bypass is not an app login).
 *   7. `pending_page`      — /signup/confirmation-pending renders.
 *   8. `webhook_app_auth`  — POST /api/email/brevo/webhook through the
 *      edge bypass but WITHOUT the app credential is refused 401 by the
 *      app itself. Two independent locks, both verified.
 *
 * SAFETY RULES
 *
 * - The bypass secret is read from the environment only, is never
 *   printed, never put in a URL, and never sent to any other host.
 * - Output is fixed-vocabulary JSON lines plus one `[autodine:alert]`
 *   line on failure (same convention as the app's incident logs). URLs
 *   are printed with query/hash stripped. No emails, no headers, no
 *   response bodies.
 * - Exit codes: 0 = everything that could run passed; 1 = a check
 *   failed; 2 = blocked (missing config / unreachable), so CI can tell
 *   "not set up" apart from "broken".
 */

const TIMEOUT_MS = 15_000;

/**
 * Strict Preview URL allowlist (R2). Only this project's branch-alias
 * hosts may ever be tested:
 *
 *   new-git-<branch>-iamjarvis9896-3988s-projects.vercel.app
 *
 * Everything else is refused before any request is made: Production
 * aliases (`new-git-main-…`), unique per-deployment URLs (`new-…`),
 * custom domains, arbitrary hosts, non-https URLs, URLs carrying
 * credentials/query/fragment (a query could smuggle a bypass secret),
 * and malformed input. Keep this pattern in sync with
 * playwright.preview.config.ts — a test in check-preview.test.mjs's
 * sibling suite asserts the two copies match.
 */
export const PREVIEW_HOST_PATTERN =
  /^new-git-([a-z0-9-]+)-iamjarvis9896-3988s-projects\.vercel\.app$/;

export function validatePreviewUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'missing' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' };
  if (url.search || url.hash) return { ok: false, reason: 'query_or_fragment' };
  if (url.port) return { ok: false, reason: 'explicit_port' };
  const match = PREVIEW_HOST_PATTERN.exec(url.hostname);
  if (!match) return { ok: false, reason: 'host_not_permitted' };
  if (match[1] === 'main') return { ok: false, reason: 'production_alias' };
  return { ok: true, origin: url.origin };
}

/** Strip query + hash so a credential can never ride into the logs. */
export function redactUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

function isVercelSso(location, body) {
  if (location) {
    try {
      const host = new URL(location).hostname;
      if (host === 'vercel.com' || host.endsWith('.vercel.com')) return true;
    } catch {
      /* fall through to body check */
    }
  }
  return typeof body === 'string' && /Protected Deployment|Log in to Vercel/i.test(body);
}

function isAppHtml(body, marker) {
  return typeof body === 'string' && body.includes(marker) && !/Log in to Vercel/i.test(body);
}

async function probe(fetchImpl, url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    const body = response.status === 200 ? await response.text() : '';
    return { status: response.status, location: response.headers.get('location') ?? '', body };
  } finally {
    clearTimeout(timer);
  }
}

async function probePost(fetchImpl, url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
      redirect: 'manual',
      signal: controller.signal,
    });
    return { status: response.status, location: response.headers.get('location') ?? '', body: '' };
  } finally {
    clearTimeout(timer);
  }
}

const CHECKS = [
  {
    id: 'login_page',
    needsSecret: true,
    async run(ctx) {
      const r = await probe(ctx.fetchImpl, `${ctx.base}/login`, ctx.bypass);
      return r.status === 200 && isAppHtml(r.body, 'name="password"')
        ? 'pass'
        : 'fail';
    },
  },
  {
    id: 'signup_page',
    needsSecret: true,
    async run(ctx) {
      const r = await probe(ctx.fetchImpl, `${ctx.base}/signup`, ctx.bypass);
      return r.status === 200 && isAppHtml(r.body, 'name="restaurantName"')
        ? 'pass'
        : 'fail';
    },
  },
  {
    id: 'reset_page',
    needsSecret: true,
    async run(ctx) {
      const r = await probe(ctx.fetchImpl, `${ctx.base}/forgot-password`, ctx.bypass);
      return r.status === 200 && isAppHtml(r.body, 'name="email"') ? 'pass' : 'fail';
    },
  },
  {
    id: 'app_auth_intact',
    needsSecret: true,
    async run(ctx) {
      const r = await probe(ctx.fetchImpl, `${ctx.base}/dashboard`, ctx.bypass);
      if (r.status < 300 || r.status >= 400) return 'fail';
      try {
        return new URL(r.location, ctx.base).pathname.startsWith('/login') ? 'pass' : 'fail';
      } catch {
        return 'fail';
      }
    },
  },
  {
    id: 'pending_page',
    needsSecret: true,
    async run(ctx) {
      const r = await probe(ctx.fetchImpl, `${ctx.base}/signup/confirmation-pending`, ctx.bypass);
      return r.status === 200 && isAppHtml(r.body, 'name="email"') ? 'pass' : 'fail';
    },
  },
  {
    id: 'webhook_app_auth',
    needsSecret: true,
    async run(ctx) {
      const r = await probePost(ctx.fetchImpl, `${ctx.base}/api/email/brevo/webhook`, ctx.bypass);
      return r.status === 401 ? 'pass' : 'fail';
    },
  },
];

export async function runChecks({ baseUrl, secret, fetchImpl = fetch }) {
  const base = redactUrl(baseUrl).replace(/\/$/, '');
  const results = [];
  const record = (check, result, detail) => {
    const line = { check, result, detail };
    results.push(line);
    return line;
  };

  // Posture first: if the edge lets anonymous traffic through, nothing
  // else matters and the full checks would be testing a public site.
  try {
    const anon = await probe(fetchImpl, `${base}/login`, {});
    record(
      'protection_on',
      anon.status !== 200 && isVercelSso(anon.location, anon.body) ? 'pass' : 'fail',
      anon.status !== 200 && isVercelSso(anon.location, anon.body)
        ? 'anonymous request is stopped at Vercel SSO'
        : 'anonymous request reached the app or an unexpected response',
    );
  } catch {
    record('protection_on', 'blocked', 'deployment unreachable');
  }

  try {
    const wrong = await probe(fetchImpl, `${base}/login`, {
      'x-vercel-protection-bypass': 'autodine-deliberately-wrong-value',
    });
    record(
      'fail_closed',
      wrong.status !== 200 && isVercelSso(wrong.location, wrong.body) ? 'pass' : 'fail',
      wrong.status !== 200 && isVercelSso(wrong.location, wrong.body)
        ? 'wrong bypass value is refused at the edge'
        : 'wrong bypass value reached the app or an unexpected response',
    );
  } catch {
    record('fail_closed', 'blocked', 'deployment unreachable');
  }

  const bypass = secret ? { 'x-vercel-protection-bypass': secret } : null;
  for (const check of CHECKS) {
    if (!bypass) {
      record(check.id, 'blocked', 'VERCEL_AUTOMATION_BYPASS_SECRET is not set');
      continue;
    }
    try {
      const outcome = await check.run({ fetchImpl, base, bypass });
      record(check.id, outcome, outcome === 'pass' ? 'ok' : 'unexpected response through bypass');
    } catch {
      record(check.id, 'blocked', 'request failed or timed out');
    }
  }
  return results;
}

export function exitCodeFor(results, { postureOnly = false } = {}) {
  if (results.some((r) => r.result === 'fail')) return 1;
  if (!postureOnly && results.some((r) => r.result === 'blocked')) return 2;
  if (postureOnly && results.filter((r) => r.check === 'protection_on' || r.check === 'fail_closed').some((r) => r.result !== 'pass')) return 2;
  return 0;
}

async function main(argv) {
  const postureOnly = argv.includes('--posture');
  const validation = validatePreviewUrl(process.env.PREVIEW_URL ?? '');
  if (!validation.ok) {
    // Fixed reason vocabulary only — the rejected value is never echoed.
    console.log(JSON.stringify({ check: 'config', result: 'blocked', detail: `PREVIEW_URL rejected: ${validation.reason}` }));
    console.warn(`[autodine:alert] ${JSON.stringify({ event: 'incident_opened', kind: 'preview_check_blocked', severity: 'warning', summary: `Preview checks blocked: PREVIEW_URL rejected (${validation.reason})` })}`);
    return 2;
  }
  const baseUrl = validation.origin;
  const results = await runChecks({
    baseUrl,
    secret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '',
  });
  for (const line of results) console.log(JSON.stringify(line));
  const code = exitCodeFor(results, { postureOnly });
  const failed = results.filter((r) => r.result === 'fail').map((r) => r.check);
  const blocked = results.filter((r) => r.result === 'blocked').map((r) => r.check);
  if (code === 1) {
    console.warn(`[autodine:alert] ${JSON.stringify({ event: 'incident_opened', kind: 'preview_check_failed', severity: 'warning', summary: `Preview checks failed: ${failed.join(', ')}` })}`);
  } else if (code === 2) {
    console.warn(`[autodine:alert] ${JSON.stringify({ event: 'incident_opened', kind: 'preview_check_blocked', severity: 'warning', summary: `Preview checks blocked: ${blocked.join(', ')}` })}`);
  } else {
    console.log(JSON.stringify({ check: 'summary', result: 'pass', detail: postureOnly ? 'posture only' : 'all checks' }));
  }
  return code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    () => process.exit(2),
  );
}
