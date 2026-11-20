# Staging authorization and acceptance — 2026-11-19

**This document authorizes nothing.** It records what would have to be true
before a hosted Staging acceptance could run, and what would then be checked. A
signature, an environment variable, an old approval or a candidate project ref
is not authorization; only a written decision by the owner that names **the exact
file(s)** and **the exact target project** is.

Companion evidence:

- [`qa-evidence/day1/STAGING_DRIFT_INVESTIGATION_2026-11-19.md`](../qa-evidence/day1/STAGING_DRIFT_INVESTIGATION_2026-11-19.md) — Report A, what is actually on the candidate.
- [`qa-evidence/day1/DEFINER_SECURITY_REVIEW_2026-11-19.md`](../qa-evidence/day1/DEFINER_SECURITY_REVIEW_2026-11-19.md) — Report B, the 81-function definer review and findings QR-01/QR-02.
- [`qa-evidence/day1/SECURITY_AND_STAGING_CROSS_CHECK_2026-11-19.md`](../qa-evidence/day1/SECURITY_AND_STAGING_CROSS_CHECK_2026-11-19.md) — how the two reports constrain each other.
- [`docs/migration-authorization-register-2026-11-19.md`](./migration-authorization-register-2026-11-19.md) — the generated per-file register (119 files).

## 1. State of authorization

| Surface | State | Basis |
|---|---|---|
| Local repository work (code, migrations, tests) | **PASS** | 2,614 unit tests, 288 integration tests, 272 embedded-replay tests, `verify:release` 47 checks |
| Hosted Staging application | **NOT AUTHORIZED** | no target designated; candidate not eligible (§3) |
| Provider activation (IRP, payments, email/SMS) | **NOT AUTHORIZED** | no provider call attempted this phase |
| Production | **NO-GO** | unchanged |
| PR merge / release | **NOT AUTHORIZED** | no pull request approved or merged |

## 2. Target

| Project | Ref | Region | PostgreSQL | Status | Role |
|---|---|---|---|---|---|
| `autodinetest` | `juwyhslzchjevqkdvwjm` | ap-northeast-2 | 17.11.0.018 | ACTIVE_HEALTHY | **candidate only** |
| `autodine-production` | `bdbaqpevwmgdvghszjno` | ap-south-1 | 17.11.0.003 | ACTIVE_HEALTHY | out of scope |

No project is designated as Staging. The candidate is not Production — different
ref, region and SQL version — but it is also not a clean baseline of this
branch: its ledger holds thirteen dashboard applications, its schema is the
2026-11-09 bundle plus four later owner migrations, and it carries two live
cross-tenant defects (Report A §2/§6, Report B §1.1).

**Do not reset it.** Resetting would erase a third workstream's intentional
change and the only witness of how this project was built. Either accept it as a
recorded baseline (Report A §9) or stand up a fresh project — the second is the
faster route to a clean Staging label.

## 3. Eligibility of the candidate — NOT ELIGIBLE

Four conditions remain, all decisions rather than discoveries (Report A §8):

1. The owner confirms the 2026-11-19 `announcement_claim_recovery` application as the third workstream's intentional change (PR #195).
2. `autodinetest` is designated Staging, or a dedicated target is created.
3. The QR-boundary correction is authorized for that target (it closes live cross-tenant defects F-01, F-02 and the rotation race F-03).
4. The local-only scaffold is dropped, and the pre-hardening
   `owner_billing_configuration_guard` revision is either re-applied from the
   repository file or explicitly accepted.

The former fifth condition — the 2026-11-11 `qr_verification_attempts_legacy_*`
schema effect — is **closed**: its origin is proven to be the documented review
application of `20261110000900_converge_qr_verification_attempts.sql`, and the
object is inert (Report A §4.1).

## 4. The minimal first application, if the owner authorizes it

One file, forward-only, signature-preserving:

`supabase/migrations/20261118002200_qr_code_staff_boundary.sql`

- Re-creates `rotate_table_qr_code(uuid)` and `retire_table_qr_code(uuid)` with
  `has_restaurant_role(…, array['owner','manager'])` **before** the existing
  `restaurant_can_write()` entitlement gate.
- Return types, argument lists, `SECURITY DEFINER`, `search_path`, revokes and
  grants are unchanged, so nothing that calls them needs to change.
- No table, policy, index or data change. No destructive statement.

Refusal conditions to verify **before** applying: the target's two functions are
the only ones being replaced; no other migration is bundled with it; the change
is recorded by name and by target ref in the decision.

Expected effect on the candidate, stated as a prediction to be checked rather
than a result: outsider accounts and owners of other outlets get SQLSTATE
`42501` on both RPCs, while the owning owner/manager keeps working. This is
exactly what the disposable-database reproduction already showed
(`scripts/local-pg/verify-qr-finding.mjs`).

## 5. The fourteen acceptance points

**Current scores live in
[`qa-evidence/day1/STAGING_ACCEPTANCE_MATRIX_2026-11-19.md`](../qa-evidence/day1/STAGING_ACCEPTANCE_MATRIX_2026-11-19.md):
11 points pass locally, 3 are blocked, none fails; on hosted only ledger parity has been run.**
The table below is the definition of each point, not its result. "Pass criteria" is what must be observed, "evidence"
is what must be captured, and the commands are the ones the owner (not this
session) would run once authorized. No point involves a live provider, a real
payment, a real email/SMS or production data.

| # | Point | Pass criteria | Evidence to capture | How |
|---|---|---|---|---|
| 1 | Identity and target | The ref, region and SQL version match the written decision; the project is not `bdbaqpevwmgdvghszjno` | metadata screenshot/JSON | Supabase project settings; `select version()` |
| 2 | Ledger parity | Every ledger row maps to a repository file or to a documented non-repository application (Report A §2); no unexplained row appears | ledger dump + the mapping table | `select version, name, created_by from supabase_migrations.schema_migrations order by version` |
| 3 | Authorized replay only | The applied set equals exactly the authorized set; nothing else changed | before/after ledger diff plus `pg_proc`/`pg_policy` counts | apply, then diff the two dumps |
| 4 | Role / RLS matrix | For each protected table, `anon`, `authenticated` non-member, other-tenant owner, own owner/manager and `service_role` each see exactly what the matrix says | per-role row counts | `set role` + `select` per table |
| 5 | Auth round-trip | Sign-in, invite redemption, session refresh and sign-out work for a synthetic account; no email is sent to a real address | request ids + app logs | Preview build against the target |
| 6 | Guest journey | QR scan → menu → order → kitchen → checkout completes for a synthetic restaurant | order/session ids and status transitions | Preview build, synthetic tenant |
| 7 | Unregistered receipt | A receipt generated without GST registration carries no tax fields and no IRN | receipt payload | `close_order_session_and_issue_receipt` on a synthetic session |
| 8 | Composition receipt | A GST-registered synthetic tenant produces the configured tax split | invoice payload + series number | same, with `restaurant_gst_config` seeded |
| 9 | IRP rehearsal | A **simulated** IRP response is stored as a simulation and is never presented as a legal IRN; the dispatcher never leaves the sandbox | dispatch row + UI text | worker run against the simulated adapter only |
| 10 | Realtime fallback | With realtime unavailable, polling still refreshes kitchen and order state | before/after UI state | Preview build with the channel blocked |
| 11 | Payment reconciliation | Counter and online amounts reconcile to the order total; no real money moves | ledger rows | synthetic payment methods only |
| 12 | Print / share / redaction | Receipts print and share, and no customer identifier leaks into a share link | rendered artifacts | Preview build |
| 13 | Rate limits | Guest order attempts and table-verification attempts are throttled at the documented thresholds | attempt counters | looped synthetic requests |
| 14 | Recovery / rollback | The documented recovery procedure brings the target back to its pre-change state without data loss | restore evidence | backup/PITR procedure in `docs/backup-restore-runbook.md` |

## 6. What remains explicitly out of scope

Production access or change; any hosted migration not named in a written
decision; IRP provider activation; live payment capture or refund; live email or
SMS; secret retrieval or display; destructive cleanup of the candidate; PR
approval or merge; any reset or forced baseline of a project.

## 7. If the decision is "not now"

Then the honest state is: local work complete and verified, hosted Staging
acceptance unstarted, two known cross-tenant defects live on the only candidate.
That is recorded, not hidden — and the QR-boundary correction stays the single
highest-value authorization request in the queue.
