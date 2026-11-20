# Release candidate — Priority 5 product-wide E2E and RC verification

Branch `arena/ce32f7c8-autodine` · base `7064c912b1b85ab6364f23d1755d855ff4f462ad` ·
HEAD `7064c912b1b85ab6364f23d1755d855ff4f462ad` (unchanged, nothing committed) ·
local date 2026-11-19 (UTC) · **local evidence only**

## 1. Baseline

| Item | Value |
|---|---|
| Branch / HEAD | `arena/ce32f7c8-autodine` @ `7064c912b1b85ab6364f23d1755d855ff4f462ad` |
| HEAD tree | `9967015f994ee23abd73c13b0e4a673e80fa0b36` (same as the P4 opening) |
| Index | `fc6536a889bff32be353efcd9fedec3a03227bcefe7d60ffafe1841fd2ec07c6`, **0 staged paths** |
| Migration chain | **118 files**, unchanged since P4 (`20261118002100_operational_realtime.sql` last) |
| Protected predecessors | **123/123 digests unchanged** (GST/IRP files, manifests and guarded artifacts) |
| Working tree | 257 dirty paths: 180 modified, 74 untracked (directory-collapsed), 3 pre-existing deletions; `git diff --check` clean |
| Prior closures read | P1 GST, P2 IRP, P3 guest-to-receipt, P4 realtime reports + `RELEASE-BLOCKER-REPORT.md` + owner register |

The 3 deletions (`components/AttemptToken.tsx`, `components/ClearCartOnOrder.tsx`,
`components/RememberOrder.tsx`) and the untracked directories are pre-existing
P1–P3 content relative to HEAD; P5 neither deleted nor renamed anything. 44
files that were already dirty at the P4 opening now hash differently because
P4 and P5 edited them (documents and the cashier screen); no protected file
changed.

## 2. Journeys exercised

| Journey | Evidence | Result |
|---|---|---|
| **A — GST restaurant, scan to receipt** | Chromium journey suite (`e2e/journey`), production Next build, disposable PostgreSQL 17: desktop scan→confirm→order→kitchen→cash→close→saved receipt, phone code→custom basket→lost acknowledgement→UPI→saved GST receipt, plus counter retry/dedupe specs | **17/17 passed** |
| **B — No GST (Unregistered and Composition)** | New P5 test _issues a plain receipt without tax or an IRP record at an outlet with no GST registration_ (guest order → counter tender → sitting close), plus the P1 two-mode suite re-run inside the 13-suite integration gate (off/receipt, Composition Bill of Supply, SAC and acknowledgment gates, buyer-detail refusal) | **Pass** |
| **C — Eligible B2B / IRP** | P2 `irp-execution.integration.test.ts` re-run in the P5 gate (offline preflight, dispatch, verified response, hold/release, cancellation, lookup-before-resend, simulated response never a legal IRN), plus P1 B2B/IRP applicability and invoice-immutability tests | **Pass** (synthetic rehearsal only; no provider, no legal IRN) |
| **D — Floor operations** | New P5 test _runs the floor lifecycle: idempotent acknowledgement, a blocked transfer, and a revoked table proof_; P4 `operational-realtime.integration.test.ts` (coalescing, publication, ACLs, call binding, transfer refusals, guest versions) re-run; Chromium `realtime.desktop.spec.ts` socket drop/recover | **Pass** |

Journey B and C are proven at the database/API boundary through the public
RPCs and roles, not through new browser screens; the browser layer is proven
for journey A and the realtime half of D. This is stated as a limit, not
papered over.

## 2b. Files changed by Priority 5

| File | Change | Why |
|---|---|---|
| `lib/db/p5-cross-module.integration.test.ts` | **new**, 5 tests | Cross-module seams no single-module suite owns: cross-outlet refusals, kitchen-frozen edits, retried tender/checkout, issued-document immutability, the no-GST receipt, and the floor call/transfer lifecycle |
| `scripts/local-pg/run-integration-tests.mjs` | one suite entry | Run the new suite in the disposable-PostgreSQL gate |
| `docs/infrastructure-architecture.md` | stale timer claims replaced | Kitchen/dashboard text still said five-second polling and did not mark hosted Realtime unverified |
| `docs/e2e-local.md` | P5 pointer | Make the new suite and RC report discoverable from the E2E guide |
| `qa-evidence/day1/MASTER_EXECUTION_STATUS.md` | P5 section | Keep the master status current |
| `RELEASE-BLOCKER-REPORT.md` | P5 checkpoint | Publish the RC verdict and the unchanged blockers at the release gate |
| `qa-evidence/day1/MASTER_OWNER_ACTION_REGISTER.md` | P5 note | State explicitly that P5 adds evidence, not authorization |
| `qa-evidence/day1/RELEASE_CANDIDATE_PRIORITY_5_LOCAL_VERIFICATION.md` | **new** | This report |

No application code, migration, SQL function, grant, policy or fixture
underneath another workstream was modified.

## 3. Cross-module integrity and failure testing

New file `lib/db/p5-cross-module.integration.test.ts` (5 tests, registered in
`scripts/local-pg/run-integration-tests.mjs`, disposable `autodine_check_*`
database only):

1. **Cross-outlet refusal matrix** — owner, manager, cashier, kitchen and
   waiter of outlet A are refused (`42501`) on outlet B's transfer, waiter-call
   acknowledgement, counter payment and line edit; outlet A's guest token
   returns `null` from B's order lookup and `not_found` from B's versioned
   edit. B is afterwards byte-unchanged: 0 payments, call still `open`,
   `acknowledged_at` null, `prep_status` still `new`, 0 operation-audit rows.
2. **Kitchen start freezes the guest edit** — a kitchen `preparing` transition
   increments `guest_live_version` (so an old revision reads `stale`), and a
   *current* version edit is then refused by the kitchen-state guard with no
   version move and no quantity audit row.
3. **Counter retry, one receipt, frozen document** — the same idempotency key
   from a second tab returns the same payment row (1 payment); a fresh key is
   refused because the ticket is no longer unpaid-pending; a retried checkout
   returns the same invoice (1 invoice per sitting); direct `UPDATE` of totals
   or number and `DELETE` are refused with `42501` and the issued row is
   unchanged; a paid, closed ticket is not editable via the guest route; ticket,
   tender and document totals reconcile.
4. **No-GST document** — an outlet with no GST registration produces a
   `receipt` with zero tax, no `gst_snapshot`, `irp_status = not_required`, no
   IRN, a well-formed `INV/FY/nnnnnn` number, and **zero** IRP jobs or
   dispatches.
5. **Floor lifecycle** — guest call → manager acknowledgement is idempotent
   (second device does not reassign actor/time); a transfer with an open call
   returns `call_open` and leaves the sitting in place; after the call is
   finished the transfer returns `moved`, revokes both tables' verification
   proofs, and a replayed request UUID returns `already_recorded` with exactly
   one move row; the guest keeps order and token across the move but the
   revoked proof cannot place another order; once a payment exists the transfer
   returns `held_or_paid` and the table does not move.

The P3/P4 suites re-run in the same gate cover lost acknowledgements,
duplicated load, competing tabs, socket drops, subscription cleanup and
transaction retries. **No product defect was demonstrated**: every failure
during authoring was a wrong expectation in the new test (stale version
semantics, bigint-as-string, snapshot column names, invoice error code
`42501`), corrected against the migration source rather than by weakening a
guard. No check was relaxed and no schema or function changed in P5.

## 4. Security and permissions

- Cross-outlet read/write refusal is asserted for all five staff roles, both
  through definer RPCs and guest-token probes (test 1).
- RLS/authz suites (`phase0-security`, `account-link-audit`,
  `owner-billing-guard`, `subscription-billing`) re-ran green in the 13-suite
  gate.
- P5 adds **no** function, grant or policy. The three token-scoped anon entry
  points introduced by P4 remain the only new flags in the definer audit
  (148 functions audited, 81 heuristically flagged): `call_verified_waiter_at`
  and `read_verified_waiter_state` bind slug + table label + a live, unexpired,
  unrevoked 64-hex session token; `set_guest_order_lines_at_version` requires
  the order's guest token, checks the live version, and delegates to the
  existing pricing/role/time/payment authority. All three pin
  `search_path=public,pg_temp` and revoke `public`/`service_role`. No escalation
  path was found; the audit remains a heuristic triage, not a clearance.
- Secret scan of the production build: no `sb_secret_*`, service-role key or
  signed JWT material in `.next/static` or `.next/server` (only environment
  variable *names* appear in library code), and no synthetic key/token in the
  P5 run logs.

## 5. Migration and compatibility

| Check | Result |
|---|---|
| Full-chain replay, disposable DB | **118 migrations replayed without application-table scaffolds**; **270 passed / 3 skipped** (`npm run test:db:embedded`) |
| Populated upgrade from the P4 baseline | **10 files, 270 passed / 3 skipped** (`READINESS_GST_UPGRADE=1`): financial, order, guest, table, audit and share rows preserved; series counters continue; no rewrite or backfill |
| Protected predecessors | 123/123 digests identical |
| P5 schema/function changes | **None** — no migration added or edited in P5 |
| Hosted migration application | **None performed** |

The 3 skips are the existing environment-gated cases (hosted/direct PostgREST
and clock-dependent paths that cannot run in a loopback embedded cluster); they
are reported as skips, never as passes.

## 6. Full gates

| Gate | Result |
|---|---|
| Native PostgreSQL integration (`npm run test:db:integration`) | **13 suites, 286 passed / 1 skipped** |
| Full-chain replay (`npm run test:db:embedded`) | **270 passed / 3 skipped** |
| Populated upgrade | **270 passed / 3 skipped**, 10 files |
| Chromium journey (`npm run test:e2e:journey`) | **17/17 passed** (16 desktop, 1 phone) |
| Unit/component (`npm test`) | **2,612 passed / 296 skipped** across 2,910 tests, 235 files passed / 14 skipped |
| lint, design, SQL, migration chain, typecheck | **exit 0** |
| `verify:release` | **OK — 47 checks (118 files)** |
| Hermetic production build | **exit 0, 28/28 static pages** |
| Definer audit | **148 audited / 81 flagged** |

The single integration skip is the same environment-gated case carried since
P3; the unit skips are the DB-gated suites plus the new P5 file running without
`READINESS_DB_URL`. None is evidence of hosted behaviour.

## 7. Documentation and registers updated

- `docs/infrastructure-architecture.md` — removed the stale “five-second
  polling” claim for Kitchen and the polling paragraph in the compute section;
  the Realtime row now describes `outlet_live_revisions` as a metadata-only
  signal and marks hosted publication/RLS/Realtime **UNVERIFIED**.
- `docs/e2e-local.md` — names the P5 cross-module suite and points at this
  report.
- `qa-evidence/day1/MASTER_EXECUTION_STATUS.md`, `RELEASE-BLOCKER-REPORT.md`
  and `MASTER_OWNER_ACTION_REGISTER.md` — P5 checkpoint added; GST/IRP/realtime
  authorization status unchanged.
- `docs/migration-manifest-2026-11-14.md` — unchanged (no new migration).

## 8. Boundaries honoured

No hosted database read/DDL/DML, no hosted migration application, no
Staging/Production change, no deploy/release/pilot/config change, no real
payment, no live IRP/provider call, no secret collected or exposed, no
commit/push/PR/merge (none authorized), no destructive cleanup, and no P1–P4
reopening. All databases were disposable embedded PostgreSQL 17 clusters under
`/tmp`, dropped by their runners.

## 9. Remaining blockers

| Group | Blocker |
|---|---|
| Local (non-blocking, disclosed) | Browser journeys cover A and realtime D; B and C are DB/API-level. The journey HTTP/socket adapters are fixtures, not PostgREST/Auth/Realtime. Waiter board at phone width still wants a human visual pass. |
| Staging | Isolated non-production target designation; read-only ledger/catalog/ACL checks; `supabase_realtime` publication review; genuine Supabase Auth sign-in/renewal and Data API; hosted RLS/Realtime observation. |
| Provider | Payment provider, IRP provider/transport/trust validation and credentials, email provider activation — none authorized or exercised. |
| Production | Separate written authorization for the 26 GST/IRP files, `20261118002000` and `20261118002100`; verified recovery/PITR evidence; deployment approval; statutory/CA sign-off. |

**Hosted action status: none performed.** No hosted migration, read, deploy,
provider call or release action occurred in this work.

## Verdict

**LOCAL PASS WITH BLOCKERS.**

The local release-candidate composition — guest ordering, kitchen progression,
floor operations, counter tender, invoice/receipt immutability, GST and no-GST
documents, synthetic IRP hold, and realtime propagation with recovery — is
verified end to end on disposable PostgreSQL and a production Next build, with
zero demonstrated cross-module defects and zero product-code changes required.
This is **not** launch readiness: no hosted environment, provider, recovery
target or statutory authorization has been verified, and Staging, Production,
pilot and release remain **NO-GO**.

## Reproduction

```
npm run test:db:integration
npm run test:db:embedded
READINESS_GST_UPGRADE=1 npm run test:db:embedded
npm run test:e2e:journey
npm test
npm run lint && npm run design:check && npm run sql:check && npm run migrations:verify
npm run typecheck && npm run verify:release
GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test npm run build
npm run audit:definer
```
