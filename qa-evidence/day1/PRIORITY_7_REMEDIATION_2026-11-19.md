# Priority 7 — staging anomaly, security remediation, release readiness (2026-11-19)

Arena B only. No Arena A work, no Backblaze/B2, no PR #194, no provider, no
deployment, no hosted write, no commit. Everything below is local except two
read-only catalogue reads on the candidate project.

**Headline:** the last unexplained staging anomaly is now **proven**, the QR
defect family grew from two findings to **three** and all three are **fixed and
verified locally**, the 14 staging points are **scored** (8 local pass / 6
blocked / 0 fail), the finding and owner registers reconcile, and every gate is
green.

---

## 1. Baseline confirmed

| Item | Value |
|---|---|
| Branch | `arena/ce32f7c8-autodine` |
| HEAD | `7064c91` — *docs(preview): conflict-resolution addendum with merged-head evidence* |
| Base | `7064c912…` of `arena/2670dd12-autodine` |
| Working tree | 181 modified, 89 untracked, 3 deleted (pre-existing branch state), **0 staged** |
| Pull request | none for this branch; 3 unrelated PRs open (#194, #184, #181 — not touched) |
| Hosted writes | **none**; read-only metadata and catalogue `SELECT`s only |
| Preserved | all P1–P6 work, all prior evidence files, no reset, no restore point touched |

---

## 2. Priority 7A — the remaining anomaly is proven

`public.qr_verification_attempts_legacy_20261111054934`

| Question | Finding |
|---|---|
| Object | Regular table, owner `postgres`, RLS on, `ACL = {postgres, service_role}` only, **0 rows**, 16 kB, 4 columns (`id bigserial`, `qr_code_id`, `ip_hash`, `attempted_at`), PK + FK, no policies |
| Origin | **Proven**: `supabase/migrations/20261110000900_converge_qr_verification_attempts.sql`, which renames a non-canonical table to `qr_verification_attempts_legacy_<YYYYMMDDHH24MISS>` and creates the canonical counter table |
| Time | **2026-11-11 05:49:34 UTC** — the suffix is `to_char(statement_timestamp(), …)`, i.e. the moment the block ran |
| Independent fingerprint | The PK is `qr_verification_attempts_pkey_20261111054934_20261111054934` — a **double suffix**. Reproduced on a disposable database: renaming a PK index also renames its constraint, so the migration's constraint loop suffixes it a second time. Only this file produces that name |
| Documentation | `docs/review-deployment-2026-11-11.md` §5 lists the file among "16 applied, in order", and the next subsection names this exact table ("4 columns, 0 rows … intentional evidence, not debris") |
| Why no ledger row | Those sixteen files were applied without writing `supabase_migrations.schema_migrations`; the ledger jumps from 2026-11-09 to 2026-11-13 |
| Channel (tool) | **Not recorded anywhere.** `supabase db push` would have written ledger rows, so it was a direct execution (psql or the dashboard SQL editor). Stated as **probable**, not proven |
| References | None — no function body, view, policy, trigger or default mentions it |
| Risk | **None material**: no runtime grant, RLS on, 0 rows, no readers. It is inert |
| Still required? | Not functionally. Evidentially yes — it is the only surviving record of the pre-convergence shape |

**Classification: 1 — proven origin.** The only residual unknown is *which tool*
ran the 2026-11-11 batch, and the report says so instead of guessing.

Full evidence table: [Report A §4.1](STAGING_DRIFT_INVESTIGATION_2026-11-19.md).

---

## 3. Priority 7B — the two class-A findings, plus a third

### 3.1 Review of the functions and the fix

| Requested check | Result |
|---|---|
| `SECURITY DEFINER` context | Both are definer; owner `postgres`; RLS therefore suspended inside, which is why the guard must be explicit |
| `search_path` | `set search_path = public, pg_temp` — pinned, `pg_temp` last. Correct |
| Schema qualification | Every object reference is `public.`-qualified (`dining_tables`, `table_qr_codes`, `has_restaurant_role`, `restaurant_can_write`, `new_qr_public_token`) |
| Authorization / tenant isolation | **Was the defect.** Only `restaurant_can_write()` — a billing/entitlement predicate. Now `has_restaurant_role(…, array['owner','manager'])` first, matching the `dining_tables` write policy |
| Ownership validation | `restaurant_id` is taken from the `dining_tables` row, never from the caller; a caller cannot point a card at a foreign restaurant |
| Role permissions | `EXECUTE` revoked from `public`/`anon`, granted to `authenticated`; `new_qr_public_token()` stays revoked from every runtime role |
| Lifecycle behaviour | Rotate revokes every live card for the table, then inserts exactly one; retire revokes and returns. Revocation is not deletion, so an old scan can still explain itself |
| Race / concurrency | **New defect F-03.** No lock; two overlapping rotations each failed to see the other's uncommitted card → **two live cards**; a retire racing a rotate could report success while a fresh card stayed live. Fixed by `select … for update` on the `dining_tables` row before the checks |
| Cross-tenant access | Refused with `42501` for an outsider and for another outlet's owner (proven, 4 scenarios) |
| Replay / escalation | The token is a fresh random value; no path returns an existing token, mints a session, or elevates a role. `has_restaurant_role` is `NOT NULL` (`select exists …`), so `not …` is never NULL — the guard cannot be skipped by a null result |
| Legitimate behaviour preserved | Owner and manager rotate/retire; cashier and kitchen refused *for card management only*; guests still scan, open sessions and order; tablet/QR provisioning unaffected. Journey suite 20/20 |

### 3.2 What changed in the migration (local only)

One addition, twice — a row lock before the checks:

```sql
select t.restaurant_id into v_restaurant_id
  from public.dining_tables t
  where t.id = p_table_id
    for update;
```

No signature, return type, grant, error code, token format or entitlement
behaviour changed. No test assertion was relaxed to make this pass; the five
existing QR assertions are unchanged and six were added.

### 3.3 Evidence

`node scripts/local-pg/with-embedded-postgres.mjs node scripts/local-pg/verify-qr-finding.mjs`
(disposable cluster, 118 migrations without the fix, then the fix):

```
PRE-FIX: outsider rotated another outlet's table code      SUCCEEDED (vulnerable)
PRE-FIX: token returned to the attacker                    0216aade04c5… (64 chars)
PRE-FIX: outsider retired the same table code              SUCCEEDED (vulnerable)
PRE-FIX: two concurrent rotations                          issued 2 distinct token(s), 2 live card(s)
POST-FIX: outsider rotate                                  refused (42501)
POST-FIX: outsider retire                                  refused (42501)
POST-FIX: the outlet owner rotates its own code            allowed (64 chars)
POST-FIX: two concurrent rotations                         issued 2 distinct token(s), 1 live card(s)
```

New regression tests in `lib/db/phase0-security.integration.test.ts` →
`table QR lifecycle`:

1. refuses guests at the function boundary (`anon`, both RPCs)
2. rejects a missing or unknown table identifier (`22023`, `P0002`)
3. lets an outlet manager rotate; refuses cashier and kitchen staff
4. replaces the old card (guest sees `revoked`), and two rotations leave exactly one live card
5. accepts the replacement card (guest session opens) and retire is idempotent
6. *existing* — refuses another outlet's table code, and the card still works afterwards

---

## 4. Priority 7C — the 14 acceptance points, scored

[`STAGING_ACCEPTANCE_MATRIX_2026-11-19.md`](STAGING_ACCEPTANCE_MATRIX_2026-11-19.md):
each point has a status, evidence, exact command, the owner decision it needs and
whether it requires hosted authorization.

| Score | Points |
|---|---|
| **PASS (local)** — 11 | ledger parity (candidate), authorized replay (local proxy), role/RLS matrix, guest journey, unregistered receipt, composition receipt, IRP rehearsal (simulated), realtime fallback, payment reconciliation, print/share/redaction, rate limits |
| **BLOCKED** — 3 | identity/target (1), hosted auth round-trip (5), recovery/rollback (14) |
| **FAIL** | none |

Nothing is marked PASS merely because a document exists — every local pass
cites a command and a result from this session. The three blocked points are
identity/target (1), the hosted auth round-trip (5) and recovery/rollback (14).

Minimum remaining path to a legitimate baseline is §3 of the matrix: designate a
target → apply **one** file (`20261118002200`) → re-run the two read-only points
→ decide the remaining gaps → settle the scaffold and billing-guard revisions →
run the rest with synthetic data.

---

## 5. Priority 7D — register audit

| Check | Result |
|---|---|
| F-01 and F-02 separate and accurately classified | Yes — separate rows, both **High**, cross-tenant, with distinct impact (write/token theft vs denial of service) |
| Accepted defects not mixed with observations | Yes — §1 findings, §2 accepted defects (N-01…N-04), §3 observations (O-01…O-05) |
| Duplicates / wrongly closed | None. One observation was closed **with evidence** (O-03 → Report A §4.1); nothing else changed state |
| Every class-A finding has owner action, impact, remediation, verification | Yes — each row carries surface, preconditions, impact, reproduction, fix, test file, state, and the authorization needed |
| 80 flagged definer functions categorized | Reported as 81 flagged at review; after the local fix the audit reports 80. Reconciles exactly: C 26 + D 28 + E 26 = **80** still flagged, and the 81st flag was `retire_table_qr_code`, now unflagged (Report B §0) |
| Nothing marked resolved without evidence | Ledger evidence is named per row; the local fix is explicitly **NOT APPLIED** on any host |

Updated registers: findings register (F-03 added, counts restated),
owner-action register (6b block, gate numbers, decision text),
Report B (post-review delta), Report A (verdict + §4.1), cross-check and P6
addendum.

---

## 6. Priority 7E — regression protection

| Suite | Command | Result | What it protects |
|---|---|---|---|
| Unit | `npm test` | **2,614 passed / 303 skipped (250 files)**, exit 0 | app + component behaviour; the +5 skips are the new DB-gated QR tests |
| Integration | `npm run test:db:integration` | **293 passed / 1 skipped (13 files)**, exit 0 | RLS/role matrix, GST two-mode (60), readiness/commercial boundary (64), report sales (28), subscription billing (41), credit notes (12), throttle (5), QR lifecycle (6) |
| Embedded replay | `npm run test:db:embedded` | **277 passed / 3 skipped (10 files)**, exit 0 | the whole 119-migration chain applies cleanly and behaves |
| Guest journey | `npm run test:e2e:journey` | **20/20 passed (2.7 min)**, exit 0 | QR scan → menu → order → kitchen → checkout → receipt, counter payment, privacy, realtime fallback, IRP simulation, integrity/rate-limit paths |

No GST/IRP behaviour was changed to make a security test pass; the fix touches
two QR functions and nothing else.

---

## 7. Repository hygiene

**`/docs/*.md` is ignored by design, with an explicit allowlist.** The rule is
`/docs/*.md` followed by ~35 `!/docs/<name>.md` negations; the comment says
"Internal planning notes stay local; publish only the canonical operator/test
docs". New docs are therefore invisible until allowlisted — which is exactly why
the P6 report linked to a file that could not be committed.

Fixed by following that convention, not by force-adding:

```
!/docs/staging-authorization-and-acceptance-2026-11-19.md
!/docs/migration-authorization-register-2026-11-19.md
```

Consequence: both are now untracked-but-visible (`??`), committable when the owner
authorizes a commit, and no longer silently dropped. The four `qa-evidence/day1/`
reports were never ignored (`git check-ignore` returns no match), so they need no
rule.

Also fixed, in the generator rather than in the artefact: the authorization
register's title was hard-coded to "118 files" while listing 119. It now derives
from the file count, and the register was regenerated (119/119/0).

---

## 8. Gates

| Gate | Historical | Now | Verdict |
|---|---|---|---|
| `npm run typecheck` | clean | clean | unchanged |
| `npm run lint` | 0 errors, 2 warnings | 0 errors, 2 warnings (same pre-existing) | unchanged |
| `npm test` | 2,614 / 298 skipped | **2,614 / 303 skipped** | no regression (+5 new DB-gated tests) |
| `npm run test:db:integration` | 288 / 1 | **293 / 1** | +5 new tests |
| `npm run test:db:embedded` | 272 / 3 | **277 / 3** | +5 new tests |
| `npm run test:e2e:journey` | 20/20 (P6) | **20/20** | unchanged |
| `npm run verify:release` | 47 checks | **47 checks OK** | unchanged |
| `npm run register:migrations` | 119/119/0 | **119/119/0** | unchanged |
| `npm run audit:definer` | 148 / 80 | **148 / 80** | unchanged; both QR functions unflagged |

**Regressions: none.** One test-level change: the 5 new assertions are additive
and the pre-existing QR assertions were not modified.

---

## 9. Remaining owner decisions

| # | Decision | Blocks |
|---|---|---|
| A1 | Confirm the 2026-11-19 `announcement_claim_recovery` application (PR #195) | Baseline provenance |
| A2 | Disposition for the inert `qr_verification_attempts_legacy_*` table (keep as evidence / authorize removal later) | Housekeeping only |
| A3 | Designate a Staging target, or create a fresh project | Everything hosted |
| A4 | Authorize `20261118002200_qr_code_staff_boundary.sql` for that target — closes F-01, F-02, F-03 | Live cross-tenant exposure |
| A5 | Re-apply `20261115000200`, or accept the older billing-guard revision | Defence-in-depth delta |
| A6 | Drop `autodine_local_test_scaffold` before any Staging label | Inferred DDL under a Staging name |
| A7 | Recovery: purchase/enable PITR and authorize a restore rehearsal | Acceptance point 14 |

## 10. Files created or modified in Priority 7

| Path | Change |
|---|---|
| `supabase/migrations/20261118002200_qr_code_staff_boundary.sql` | **modified** — `for update` row lock added to both functions (still NOT AUTHORIZED) |
| `lib/db/phase0-security.integration.test.ts` | **modified** — 5 new QR-lifecycle tests |
| `scripts/local-pg/verify-qr-finding.mjs` | **rewritten** — adds the two-session concurrency proof and a pass/fail exit code |
| `.gitignore` | **modified** — two allowlist entries for the acceptance doc and the register |
| `scripts/release/render-migration-register.mjs` | **modified** — dynamic title (was hard-coded 118) |
| `docs/migration-authorization-register-2026-11-19.md` | regenerated (119 rows) |
| `qa-evidence/day1/STAGING_DRIFT_INVESTIGATION_2026-11-19.md` | verdict → EXPLAINED, new §4.1, decisions re-stated |
| `qa-evidence/day1/SECURITY_FINDINGS_REGISTER_2026-11-19.md` | F-03 added, O-03 closed, counts restated |
| `qa-evidence/day1/DEFINER_SECURITY_REVIEW_2026-11-19.md` | §0 post-review delta |
| `qa-evidence/day1/SECURITY_AND_STAGING_CROSS_CHECK_2026-11-19.md` | race section, updated gates and file list |
| `qa-evidence/day1/MASTER_OWNER_ACTION_REGISTER.md` | 6b block, F-03, gate numbers, decision text |
| `qa-evidence/day1/FINAL_LAUNCH_READINESS_PRIORITY_6_2026-11-19.md` | drift sentence corrected |
| `qa-evidence/day1/STAGING_ACCEPTANCE_MATRIX_2026-11-19.md` | **new** — the 14 points scored |
| `qa-evidence/day1/PRIORITY_7_REMEDIATION_2026-11-19.md` | **new** — this report |

## 11. Verdicts

| Surface | Verdict |
|---|---|
| **LOCAL** | **PASS** — 2,614 unit, 293 integration, 277 replay, 20/20 journeys, 47 release checks, register consistent |
| **SECURITY** | **PASS (local)** — three findings reproduced and closed locally; **OPEN on every hosted project** because the file is not applied. No accepted-risk items |
| **MIGRATION** | **READY, NOT AUTHORIZED** — `20261118002200` is minimal, forward-only, signature-preserving, idempotent, and covered; 119/119/0 bookkeeping |
| **STAGING** | **NOT AUTHORIZED / NOT ELIGIBLE** — no designated target; 11 points pass locally, 3 blocked, 0 fail |
| **PROVIDER** | **NOT AUTHORIZED** — no provider call attempted |
| **PRODUCTION** | **NO-GO** |

The work that remains is decisions, not discoveries. The single highest-value
one is A4: it is one file, it changes no signature, and it closes a live
cross-tenant defect plus the race that lets it happen twice.
