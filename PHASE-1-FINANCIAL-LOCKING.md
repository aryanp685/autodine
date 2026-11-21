# Phase 1 — financial locking (in progress)

## Scope and safety

Authorized scope: financial lock ordering and isolated regression verification.
No hosted database was used, no migration deployed, and no production data changed.
Rate-limit policy, hosted load testing, GST and subscription work remain out of scope.
This is an incremental fix, not a completed financial audit or production-readiness certification.

## First reproduced defect: counter collection versus session work

`mark_order_session_paid` takes session then order locks. Checkout also takes the
session before issuing its invoice. Previously `record_counter_payment` took the
order lock and then its payment receipt trigger requested the session lock.
This admits an order/session wait cycle.

The new native PostgreSQL test holds the session in connection A, invokes the
actual authenticated counter RPC in connection B, observes blocking via
`pg_blocking_pids`, and asks A to lock the order NOWAIT. On the old migrations,
the test fails with `could not obtain lock on row in relation "orders"`.
No timing-based artificial sleep is needed to manufacture the lock inversion.

Migration `20261110000100_counter_payment_lock_order.sql` replaces only the
counter RPC. After existing membership validation, it locks the authorized
order's session before acquiring the order lock. The receipt trigger can then
reacquire the same session lock in its transaction. No balances, historical rows,
policies, function signatures or grants are rewritten.

The test checks completion, ledger sum equals the order total, and an identical
idempotency-key retry leaves exactly one recorded payment. Existing native tests
still cover tenant/role rejection, pending-online guards, repeat checkout,
source freezing after invoice issue and read-only trials.

## Evidence from this workspace

- Disposable PostgreSQL 18.6 on loopback; verifier creates and drops only its own
  random `autodine_check_*` databases, replaying all repository migrations.
- Before fix: 21 tests passed, new lock-order regression failed.
- After fix: 22 native tests passed (18 readiness + 4 throttle regression).
- Full ordinary unit suite: 1946 passed, 22 skipped without database environment.
  These skips are not passed database tests; native verification above runs them separately.
- Typecheck, lint, design guard and production build passed.
- Hosted concurrency, provider settlement, restore verification and cross-version
  PostgreSQL CI have not been rerun for this change yet.

## Extended audit and fixes

Migration `20261110000200_financial_session_serialization.sql` aligns:

- `cancel_order` and the latest `set_order_line_quantities` implementation:
  authorized session lock before source order mutation. Guest-token precedence
  is preserved; member roles match existing validation. Existing finalization
  guards reject queued source edits after checkout has issued its invoice.
- Latest `begin_online_payment`: guest-token/slug-scoped session before order.
- `settle_online_payment`: resolve the attempt reference without a lock, take
  session then order, then lock/re-read payment and retain existing state,
  provider amount and idempotency validation.

No privileged helper is added. CREATE OR REPLACE preserves existing function
ACLs and signatures. Mutations of attempt-to-order references by privileged
out-of-band administrative SQL are outside these RPC assumptions.

Invoice/receipt review: checkout and direct session invoice issuance already
lock the session. The payment receipt trigger locks session then invoice and
assigns supplemental sequence numbers under that invoice lock. Invoice voiding
locks only its invoice and does not subsequently request order/session locks;
no reverse lock edge was found in that function. No invoice/void policy was
changed. Simultaneous void/receipt behavior has not been separately exercised.

## Extended verification

- Added eight deterministic tests: cancellation, quantity edit, online attempt
  creation and online settlement, each with/without checkout committing while
  the worker waits. All eight fail when only the new second migration is
  omitted; all pass with it. Session blocking is observed via pg_blocking_pids.
- Checkout-winning cancellation/quantity races reject and preserve order total.
- Online settlement after checkout preserves the invoice totals snapshot and
  creates exactly one supplemental receipt for the recorded payment.
- Distinct concurrent full-balance collection requests produce one recorded
  payment and one supplemental receipt; a later overcollection is rejected.
- Partial counter payments remain disallowed by the existing exact-due rule.
  An initial partial-collection test assumption was corrected, not the policy.
- Latest native PostgreSQL 18.6 run: **31 passed** (27 readiness + 4 throttle).
- Latest ordinary unit run: **1946 passed, 31 skipped**; native tests above run
  separately with an explicit disposable database URL.
- Typecheck, lint, design guard, production build and diff checks pass.

## Rollout gates and limits

Local implementation and the targeted concurrency audit are complete for these
paths, but Phase 1 rollout is not approved or deployed. Remaining gates:

1. Independent diff review and cross-version PostgreSQL CI.
2. Populated forward-upgrade/recovery verification; only clean migration replay
   was run here. No staging/production migration has been applied.
3. Broader permission/retry/property-based financial coverage, including provider
   amount mismatch concurrency, payment-first checkout schedules, simultaneous
   invoice voiding, and external provider end-to-end callbacks.

This is not proof of zero deadlocks in arbitrary administrative SQL or all
possible schedules, nor a complete money-policy audit. No production capacity,
GST, subscription or provider-integration certification is claimed. No changes
to rate limits, existing data or production resources were made.

## Follow-up: populated upgrade and recovery gates

- Added opt-in `READINESS_FINANCIAL_UPGRADE=1` to the existing loopback-only,
  random-database verifier. Before the first Phase 1 migration, it seeds a
  restaurant, owner, menu, order, issued invoice, recorded payment, audit event
  and supplemental receipt using the pre-upgrade RPCs.
- Before/after fingerprints match for all rows across 35 tables, table ACL/RLS,
  48 policies and 117 function signatures/ACL/security settings. Function bodies
  are intentionally excluded because changing those bodies is the upgrade.
- The PostgreSQL 15/17/18 CI matrix now opts into this populated upgrade guard
  before its existing logical dump/restore drill. This workflow change has not
  yet run on GitHub; configured is not verified.
- Added payment-first checkout concurrency test: checkout waits for the payment
  transaction, then snapshots `amount_paid_paise=25000` with no supplemental
  receipt. The checkout-first schedule remains covered by earlier tests.
- Updated local PostgreSQL 18.6 verification: **32 native tests passed**.
- Existing offline cold-recovery drill passed with **58 migrations, 35 tables,
  34 orders, 8 payments and 8 invoices**, recovering in **1166 ms** in this run.
  It removes only its original disposable cluster and restores a clean-shutdown
  physical copy; this is not live backup/PITR, hosted restore or logical pg_dump
  verification.

These supersede the earlier clean-replay-only/local-recovery gaps. Independent
review, cross-version CI and external provider end-to-end coverage remain open.
No hosted migration, commit, push or merge was performed for this validation.

## Follow-up: provider edge cases and local cross-version evidence

Added native regressions for:

- Pending provider amount mismatch: rejection leaves payment pending, provider
  payment reference null, order pending, and no payment audit event.
- Matching successful provider retry returns the same payment UUID and leaves
  one online collection audit event and exactly the order total recorded.
- EXECUTE privilege and actual authenticated-role rejection on the
  service-only provider settlement function.
- Void-first interleaving: settlement waits for the invoice row held by the
  voider, then records the payment without a supplemental receipt against the
  now-voided invoice. This tests one direction, not every void/reissue schedule.

Latest isolated populated forward-upgrade + native test results:

| Local PostgreSQL | Native tests | Financial data/security fingerprint |
| --- | --- | --- |
| 15.19 | 35 passed | preserved, 35 tables / 48 policies / 116 functions |
| 17.11 | 35 passed | preserved, 35 tables / 48 policies / 116 functions |
| 18.6 | 35 passed | preserved, 35 tables / 48 policies / 117 functions |

Function counts differ between PostgreSQL releases; equality was checked
before/after within each version, not by comparing versions to each other.
The additional PostgreSQL binaries/tools were installed outside the repository;
no application dependency or lockfile changes were needed. Their disposable
servers were stopped after each run. No hosted connector/database was used.

Latest full unit suite: **1946 passed / 35 skipped** (database tests executed
separately above). Typecheck, lint, design guard, production build and diff
checks passed. Repeated offline PostgreSQL 18 cold recovery also passed with
58 migrations / 35 tables / 36 orders / 10 payments / 9 invoices, in 1125 ms.

Local cross-version validation is now covered. GitHub CI execution, independent
review and real provider end-to-end verification remain unperformed. No commit,
push, merge or migration deployment was performed in this follow-up.
