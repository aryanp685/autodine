# Phase 7 — recovery, RPO and RTO evidence (Phase 2)

**Phase 2 status: LOCAL SYNTHETIC COLD-RECOVERY PASS; HOSTED RECOVERY AND RPO/RTO UNVERIFIED.** The local drill was run only against a fresh disposable PostgreSQL 17.11 cluster containing synthetic fixtures. It is not a Production backup, Supabase PITR, provider restore, or pilot recovery guarantee.

## 1. Current execution — Local only

Command:

```bash
READINESS_PG_BIN="$PWD/node_modules/@embedded-postgres/linux-x64/native/bin" npm run test:recovery:cold
```

The runner (`scripts/verify-cold-recovery.mjs`) created a random temporary loopback PostgreSQL cluster and database, applied the local Supabase shim and all **77 checked-in migrations**, inserted only synthetic/local ACL and application fixtures, ran the native PostgreSQL readiness/throttle tests, computed table-content/RLS/policy/function-grant fingerprints, shut down cleanly, copied the physical data directory, removed the original disposable cluster, restored from that copy on a different loopback port, and compared the recovered fingerprints and privilege checks. The temporary directories and clusters were removed by the runner.

**Observed result:** `LOCAL_COLD_RECOVERY_VERIFIED`; 67 local PostgreSQL tests passed (62 readiness + 5 throttle), zero failed; 45 tables; 117 synthetic orders; 20 synthetic payments; 10 synthetic invoices; original cluster removed; physical snapshot recovery phase reported **1,470 ms**. A separate `npm run test:db:embedded` on the current checkout also passed **130/130** native DB tests across five files after replaying the same 77 migrations.

The 1,470 ms is only a small local synthetic copy/restart/fingerprint measurement. It excludes the provider, network, operator detection/decision time, customer traffic, Auth/Storage/Realtime, Vercel, DNS, secrets, and service cutover. It must not be described as the service RTO, a Production restore time, or a performance/capacity result. The local snapshot was taken from a newly populated synthetic DB, not from either hosted project; no hosted credentials or data were read.

## 2. Test / Preview, Staging and Production recovery evidence

| Environment | Evidence at this phase | Result |
|---|---|---|
| Local | Fresh disposable PostgreSQL 17.11 physical-copy/recovery run above. | **PASS — local synthetic physical recovery only.** |
| Test / Preview | No current hosted backup artifact or restore was requested or performed. The project-to-Staging mapping is still unconfirmed. | **UNKNOWN — no hosted Test restore evidence.** |
| Staging | No distinct Staging project was returned, and no owner-accepted restore target/source point/window/data policy was recorded. | **BLOCKED — no Staging restore evidence.** |
| Production | Supabase connector provides no evidenced read-only Backups/PITR/retention view in this execution. No Production backup, PITR configuration, restore point, dump, restore, or data query was performed. | **UNKNOWN — Production recovery gate remains red.** |

Older repository/runbook references to a private backup and a November 10 restore are historical only. They have not been inspected or re-created here and do not establish a fresh backup, present retention/PITR status, recoverability of current Production, or a contractual RPO/RTO. No backup archive or customer data is included in this repository.

## 3. RPO/RTO decision status

No numeric Recovery Point Objective (maximum acceptable data loss) or Recovery Time Objective (maximum acceptable service interruption) has been specified for the limited pilot. No values are inferred from the local test, provider plan, historical backup date, migration cadence, or synthetic test duration.

**Required owner/operator inputs before pilot acceptance:**

1. Written maximum acceptable data-loss interval and service-restoration interval for the pilot, including scope (database, Auth identities, Storage assets, and application/configuration).
2. Approved backup/PITR schedule, retention window, encryption/access owner, restore-point verification method, and a named operator accountable for recovery.
3. Approved isolated restore target, source snapshot/restore point, window, data-handling/sanitization rule, and cleanup/retention owner for a hosted drill. Production is never the restore target.
4. Restoration sequence for schema/data, Auth, Storage, Edge Functions/secrets, Vercel config/deployment, DNS/domain, scheduled jobs, and Realtime; define how service is held or cut over and how financial/order reconciliation is verified.
5. Explicit pilot go/no-go thresholds and a successful rehearsal against the approved non-Production target. Any access required must be provided through the authorized provider UI/connector; never send credentials, backup files, or customer data in chat or Git.

Until these inputs and provider evidence exist, RPO and RTO are **UNKNOWN**, not zero and not passed. A local synthetic test is not a substitute.

## 4. Safety and next steps

- No Production database change or test is authorized or implied by this report. No hosted restore has been attempted.
- Before any Staging migration, first obtain current backup/PITR metadata and a successful approved isolated restore, then complete target/migration review and preserve exact pre/post catalog evidence.
- The current sandbox has the embedded PostgreSQL binaries in ignored `node_modules`; no OS packages, Docker daemon, native service, or paid resource was installed or started.
- The tool/runtime clock was 2026-11-13 while Arena's authoritative date is 2026-11-06. The local run is reported with its measured duration only; no timestamp-based hosted acceptance is inferred.

**Phase 2 outcome:** local synthetic cold-recovery test passes; hosted recovery, RPO, and RTO remain open release gates.
