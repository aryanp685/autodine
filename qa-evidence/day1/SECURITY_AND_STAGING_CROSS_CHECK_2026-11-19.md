# Cross-check — definer review (Report B) against staging drift (Report A), 2026-11-19

Two reports were produced in this phase:

| Report | Path | Question |
|---|---|---|
| **A** | [`STAGING_DRIFT_INVESTIGATION_2026-11-19.md`](./STAGING_DRIFT_INVESTIGATION_2026-11-19.md) | What is actually on the only candidate project, and is it this branch's baseline? |
| **B** | [`DEFINER_SECURITY_REVIEW_2026-11-19.md`](./DEFINER_SECURITY_REVIEW_2026-11-19.md) | Which of the 81 flagged `SECURITY DEFINER` functions is a real authorization defect, and what is the minimal fix? |

They are not independent: A supplies the **deployed state**, B supplies the
**reasoning**. Neither is sufficient alone, and this page is the join.

## 1. The two conclusions

- **A:** the candidate is a documented, deliberately built test backend —
  thirteen dashboard applications, all explained by repository evidence: twelve
  from this repository's files (six by hand, the scaffold, a content-addressed
  bundle, a probe, three owner migrations), one from the third main-branch
  workstream (PR #195), plus one schema effect now **proven** to be the
  documented 2026-11-11 review application of the QR-convergence migration
  (Report A §4.1). Verdict updated to **EXPLAINED / still NOT ELIGIBLE as a
  Staging baseline** (undesignated, scaffold installed, live defects).
- **B:** of 81 flagged definer functions, **2 are class A** (both the QR
  lifecycle pair), 0 are class B, and the remaining 79 are structural or
  owner-only and safe as written. Verdict: **one defect family, two functions.**
- **Implementation review (Priority 7):** reading the two bodies as a
  concurrency problem found a third defect in the same pair — the rotation was
  not serialised, so two overlapping rotations could leave **two live cards**
  (F-03). Closed by the same file, proven with two real concurrent sessions.
- **Together:** the defect is not hypothetical. Report A §2 row 7 and §5 show
  that the vulnerable definitions are the live ones on the candidate (ledger
  `20261021000007_table_qr_provisioning`, applied 2026-11-08 17:47:58, verified
  hosted: `has_entitlement_check=true`, `has_membership_check=false`,
  `EXECUTE` to `authenticated`).

## 2. Finding dossier — QR-01 / QR-02

### 2.1 What the code does

Both are `SECURITY DEFINER`, `search_path = public`, callable by
`authenticated`, and they re-issue the same revokes/grants — so the only guard
in front of the write is:

```sql
if not public.restaurant_can_write(v_restaurant_id) then
  raise exception 'You do not manage this restaurant.' using errcode = '42501';
end if;
```

`restaurant_can_write()` answers a **billing** question ("is this restaurant's
plan or trial still writable?"), not an identity question ("is this caller a
member of this restaurant?"). Nothing in either function compares
`auth.uid()` with a membership row. That is the whole defect.

### 2.2 Preconditions

| Requirement | Realistic? |
|---|---|
| A signed-in account (`authenticated`) | Trivial — any guest can create an account, and sign-up is public |
| Knowledge of a target `table_id` (UUID) | Easy — `current_table_session()` hands the table id to guests sitting at that table; the qr-code page also carries it |
| The target restaurant's plan/trial in a writable state | True for every paying or trialling tenant, i.e. the normal case |

No admin, no service key, no knowledge of the victim's staff, no email needed.

### 2.3 Impact

| # | Function | Effect for an outsider | Consequence |
|---|---|---|---|
| QR-01 | `rotate_table_qr_code(p_table_id)` | Revokes every active card for that table **and returns the newly minted 64-character `public_token`** | The attacker holds a token that the app accepts at the guest order entrypoint → can place orders into the victim's kitchen under the victim's table, and can print their own QR that guests will scan |
| QR-02 | `retire_table_qr_code(p_table_id)` | Revokes the active card and inserts nothing | Denial of service: the outlet's printed cards stop working until an owner rotates them |

Cross-tenant, unauthenticated-adjacent (any account), repeatable, silent. Not
reachable: finance, GST invoices, IRP, payment capture, staff accounts — the two
functions touch `table_qr_codes` only. Severity: **high** for tenant isolation
(one tenant writing into another's service flow), **not** a financial-integrity
defect.

### 2.4 Reproduction

Reproduced **locally**, on a disposable embedded database, not on any hosted
project:

```
node scripts/local-pg/with-embedded-postgres.mjs node scripts/local-pg/verify-qr-finding.mjs
```

| Step | Observation |
|---|---|
| Apply the repository chain without `20261118002200` | — |
| Sign in as an account with no membership in the victim restaurant | — |
| `rotate_table_qr_code(victim_table)` | **returns a fresh 64-character token** (PRE-FIX: defect confirmed) |
| `retire_table_qr_code(victim_table)` | **succeeds** |
| Apply `20261118002200` and repeat | both raise `42501` |
| Repeat as the victim outlet's own owner | both succeed |

Corroborated on the candidate read-only: `has_membership_check=false`,
`has_entitlement_check=true`, `auth_exec=true` for both functions (Report A §5).
No hosted call was made.

### 2.5 Minimal fix

`supabase/migrations/20261118002200_qr_code_staff_boundary.sql` — `create or
replace` both functions, adding one guard **before** the billing gate:

```sql
if not public.has_restaurant_role(v_restaurant_id, array['owner','manager']) then
  raise exception 'Only the owner or a manager may manage table QR codes.'
    using errcode = '42501';
end if;
```

Nothing else changes: same signatures, same return values, same
`SECURITY DEFINER`/`search_path`, same revoke/grant block, same token generation,
no table or policy or data change. Forward-only; safe to apply after the
vulnerable version and idempotent if re-run.

### 2.6 Regression test

`lib/db/phase0-security.integration.test.ts` → `describe('table QR lifecycle')`:

- *"refuses to rotate or retire another outlet's table code"* — outsider and
  other-outlet owner both get `42501`, asserted inside the role transaction;
- *"lets the outlet's owner rotate and retire its own code"* — own owner still
  gets a token and a successful retire.

Both pass in the full integration run (13 files, 288 passed, 1 skipped).

### 2.7 Hosted authorization

**NOT AUTHORIZED.** The fix is written, tested and unapplied. Applying it to
`autodinetest` (or to any project) requires a written decision naming the file
and the target (`docs/staging-authorization-and-acceptance-2026-11-19.md` §4).
Report A explicitly recommends it as the first application — and equally
explicitly does not perform it.

### 2.8 F-03 — the race the audit could not see

Both functions read `dining_tables` without a lock, then `update … where revoked_at is null`
and `insert`. Under `READ COMMITTED`, two overlapping rotations each update
nothing the other can see and each insert its own card, so the table ends with
**two live tokens**; a retire racing a rotation can return success while a fresh
card stays live. The definer audit cannot detect this class at all — it reads
grants and predicates, not isolation.

Fix: `select … from public.dining_tables … for update` before the checks, so the
second caller waits and then observes the first caller's card. Measured on a
disposable database with two real sessions:

| Run | Live cards after two concurrent rotations |
|---|---|
| Without the fix | **2** |
| With the fix | **1** |

## 3. Where the reports constrain each other

| Report A fact | Consequence for Report B |
|---|---|
| The vulnerable functions arrive in ledger entry 7 (2026-11-08), and the candidate's schema is otherwise the 2026-11-09 bundle | The defect exists in **every** database built from this branch's chain, not just this one; the fix must ship as a migration, not as a hosted patch |
| The candidate is not a clean baseline and must not be reset | The fix cannot be "rebuilt from scratch" — it must be a forward migration applied to whatever target is eventually designated |
| Twelve of thirteen ledger entries are explained, but 92 branch functions are unapplied | Applying the QR fix will not accidentally drag in GST/IRP code; the register keeps those files individually unauthorized |
| `owner_billing_configuration_guard` on the candidate is an older revision | Hosted state can lag the repository by small hardenings; the definer review therefore classifies from the **repository** body plus the hosted probe, and states which one it used |

| Report B fact | Consequence for Report A |
|---|---|
| The heuristic gap let `rotate_table_qr_code` escape the tenant-predicate flag (`auth.uid()` appeared only as an inserted `created_by` value) | The audit's 81-flag list is not a vulnerability list; Report A §5 must not read "flagged" as "defective" |
| 79 of 81 flagged functions are structural or owner-only | The candidate's exposure is concentrated in one function family, which is why one migration closes it |
| `restaurant_can_write` is a billing gate, not authorization | Any future review of "who can call this" must require a second identity-bearing guard before assigning class A/B |

## 4. Repository changes made by this phase

| Path | Status | Note |
|---|---|---|
| `supabase/migrations/20261118002200_qr_code_staff_boundary.sql` | new, **NOT AUTHORIZED** | the fix above |
| `scripts/local-pg/verify-qr-finding.mjs` | new | PRE/POST reproduction on a disposable database |
| `lib/db/phase0-security.integration.test.ts` | extended | the two regression tests |
| `docs/migration-manifest-2026-11-14.md` | row + header → 119 | register input |
| `scripts/release/verify-release-readiness.mjs` | `EXPECTED_MIGRATIONS = 119` | release gate |
| `scripts/release/render-migration-register.mjs` | title now derived from the file count | it said "118 files" while listing 119 |
| `docs/migration-authorization-register-2026-11-19.md` | regenerated | 119 rows, 0 problems |
| `docs/staging-authorization-and-acceptance-2026-11-19.md` | new | the document the P6 report already linked to; now allowlisted in `.gitignore` |
| `qa-evidence/day1/STAGING_ACCEPTANCE_MATRIX_2026-11-19.md` | new | the 14 points scored PASS/FAIL/BLOCKED with evidence and commands |
| `scripts/local-pg/verify-qr-finding.mjs` | extended | adds the two-session concurrency proof (PRE-FIX 2 live cards, POST-FIX 1) |
| Reports A, B, this page | new | evidence |

## 5. Verification gates at the end of the phase

| Gate | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | clean |
| Lint | `npm run lint` | 0 errors (2 pre-existing warnings) |
| Unit | `npm test` | see the Priority 7 report — re-run after the fix |
| Integration | `npm run test:db:integration` | **293 passed / 1 skipped (13 files)** — 5 new QR-lifecycle tests |
| Embedded replay | `npm run test:db:embedded` | **272 passed / 3 skipped (10 files)** |
| Release readiness | `npm run verify:release` | **47 checks OK** |
| Migration register | `npm run register:migrations` | 119 files / 119 rows / 0 problems |
| Definer audit | `npm run audit:definer` | 148 audited / **80** flagged (81 before the fix; both QR functions now unflagged) |
| Finding reproduction | `verify-qr-finding.mjs` | isolation defect reproduced, race reproduced (2 live cards), both closed by the fix (1 live card) |

No hosted mutation, no provider call, no production access, no merge.

## 6. Consolidated verdict

**LOCAL: PASS.** The defects are demonstrated, the fix is minimal and tested,
the suite is green and the migration bookkeeping is consistent.

**STAGING: NOT AUTHORIZED and NOT READY.** The candidate is a partially explained
baseline carrying two live cross-tenant defects; the fix is the first application
requested, and applying it is an owner decision.

**PROVIDER: NOT AUTHORIZED. PRODUCTION: NO-GO.**

One defect family, two functions, one file, one signature. Everything else in
this phase's evidence says the same thing: the work that is left is decisions,
not discoveries.
