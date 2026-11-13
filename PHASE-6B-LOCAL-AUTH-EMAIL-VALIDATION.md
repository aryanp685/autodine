# Phase 6B — Local Supabase Auth and Mailpit validation

**Evidence date:** 2026-11-06 UTC
**Branch / base:** `arena/3878e9b8-autodine` / `e13720652440fc69280caa09e2e60bc151288426`
**Status:** **BLOCKED — no local Supabase or Mailpit integration was run.**
**Scope:** Local repository/configuration inspection and locally runnable unit/static/build verification only. This report is not hosted Staging or Production evidence.

## Executive result

Supabase CLI **3.1.0** is available through `npx`, but this environment has no Docker, Podman, or Nerdctl runtime. `npx supabase start` and `npx supabase status` both stop before starting or inspecting services with:

> `failed to inspect container health: docker: command not found (podman also not found) — install Docker Desktop or Podman and ensure it is on PATH`

No local Supabase service, Auth, PostgreSQL, or Mailpit inbox was available. Therefore owner registration/confirmation, real email capture, PKCE verifier-cookie behavior in a browser, recovery/password-update lifecycle, staff acceptance through Auth, and Auth-service rate limits were **not** tested end to end. No runtime results are inferred from unit tests.

The local Auth configuration retains email confirmation. A source-level recovery-permission gap was also fixed: an untrusted `flow=recovery` or `next=/reset-password` query can no longer grant password-reset permission to a PKCE callback. A recovery request now carries a random state matched against a short-lived HTTP-only cookie, and focused tests cover the request and callback behavior.

## Scope and safety

- Only repository source, local Supabase configuration, existing local E2E setup, and local tests/checks were examined.
- No hosted Supabase project/config/database, provider account, SMTP credential, DNS, or hosted email was accessed or changed. No hosted connector call was made for Auth settings.
- No migrations were run. The disposable local stack could not start, and the current instruction also disallows migrations.
- No email was sent outside a local inbox; in fact, Mailpit did not start and received no messages.
- No user/staff account was created or deleted; no cleanup policy was invented. No customer or operator was contacted.
- No provider was selected, no CAPTCHA provider/secret was chosen or created, and no public-signup protection was weakened.
- Staging remains **NO-GO**. Production remains **read-only**.

## Local configuration and harness inspection

`supabase/config.toml` currently specifies:

| Setting | Local value / finding | Interpretation |
|---|---|---|
| Project ID | `autodine` | Local CLI project identity only |
| API / database / Studio ports | `54321` / `54322` / `54323` | Local stack ports; no service was listening |
| Auth Site URL | `http://localhost:3000` | Local only |
| Redirect allowlist | `http://localhost:3000/**`, `http://localhost:3100/**`, `http://127.0.0.1:3100/**` | Local development/test redirects only |
| Signup | `enable_signup = true`; `[auth.email] enable_signup = true` | Local test capability, not permission to expose hosted public signup |
| Email confirmation | `[auth.email] enable_confirmations = true` | Preserves confirmation for a future local Auth test; a config unit test pins this |
| DB migrations / seed | Both disabled in local CLI config | Stack startup would not auto-run the repository fixture chain through these settings |
| Email templates / CAPTCHA | No repository template files or CAPTCHA provider/token wiring found | Default local Auth templates and inbox behavior were not exercised; no CAPTCHA is configured by this repo |
| Mailpit | Not explicitly configured in this file; the Supabase CLI local stack normally provides its local mail catcher (port `54324`) | Not started or verified in this environment |

`docs/e2e-local.md` documents the full-stack local workflow and explicitly notes this sandbox lacks a container runtime. `scripts/e2e/prepare-local-supabase.mjs` has loopback URL checks, expects the local database on port `54322`, applies the checked-in migration chain plus an inferred local-only scaffold, and creates synthetic **already-confirmed** Auth fixture users through the local Admin API. That fixture preparer is not an owner-registration/confirmation test, does not validate email delivery, and was not run. It must not be pointed at a hosted project.

## Auth flow assessment and evidence

| Scenario | Source-level finding / local test evidence | Phase 6B integration disposition |
|---|---|---|
| Owner registration | `app/auth/actions.ts` validates input and password, calls `auth.signUp()` with `/auth/confirm?next=/dashboard`, then creates a profile and account/restaurant workspace through the server-side admin/RPC path. With no Auth session it directs the owner to confirm before signing in. An enumeration-protected existing email is handled without creating a second workspace. | **Not run** against local Auth/DB; no owner identity, confirmation message, or account state was observed. |
| Confirmation and account state | Confirmation uses the Auth PKCE code exchange; local confirmation is enabled in config. The workspace write precedes email confirmation, so abandoned unconfirmed signups may leave an unconfirmed Auth user and workspace. The reviewed app has no resend-confirmation action or automatic cleanup policy. | **Not run.** No test account was created. Do not infer lifecycle behavior from the source path alone. |
| PKCE callback/session | Callback code exchange and safe same-origin invitation destination have unit coverage. The real verifier cookie/session cookie round trip requires the browser that requested the link. | Unit coverage only; browser and Mailpit **not run**. |
| Password recovery | Recovery requests keep account-existence responses generic and map Auth rate-limit errors to a site-level message. The callback forces a verified token-hash recovery to `/reset-password`; the recovery permission is HTTP-only and lasts 15 minutes. Saving a password requires the recovery permission and a user session, consumes the permission, and signs out. | Request/route unit coverage only; no recovery email, expiry/replay, password update, or sign-out was exercised against Auth. |
| Recovery PKCE state | The request now adds a random 32-byte base64url state to its callback URL and stores the matching value in an HTTP-only, `SameSite=Lax` cookie for up to one hour. A PKCE recovery code must arrive with that matching state and is exchanged before the 15-minute reset permission is issued. Multiple pending requests in the same browser reuse a valid state; it is cleared after a successful recovery callback. | Unit tested; Supabase email-template/query preservation and browser cookie behavior remain **unverified**. |
| Invited staff | `app/(staff)/dashboard/settings/team-actions.ts` creates a single-use invitation. `PeoplePanel` says no email is sent; the owner manually copies/shares the link. `app/join/actions.ts` applies an IP attempt budget, handles enumeration-protected existing accounts, and returns safe failure/rate-limit messages. | Existing action tests cover safe rejection/rate-limit behavior; invited-account confirmation and one-use redemption were **not** run against local Auth. Staff invitations must not be described as SMTP email. |
| Failure/abuse responses | New unit coverage checks the recovery action's 429 message and ensures a failed/rate-limited request does not persist correlation state. Existing join tests check that a rate-limited invitation attempt stops before redemption and that raw DB errors are not exposed. | Auth-service 429s, invalid/expired/replayed email links, provider rejects, and quota exhaustion were **not** exercised. |
| CAPTCHA / public-signup readiness | No CAPTCHA UI or token forwarding is wired in the reviewed signup/recovery calls. Prior Supabase CAPTCHA documentation notes referenced hCaptcha and Cloudflare Turnstile, but those pages were not revalidated against this report's evidence date. Verify currently supported choices before any decision; an approved integration would require owner selection, app token wiring, project-side secret/configuration, and failure/expiry tests. | No provider or secret selected/generated. Do **not** broadly enable hosted public signup/reset email sending without an approved abuse-protection plan. |

## Focused source correction

The previous callback inferred recovery authority from URL hints (`flow=recovery` or `next=/reset-password`). Those values are caller-controlled; a PKCE email-confirmation code is not itself proof that the code was issued for password recovery. The callback could therefore set the recovery permission after a successful code exchange without correlating the request to a reset flow.

The fix in `app/auth/actions.ts`, `app/auth/confirm/route.ts`, and `lib/password.ts` uses a random state correlated to an HTTP-only browser cookie for PKCE recovery. It does not treat `next` as recovery proof. Token-hash recovery still requires successful `verifyOtp(..., type: 'recovery')`. Focused regression tests cover forged recovery query parameters, a reset-page `next` without permission, matching/missing PKCE state, verified token-hash recovery, a safe 429 response, and state reuse. This is a source/unit-test correction, **not** a defect reproduced against a running Supabase Auth service.

## Verification run in this workspace

| Command / check | Result | Scope limit |
|---|---|---|
| `npm ci` | Passed; 350 packages installed, npm reported 0 vulnerabilities during install | Dependency installation only |
| Focused Auth/invite tests | **11 files passed; 71 tests passed** | Mocked/local unit behavior, not Auth service integration |
| `npm test -- --reporter=dot` | **185 files passed, 4 skipped; 2,127 passed, 122 skipped** | Skips are not passes; no Mailpit/browser Auth proof |
| `npm run typecheck` | Passed | Static type checking |
| `npm run lint` | Passed | Static linting |
| `npm run design:check` | Passed | Design-system constraints only |
| `npm run sql:check` | Passed | Static DDL parser only; migrations were not executed and function bodies/RLS semantics are outside its validation |
| `GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test npm run build` | Passed | Hermetic CI/demo-guarded build; no deployment or Auth connection |
| `npx --yes supabase --version` | `3.1.0` | CLI executable only |
| `npx supabase start` / `npx supabase status` | Failed before service startup/status because Docker and Podman were absent | No local Supabase or Mailpit evidence |
| Full Supabase browser E2E, real Auth, Mailpit, migration replay | Not run | Container runtime unavailable; migration replay was not authorized/run |

## Safe follow-up setup — only on an isolated local machine

1. Provide a local Docker Desktop or Podman runtime and verify it is a local engine, not a remote context. Do not add hosted Supabase URLs or credentials.
2. From this repository root, start only the configured local stack with `npx supabase start`; inspect its local-only service status without pasting any returned keys into chat, issues, or artifacts. Confirm the local Auth API, database, and mail catcher are healthy before proceeding. Mailpit is normally at `http://127.0.0.1:54324` for this CLI setup.
3. Keep app environment values process-local and sourced only from this disposable stack: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or local anon key), and server-only `SUPABASE_SECRET_KEY` (or local service-role key). Never put a secret key in a `NEXT_PUBLIC_*` variable.
4. **Migration gate:** the repository's local config disables automatic migration/seed application, while the existing fixture preparer replays 60 checked-in migrations plus a local-only scaffold. Because this task's standing instruction says no migrations, do not run that preparer or any DB reset/replay unless the user separately authorizes a disposable local-only migration run. The full app-level owner/workspace tests cannot pass without the required local schema.
5. Once both the container runtime and any required local-only migration authorization are in place, use synthetic identities and direct local Auth mail to Mailpit. The existing `prepare-local-supabase.mjs` / full-stack E2E fixture path seeds already-confirmed users and does not cover owner registration plus the complete recovery lifecycle, so it is **not** sufficient evidence for these cases. A purpose-built, separately reviewed Phase 6B browser/manual harness is still needed. Verify owner signup → confirmation → login, duplicate/unconfirmed behavior, recovery request → same-browser PKCE → password update → sign-out, staff signup/confirmation/manual invite acceptance, invalid/expired/replayed links, and Auth 429/failure responses. Capture only redacted counts; do not automatically delete accounts or invent a lifecycle cleanup policy.
6. Stop and discard only the disposable local stack/volume after retaining non-secret aggregate test evidence. Do not use a hosted project as a fallback.

## Remaining gates

- Local Auth/Mailpit integration and browser PKCE/account lifecycle evidence remain **OPEN / NOT RUN** until an isolated container runtime is available (and local migration replay is authorized if needed).
- Hosted SMTP provider, sender identity/DNS, templates, redirect allowlist, quotas, and CAPTCHA configuration remain **UNKNOWN**. No hosted Auth settings were read.
- CAPTCHA and abuse protection remain a blocker before broad public signup or reset-email exposure. No provider choice or secret is approved.
- Staging remains **NO-GO**; Production remains **read-only**; overall release/pilot remains **NO-GO**.

The protected `scripts/phase3/staging-baseline.json` SHA-256 was verified as `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`.
