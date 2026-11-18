# One-Time Setup — Dedicated Preview Test Account + Actions Secrets

Do this once. After it, Preview testing needs no approvals and no
recurring setup. **Never paste any secret value into chat, email,
tickets, or this repository.** Values go only from their source
(Vercel dashboard / your password manager) into GitHub's secret fields.

## Principles

- The test account is **dedicated and synthetic**: not your personal
  mailbox, not used for anything except Preview checks, owning only
  throwaway data on the test project (`autodinetest`).
- Personal-account credentials must never be placed in CI. If a
  personal credential was ever used this way, rotate it.

## Step 1 — Dedicated mailbox (owner, ~3 min)

Create or designate an owner-controlled mailbox that is **not** your
personal inbox — e.g. a separate free mailbox named for this purpose
(`autodine-preview-checks@…`). A plus-addressed alias of a
*non-personal* inbox is acceptable; a separate mailbox is better
because its password can be rotated independently.

## Step 2 — Create the test account on Preview (~5 min)

1. In the browser where you are signed in to Vercel as team owner,
   open the branch alias and sign in if the app asks:
   `https://new-git-arena-2670dd12-autodine-iamjarvis9896-3988s-projects.vercel.app/signup`
2. Sign up with the Step-1 mailbox:
   - Name: `Preview Checks` · Restaurant: `AutoDine Preview Test`
   - Password: generate a unique one in your password manager and
     save it there immediately (never reuse a personal password).
   - Tick the preview-data acknowledgement, submit.
3. Open the confirmation email in that mailbox (check Spam — the
   domainless sender lands there until domain authentication, B7),
   click the link **in the same browser**, and confirm you land on
   the dashboard.
4. Sign out and sign back in once, to prove the credentials work.

## Step 3 — Store the three Actions secrets (~4 min)

GitHub → `aryanp685/autodine` → **Settings → Secrets and variables →
Actions → New repository secret**, three times, with these exact
names (names are not secret — you may confirm names to the agent;
values, never):

| Name | Value source |
| --- | --- |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel → project **new** → Settings → Deployment Protection → Protection Bypass for Automation. Recommended: click **Add** and create a dedicated secret named `preview-automation` so test tooling can be revoked without touching the Brevo-webhook secret; paste its value here. |
| `PREVIEW_TEST_EMAIL` | The Step-1 mailbox address. |
| `PREVIEW_TEST_PASSWORD` | The password saved in your password manager in Step 2. |

## Step 4 — First run (after PR #191 merge)

GitHub → **Actions → Preview checks → Run workflow** (leave the
default Preview URL). Expected: HTTP checks pass, then 6 browser
tests run (anonymous refusal, login→workspace, signup→pending,
reset safety ×2, invitation link). A green run proves the whole
chain with zero collaborator approvals.

Reading failures:
- Tests **skipped** → a `PREVIEW_TEST_*` secret is missing/misnamed.
- Checker **blocked (exit 2)** with a reason like `production_alias`
  → the URL guard did its job; use the branch alias.
- **Sign-in failed** → account unconfirmed or password mismatch;
  use the Preview forgot-password flow for that mailbox, then update
  the `PREVIEW_TEST_PASSWORD` secret.

## Rotation & incidents

- Test-account password: change via Preview forgot-password, then
  update the Actions secret. Do this if the password was ever shared.
- Bypass secret: regenerate/delete it in the same Vercel panel, then
  update `VERCEL_AUTOMATION_BYPASS_SECRET`. Note: values baked into
  old deployments' system env are invalidated — the checks read the
  secret from Actions, so they keep working.
- A leaked bypass secret passes only the Vercel edge, not the app
  login (the checker proves this on every run) — rotate anyway.

## Hygiene

Each full run leaves small synthetic residue on `autodinetest`
(timestamped `@example.test` signups/invitations; invitations
self-expire). Purge periodically if desired. Never run the suite
against any other project or the Production URL — the URL guard
will refuse, by design.
