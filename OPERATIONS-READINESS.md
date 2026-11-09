# Safe verification and release runbook

## Nonproduction checks

Use Node 22+, install locked dependencies, and do not load production credentials:

```sh
npm ci
npm run typecheck
npm run lint
npm run design:check
npm run sql:check       # DDL parser only, not native SQL verification
npm test
npm run build
npx playwright install chromium
npm run e2e
```

The demo browser suite intentionally has no database secrets. Integration cases require their documented `E2E_*` accounts/deployment and a disposable stack; skipped cases are not verified. The optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and JSON-array `PLAYWRIGHT_CHROMIUM_ARGS` support sandbox-installed Chromium; normally omit both. The browser server is port 3100, distinct from development port 3000.

### Native migration/security/concurrency checks

Start a **local** disposable PostgreSQL service with a superuser able to create databases. No production URL is accepted. The runner creates a random `autodine_check_*` database, emulates only platform schemas/default grants, applies sorted migrations without application-table scaffolds, runs real DB tests, then drops its own database even on failure:

```sh
READINESS_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db
```

Match the project's PostgreSQL 15 baseline and test newer versions separately. This session used PostgreSQL 18.6 locally. GitHub CI matrix 15/18 is configured but has not run remotely. Supabase Auth/Storage/Realtime are not emulated by these SQL tests.

### Populated backup / restore drill — implementation is not success evidence

Install matching native PostgreSQL client tools, then:

```sh
READINESS_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres \
READINESS_VERIFY_RESTORE=1 npm run test:db
```

Alternatively CI supplies `READINESS_PG_CONTAINER` with its local disposable PostgreSQL service container ID; the runner invokes the container's matching `pg_dump`/`pg_restore` using `docker exec`, never a cloud project. A custom-format archive stays in process memory, bounded to 64 MB. Restoration creates a second random local database and compares all public/auth/storage table row counts/content fingerprints, public policies and function grants. It drops the restored database in `finally`. Success must print `LOCAL_RESTORE_VERIFIED`; lack of this message is not success. This tests small fixtures, not large production backup retention, WAL/PITR, Storage objects, secrets, provider Auth restoration or full service recovery.

**Session result: NOT EXECUTED successfully** because matching dump/restore tools were unavailable. Run the new CI job before claiming drill readiness.

### Verified local cold physical recovery (separate from logical dump/PITR)

Run `READINESS_PG_BIN=/path/to/postgres/bin npm run test:recovery:cold`. This creates its own fresh clusters, applies 55 migrations, runs native tests, fingerprints populated application/platform-shim data and privileges, stops cleanly, copies the physical cluster, deletes the original and restores/restarts the backup on another loopback port. It accepts no existing database URL/data directory. Latest local result: **20 native tests passed; 35 tables/23 orders/1 payment/2 invoices recovered**, 913 ms tiny-fixture recovery phase. This is not a production RTO, online backup or PITR result. See [STAGING-PREFLIGHT.md](STAGING-PREFLIGHT.md) for exact hosted blockers and staging plan. Logical `pg_dump`/`pg_restore` CI remains unrun.

## Before applying migrations to any deployed environment

1. Obtain separate deployment/data-change approval; take and verify a recoverable backup in the approved environment.
2. Inventory `supabase_migrations.schema_migrations` and actual schemas/constraints/functions/policies/grants in a sanitized staging clone. Do not expose service keys or customer data in logs.
3. Specifically compare the restored historical ledger migration `20261107080000_payment_audit_ledger.sql` with deployed `payment_audit_events`, `payments.recorded_by`, foreign keys and actual history. **Do not blindly run migration repair, reset, --include-all or push a backdated migration.** Resolve history/schema differences in an approved forward reconciliation plan.
4. New migrations revoke direct financial writes, constrain kitchen transitions, guard pending online settlements, freeze issued receipt sources, correct zero-quantity deletion and add RLS-preserving floor-plan aggregation. Confirm every deployed writer uses the intended RPCs first.
5. Replay on the staging clone, run native tests plus full authenticated end-to-end workflows, reconcile money/snapshots and test old clients/retries. Verify default grants do not reopen revoked entrypoints.
6. Rollback strategy is a reviewed forward fix or approved restore/cutover. Do not “roll back” by dropping financial ledgers/receipts or regranting unsafe direct money updates. Document irreversible data migrations before approval.

## Deployment readiness / monitoring

- Configure `AUTODINE_MODE=live`; database absence must produce operational 503, not demonstration orders. Demo mode is for nonproduction only.
- Configure browser-safe Supabase URL/publishable key, server-only secret key, canonical site URL, approved auth redirect allowlist, webhook settings, storage policies and provider capabilities. Never place a secret key in `NEXT_PUBLIC_*`.
- `/api/health`: 200 only when readiness probes pass; unready returns 503/no-store. Missing operational schema/credentials should alert, not be silently ignored. Public health output contains no DB error messages/tenant rows.
- Configure an external uptime check and real log/alert destination. Track 5xx/503, DB pool exhaustion, lock waits/deadlocks, failed order attempts, failed callback/settlement reconciliation, guest throttle volume, Realtime reconnects and voice fallback. The route-error JSON hook is not an alerting product.
- Generated HTML `X-Request-ID` supports support correlation; the server error hook logs route templates and error digests, not raw order-token URLs, cookies or request body. Other existing log sites still require a redaction review.
- Establish explicit RPO/RTO, backup ownership/encryption/retention and a scheduled restore drill. Inventory Storage files and Auth metadata separately from application DB rows. Test restoration into isolated staging, never overwrite production to prove a backup.

## 5,000-user qualification plan (not executed)

Agree on “users”: simultaneous diners, logged-in staff, outlets, or daily active users are different workloads. Create tenant-isolated synthetic data at realistic menu/order/history sizes. Measure authenticated browser/HTTP throughput and latency, 5xx, queue/pool utilization, CPU/memory and DB lock metrics for browse→scan→deduplicated submit→kitchen→incremental submit→manual payment→receipt. Include duplicate/out-of-order retries, offline/reconnect, auth expiry, pending provider payment, cancel/settle/close races, rate-limit abuse, Realtime fanout and long-lived history. Start low, ramp gradually, add a sustained soak and recovery period. Agree pass/fail SLOs and verify correctness/reconciliation after load. Never extrapolate the 16-client SQL sample to 5,000 users.

## Go-live acceptance

- [ ] Deployed migration history reconciled; backups and restore actually verified.
- [ ] Unit/native/browser gates pass; skipped live workflows executed in disposable staging.
- [ ] All approved role/tenant workflows persist and survive relogin; auth/email/storage/Realtime verified.
- [ ] Pending, duplicate and concurrent money operations reconcile with immutable issued documents.
- [ ] Tax/GST/discount/refund/commercial-subscription decisions approved and implemented/tested as required.
- [ ] TTS public/auth contract and distributed abuse limits approved; supported-service/device acceptance complete.
- [ ] Payment provider tested; manual-only launch explicitly accepted if online collection remains disabled.
- [ ] Real print/PDF/share, Android/iOS/desktop and assistive/reduced-motion acceptance complete.
- [ ] SLO-based load/soak evidence, alerts, incident owner, rollback/cutover and recovery drills signed off.
- [ ] Separate production deployment authorization received.
