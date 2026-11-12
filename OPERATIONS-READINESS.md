# Safe verification and release runbook

> **Current evidence note (Arena date 2026-11-06 UTC):** This PR reconciliation has not changed a database or created a deployment. GitHub PR/check metadata and Vercel project metadata were inspected read-only; no Supabase database, recovery target, or payment-provider operation was performed. Staging remains NO-GO and Production remains read-only. A READY Preview or green health probe is not launch acceptance. See `RELEASE-BLOCKER-REPORT.md` for the live blocker register.
>
> Historical CI, Preview, and restore statements below are dated evidence from earlier snapshots, not results of this reconciliation. Do not execute a restore under this task; any separately requested restore must name an isolated non-production target and have explicit approval.

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

The reconciled GitHub CI matrix is PostgreSQL 15/17/18; no current-branch matrix result is claimed from this local run. Supabase Auth/Storage/Realtime are not emulated by these SQL tests.

### Populated backup / restore drill — implementation is not success evidence

The helper can be invoked with matching local PostgreSQL client tools, but this is a restore operation and is **not approved for execution by this task**. The current CI workflow deliberately does not set `READINESS_VERIFY_RESTORE=1`. Once written approval names a separate isolated non-production target, the helper can create a second disposable local database, compare row-count/content fingerprints, policies and function grants, then drop that database. The archive is held in process memory (maximum 64 MB). This tests a synthetic local dump only—not provider backups, production retention, WAL/PITR, Storage objects, secrets, Auth restoration, or full service recovery.

**Current continuation: NOT EXECUTED.** The helper is not restore-drill evidence; no output from it should be presented as such.

### Imported historical local cold-restore report (not reverified here; not PITR)

`main` records a local physical recovery run with **20 native tests passed; 35 tables/23 orders/1 payment/2 invoices recovered**, 913 ms tiny-fixture recovery phase. This continuation did not execute or independently verify that run. Even if valid, it is not a provider backup, production RTO, online backup, Supabase PITR, or Auth/Storage recovery result. Any new restore drill requires explicit written approval and a separately named non-production target before execution. See [production-readiness-continuation.md](docs/production-readiness-continuation.md) for required access and approval details.

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
