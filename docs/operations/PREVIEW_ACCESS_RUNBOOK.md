# AutoDine — Permanent Preview Access Workflow (no more approval requests)

**Decision (2026-11-18):** Deployment Protection stays **ON**. Humans use
the stable branch-alias URL while signed in to Vercel as the team owner.
Automation uses the project's **Protection Bypass for Automation** header.
Nobody approves external-collaborator requests for tooling anymore.

## Why the approval requests kept recurring

Verified against Vercel's official documentation (2026-11-18):

- With Vercel Authentication on, a visitor who is not authorized hits a
  Vercel login and may **request access**. A grant lets that account view
  the *latest deployment of one branch* — every new branch starts the
  cycle again, and an Arena session that opens a fresh per-deployment
  URL from a non-owner identity re-triggers it.
- **Hobby allows only ONE external user per account, ever.** Approving
  collaborators for agents/CI is therefore mathematically unsustainable.
- Password Protection is **not available on Hobby** (Pro add-on), and
  Trusted IPs is **Enterprise-only**. There is no paid fix to buy here,
  and none is needed.
- **Shareable Links** are per-deployment and Hobby allows one per
  account — useful for a one-off share, not a testing workflow.
- **Protection Bypass for Automation** is available on **all plans**: a
  project secret sent as the `x-vercel-protection-bypass` header skips
  the SSO challenge for tools only. Protection stays on for everyone
  else. Multiple named secrets per project are supported, so each tool
  can hold a revocable credential of its own.

## The permanent workflow

### Humans (owner)

1. Always open the **branch-alias URL** you bookmarked
   (e.g. `https://new-git-<branch>-iamjarvis9896-3988s-projects.vercel.app`),
   not per-commit deployment URLs from PR comments.
2. Stay signed in to Vercel in that browser with the **team-owner**
   account. SSO then passes silently for every deployment, forever —
   no request, no approval, no seat consumed.
3. If a browser shows "request access", you are signed in with the
   wrong Vercel identity (or signed out). Switch to the owner account;
   do not approve the request.

### Automation (Arena, CI, scripts)

1. The secret travels **only as a header**, from an environment
   variable: `VERCEL_AUTOMATION_BYPASS_SECRET`. Never in a URL (the
   query-parameter form is reserved for webhook senders that cannot set
   headers — Brevo — and is never used for browsing or tests), never in
   code, never in chat.
2. Browser tests also send `x-vercel-set-bypass-cookie: true` so the
   bypass becomes a session cookie and multi-page flows (Supabase Auth
   redirects, emailed-link callbacks) stay authorized.
3. Entry points in this repo:
   - `node scripts/preview/check-preview.mjs` — HTTP checks (posture +
     app surfaces). `PREVIEW_URL` + secret via env; `--posture` needs
     no secret and proves the edge is still closed.
   - `npx playwright test --config playwright.preview.config.ts` —
     browser flows: anonymous refusal, login→workspace, signup→
     confirmation-pending + unconfirmed sign-in refusal, password-reset
     request + bogus-callback safety, staff invitation link.
   - GitHub Actions → **Preview checks** (manual dispatch) — runs both,
     with secrets from Actions secrets. Manual-only by design (it
     creates a throwaway signup/invitation on the test project).

### One-time setup (owner, ~5 minutes, never recurring)

1. Vercel → project **new** → Settings → Deployment Protection →
   Protection Bypass for Automation: confirm one secret exists (it
   does — created for the Brevo webhook). Optionally add a second,
   dedicated secret named `preview-automation` so test tooling can be
   revoked without touching the webhook credential.
2. GitHub → repo Settings → Secrets and variables → Actions, add:
   - `VERCEL_AUTOMATION_BYPASS_SECRET` — the bypass secret value
   - `PREVIEW_TEST_EMAIL` / `PREVIEW_TEST_PASSWORD` — the confirmed
     throwaway owner account on `autodinetest` (the one whose
     confirmation was verified 2026-11-18)
3. Leave every existing collaborator/grant exactly as it is; nothing
   needs removing for this workflow to function.

### Rotation / revocation

- Regenerate or delete a bypass secret in the same Vercel panel; update
  the Actions secret to match. Note Vercel's rule: regenerating
  invalidates the value baked into previous deployments' system env —
  redeploy before relying on `VERCEL_AUTOMATION_BYPASS_SECRET` inside
  the app (our external checks read it from Actions, so they are
  unaffected).
- A leaked bypass secret is **not** an app compromise: it passes only
  the Vercel edge. App login, Supabase Auth, and RLS still apply — the
  checks prove this (`app_auth_intact`). Rotate anyway.

## Failure signals (no secrets, no personal data)

- Checker output is fixed-vocabulary JSON per check
  (`pass`/`fail`/`blocked`) plus one `[autodine:alert]` line
  (`preview_check_failed` / `preview_check_blocked`) on non-zero exit.
  Exit 1 = something is broken; exit 2 = not configured/unreachable.
- `protection_on` failing means Deployment Protection is OFF — treat
  as a security incident, re-enable before anything else.
- In-app mail failures remain operator incidents from the app itself
  (see BREVO_EMAIL_RUNBOOK §6).

## What must never happen

- Disabling Deployment Protection (any scope) without the owner's
  explicit approval — "Standard Protection with production public" is
  the current posture and Production behaviour is unchanged.
- Approving external-user access requests for automation, or adding
  collaborators to solve a testing problem.
- Pasting the bypass secret into a URL, a doc, a ticket, or chat.
- Using Production URLs or the production Supabase project for any of
  these checks. Preview + `autodinetest` only.
