# Interim review deployment — 2026-11-11

A hosted, isolated review build of everything completed so far, so the whole
product can be exercised by hand in a browser before anything goes near
production.

This is **not** the commercial launch. No roadmap feature was added, nothing was
merged to `main`, and production was not touched.

---

## 1. Working hosted URL

**`https://new-git-arena-a5344572-autodine-iamjarvis9896-3988s-projects.vercel.app`**

Deployment `dpl_26KPYXmTngdNgrgh3sH5beKyx34Z` — state `READY`, branch alias
assigned, built from branch HEAD `7f2e00e` (the code commit below plus this
document).

> **Action needed before it can be used.** Vercel Deployment Protection is
> enabled on this project, so opening the URL above shows a Vercel login page
> rather than the app. Fetching the URL returns a "Protected Deployment –
> Vercel" page redirecting to `vercel.com/login`.
>
> To open it, do **one** of these in the Vercel dashboard
> (`iamjarvis9896-3988s-projects` → project **new** → Settings → Deployment
> Protection):
> - turn off protection for the **Preview** environment only, or
> - use **Share** on this specific deployment to generate a `_vercel_share` link.
>
> Turn it off for Preview only. Leaving Production protection enabled is
> correct and should not be changed.
>
> I deliberately did **not** change this myself: Deployment Protection is a
> project-level setting, and changing it project-wide would alter production
> configuration, which is out of scope here. The Vercel tooling available to me
> has no deployment-level "share" or "make public" call.

### Sign in as any of four staff roles

All four share the password `Review2026!`.

| Role | Email | Can do |
|---|---|---|
| Owner | `owner@autodine-review.test` | Everything, including billing and subscription |
| Manager | `manager@autodine-review.test` | Menu, tables, staff, reports |
| Kitchen | `kitchen@autodine-review.test` | Kitchen display, KOT progression |
| Cashier | `cashier@autodine-review.test` | Counter, payments, settlement, receipts |

## 2. Release branch and commit

| | |
|---|---|
| Branch | `arena/a5344572-autodine` |
| Branch HEAD (served) | `7f2e00e1d52e602e13382318be5641c8b98d920a` — this document only |
| Code commit | `a8087af0d4e6f0730b2d62cd67e907f60a08bb59` — the release candidate |
| Remote | pushed to `origin/arena/a5344572-autodine` |

`a8087af` is the merge of `origin/main` (PRs #173, #174, #175) into the Phase 0
and subscription work that was already on this branch. Nothing was merged to
`main`.

### Conflicts, resolved deliberately

Three files conflicted; all three were resolved in favour of this branch, with
the reasoning recorded in the merge commit message.

| File | Kept | Why |
|---|---|---|
| `scripts/verify-financial-upgrade.mjs` | ours | superset of the `main` version |
| `scripts/verify-database.mjs` | ours | the `main` version restores the silent-skip version cut-off and drops 55 tests |
| `lib/db/readiness.integration.test.ts` | ours | plus an in-file comment explaining the one superseded group |

The substantive decision: migration `20261110000800_remove_order_submission_caps`
supersedes the per-attempt order budgets PR #174 introduced. Both cannot ship —
the later migration encodes a stated product rule that a legitimate guest order
is never refused for counting. The candidate keeps `000800`; seven tests from
`main` that asserted the removed budgets were not carried over.

## 3. What is included

- **Production baseline** as of `origin/main` at merge time.
- **PR #173** — financial lock ordering, session checkout serialisation,
  concurrency regression gates.
- **PR #172** — implementation carried on this branch.
- **PR #174** — shared Wi-Fi admission and scan limits. *Partially superseded:*
  its per-attempt order budgets are removed by `000800`; its scan admission work
  is retained.
- **PR #175** — guarded baseline runner and native staging reconstruction.
- **Phase 0** security and database hardening.
- **Subscription / Model C** account-level outlet billing: `lib/billing/`,
  `lib/db/subscription-screen.ts`, `components/screens/SubscriptionScreen.tsx`,
  `app/(staff)/dashboard/subscription/`.
- Completed restaurant ordering, kitchen, counter, billing, menu and staff
  functionality.
- One fix made during verification: the subscription UI used `text-[14px]` and
  `text-[12px]`, which are off the sanctioned type scale, so `design:check`
  failed. Remapped to `text-[15px]` and `text-[12.5px]`.

## 4. Staging Supabase project

| | |
|---|---|
| Project | `autodinetest` |
| Ref | `juwyhslzchjevqkdvwjm` |
| Region | `ap-northeast-2` |
| Postgres | 17.11.0.018, `ACTIVE_HEALTHY` |

**`autodine-production` (`bdbaqpevwmgdvghszjno`) was not touched.** The
preview's project-wide environment variables still point at production; the
review deployment overrides them with **branch-scoped** variables scoped to
`arena/a5344572-autodine`:

```
NEXT_PUBLIC_SUPABASE_URL                 -> https://juwyhslzchjevqkdvwjm.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY     -> review project publishable key
SUPABASE_SECRET_KEY                      -> review project service-role key
AUTODINE_EXPECTED_PROJECT_REF            -> juwyhslzchjevqkdvwjm
AUTODINE_ISOLATED_STAGING                -> 1
AUTODINE_MODE                            -> live
```

Overriding `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` by its exact name matters: the
app prefers that name over the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`, so adding
a differently-named variable would have left the production value winning.

**The guard that proves it.** The first deployment of the pushed branch
(`dpl_6AL1QLPAXqpjHep1ToFjkZ3Lfws1`) ran before the overrides existed and
**failed**: `BUILD_UTILS_SPAWN_1`, `npm run build exited with 1`. That is
`assertDeploymentIsolation()` refusing to let a preview build against the
production project. The deployment that follows it, with the overrides applied,
succeeded. The isolation rule is enforced by the build, not by convention.

Note: the review project's `sb_secret_…` key value is redacted by the Supabase
API, so the legacy service-role JWT is used in the secret slot. The app accepts
either format there.

## 5. Migrations applied to the review database

55 of the 71 repository migrations were already present. **16 were applied, in
order:**

```
20261108007000_payment_recorded_by
20261108008000_p8_require_settlement_before_close
20261108009000_p9_financial_read_roles
20261108010000_invoice_share_links
20261109001000_operational_readiness
20261110000100_counter_payment_lock_order
20261110000200_financial_session_serialization
20261110000300_shared_wifi_scan_limits
20261110000400_durable_order_attempt_budget
20261110000500_public_restaurant_profile
20261110000600_staff_finance_boundaries
20261110000700_restaurants_member_only
20261110000800_remove_order_submission_caps
20261110000900_converge_qr_verification_attempts
20261110001000_account_subscriptions
20261110001100_subscription_billing
```

### The migration-reconciliation finding is now resolved with real evidence

`20261110000900` exists because hosted databases disagreed about the shape of
`qr_verification_attempts`. This review database had the **non-canonical** shape
— an append-only event log with columns `id, qr_code_id, ip_hash, attempted_at`.

The migration's guard detected exactly that, preserved the old table as
`qr_verification_attempts_legacy_20261111054934` (4 columns, 0 rows), and created
the canonical 6-column rate-limit table. Both tables are now present in the
review database, so the divergence is documented rather than guessed at. This is
the previously open reconciliation question, answered on a real hosted database
instead of a reconstructed one.

Schema after migration: 41 tables, all 29 account/subscription/billing/ordering
functions present with correct signatures.

## 6. Test results from the integrated candidate

Run on the merged commit `a8087af`, before deployment.

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `next lint` | 0 errors |
| `npm run design:check` | pass (ad-hoc font sizes 0/0) |
| `npm run sql:check` | pass |
| `npm run build` | compiled successfully |
| `vitest` | **177 files / 2095 passed, 4 files / 114 skipped** |
| DB replay — clean | **114 passed / 114** |
| DB replay — staging forward-upgrade | **114 passed / 114** |
| DB replay — financial preservation | **114 passed / 114** |
| Migration reconciliation runner | exit 0 |

The three DB paths use disposable embedded PostgreSQL only; no verification
script ever connected to production or to a hosted database.

**Browser E2E was not run — it could not be.** `scripts/e2e/` exists and the
`@playwright/test` package is installed, but:

- `~/.cache/ms-playwright` is empty and Playwright's CDN is unreachable, so no
  browser binary can be downloaded;
- the shared libraries a browser needs are absent
  (`ldconfig -p | grep -E "libnspr4|libnss3|libatk-1.0|libgbm"` → 0 matches);
- they cannot be installed: the sandbox has **no outbound network** except to
  `github.com`, `codeload.github.com`, `api.github.com`, `registry.npmjs.org`,
  `pypi.org` and `files.pythonhosted.org`, and the account is not root
  (`apt-get download libnss3` → "Unable to locate package").

For the same reason the hosted URL could not be verified by HTTP from the
sandbox. Its state was confirmed through the Vercel API and by fetching the URL
through an out-of-band page fetch, which is how the Deployment Protection
problem above was found.

Treat **browser E2E** and **hosted HTTP smoke tests** as unmet verification
items, to be run once a browser-equipped environment or an unprotected URL is
available.

## 7. Testable workflows

Review data was added **alongside** the existing 126 orders and 22 sessions,
which were preserved, not wiped.

**Review tenant — "Spice Route"** (`/r/spice-route-review`)

- 6 categories, 26 dishes across starters, mains, breads, rice & sides,
  desserts, drinks; one item deliberately marked unavailable.
- 8 covers (T1–T8), each with a live QR card; 6 have an open sitting with real
  orders already placed **through the guest entrypoint** (`open_table_session` →
  `place_public_order_attempt`), not inserted directly.
- GST set at 5%, UPI ID present but marked `REVIEW — no transfer`.

**Second outlet on the same account — "Spice Route Express"**
(`/r/spice-route-express-review`) with its own menu, 4 covers and 3 orders.
This is what exercises **Model C multi-outlet billing**: one account, one trial,
one subscription, two outlets.

**A second tenant** (`Arena other tenant`, from prior fixture runs) exists with
no membership for the review owner — use it to confirm tenant isolation, i.e.
that the owner cannot see its orders.

Workflow-by-role:

- **Customer** — scan a table QR (or enter the code), browse the menu, order,
  place, watch status, request the bill; QR verification in both `scan` and
  `code` modes.
- **Owner** — full dashboard; menu and category editing; covers and QR cards;
  staff management across all four roles; the **Subscription** screen (plan,
  trial countdown, outlet count against the plan limit, billing history,
  receipts, cancellation request and withdrawal); add a second outlet.
- **Manager** — menu, covers, staff, reports; no billing.
- **Kitchen** — kitchen display and incremental KOT progression on the six live
  sittings.
- **Cashier / counter** — counter ordering, session settlement, payment
  recording, receipts, invoice share links.

**Subscription is fail-closed by design.** `BILLING_PROVIDER`,
`BILLING_API_KEY` and `BILLING_WEBHOOK_SECRET` are **not set**, so checkout
refuses rather than pretending. No payment provider is activated and no real
charge can occur. To see a paid state, call `admin_set_subscription()` with the
service role.

## 8. Not available in this build

- **Browser E2E and hosted HTTP checks** — blocked, see §6.
- **Live payment provider** — absent by design; subscription checkout is
  fail-closed and UPI details are marked as non-transferring.
- **Roadmap features** — deliberately out of scope, none added.
- **Scheduled subscription expiry** — `expire_subscriptions()` exists and is
  tested, but no cron fires on this project, so expiry is observable only by
  calling it directly.

## 9. Known defects and limitations

1. **Preview Deployment Protection blocks the URL** until disabled for Preview
   or a share link is generated. The single blocking issue for hand-testing.
2. **Browser E2E unrun.** Not a defect in the product; a sandbox limitation.
3. **Seven PR #174 order-budget tests were not carried**, because `000800`
   intentionally removes the behaviour they assert. Superseded, not skipped.
4. **The legacy `qr_verification_attempts_legacy_20261111054934` table remains**
   in the review database. That is intentional evidence, not debris.
5. **Two data-shape caveats carried from earlier sessions:** the open decision
   about `20261109000400` having been edited in place (`docs/migration-reconciliation.md`),
   and the fact that the pre-existing E2E fixtures on this project use random
   `example.invalid` addresses and are not human-usable.
6. **`AUTODINE_MODE=live`** is set on this branch's preview. If Supabase config
   ever goes missing, operational routes return 503 rather than sample data —
   fail-closed, which is what a review build should do.
