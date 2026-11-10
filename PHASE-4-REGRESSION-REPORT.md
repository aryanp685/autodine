# Phase 4 — regression execution, hosted peak/soak pending

## Release status and authorization

User approved staging-only coordinated cutover, PR175 merge, and Phase4 work.
PR175 was already committed at `9babf9a3654ba3baa21c89fe1d8bc00b7c33e6e3`.
All reported checks passed before explicit `gh pr merge 175 --merge` succeeded.
GitHub confirms merge commit `8ae4feb01459238ffbace429a7ef1859529ef702`.
Work remains on session branch `arena/6d8badd1-autodine`; no branch switch.
Main automatic Vercel deployment hold remains unchanged in vercel.json.
Merge is not evidence of a hosted database cutover or application deployment.

## Executed regression evidence

Run against local source `9babf9a`, containing the code merged in PR175:

| Check | Observed result |
|---|---|
| Ordinary Vitest suite | 1,954 passed; 50 DB tests skipped in this ordinary run |
| Dedicated native PostgreSQL17.11 suite | 50 passed across two test files |
| Populated financial forward upgrade | preserved: 35 tables, 48 policies, 116 function security entries at financial boundary |
| Phase3 node safety/builder tests | 12 passed |
| Typecheck | passed |
| Whole-repository lint | passed |
| Design system guard | passed |
| Application build | passed |
| SQL static check | passed; not a substitute for native SQL execution |

Native PostgreSQL was installed outside the repository. A scratch orchestration
script created/started a local17.11 cluster, ran the repository's disposable
`verify-database.mjs` with READINESS_FINANCIAL_UPGRADE=1 and stopped the server.
The runner creates/deletes only its own random loopback autodine_check_* DB.
No customer dump, existing database or app deployment credentials were used.
READINESS_VERIFY_RESTORE was NOT enabled in this local run: do not describe this
run as a new logical restore test. Earlier CI recovery and user-run backup
restore evidence are separate, with their previously documented limitations.

Ordinary-suite DB skips are not counted as passing; the dedicated native run is
separate evidence. No new browser execution occurred locally during this turn;
PR175's green browser check is prior GitHub evidence, not a new hosted guest
ordering/payment run. Independent review remains unperformed.

Local diagnostic logs (not durable deliverables):
`/tmp/phase4-unit.log`, `/tmp/phase4-native.log`, `/tmp/phase4-build.log`,
`/tmp/phase4-probe.log`, `/tmp/phase4-sql.log`.

## NOT completed — must not be inferred from regression results

- Coordinated hosted staging migration and matching app isolation/cutover.
- Actual HTTP baseline invocation with securely configured staging public key.
- Real REST transaction counter persistence / caller rollback handling.
- Production proxy trust provenance.
- Hosted order/scan load, contention/pool measurements and bottleneck comparison.
- Peak/soak workload, sustained error/latency measurements, capacity estimate.
- Hosted financial/payment-provider end-to-end verification.
- Full ownership/ACL disaster recovery drill or independent review.
- Production database migration or production release.

Approval is recorded; remaining barriers are technical, not a request to repeat
permission. The last observed staging catalog lacked the new attempt API and
retained the old public API. We have not established that all active app
consumers are isolated to staging with matching credentials or that a real
ordering-RPC maintenance/drain mechanism is in place. Applying the five-source
candidate before that would knowingly break old-build ordering. Do not blindly
apply the rehearsal SQL as a hosted migration payload (it includes transaction
statements and does not implement provider migration ledger integration).

## Remaining execution sequence

1. Verify exact staging app/project/branch mapping and staging-only public/server
   credentials without inheriting production fallbacks. Preserve share access
   protection and never expose credentials in chat or logs.
2. Prepare and verify a direct-RPC-aware staging admission/drain gate and
   coordinated rollback. Preserve pre-cutover row-content/ACL evidence and
   restore readiness; retain all existing staging data.
3. Recheck the seven function fingerprints/ACLs/settings and bundled manifest;
   use the approved native-rehearsed delta through a reviewed transactional
   hosted migration runner. Reject drift, no reset/history rewriting.
4. Deploy matching isolated staging app, verify schema/ACL/readiness and genuine
   guest flows/REST persistence, then reopen only after checks pass.
5. Run bounded, fixture-scoped staged load with explicit request/time/concurrency
   ceilings, stop on unexpected errors/latency/counter anomalies. Separate
   expected throttling from failures; never generate real charges.
6. Only then run the defined peak/soak window and publish exact duration,
   achieved rates, percentile sample sizes, error/refusal counts, lock/pool
   metrics and app/schema SHAs. Phase4 remains incomplete until these exist.

No zero-bug, production-capacity, peak-ready or soak-passed claim is made.
