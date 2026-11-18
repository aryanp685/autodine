# AUTODINE — PREVIEW ACCESS AUTOMATION (evidence, 2026-11-18)

Owner directive: eliminate recurring Vercel Deployment Protection
approval requests permanently, securely, at zero budget. Do not disable
protection, do not upgrade, do not remove collaborators, do not expose
secrets, do not touch Production.

## Investigation

**Current architecture (metadata-verified, no secret read):**
- Vercel project `new`; branch deployments get stable **branch-alias**
  URLs plus unique per-deployment URLs. Deployment Protection is ON:
  live probe of the Preview alias unauthenticated returns Vercel's SSO
  login ("Protected Deployment – Vercel", sso-api redirect with nonce).
- A Protection Bypass for Automation secret exists (owner-created for
  the Brevo webhook; Brevo's test event returned HTTP 200 through the
  header), and `VERCEL_AUTOMATION_BYPASS_SECRET` appears (name only) in
  deployment build/runtime env. Value never read by the agent.
- App layer behind the edge: Supabase Auth (test project
  `autodinetest`), server-side session checks, RLS. The edge is one of
  two locks; the checker verifies both.

**Plan facts (Vercel official docs, fetched 2026-11-18):**
- Vercel Authentication included on all plans incl. Hobby.
- Access requests: a grant covers the latest deployment of a specific
  branch; **Hobby: only one external user per account**.
  (vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
- Password Protection: Pro add-on, **not available on Hobby**;
  Trusted IPs: Enterprise only.
  (vercel.com/docs/deployment-protection)
- Shareable Links: all plans, but per-deployment and **Hobby limited
  to one link per account**.
  (.../methods-to-bypass-deployment-protection/sharable-links)
- Protection Bypass for Automation: **all plans**, header
  `x-vercel-protection-bypass` (+ `x-vercel-set-bypass-cookie` for
  browser sessions), multiple named secrets per project, official
  Playwright pattern. Also skips bot/system mitigations for that
  request; does NOT bypass DDoS/attack rate limits.
  (.../methods-to-bypass-deployment-protection/protection-bypass-automation)

**Connector limitation (recorded, not worked around):** the Vercel
connector token was denied `get_project`/`get_team` reads (access
denied), so settings were proven behaviourally (live SSO probe +
READY deployment metadata) rather than read from the settings API.
No write to Vercel was made or attempted.

## Implemented (workflow-level, zero cost, protection untouched)

1. `scripts/preview/check-preview.mjs` — HTTP checker. Posture checks
   (anonymous refused at SSO; wrong bypass refused) need no secret;
   full checks via bypass verify login/signup/reset/pending pages,
   `/dashboard` → `/login` app-auth wall, and Brevo webhook app-auth
   401 through the edge bypass. Fixed-vocabulary JSON output, one
   `[autodine:alert]` line on failure, exit 0/1/2 (pass/fail/blocked).
   Secret read from env only; never printed; URLs redacted.
2. `scripts/preview/check-preview.test.mjs` — node:test suite against
   a local stub edge+app: **5/5 pass** (incl. protection-off detection,
   wrong-bypass detection, secret absence → blocked/exit 2, no secret
   in output). CLI blocked-path exercised: exit 2 with alert line.
3. `playwright.preview.config.ts` + `e2e/preview/auth-flows.spec.ts` —
   6 browser tests (anonymous refusal; login→workspace; signup→
   pending + unconfirmed sign-in refusal; reset request +
   bogus-callback safety; bogus confirmation callback; staff
   invitation join link). Official bypass-header config. Verified:
   tests list cleanly, typecheck clean, and **all 6 skip honestly**
   when env is absent (never fake-green). Delivery is never asserted —
   only an inbox proves delivery.
4. `.github/workflows/preview-checks.yml` — manual-dispatch workflow
   (mirrors staging-e2e's fail-closed secrets gate), inputs the alias
   URL, runs checker then browser suite, uploads failure evidence.
   YAML sanity-checked.
5. `docs/operations/PREVIEW_ACCESS_RUNBOOK.md` — the permanent
   workflow: owner-SSO + alias bookmark for humans; header automation
   for tools; one-time Actions-secrets setup; rotation; never-list.

## Not yet done (honest)

- The full live run needs the bypass secret in the runner's env.
  The agent does not hold it and must not read it. Owner one-time
  setup (runbook): add `VERCEL_AUTOMATION_BYPASS_SECRET`,
  `PREVIEW_TEST_EMAIL`, `PREVIEW_TEST_PASSWORD` as Actions secrets,
  then dispatch **Preview checks**. Until then, live evidence is:
  posture proven by SSO probe; bypass proven by Brevo's 200 test
  event; checker logic proven against the stub; browser suite proven
  to discover/typecheck/skip correctly.
- workflow_dispatch becomes available once the workflow file reaches
  the default branch (normal GitHub rule); the current PR carries it.
- Sandbox egress cannot reach *.vercel.app directly, so no live HTTP
  run was possible from here; CI is the intended runner.

## Scope compliance

Preview + `autodinetest` only. Production untouched. No plan change,
no collaborator removed, no Dashboard Protection setting changed, no
secret read/printed/committed.
