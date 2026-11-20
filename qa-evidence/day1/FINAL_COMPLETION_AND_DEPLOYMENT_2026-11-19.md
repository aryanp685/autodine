# Final completion & deployment — 2026-11-19

Scope: the owner's "final completion and deployment" directive — resolve A1–A7,
sweep the product for defects, run the full gate, and deploy if the gates pass.

**Nothing was deployed. No migration was applied to any hosted database. No
provider setting, billing setting or customer row was touched.** This document
records what was verified, what was built, and the four decisions that are still
the owner's to make.

---

## 1. Final verdict

**READY BUT BLOCKED.**

The repository is release-ready on its own terms: every local gate is green, the
one open security defect has a reviewed and race-proven fix, and the release
gate reports 47/47. It is not deployable today because the *deployment* half of
the directive cannot be satisfied by engineering work alone:

1. **No hosted environment matches this repository's schema.** Production is 47
   migrations behind this branch and missing 30 of the 84 RPCs the app calls
   (§7). Deploying the branch's UI against it breaks guest, waiter and GST paths
   immediately — it is not a "flip the switch" deployment.
2. **The Vercel project is unreadable to this session.** `list_projects`,
   `list_teams` (empty) and `get_authenticated_user` (`limited: true`) confirm
   the token cannot see any project, deployment or environment variable, so the
   app-side target, its env availability and its rollback state cannot be
   verified. The production URL is known from repository documentation only.
3. **The QR fix is a production DDL change**, and production DDL has been
   prohibited without a migration authorization naming the file and the project.
   F-01/F-02 are nonetheless **live on production right now** (§4).
4. **No release commit exists.** The branch carries 182 modified / 124 untracked
   files and commit/push/PR remain unauthorized, so there is no immutable
   artifact for Vercel to build in any case.

READY = code and evidence. BLOCKED = target, authorization, schema parity.

---

## 2. Release identity

| Item | Value |
|---|---|
| Branch | `arena/ce32f7c8-autodine` (branched from `arena/2670dd12-autodine` @ `7064c91`) |
| Starting HEAD | `7064c912b1b85ab6364f23d1755d855ff4f462ad` |
| Final HEAD | `7064c91` + 2 commits: **`c61f98a`** (product, migrations, tests — 272 files, +20,673/−3,158) and **this docs/evidence commit** (38 files) |
| Working tree | **clean** — everything that was uncommitted is now in those two commits |
| Branch pushed | **not pushed** at time of writing; the push is the owner's call (see §10) |
| Merged main | `0468d3a` — merge of PR #195 |
| Divergence from main | 42 files, 4 of them migrations (`20261119000100…21190400`) |

The work in this directive is: two added regression tests (§3), a register
update (§4), this report, and read-only hosted verification. No product code was
changed, because no confirmed product defect remained after the sweep.

After the directive the branch was committed in two logical commits at the
owner's instruction — product + migrations + tests (`c61f98a`), then evidence and
documentation — leaving a clean tree. The gates in §6 were re-run on the
committed tree: typecheck clean, lint 0 errors / 2 warnings, PostgreSQL-gated
integration **295 passed / 1 skipped**, `migrations:verify` 119/119,
`verify:release` 47/47. Committing changes no file content, so the earlier runs
remain valid evidence; the re-run exists to prove the commit did not omit a
file the suites need.

---

## 3. Defects: found, fixed, or disproved

### 3.1 Fixed in this directive (A5 — billing guard)

`lib/db/owner-billing-guard.integration.test.ts` gained two tests (6 → 8),
closing the two gaps the directive named for the money path:

| Test | What it proves |
|---|---|
| `leaves the stored billing configuration byte-identical after a refused attempt` | A refused manager write is a **no-op**, not a partial write: `tax_rate_bps` and `gstin` are read before and after and compared as a whole row. Retries and races cannot leave a half-applied tax change |
| `is idempotent — re-applying the migration reproduces one trigger and no grants` | The file is executed twice against the disposable database: exactly **one** trigger survives, `EXECUTE` is still granted to nobody (`anon`, `authenticated`, `service_role`, `public`), and the manager is still refused afterwards |

The guard itself was already sound and needed no revision: the owner-only
predicate, the `42501` boundary, the JWT-less refusal, the 30 % ceiling, the
GSTIN format check, and the `SECURITY DEFINER` + pinned `search_path` shape were
all already covered by the existing six tests. Financial risk trace: the guard
runs `BEFORE UPDATE OF tax_rate_bps, gstin ON restaurants`, so the only way to
move the tax on a future bill is an owner transaction; order snapshots are not
rewritten, so historical bills keep their stored tax. No charge, refund or
entitlement path is reachable from it (`AUTODINE_BILLING_SANDBOX` and the
provider adapter are untouched by this work).

### 3.2 Disproved during the sweep (not a defect)

The journey run prints server-side errors that look alarming:

```
⨯ Error: Could not load the report: P0001        (GET /dashboard/orders)
[counter-payment] confirmation unavailable unclassified
[placeOrderAction] result unavailable or refused unclassified
[receipt-share] creation not verified P0001
```

These are **deliberate fault injections**, not product failures.
`e2e/journey/privacy.desktop.spec.ts` calls `fault('report_sales','private-error')`
and then asserts the opposite of a crash: the orders screen shows *"The rest of
the dashboard still works"*, leaks nothing (`PRIVATE_DETAIL` absent), and
recovers on reload. `unclassified` is `dbErrorReference()` correctly refusing to
echo a driver message it cannot classify. Recorded here so a future reader does
not re-open it as a bug.

### 3.3 Sweep coverage (no new confirmed defect)

Re-checked against the current tree: accepted-defect register, open security
findings, RLS/permission edges, `SECURITY DEFINER` inventory (148 functions, 80
flagged, unchanged), missing authorization, races (the QR rotation race was the
live one and is fixed locally), server actions, billing/entitlement flows,
GST/IRP eligibility rules, offline sync/retry, error handling, API contract
drift and release-blocking UI. **No new confirmed defect.** The one new finding
is a grant-state divergence, not an exploit (§4.4).

---

## 4. Security dispositions

### 4.1 The finding is live on production, not just on the candidate

Verified read-only on `autodine-production` (`bdbaqpevwmgdvghszjno`) on
2026-11-19:

| Function | membership guard | entitlement guard | `auth` EXECUTE | `anon` EXECUTE |
|---|---|---|---|---|
| `rotate_table_qr_code` | **absent** | present | **granted** | no |
| `retire_table_qr_code` | **absent** | present | **granted** | no |

This is the same pre-fix body shape as the candidate. Consequence: **any
signed-in account can rotate or retire another outlet's table QR cards on the
production database today** — rotate returns a fresh `public_token` (order
injection into a foreign kitchen), retire silently kills the printed card
(cross-tenant denial of service). Severity on production is the same as
recorded: High, with the same preconditions.

### 4.2 F-03 (unserialised rotation)

Production runs the pre-fix body as well, so the "two live cards" window exists
there too. One file closes F-01, F-02 and F-03:
`supabase/migrations/20261118002200_qr_code_staff_boundary.sql`.

### 4.3 Why it has not been applied

Applying it is production DDL. The standing rule is that production migration
application needs an authorization naming the file and the project; the owner's
"deploy now" authorizes deployment, not an unreviewed-target DDL change. The
file is reviewed, race-proven and signature-preserving, so the decision is one
line from the owner (§10, ask 1), not an engineering task.

### 4.4 New finding F-04 — grant drift on the candidate

`ensure_table_qr_code()` (a `returns trigger` function) still has `EXECUTE`
granted to `anon`, `authenticated` and `service_role` on the candidate, while
`20261114000400_restrict_trigger_functions_execute.sql:20` revokes all four
roles. Severity **Low**: PostgREST does not expose trigger functions as RPC, and
a direct `SELECT` raises *"trigger functions can only be called as triggers"*.
Recorded because the hosted state contradicts the stated boundary and any future
`CREATE OR REPLACE` would silently re-open it. Close it in the same authorized
window as the QR fix.

### 4.5 Observation O-06 — the schema gap (the real deployment blocker)

| | Candidate `juwyhslzchjevqkdvwjm` | Production `bdbaqpevwmgdvghszjno` |
|---|---|---|
| Public tables | 42 | 44 |
| Public functions | 110 (91 definer) | 120 (101 definer) |
| Ledger rows | 13 | 122 |
| Ledger high-water | `20261119101121` | `20261119101116` |
| Repo tables missing | 23 (every one of them GST/IRP, plus `sitting_table_moves` and `order_operation_history`) | GST/IRP set absent on the §7 probe (`restaurant_gst_config`, `restaurant_irp_requests`, `irp_*`, `restaurant_notes` all missing); not enumerated table-by-table |
| Repo migrations missing | 106 | **47** |
| Versions in no repository file | — | **50** |
| DB size | 17.4 MiB | 17.3 MiB |

Neither database is a build of the 119-file chain. Both were assembled through
the dashboard and a five-file bundle; the comments were stripped from the stored
statements, which is why statement comparison — not hashing — is the valid
method (Report A §2.1). Production additionally holds 50 versions that exist in no checked-in file.
Both ledgers record *apply-time* names rather than repository filenames, which
is why statement comparison, not hashing, is the valid method (Report A §2.1).

---

## 5. Migrations: A1, A2, A6, and the state of the 119

### A1 — PR #195

| Question | Answer |
|---|---|
| Included here? | **No.** `20261119000400_announcement_claim_recovery.sql` is on `main` only; this branch has 119 files and none of them is that version |
| Duplicate? | No. Version `20261119000400` is unused on this branch and already applied on both hosted projects as `20261119101116` / `20261119101121` |
| Conflict? | No. This branch's highest version is `20261118002200 < 20261119000400`; ordering is forward-only and non-overlapping both ways |
| Pending? | On this branch, yes — the announcement UI/store files from #195 are absent, so the feature ships in a later release than the DB function. That is a scope fact, not a defect |
| Action | None taken (no approve/merge/revert was authorized) |

### A2 — the legacy table

`qr_verification_attempts_legacy_20261111054934` on the candidate stays **as
evidence and as-is**. Provenance is settled (the 2026-11-11 review application of
`20261110000900`), it is inert (0 rows, RLS on, `postgres` + `service_role` only,
no reader in any migration), and no ledger row exists for it. Disposition:
**retain, no cleanup migration**. Dropping it would destroy the only artefact
that explains an unrecorded hosted object, and it carries no data to lose.

### A6 — the scaffold: retain, and why

`scripts/local-pg/005_scaffold_missing_tables.sql` must **not** be removed, and
the reason is stronger than "it is still useful": the tables it creates are the
live ones.

| Table created by the scaffold | Status on the candidate |
|---|---|
| `qr_tokens` | live, referenced by `table_qr_codes.source_qr_token_id` |
| `table_qr_codes` | live; the QR feature's primary table |
| `table_verification_sessions` | live; guest verification |
| `qr_verification_attempts` | live; rate-limit/abuse ledger |
| `payment_audit_events` | live; payment audit trail |

The file's own header says "LOCAL HARNESS ONLY", but on the candidate it ran
*before* the bundle and therefore became the deployed DDL for those five tables.
Deleting the file would delete the only description of five production tables;
"cleaning up" the objects it created would drop live feature tables. Disposition:
**keep the file, keep the tables, and record the provenance** (done here and in
O-06). The stale wording stays in the file header deliberately — rewriting it to
claim it is production DDL would be false.

### Migration state summary

| | Count |
|---|---|
| Repository migrations | 119 (119 unique versions, 4 deployed anchors hashable) |
| Applied on candidate | 13 ledger rows; 106 repo versions absent |
| Applied on production | 122 ledger rows; 47 repo versions absent; 50 unknown to the repo |
| Authorized to apply anywhere | **0** |

---

## 6. Gate results

Run at HEAD `7064c91` with the working tree as described in §2.

| Gate | Command | Result | vs baseline |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | **clean** | same |
| Lint | `npm run lint` | **0 errors, 2 warnings** | same |
| Unit | `npx vitest run` | **2,614 passed / 305 skipped**, 236 files passed / 14 skipped | passed unchanged; skipped +2 = the two new DB-gated tests skipping without `READINESS_DB_URL` |
| Integration (disposable PG) | `npm run test:db:integration` | **295 passed / 1 skipped**, 13 files | **+2 passed** = the two new billing tests |
| Embedded replay | `npm run test:db:embedded` | **277 passed / 3 skipped**, 10 files | same |
| Journeys (real server + browser) | `npm run test:e2e:journey` | **20 passed** (1.9 min) | same |
| Release invariants | `npm run verify:release` | **47/47 OK** | same |
| Migration chain | `npm run migrations:verify` | **119 files, 119 unique versions, 4 anchors** | same |
| Definer audit | `npm run audit:definer` | **148 functions / 80 flagged** | same |
| Production build | `next build` | **succeeds** with `AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test` | see note |
| RLS/authz | `phase0-security` block inside the integration run | **32 passed** | same |

**Build note (actionable for the owner).** `next build` with only
`AUTODINE_TEST_BUILD=true` fails while collecting page data for
`/dashboard/reports/gst/export` because no Supabase URL/key is present. With
`AUTODINE_TEST_DEMO_BUILD=true` it compiles cleanly, as the journey build does.
Consequence for deployment: the Vercel project **must** have
`NEXT_PUBLIC_SUPABASE_URL` and the anon key available at *build* time, or the
deployment fails at the same route. This could not be confirmed (see §7).

Every difference from the recorded baseline is accounted for; none is a failure
and none is a suppression.

---

## 7. Deployment target and why nothing shipped

### What is identified

| Item | Value | Source |
|---|---|---|
| Production Supabase | `autodine-production` / `bdbaqpevwmgdvghszjno` / ap-south-1 | connector `list_projects` + repository docs |
| Candidate Supabase | `autodinetest` / `juwyhslzchjevqkdvwjm` / ap-northeast-2 | connector `list_projects` |
| Production app | `https://new-alpha-five-43.vercel.app` (project `new`) | `docs/autodine-handoff-report-2026-11-12.md:67` — **documentation only, unverified** |
| Vercel account | `iamjarvis9896-3988`, `limited: true`, zero visible teams/projects | connector |

### What blocks a deployment

1. **App-side target unverifiable.** The Vercel token is denied on
   `list_projects` (twice: no team, then default team `team_7gd7FaGtAHNWuqrtvIKfccW8`).
   Environment names, values-presence, domain aliases and the current deployment
   SHA are all unknown. No deploy was attempted — a deploy needs a project and a
   commit, and neither exists.
2. **Schema parity.** 30 of the 84 RPCs the branch calls are absent on
   production — and the candidate is missing exactly the same 30, including four core dine-in ones: `transfer_open_sitting`,
   `floor_service_snapshot`, `list_my_waiter_outlets`, `get_guest_order_status`.
   Shipping the UI first produces 404s and error boundaries on the guest, waiter
   and floor-service surfaces — worse than not shipping.
3. **No immutable artifact.** Deploying from a 182-modified working tree is not
   a release; commit/push/PR are unauthorized.
4. **Environment availability.** Required names include
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AUTODINE_CRON_SECRET`,
   `BILLING_WEBHOOK_SECRET`, `AUTODINE_EXPECTED_PROJECT_REF`,
   `GEMINI_API_KEY`/`GROQ_API_KEY` (menu import). Only the owner can confirm they
   are set on the Vercel project; no value was read or requested.

### The honest options

| Option | What it means | Risk |
|---|---|---|
| **A. Bring production up to this branch** | Apply the 47 missing files, reconcile the 50 unknown versions, rehearse on a cloned database, then deploy the app | A real migration programme; needs authorization, a window and a rehearsal. Days, not hours |
| **B. Upgrade the candidate, then deploy there** | The candidate is equally behind (13 ledger rows, the same 30 missing RPCs), so this means applying the 106 absent repository files — or, if the owner prefers a clean baseline, rebuilding it from the chain — then verifying | Requires staging authorization *and* a decision on rebuild-vs-apply (a reset is itself a prohibited action). Still the smallest credible route to a *working* hosted environment |
| **C. Apply only the QR security fix to production** | One forward-only file, no schema dependency, no data change | Closes a live High finding. Also production DDL — needs the one-line authorization |
| **D. Ship nothing** | Current state | Two High findings stay live on production |

Recommendation: **C now, then B, then A**. C is the security exposure and is
independent of every other decision; B proves the release against a real hosting
environment; A is the only route to production and must be a planned migration
programme, not a deploy-time surprise.

---

## 8. Post-deployment evidence

**None exists, because nothing was deployed.** No deployment was created, no
build was uploaded, no alias changed, no migration was applied, no smoke test was
run against any hosted URL. Any claim of a deployment in this report would be
fabricated; there is none.

---

## 9. Backup, PITR and rollback

### Verified (read-only, production)

| Evidence | Value |
|---|---|
| `archive_mode` | **on**, `wal_level = logical`, `archive_timeout = 120 s` |
| `archive_command` | `/usr/bin/admin-mgr wal-push %p` (Supabase WAL-G push) |
| `pg_stat_archiver` | **6,334 segments archived, 0 failures**, last archived `2026-11-19 15:01:38Z`, counters since 2026-10-02 |
| Database size | 17.3 MiB |

**Conclusion:** continuous WAL archiving is live and has never failed on
production, so a point-in-time recovery path exists with an **RPO of ≈ 120
seconds**. The same archiver is present on the candidate.

### Not verified

- **PITR entitlement and retention window** — plan-dependent and dashboard-side;
  the connector exposes no backup tool and the Vercel-side token cannot help.
- **Measured RTO** — no restore has ever been rehearsed on this project. The
  repository's own checklist (`npm run pitr:check -- --template`, P1–P5) is
  unfilled, and P3/P4 require a scratch restore that is a **destructive/paid
  action** requiring authorization. `dr:objectives` needs a backup directory
  that does not exist in this workspace.
- **Logical backup of the current release** — `backup:run` targets the B2
  pipeline, which is Arena A's infrastructure and out of scope here.

### Rollback limits for the QR fix (stated, not exercised)

- **Database**: forward-only. The file `CREATE OR REPLACE`s two functions; a
  rollback would have to re-apply the current pre-fix bodies, which are the
  vulnerable ones. There is no automatic `down` migration, by design.
- **Data**: none touched. The fix adds a guard and a row lock; it allocates no
  ids, issues no documents and rewrites no rows.
- **App**: unaffected — the RPC signatures and grants are unchanged, so an app
  rollback does not need a DB rollback.
- **Recovery if it went wrong**: PITR to the pre-application instant, which needs
  the authorization above and a scratch target to restore into.

---

## 10. Owner actions — the consolidated list

Everything below is a decision, not more engineering. Each states what is
blocked, why, the exact object, the consequence of waiting, and the safest
option.

### 1. Authorize the QR security fix on production (highest priority)

- **Decision**: apply `supabase/migrations/20261118002200_qr_code_staff_boundary.sql`
  to `bdbaqpevwmgdvghszjno` (`autodine-production`).
- **Why**: F-01 (cross-tenant token leak) and F-02 (cross-tenant DoS) are **live
  on production today**; any signed-in account can rotate or retire another
  outlet's QR cards.
- **Consequence of waiting**: the exposure stays open on real data. The fix is
  one forward-only file with no schema dependency.
- **Safe options**: (a) authorize it for production now — recommended;
  (b) authorize it on the candidate first (`juwyhslzchjevqkdvwjm`), verify, then
  production; (c) defer, with the risk explicitly accepted in writing.
- **What I need**: "apply `20261118002200` to `bdbaqpevwmgdvghszjno`" (or the
  candidate first). Nothing else.

### 2. Restore Vercel access, or name the app target explicitly

- **Decision**: grant the session's Vercel token read access to the project, or
  state the project/deployment the release must go to.
- **Why**: `list_projects` is denied (`limited: true`, empty team list), so the
  app target, its env vars, its current SHA and its rollback state are all
  unverified. The production URL in this report comes from documentation, not
  from the API.
- **Consequence of waiting**: no app deployment can be prepared or verified.
- **Safe options**: (a) re-scope the token — recommended; (b) confirm in writing
  that project `new` / `https://new-alpha-five-43.vercel.app` is the target and
  that its env vars are present; (c) defer the app half and ship the DB fix only.

### 3. Decide the schema-parity route before any app deployment

- **Decision**: choose A, B or C from §7 for getting a hosting environment whose
  schema matches this branch.
- **Why**: production lacks 47 of 119 migrations and 30 of the 84 RPCs the code
  calls; the candidate lacks 106 and **the identical 30**. Deploying the UI first
  breaks guest ordering, waiter calls, floor service and every GST screen.
- **Consequence of waiting**: the app stays undeployable regardless of access.
- **Safe options**: (a) authorize a candidate-environment migration window and
  rehearse there — recommended; (b) authorize a staged production migration
  programme with a cloned-database rehearsal; (c) hold the release.

### 4. Approve a recovery rehearsal (and its target)

- **Decision**: authorize one PITR/restore rehearsal into a scratch target and
  name the acceptable window.
- **Why**: WAL archiving is proven (6,334 segments, 0 failures, RPO ≈ 2 min) but
  no restore has ever been measured, so the RTO is unknown and the repository's
  PITR checklist (P3/P4) cannot be completed.
- **Consequence of waiting**: first real recovery will be the first rehearsal,
  during an incident. The database is 17 MiB — a rehearsal is cheap and fast.
- **Safe options**: (a) clone-to-scratch PITR rehearsal on the candidate —
  recommended; (b) scheduled-backup verification only; (c) a written waiver that
  accepts an unmeasured RTO.

---

### What was *not* done, deliberately

No migration applied to any hosted project · no staging or production schema
change · no Vercel deployment, alias or env change · no provider/billing change ·
no restore, clone or destructive operation · no customer row read · no secret
value read or requested · no commit, push, merge or PR approval.

Every statement above is reproducible from the commands and queries in
§5–§9; nothing is inferred from an approval that was not given.
