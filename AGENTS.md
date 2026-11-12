# AutoDine Engineering Playbook

Applies to the whole repository. Keep this file concise; put dated evidence and blocker detail in `RELEASE-BLOCKER-REPORT.md`.

## Release truth

- Treat application source and checked-in migrations as the implementation; treat reports as dated evidence, not proof of current hosted state. Reconcile claims against callers/UI and record the evidence date, scope, and limitations.
- Release and pilot status default to **NO-GO** until fresh, authorized hosted security, migration, recovery, guest-to-staff E2E, performance, rollback, and operator-approval evidence is recorded. Local tests, a READY Preview, or `/api/health` alone never clear those gates.
- Keep `RELEASE-BLOCKER-REPORT.md` as the live blocker register. Separate current observations from historical reports and explicitly mark gates not checked.

## Worktree and change safety

- Work only on the active Arena branch. Preserve all pre-existing tracked and untracked work; never reset, clean, restore, overwrite, stage, or commit without explicit authorization.
- `scripts/phase3/staging-baseline.json` is protected user work. Preserve its bytes; its recorded worktree SHA-256 is `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`.
- Make the smallest independent fix that addresses a demonstrated defect. Add a targeted regression test for each behavioral change; do not weaken or delete tests to make a run green.

## Database, payments, and hosted boundaries

- Local migrations and tests may use only disposable, loopback PostgreSQL and synthetic data. Keep migrations additive/forward-only; never apply them to a hosted project without the required explicit approval and recovery gates.
- Production is read-only. Staging remains NO-GO: until operator acceptance, recovery evidence, and migration gates are satisfied, limit it to authorized read-only metadata/catalog inspection. No hosted DML, DDL, migrations, orders, side-effecting RPCs, or customer/staff messages.
- Online payments remain disabled. Do not invoke provider flows/RPCs, make real charges/refunds, or treat credentials/schema functions as an implemented payment path.
- Never print, copy, or commit secrets or environment values. Do not contact operators or send external messages; prepare material for the user to share.

## Verification and reporting

- Install locked dependencies with `npm ci` when needed. Run targeted Vitest tests first, then relevant `npm test`, `npm run typecheck`, `npm run lint`, `npm run sql:check`, and build/E2E checks as scope permits.
- Distinguish tests run now from historical results; report skips, unavailable fixtures, and any hosted/performance/recovery checks not performed. Do not repeat the completed Phase 5C PostgreSQL suite without a concrete inconsistency.
