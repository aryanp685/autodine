# Security findings register — 2026-11-19 (updated 2026-11-19, Priority 7)

One row per finding, with the four facts a reader needs: what it is, how it was
proven, what state it is in, and what would be needed to close it. Findings are
separated from **audit observations**: an audit flag is not a vulnerability, and
an unexplained schema object is not an intrusion.

Sources: [Report A — staging drift](STAGING_DRIFT_INVESTIGATION_2026-11-19.md) ·
[Report B — definer review](DEFINER_SECURITY_REVIEW_2026-11-19.md) ·
[cross-check](SECURITY_AND_STAGING_CROSS_CHECK_2026-11-19.md) ·
[staging acceptance matrix](STAGING_ACCEPTANCE_MATRIX_2026-11-19.md).

**State of the three code findings: all three are fixed in the repository and
verified on a disposable database; none is applied to any hosted project.**

**Production exposure (verified 2026-11-19, read-only).** The vulnerability is
not confined to the candidate. On `autodine-production` (`bdbaqpevwmgdvghszjno`)
both RPCs are present with `has_membership_check = false` and
`EXECUTE` granted to `authenticated` — i.e. the same unfixed bodies are live
there. Production also carries `20261119101116_announcement_claim_recovery`, so
the ledger is current but the QR boundary file is absent (it is absent from this
branch's 119 files as well; see O-06).

## 1. Vulnerabilities

### F-01 — `rotate_table_qr_code` has no tenant-membership guard (QR-01)

| Field | Value |
|---|---|
| Severity | **High** (cross-tenant write into another outlet's guest flow) |
| Surface | `public.rotate_table_qr_code(uuid)`, `SECURITY DEFINER`, `EXECUTE` to `authenticated` |
| Preconditions | Any signed-in account; the target `table_id` (guests receive it from `current_table_session()`); victim's plan/trial writable |
| Impact | Revokes the victim's active cards and **returns the new 64-character `public_token`** → order injection into a foreign kitchen, plus a printed QR under the attacker's control |
| Evidence | Reproduced on a disposable local database (`scripts/local-pg/verify-qr-finding.mjs`): PRE-FIX token returned for an outsider; POST-FIX `42501`. Live on the candidate: `has_membership_check=false`, `auth_exec=true`. **Live on production too** (`bdbaqpevwmgdvghszjno`, 2026-11-19): same two predicates, `anon_exec=false`, `auth_exec=true` |
| Fix | `20261118002200_qr_code_staff_boundary.sql` — `has_restaurant_role(…, array['owner','manager'])` before the billing gate; signature and grants unchanged |
| Regression test | `lib/db/phase0-security.integration.test.ts` → `table QR lifecycle` (6 tests, including anon, manager, cashier/kitchen, null/unknown id) |
| State | Fix written, tested, **NOT APPLIED** |
| To close | Written authorization naming the file and the target project |

### F-02 — `retire_table_qr_code` has no tenant-membership guard (QR-02)

| Field | Value |
|---|---|
| Severity | **High** (cross-tenant denial of service on the victim's printed cards) |
| Surface | `public.retire_table_qr_code(uuid)`, same shape as F-01 |
| Impact | Revokes the active card and inserts nothing; guests scanning the outlet's printed QR can no longer order until an owner rotates |
| Evidence | Same reproduction script (retire succeeded PRE-FIX, `42501` POST-FIX); same hosted probe, and the same production predicates as F-01 |
| Fix / test / state | Same file, same test block, **NOT APPLIED** |

### F-03 — QR rotation is not serialised, so two live cards can survive (added 2026-11-19)

| Field | Value |
|---|---|
| Severity | **Medium** (integrity; no cross-tenant path on its own) |
| Surface | Both RPCs — `select … dining_tables` took no row lock before `update`/`insert` |
| Preconditions | Two requests for the same table overlap (double click, retry, two managers) |
| Impact | Two concurrent rotations each revoke and insert without seeing the other, leaving **two live cards** for one table; a retire that races a rotate can return success while a fresh card stays live. The table contract is "a live card is one with `revoked_at null`" |
| Evidence | Two real concurrent sessions on a disposable database: **PRE-FIX 2 live cards, POST-FIX 1** (`verify-qr-finding.mjs`, `PRE-FIX/POST-FIX: two concurrent rotations`) |
| Fix | Same migration: `select … from public.dining_tables … for update` before the checks, so the second caller waits and then observes the first caller's card |
| Regression test | `table QR lifecycle` → *"replaces the old card, and two rotations leave exactly one live card"* |
| State | Fixed locally, **NOT APPLIED** |
| To close | Ships with F-01/F-02 in the same file; same authorization |

### F-04 — `ensure_table_qr_code()` still grants `EXECUTE` to runtime roles on the candidate (added 2026-11-19)

| Field | Value |
|---|---|
| Severity | **Low / grant drift**, not a privilege escalation |
| Surface | `public.ensure_table_qr_code() returns trigger`, `SECURITY DEFINER`, on the candidate |
| Expected | `20261114000400_restrict_trigger_functions_execute.sql:20` revokes `EXECUTE` from `public, anon, authenticated, service_role` |
| Observed | On `juwyhslzchjevqkdvwjm`: `anon_exec = true`, `auth_exec = true`, `service_exec = true`; the revoke file is not in the candidate ledger |
| Why it is Low | A `returns trigger` function cannot be invoked through PostgREST and cannot be `SELECT`ed; calling it directly from SQL fails with `trigger functions can only be called as triggers`. No data path exists |
| Exploitability today | None demonstrated. Recorded because the hosted grant state contradicts the repository's stated boundary and would be re-introduced by any future `CREATE OR REPLACE` that forgets to re-revoke |
| To close | Apply `20261114000400` to the candidate as part of the same authorized migration window as the QR fix, then re-assert the ACL in the acceptance matrix |

## 2. Defects that are not vulnerabilities (accepted, recorded)

| ID | Item | Assessment |
|---|---|---|
| N-01 | `operational_schema_readiness()` executed only by `service_role`, returning a JSON presence map | Internal diagnostic; no tenant data. Accepted |
| N-02 | 28 class-D functions (13 trigger functions + 15 owner-only helpers) run definer-rights with an unpinned or `public`-only `search_path` | Trigger functions cannot be called directly; the 15 helpers are callable by `service_role`/owner only. Accepted, with a future `pg_temp` hardening noted in Report B §4.2 |
| N-03 | 26 class-C functions are callable only by `service_role` (webhooks, workers) and act on their arguments | Accepted; the server is the only caller |
| N-04 | The candidate's `guard_restaurant_billing_configuration` is an older revision that does not revoke `EXECUTE` from `service_role` | Trigger function, not directly callable. Defence-in-depth delta only |

## 3. Audit observations / anomalies (no security claim)

| ID | Observation | Status |
|---|---|---|
| O-01 | `rotate_table_qr_code` escaped the audit's `NO_TENANT_PREDICATE` flag because `auth.uid()` appeared only as an inserted `created_by` value | Recorded as a heuristic gap in Report B §4.1; recommended guard-shaped detection plus a manual checklist |
| O-02 | 19 functions pin `search_path = public` without `pg_temp` | Not exploitable without a callable path; scheduled as forward hardening, not a fix |
| O-03 | `qr_verification_attempts_legacy_20261111054934` on the candidate has no ledger or manifest row | **Closed.** Proven provenance: the 2026-11-11 review application of `20261110000900_converge_qr_verification_attempts.sql`, documented in `docs/review-deployment-2026-11-11.md` §5. Inert: 0 rows, no readers, no runtime grant (Report A §4.1) |
| O-04 | 92 branch-defined functions are absent from the candidate (GST/IRP/realtime work not applied) | Expected, because none of those files is authorized |
| O-05 | The candidate's ledger records apply-time versions, not repository versions, and stores five scripts with comments removed | Explained in Report A §2.1 as the dashboard-application flow; comparisons done on statements, not md5 |
| O-06 | **Neither hosted project implements the repository schema.** Candidate: 42 tables, 13 ledger rows; production: 44 tables, 122 ledger rows, 50 versions that exist in no repository file, and **47 of the 119 repository migrations missing** (everything from `20261110000851` onward, including the GST/IRP set and `20261115000200`). The branch's code calls 84 RPCs; **30 of them do not exist on production** (including `transfer_open_sitting`, `floor_service_snapshot`, `list_my_waiter_outlets`, `get_guest_order_status`) | Blocks "deploy the branch to production" as a schema question, not only an approval question. Closing it is a migration programme (backfill 47 files, reconcile 50 unknown versions, rehearse on a clone), never a same-day step |

## 4. Status summary

| State | Count |
|---|---|
| Vulnerabilities open (fix not applied anywhere) | **3** — F-01, F-02, F-03, one file; all three live on **both** hosted projects |
| Vulnerabilities fixed and verified locally | 3 (same three, disposable database) |
| Vulnerabilities accepted as risk | 0 |
| Defects / hardening deltas accepted | 5 (adds F-04, grant drift) |
| Observations closed by evidence | 1 (O-03) |
| Observations still awaiting a decision | 1 (O-04 — no decision needed, informational) |
| Observations added 2026-11-19 | O-06 (hosted schema gap — the deployment blocker) |

**No hosted change was made in the course of this register.** Production was
read by catalogue query only (`pg_proc`, `pg_tables`, `pg_stat_archiver`,
`pg_database_size`, `supabase_migrations.schema_migrations`); no customer row
was read, no DDL or DML was issued, and no provider setting was changed. Applying F-01/F-02/F-03 requires
`docs/staging-authorization-and-acceptance-2026-11-19.md` §4.
