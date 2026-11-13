# SMTP configuration and Auth readiness

**Evidence date:** 2026-11-06 UTC
**Branch / recorded base:** `arena/3878e9b8-autodine` / `e13720652440fc69280caa09e2e60bc151288426`
**Current disposition:** **NO-GO** for Staging; Production remains **read-only**. Auth lifecycle hardening has source, unit, static, and guarded-build evidence, but no live Supabase Auth, SMTP, Mailpit, database, browser-confirmation, or email-delivery evidence.

## Executive summary

Phase 6C hardens owner signup/resend against account enumeration and makes signup confirmation use correlated Supabase PKCE flow state. It deliberately does **not** claim that email is configured or deliverable:

- Owner signup and resend return generic confirmation-pending/requested feedback for syntactically valid addresses. This includes Auth/provider errors, missing identities, transport errors, and unavailable Auth. `requested` means only that the server accepted a syntactically valid resend request for generic presentation; it is not evidence of an Auth acceptance or email send.
- Resend logs no address or raw error. Error results, where available, are reduced to status/code-only server diagnostics. Signup failure also has no account-specific client response. No raw provider text is exposed.
- Signup/resend can preserve Supabase's matching PKCE verifier cookie after Auth errors so the browser's cookie shape does not reveal whether Auth found a mail-eligible user. This is a narrow opt-in behavior; ordinary Auth flows retain normal verifier cleanup. The source-level cookie behavior is covered by mocked tests of the installed Supabase SSR/Auth SDK, not by a browser or hosted-project test.
- Signup callback includes the Supabase `sb_flow_id`, and the callback passes it to `exchangeCodeForSession`. The configured hosted Supabase redirect allowlist must support this query parameter safely. Hosted allowlist configuration is unknown.
- The app's local `supabase/config.toml` enables email confirmations for local Auth only. It does not establish the hosted project's confirmation setting, SMTP provider, sender identity, templates, redirect allowlist, CAPTCHA, or limits.
- No hosted settings or secrets were read or changed. No provider/vendor was selected, no email was sent, and no DNS or SMTP change was made.
- A separate source-only write-gate audit found a P0 Staging blocker: authenticated owner/manager table updates can likely change nullable `restaurants.account_id`, allowing a restaurant to detach from or remap its billing entitlement. No migration/policy fix was added in Phase 6C; require a forward-only guard and disposable-DB/PostgREST test before Staging.

## Confirmed local implementation

### Owner signup

- Validates and normalizes email and derives a fixed callback at `/auth/confirm?flow=signup&next=/dashboard`; no caller-controlled destination is used.
- Allows HTTPS request origins (and HTTP loopback for development) and rejects credentials, paths, queries, and fragments in the candidate origin. The host/proxy source itself still needs to be trusted in deployment.
- Enables Supabase Auth's `appendPkceFlowIdToRedirects` option. The server cookie adapter persists a verifier per flow; the callback selects the matching `sb_flow_id` verifier when present.
- A new Auth identity still provisions `profiles` and the workspace/trial before confirmation. The action then routes to the pending confirmation page because there is no active session. A duplicate/identity-less Auth response, Auth error, missing ID, or thrown error routes to the same pending page without provisioning a workspace.
- A genuinely new owner workspace can therefore be created before the user verifies email. It claims/starts the existing 21-day account trial and reserves its globally unique restaurant slug. No lifecycle policy or cleanup was added.

### Resend and user feedback

- Calls `supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo } })` using the same fixed callback policy.
- Only invalid email syntax returns `invalid`; all valid addresses return `requested`, including provider/Auth rejection, Auth throttling, missing configuration/client, and transport exceptions.
- The UI identifies the outcome as unconfirmed, advises inbox/spam checks and same-browser link use, suggests a cooldown before retry, and offers sign-in. It does not say “sent” or confirm account existence.
- There is no client-side timer or independent resend limiter. Auth rate limits are expected to enforce the send policy; hosted values are not known.

### PKCE verifier consistency

The installed `@supabase/ssr` adapter applies Auth SDK `-code-verifier` cookie writes immediately. The Auth SDK's enumeration-sensitive error responses can therefore clear the verifier for a not-eligible user. The server adapter now has a narrow opt-in to suppress only verifier deletions (empty value plus `maxAge: 0`) for owner signup and resend; it does not suppress other cookie updates. Tests verify (a) ordinary Auth errors still remove the verifier and (b) a mocked resend 429 retains a uniform verifier cookie. This is a local SDK-level unit result only. It does not prove hosted provider behavior, cookie persistence through a real browser, cross-device confirmation, or successful exchange against the deployed redirect allowlist.

### Callback behavior and retained recovery safeguards

- Signup confirmation success routes to the fixed dashboard destination and clears the pending-email display cookie; failure/expired/reused links return generic pending-confirmation guidance.
- The callback matches `sb_flow_id` to the PKCE verifier. If the parameter is absent, existing callback compatibility behavior remains; actual hosted behavior must be validated before release.
- Recovery remains separate: the callback's random recovery state-cookie match, typed recovery verification/exchange, recovery-only reset permission, expiry, redirect safeguards, and sign-out handling are retained. No recovery or sign-in behavior was replaced with the signup flow.

## Provider and configuration requirements — not verified

The checklist below is **not** confirmation of current hosted settings. Values must be inspected and evidence recorded by an authorized project owner before Staging can be considered.

| Requirement | Needed evidence | Current status |
|---|---|---|
| Hosted email confirmation | Inspect Auth provider configuration and signup/confirmation policy | **Unknown; not inspected** |
| SMTP provider and sender | Authorized project inspection; verified sender/domain and delivery tests | **Unknown; not inspected** |
| Confirmation template | Verify token/action URL, correct app origin, `/auth/confirm`, and supported PKCE `sb_flow_id` query parameter; test the exact sent message | **Unknown; no hosted message/test** |
| Redirect allowlist | Exact production/staging callback origins and paths; permit required Auth callback query parameters using the narrowest viable entries | **Unknown; not inspected** |
| Email sending and OTP limits | Inspect project Auth rate limits and record effective values; test throttling without exposing account state | **Unknown; not inspected** |
| CAPTCHA/abuse controls | Choose a supported provider, authorize and configure its secret, add UI token generation/forwarding, and test fail-closed behavior | **Not implemented/configured** |
| Sender-domain authentication | Validate SPF, DKIM, DMARC, bounce/complaint handling with authorized DNS/mail owners | **No DNS or mail-provider evidence** |
| Browser PKCE round trip | Two independent pending signups in a real browser; verify correct flow IDs/verifiers, same-browser confirmation, expired/reused link, and safe destination | **Not run** |
| End-to-end delivery | Authorized test accounts and mailbox access; verify message arrival, spam placement, link, expiry, and resend behavior | **Not run** |

Supabase documents CAPTCHA through supported hCaptcha or Cloudflare Turnstile integrations, requiring a challenge token in Auth calls and corresponding Auth dashboard configuration. Supabase also documents configurable Auth rate limits, including email sending/OTP limits and 429 throttling. These documentation facts do not reveal AutoDine's hosted values. References: [CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [email passwordless/OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless).

An upstream source inspection of Supabase Auth `master` found resend returns HTTP 200 with an empty object for unknown or already-confirmed users, which supports the application's neutral response design. This is not evidence for the hosted deployment's exact Auth version or its provider delivery behavior.

## Staff invitations (SMTP scope)

Staff invitations are **not emailed**. The authorized owner manually shares a single-use invite link. The database stores a hash of the invite code, applies a seven-day default and 1–30 day expiry clamp, rejects owner-role invitations, and checks expiry, revocation, use, and membership in the redemption RPC. Staff Auth confirmation remains a separate email path and returns to the invitation before authenticated redemption. No invitation behavior or email provider was changed in Phase 6C. These are source/migration observations, not a live database replay.

## Workspace write-gate audit — source only

This audit inspected the ordered migration sources, application write calls, RLS policies, and the account-level entitlement functions. It did not replay SQL or simulate a PostgREST request.

- The latest `account_can_write` in `20261110001100_subscription_billing.sql` evaluates the subscription period/status; linked restaurants delegate to it through `restaurant_can_write`. The account write result does not incorporate `restaurants.is_active`. The legacy unlinked branch does check `is_active` and the restaurant's legacy plan/trial columns.
- This separates **billing entitlement** from **storefront availability**: public menu/item reads and guest order/session admission check active state separately. A closed but currently entitled account can still permit staff edits. Owner/manager settings and branding repair paths intentionally remain writable after billing expiry; ordinary menu, table/QR, invite, order, payment and session writes use the subscription gate in RLS or RPCs. “Read-only” is therefore not a literal ban on every database write.
- **P0 source-level blocker — mutable subscription association.** `20261021000500_restaurant_settings.sql` grants table-level `UPDATE` on `restaurants` to `authenticated`, and its owner/manager policy checks membership/role but not changed columns. `20261110001000_account_subscriptions.sql` adds nullable `restaurants.account_id` but does not revoke that grant, freeze the link, or add an owner-match constraint. The existing `protect_restaurant_plan` trigger only restores legacy plan/trial fields, not `account_id`; later `20261110000700` revokes writes from `anon` only, and `20261110001220` preserves ordinary DML grants. An authenticated owner/manager can likely set `account_id = NULL` or reassign it to a known account. A null link selects the legacy write-gate branch, potentially bypassing the account entitlement; a changed link also changes account-scoped RLS access. Treat this as a Staging blocker. It needs a forward-only immutable-link hardening change and a disposable-DB/PostgREST regression test; no SQL/policy change was made in Phase 6C.
- The owner-index/trial-claim discrepancy is clarified at source level: `accounts_owner_key` permits only one non-null account row per owner, while `claim_account_trial` gives one grant per profile. `create_account_with_restaurant` inserts before claiming, so an ordinary duplicate attempt fails the unique index rather than producing a no-trial second account. If an account row is removed while the profile/grant remains, a later new account can be created but the existing grant denies another trial. The migration comment is overbroad shorthand; no supported account-deletion flow was found. No historical migration or trial policy was changed.
- `restaurant_can_write(uuid)` retains the earlier migration's `anon`/`PUBLIC` execute privilege: the account migration adds grants but does not revoke it. The public restaurant profile exposes the restaurant UUID, and an existing integration-test expectation says an anon caller may invoke the boolean RPC. It reveals only write eligibility, not the plan or dates, but this exposure should remain only if that public probe is intentional. It was not runtime-tested here.

The account-link finding was not folded into Phase 6C code because this was an Auth lifecycle/source-audit scope and the repository had no supported local database runtime for validating a database authorization change. The release remains **NO-GO** until the link is protected and the effective RLS behavior is tested in an authorized disposable database.

## Validation and evidence limits

- Phase 6C focused tests: **9 files / 65 tests passed**.
- Complete Vitest suite: **188 test files passed, 4 skipped; 2,152 tests passed, 122 skipped**.
- TypeScript typecheck, ESLint, design-system check (hex 5/5, glass 2/2, off-scale fonts 0/0), DDL syntax check, and guarded production/demo build all passed.
- The SQL checker parses DDL syntax only. It does **not** validate PL/pgSQL function bodies, RLS behavior, locks, grants, or migration execution.
- Phase 6B local Supabase startup failed because Docker and Podman were absent; Nerdctl was also unavailable. No privileged daemon was installed/started, and no runtime retry occurred.
- No local/hosted database replay, Supabase Auth, Mailpit, SMTP connection, browser test, hosted setting read, mailbox access, email send, or delivery test was performed.

## Release decision

**Staging: NO-GO. Production: read-only. Overall release: NO-GO.** Source hardening and local verification are necessary but not sufficient. Before Staging, an authorized owner must verify hosted confirmation, SMTP/from-domain, templates, redirect allowlist including `sb_flow_id`, effective rate limits, CAPTCHA/abuse requirements, and at least one real browser/email confirmation path. The Phase 6C workspace audit additionally identified pending signup creating a publicly addressable/active slug and starting the trial before email confirmation; decide a product and billing lifecycle policy before treating that state as acceptable. No implementation recommendation to delete pending workspaces is implied.

Do not use or disclose production provider credentials in this report or chat. Any hosted configuration inspection/change must be separately authorized and recorded.
