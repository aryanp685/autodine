# Verification run — 2026-11-10

What was executed, what it produced, and — no less important — what could not
be executed here and why. Every command below was run on branch
`arena/a5344572-autodine` against the working tree, in this sandbox.

## Summary

| Area | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 0 warnings |
| `npx vitest run` | 179 files — 2076 passed, 81 skipped, 0 failed |
| `npm run sql:check` | exit 0 |
| `npm run design:check` | exit 0 |
| `npm run build` (hermetic CI env) | exit 0 |
| Migration replay, clean | 70 migrations applied, 81 DB tests passed |
| Migration replay, staging-scaffold baseline | 81 DB tests passed |
| Migration replay, financial forward upgrade | 81 DB tests passed, rows preserved |
| `npm run db:reconcile` | exit 0 |
| Local load, 5 000 users | exit 0 |
| `pg_dump` / `pg_restore` round trip | identical schema, identical rows |
| Browser end-to-end | **NOT RUN** — see below |

## Static checks

```
npx tsc --noEmit          # 0 errors
npm run lint              # 0 errors, 0 warnings
npx vitest run            # Test Files 176 passed | 3 skipped (179)
                          # Tests     2076 passed | 81 skipped (2157)
npm run sql:check         # exit 0
npm run design:check      # exit 0
```

The 81 skipped tests are the PostgreSQL-gated integration suites; they run in
the database section below, not here.

`npm run build` needs Supabase public configuration, or one of the two
documented escape hatches (`lib/supabase/env-guard.ts`). Without either it
fails during page-data collection with *"AutoDine requires
NEXT_PUBLIC_SUPABASE_URL and a public Supabase key"* — a configuration error,
not a code error. Built the way CI builds it:

```
GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test npm run build
# Compiled successfully; exit 0
```

## Database

Three replay paths, each against a disposable embedded PostgreSQL 17.11
cluster, driven by `scripts/verify-database.mjs`:

```
node scripts/local-pg/with-embedded-postgres.mjs node scripts/verify-database.mjs
READINESS_REPLAY_BASELINE=staging_scaffold ... node scripts/verify-database.mjs
READINESS_FINANCIAL_UPGRADE=1 ... node scripts/verify-database.mjs
```

| Path | Migrations | Tests | Exit |
| --- | --- | --- | --- |
| Clean replay | 70 applied, no application-table scaffolds | 81 passed | 0 |
| Staging-scaffold baseline | forward upgrade to 70 | 81 passed | 0 |
| Financial forward upgrade | 70 | 81 passed | 0 |

The financial path also reports the preservation check:

```
FINANCIAL_FORWARD_UPGRADE_PRESERVED {"tables":37,"policies":48,"functions":120,"productionClaim":false}
```

`productionClaim: false` is deliberate: this proves the repository's upgrade
path preserves data on a database built from the repository's own migrations.
It is not, and does not claim to be, evidence about the hosted production
database, whose shape has never been read in this session.

The 81 tests cover, among other things: order submission is never throttled
(no `po:attempt:%` rows, and a guard test that fails if the removed budget
keys reappear in any function body); the QR/session scan limits that remain;
the public storefront projection returning exactly the public columns and no
GSTIN; the account subscription being unreadable by guests and by other
tenants; and the Model C upgrade path (trial → starter → professional →
business) preserving every outlet and every row.

## Load

```
LOCAL_LOAD_USERS=5000 npm run -s test:db:local
# 5000 distinct guests; 5000 sessions + 5000 real SQL orders;
# 100 synthetic restaurants; DB pool cap 64
# session-open 4062ms (1231/s), order-write 53785ms (93/s); all rows persisted
```

## Backup and restore

No PostgreSQL client tools exist in this sandbox, so `pg_dump` and
`pg_restore` came from the `pgserver` wheel (PostgreSQL 16.2). `pg_dump` 16
refuses to dump a PostgreSQL 17 server, so the check replays the whole
migration chain on a 16.2 cluster instead — same migrations, same proof:

```
70 migrations applied on PostgreSQL 16.2
pg_dump  -Fc  → src.dump
pg_restore    → into a fresh database
schema-only dumps identical: True (10250 lines)
src: restaurants 1 | profiles 1 | functions 93 | policies 48
dst: restaurants 1 | profiles 1 | functions 93 | policies 48
RESTORE VERIFIED: True
```

One caveat recorded honestly: the `pgserver` wheel ships no contrib modules,
so `pgcrypto` was stubbed for this run. Nothing in `supabase/migrations`
calls a pgcrypto function — the extension is only created — and production has
the real module.

## Migration reconciliation

```
node scripts/reconcile/reconcile-migrations.mjs all    # exit 0
```

* **evidence** — five production function bodies do not match any repository
  migration: `cancel_order`, `open_table_session`, `record_counter_payment`,
  `set_order_line_quantities`, `settle_online_payment`. `place_public_order`
  matches `20261108006000`; `operational_schema_readiness` and
  `place_public_order_attempt` are absent in production.
* **converge** — baseline (45) + pending (25) = clean replay (70). The
  classifier's self-test covers 26 states with 0 wrong verdicts, and 22
  synthesised drift states are every one of them reported as REVIEW/drift.
* **staging** — 49 bundled migrations through `20261109000900`, 15 repository
  files pending there; 9 differing objects, all
  `qr_verification_attempts_legacy_*` and its sequence.

`docs/migration-reconciliation.md` records the findings and the rules; the
harness's `capture` mode (read-only, `RECONCILE_PG_ADMIN_URL`, loopback only)
is what to run against the hosted database once a read is authorised.

## Not run: browser end-to-end

Two independent blockers, both environmental:

1. **No browser can start.** The `@sparticuz/chromium` package supplies a
   Chromium binary, but it will not launch: `libnspr4.so: cannot open shared
   object file`. NSPR/NSS and the rest of Chromium's system dependencies are
   not installed (`ldconfig -p | grep -cE 'libnspr4|libnss3'` → 0), and they
   cannot be installed: this sandbox reaches only `github.com`,
   `codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`
   and `files.pythonhosted.org`. `npx playwright install chromium` fails with
   `ECONNRESET cdn.playwright.dev`.
2. **PostgREST cannot be fetched.** `scripts/e2e/run-throttle.sh` downloads a
   pinned PostgREST release; the download 302-redirects to
   `release-assets.githubusercontent.com`, outside the allowlist.

So `scripts/e2e/run-throttle.sh`, `scripts/e2e/check-chromium-runtime.sh` and
the Playwright specs are **NOT RUN** here. They need an environment with a
working browser runtime and network access to the release CDN. Nothing in the
results above contradicts them; they are simply unmeasured.

## Corrections made during this run

* `lib/db/readiness.integration.test.ts` had a duplicate `const counters`
  declaration, which made the whole file a failed suite with zero tests. Two
  earlier "1 failed / 25 passed" runs were reading that parse error, not a
  real failure.
* `20261110001000_account_subscriptions.sql` re-declared
  `restaurant_trial_ends_at`, `account_outlet_count` and
  `account_trial_ends_at` as `SECURITY DEFINER`. That is a leak, not a
  convenience: an id is not a secret, so a definer function answers with any
  restaurant's trial end date or any account's outlet count for any signed-in
  caller who can name it. All three are `SECURITY INVOKER` again, with a
  comment saying so, and two tests in
  `lib/db/phase0-security.integration.test.ts` pin the boundary.
* The trial-renewal tests (action and route) were written against the old
  table-write implementation; they now exercise
  `rpc('admin_set_subscription', …)` and keep every authorization assertion.
* `lib/db/adapt.test.ts` expected a `GSTIN — add in Settings` placeholder.
  A GSTIN is private, so the display layer stays silent instead of telling a
  stranger that a number exists.
* `components/screens/HomeScreen.test.tsx` hard-coded `'7-day trial'`; it now
  reads `TRIAL_DAYS`.

## Read-only review of the same tree (later the same day)

The finished work was re-read file by file. What it found, and what it changed:

* **Three subscription readers were callable by a guest.** A PostgreSQL
  function is created with EXECUTE granted to PUBLIC, and granting it to
  `authenticated` and `service_role` does not withdraw that. `account_trial_ends_at`,
  `account_outlet_count` and `account_can_write` therefore answered for any id
  a caller named — the last one is `SECURITY DEFINER`, so it did that with the
  definer's rights and no RLS in the way. All three are now revoked from
  `public` and `anon` in `20261110001000`, and a guest calling any of them gets
  `42501`. `account_can_write` is still reachable for every real path:
  `restaurant_can_write` calls it from inside its own definer body, where the
  privilege is not re-checked. Verified by re-running all three replay paths
  (82 tests each) and re-probing the ACLs on a throwaway cluster.
* **The renewal function's error contract was untested at the database level.**
  `admin_set_subscription` raises `restaurant_ambiguous` and
  `restaurant_not_found`; the unit tests proved the app maps those strings,
  but nothing proved SQL raises them. One test in
  `lib/db/readiness.integration.test.ts` now pins both, and pins that a refusal
  renews nothing.
* A duplicated `grant execute` line, a stray blank line and two stale comments
  naming the pre-Model-C trigger were removed.
* `docs/migration-reconciliation.md` carried pre-Model-C counts (67 migrations,
  22 pending files, 12 in staging, 11 differing objects) next to a table that
  already said 25. The numbers now match the harness (70 / 25 / 15 / 9), and
  its "cannot tell you whether a backup restores" caveat records the local
  16.2 round trip and the 17.11 gap.

Two things the review deliberately did **not** change:

* `supabase/migrations/20261109000400_order_write_boundary.sql` is edited in
  this working tree, after it was bundled into staging. The edit predates this
  branch (the Phase 3 baseline document already calls it "the overload fix"),
  and it is the tolerance that lets the repository chain replay over a
  scaffolded legacy database — reverting it breaks the staging verification
  path. Rule 3 of `docs/migration-reconciliation.md` says do not edit a
  migration any database has run. The divergence is now recorded in that file
  as a decision the owner has to take: fold the tolerance into a forward
  migration, or accept that databases built from the bundle keep the old body.
* `vercel.json` sets `git.deploymentEnabled.main` to `false` in this working
  tree. That value is already on `origin/main`, so it is inherited, not
  introduced here — but it means pushes to `main` do not deploy, and it is
  worth an explicit decision before release.
