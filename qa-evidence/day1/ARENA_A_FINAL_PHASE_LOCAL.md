# Arena A — final-phase local evidence

Scope: credential-free local implementation and verification, on top of PR #194 head `afe31ac1de27abefaaec3ad227f9ed2b709b8ed1`. No B2 authentication, hosted database access, hosted workflow dispatch, remote deletion, Production operation, approval or merge was performed. The owner reported a newly generated replacement key; neither its configuration nor the old key's revocation has been independently verified.

## Findings and changes

- Backup age monitoring now reports missing/unreadable directories, backup-shaped non-regular files and future mtimes as failures. Missing, null, string and negative restore durations cannot falsely satisfy the duration check. Failed/interrupted webhook delivery is reported without exposing its URL; this is not a missing-run monitor.
- Both dump modes reject financial sums outside the non-negative exact JSON integer range instead of rounding recovery evidence. A versioned exact-integer representation is still needed to support larger values.
- Restore verification additionally fails for invalid/not-ready indexes and unvalidated CHECK/FK constraints. These are health checks, not evidence that source and target definitions, all relationships or application behavior match.
- The owner checklist requires separate B2-authentication, staging-backup and restore authorization before dispatching the combined rehearsal, and lists remaining schema and application acceptance evidence. The open B1 owner row is not closed.
- At base `5b07e24f884128ffec86e45b2142fe171259c86f`, the remote PR was conflicting in the kitchen browser test. The local resolution incorporates the current base test and preserves the original longer-wait assertions in an additional test. A local temporary three-way merge reported no textual conflicts; the branch has not merged the base. This must be reconfirmed against the latest base and remote head.

## Verification

- `npm run verify:local-gates`: **17/17 passed**, including **176/176 DR tests**, **66/66 staging guards**, typecheck, lint, release and migration guards, database integration, unit tests and client-independence tests. This matches the prior 17/17 baseline with six additional DR tests.
- Eight targeted B2, failure, restore, retention and staging test files: **80/80 passed**. Local PostgreSQL tests injected a financial integer overflow, an unvalidated constraint and an invalid index; failures were detected without weakening aggregate checks.
- `node --test qa-evidence/day1/master-blocker-register.test.mjs qa-evidence/day1/phase7-local-verification.test.mjs`: **20/20 passed**.
- Synthetic-public-configuration `npm run build`: passed. Playwright collected **9 staff kitchen tests**; local execution was unavailable because the Chromium executable was not installed. Previous remote checks passed on `afe31ac`; these local changes have not run in remote CI.
- Populated disposable PostgreSQL 17 logical restore: **102 migrations, 49 tables, 10 rows, 59 policies, 164 functions**, financial sums 12,345 and 49,900 paise; restore-command duration 379 ms, **not** service RTO. Artifact destroyed after the local test. This does not establish real B2, hosted custom-format restore or hosted recovery.

## Approval and evidence boundaries

The GitHub Environment list returned zero visible environments and the direct `backup-staging` lookup and secret-list lookup returned 404. Existence, reviewer protections, branch restrictions and secret scope remain unverified, not proven absent. The staging workflow is not registered on the default branch. Owner attestation and authoritative configuration checks remain necessary for the non-production project, a separate private staging bucket, production-bucket inventory and replacement key's bucket restriction. GitHub Environment secrets/variables can fall back to broader scopes.

The staging verifier compares same-run manifest contents, payload hash, decryptability, aggregate counts and financial totals, and catalog health. The sidecar manifest is not cryptographically authenticated for later recovery. Source-to-target schema definitions, per-table fingerprints, representative data, application smoke and full service recovery remain unproven. Upload PUTs are deliberately not automatically retried; interrupted publication can leave a partial or versioned pair requiring investigation and separate cleanup approval. Scheduled-run absence, alert delivery, remote retention and actual B2 behavior require independently authorized verification. RPO and end-to-end RTO remain unmeasured; Production is NO-GO.
