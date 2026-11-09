# Network-enabled staging browser runner

This workflow is separate from demo browser CI. Missing secrets **fail setup**, not pass as an all-skipped test run. It is restricted to the approved staging URL/project and runs serially. Production configuration is not used or changed.

## Owner setup required (current integration returns Actions-secrets HTTP 403)

In GitHub repository **Settings → Secrets and variables → Actions**, configure:

- `AUTODINE_STAGING_SERVICE_ROLE_KEY`: server-only service-role/secret API key from **autodinetest**, ref `juwyhslzchjevqkdvwjm`. Never use a production key.
- `AUTODINE_STAGING_SHARE_URL`: authorized shareable link for the approved staging branch preview. Keep its token out of code, workflow inputs, chat replies and artifacts.

Alternatively grant the Arena GitHub connection repository Actions-secrets permission, then the agent can configure them securely. Do not provide GitHub passwords/PATs/2FA codes in chat. A permission 403 is not fixed by merely approving an action in chat.

The new workflow initially runs when its runner files are pushed to the session branch. Once registered on the repository default branch it can also be dispatched manually; do not merge/deploy production just to make dispatch available. On this branch, a reviewed runner-file update triggers the push workflow after secrets are configured.

## What the workflow does

1. Requires both secrets before network access or fixture writes.
2. Creates a uniquely named synthetic owner using Supabase Admin Auth, confirmed **only for this new test user**, without sending email or disabling normal email confirmation.
3. Creates only a new synthetic profile/tenant/menu/item/table/QR namespace, with zero tax for the fixture. Verifies real Auth password sign-in and retrieves that restaurant's on-site code.
4. Establishes authorized Vercel share access in Chromium with no tracing/screenshots, validates health and stores private access state locally.
5. Runs guest/kitchen/cashier/security integration suites against the approved hosted preview. This is not a certification of email delivery, all staff roles, invites, discounts, provider payments, GST, 5k capacity or real printers.
6. Keeps credentials/cookies/raw results in ignored `.staging-private/`; no raw artifacts uploaded. GitHub secret masking also covers generated credentials and guest QR/code values.
7. Prints aggregate result counts. A zero-pass/all-skipped result fails. Existing optional skips must still be reported honestly.

Fixture manifest is local to the ephemeral runner. This version deliberately **retains synthetic fixtures** for failure inspection; no blanket tenant reset/delete is attempted. Issued invoices have immutable financial sources/foreign-key restrictions, so automatic destructive cleanup would require separately reviewed, ID-scoped staging maintenance. Do not widen financial table permissions for cleanup. The runner prints only synthetic run/tenant UUIDs as `STAGING_FIXTURE_IDS` for later ID-scoped cleanup; no credentials or QR tokens accompany that line. No paid service keys are passed to this runner.

## Local preparation evidence, not hosted E2E success

Typecheck/lint and negative guard tests can run without credentials. The actual hosted run is blocked until repository secrets are available. No new Auth users or persistent tenant fixtures are created by a failed missing-secret preflight.
