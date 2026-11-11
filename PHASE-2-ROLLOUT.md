# Phase 2 — release/cutover checklist (not executed)

## Status

Local implementation/test evidence is in PHASE-2-RATE-LIMITS.md. This document
is a proposed procedure, NOT authorization to modify a hosted database. No
production or staging deployment has been performed.

Migration 20261110000400 deliberately revokes the old public ordering RPC.
New application code calls place_public_order_attempt and fails closed if it is
absent. Old app/new schema and new app/old schema are incompatible. A routine
uncoordinated Vercel deployment plus database migration is NOT safe here.

## Before staging

- Commit/review code and inspect the exact migration diff and function ACLs.
- Require GitHub CI on the exact release SHA, including PostgreSQL 15/17/18.
- Explicitly approve the new attempt policies: 60/session and 120/restaurant per
  ten minutes. These can throttle valid sessions sharing a busy restaurant.
- Identify every app/preview/server-action consumer of the target database.
  Do not leave an old build active against the cut-over database.
- Prefer an isolated staging clone/project. Preserve existing data and take a
  platform-supported backup; local cold-recovery results are not hosted backup
  evidence. Verify restore access before a production change.
- Check PostgREST transaction configuration, especially any option permitting
  Prefer: tx=rollback. A client-requested rollback would undo admission counters.
- Confirm trusted proxy header provenance independently. This migration does
  not turn optional/caller-supplied IP hashes into authentication.

## Staging maintenance cutover — only after explicit approval

1. Restrict guest ordering and drain in-flight order requests using the actual
   deployment/edge mechanism. A banner alone is not an admission gate. Ensure
   direct old-RPC callers cannot mutate during the maintenance period.
2. Apply only reviewed pending migrations, in repository order, through the
   approved migration runner. Do not execute a reset/reseed or erase history.
3. Deploy the exact compatible app SHA to every permitted consumer. Keep
   ordering restricted until database and app contract checks pass.
4. Verify, without exposing keys/tokens in logs:
   - new RPC exists and anon/authenticated have EXECUTE;
   - old six-argument RPC denies anon/authenticated EXECUTE;
   - operational readiness reports the versioned API available;
   - valid isolated guest fixture can order and retry without duplication;
   - malformed orders return JSON errors rather than aborted transactions;
   - the attempt counter persists across separate REST requests;
   - configured attempt and successful-order caps cannot be bypassed by changing
     IP hashes or creating fresh sessions within one tenant;
   - invalid/expired/wrong-tenant credentials cannot create orders;
   - shared-Wi-Fi scan, scan-confirm holds, counter/checkout and receipts work.
5. Restore ordering only after checks pass. Monitor errors/latency/refusals;
   distinguish attempt-limit refusals from successful-order capacity refusals.

Fixtures must be explicitly isolated and approved, never customer data. Real
charges/provider settlement are not required for these checks.

## Rollback gates

Do NOT roll back only the app: the previous build calls the revoked RPC.
Keep ordering restricted while choosing a reviewed coordinated rollback:

- Prefer forward correction if data and financial invariants remain intact.
- If restoring the old app contract is necessary, restoring old RPC EXECUTE
  privileges and its corresponding readiness probe must be paired with the
  compatible app. This temporarily removes durable failed-attempt enforcement;
  it needs explicit security approval and compensating edge restrictions.
- Never restore an old database backup over post-cutover orders merely to roll
  back code. Do not delete counters, invoices or payment ledger rows.
- Re-run contract, idempotency and financial checks before reopening ordering.

No automatic rollback SQL or deployment command is bundled: the current target,
applied migration ledger, active builds and backup state must first be reviewed.

## Remaining release gates

Independent review, exact-SHA GitHub CI, hosted REST transaction verification,
proxy trust verification, and explicit rollout authorization remain outstanding.
Phase 3 hosted load testing is separate and has not started.
