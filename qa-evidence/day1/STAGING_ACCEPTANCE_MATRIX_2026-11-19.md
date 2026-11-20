# Staging acceptance matrix — 14 points scored (2026-11-19, Priority 7)

This scores the fourteen acceptance points defined in
[`docs/staging-authorization-and-acceptance-2026-11-19.md`](../../docs/staging-authorization-and-acceptance-2026-11-19.md)
§5 against **actual evidence**, not against the existence of a document.

**Nothing here authorizes a hosted action.** A "PASS (local)" means the behaviour
is demonstrated on a disposable PostgreSQL 17 cluster or a locally built
application against synthetic data. It does **not** mean the behaviour is proven
on a hosted project, and it is never a substitute for the hosted run.

| Legend | Meaning |
|---|---|
| **PASS (local)** | Demonstrated on a disposable cluster / local build, with the command and result recorded |
| **BLOCKED** | Cannot run without an action the owner has not authorized (target, migration, provider, restore) |
| **FAIL** | Attempted and did not meet the criterion |
| **N/A** | Does not apply to the current state |

## 1. The fourteen points

| # | Point | Local | Hosted | Evidence | Exact command | Owner decision | Needs hosted authorization |
|---|---|---|---|---|---|---|---|
| 1 | Identity and target | **BLOCKED** | **BLOCKED** | Candidate metadata read 2026-11-19: `autodinetest`, `juwyhslzchjevqkdvwjm`, ap-northeast-2, PG 17.11.0.018, ACTIVE_HEALTHY (Report A §1). No project is *designated* Staging | Project settings; `select version()` | **A3** — designate a target or create one | Read-only metadata; application: no |
| 2 | Ledger parity | **PASS** (candidate, 2026-11-19) | **PASS** (as of this date) | 13 ledger rows, all mapped: 6 repository files verified statement-for-statement, scaffold, content-addressed bundle, probe, 3 owner migrations, 1 third-workstream file. One renamed table now proven (Report A §2, §4.1) | `select version, name, created_by from supabase_migrations.schema_migrations order by version` | Confirm the 2026-11-19 entry (A1) | Read-only |
| 3 | Authorized replay only | **PASS (local)** / **BLOCKED** (hosted) | **BLOCKED** | Full chain replays clean from 119 migrations: 272 passed / 3 skipped, 10 files. Nothing has been applied anywhere from this branch | `npm run test:db:embedded` | Authorize the exact file set | **Yes** |
| 4 | Role / RLS matrix | **PASS (local)** | **BLOCKED** | 13 integration suites / 293 tests replayed from the repository migrations, each acting as `anon` / `authenticated` / member / other-tenant owner, including the 6 new QR-lifecycle tests | `npm run test:db:integration` | — | **Yes** (hosted run) |
| 5 | Auth round-trip | **BLOCKED** | **BLOCKED** | `scripts/staging/auth-acceptance.mjs` exists and needs a hosted URL + a synthetic account; no hosted call made | `node scripts/staging/auth-acceptance.mjs <url>` | Provide the target and a synthetic account | **Yes** |
| 6 | Guest journey | **PASS (local)** | **BLOCKED** | Journey suite **20/20 passed** (2.7 min, exit 0) on a production build: QR scan → menu → order → kitchen → checkout → receipt | `npm run test:e2e:journey` | — | **Yes** |
| 7 | Unregistered receipt | **PASS (local)** | **BLOCKED** | `e2e/journey/nogst.desktop.spec.ts` → *"unregistered: retail receipt, no GSTIN or tax breakup, retry keeps one order"* | `npm run test:e2e:journey` | — | **Yes** |
| 8 | Composition receipt | **PASS (local)** | **BLOCKED** | `e2e/journey/nogst.desktop.spec.ts` → *"composition: tax-free Bill of Supply with the statutory declaration"* | `npm run test:e2e:journey` | Adviser sign-off on the composition declaration text (Tier 4, C2) | **Yes** |
| 9 | IRP rehearsal | **PASS (local, simulated)** | **BLOCKED** | `e2e/journey/irp.simulation.spec.ts` (2 journeys) + `irp-closed` + 64 `readiness` integration tests. Simulated responses are stored as simulations; no legal IRN, no printable tax invoice, no hold release | `npm run test:e2e:journey` · `npm run test:db:integration` | Provider decision (separate) **and** authorization of the 26 GST/IRP files | **Yes** |
| 10 | Realtime fallback | **PASS (local)** | **BLOCKED** | `e2e/journey/realtime.desktop.spec.ts` → *"a committed kitchen change reaches staff over the socket, and a dropped socket recovers"* | `npm run test:e2e:journey` | — | **Yes** |
| 11 | Payment reconciliation | **PASS (local)** | **BLOCKED** | `e2e/journey/counter.desktop.spec.ts` (4 journeys, incl. two-tab double-recording) + counter-payment integration coverage. Synthetic methods only; no money moves | `npm run test:e2e:journey` · `npm run test:db:integration` | — | **Yes** |
| 12 | Print / share / redaction | **PASS (local)** | **BLOCKED** | `e2e/journey/privacy.desktop.spec.ts` (driver details never surfaced) + share-link journeys in `irp.simulation` | `npm run test:e2e:journey` | — | **Yes** |
| 13 | Rate limits | **PASS (local)** | **BLOCKED** | `app/menu/throttle-db.integration.tsx` (16 concurrent guests persisted) + `integrity.desktop.spec.ts` scan-limit and code-budget journeys | `npm run test:db:integration` · `npm run test:e2e:journey` | — | **Yes** |
| 14 | Recovery / rollback | **BLOCKED** | **BLOCKED** | No restore has ever been executed against a hosted target; PITR is not purchased (`docs/backup-restore-runbook.md` is a procedure, not evidence) | Runbook §restore, on an authorized target | Decide PITR/add-on and authorise a restore rehearsal | **Yes** |

**Score:** **11 of 14 pass locally**, 3 are blocked, none fails. On hosted,
**1 passes** (ledger parity — a read-only observation made today) and **13 are
blocked** by the missing target, the missing authorization or the missing restore
path.

## 2. What this proves and what it does not

**Proven locally:** the repository's own migrations produce a schema on which
every product path works with the security boundaries intact — including the two
QR functions after the fix, the guest journey that depends on them, GST receipts
in both modes, the IRP simulation, realtime fallback, payments, printing, sharing
and rate limits.

**Not proven:** that any of it behaves identically on `autodinetest`. That
project runs an older schema, has no GST/IRP objects at all, and still carries the
unfixed QR functions. A local PASS is not a hosted PASS, and this matrix does not
treat it as one.

## 3. Minimum remaining requirements for a legitimate staging baseline

Ordered, one migration at a time, each step stopping for a decision:

1. **Designate the target** (owner, decision A3). Either accept `autodinetest`
   with its recorded history (Report A §9) or create a fresh project. No reset,
   no repair.
2. **Apply exactly one file** — `20261118002200_qr_code_staff_boundary.sql` —
   after a written decision naming it and the target. It is forward-only,
   signature-preserving, and closes F-01, F-02 and F-03. Verify with the two
   queries in §4 and with `verify-qr-finding.mjs`'s expected outcome (outsider
   `42501`, own owner allowed, one live card).
3. **Re-run acceptance points 2 and 4** (read-only) on that target and capture
   the dumps.
4. **Decide the remaining schema gaps** — the 92 branch functions absent from the
   candidate are GST/IRP/realtime work that is *individually* NOT AUTHORIZED;
   none of it is needed to close a security finding.
5. **Settle the two housekeeping items**: the local scaffold (A6) and the older
   `owner_billing_configuration_guard` revision (A5).
6. **Execute points 5–13** against the designated target with synthetic data
   only, and **point 14** only after a restore path exists.

Steps 1, 2, 4, 5 and 6 need the owner. Only step 3 is read-only.

## 4. Post-application checks (for whoever is authorized to apply the file)

```sql
-- both must show membership=true, auth_exec=true
select p.proname,
       pg_get_functiondef(p.oid) ilike '%has_restaurant_role%' as has_membership_check,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('rotate_table_qr_code','retire_table_qr_code');

-- the invariant the race fix protects: at most one live card per table
select table_id, count(*) from public.table_qr_codes
 where revoked_at is null group by table_id having count(*) > 1;
```

The second query must return no rows, before and after.
