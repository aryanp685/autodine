# AutoDine — authoritative project instructions

These rules apply to every coding agent, developer task, test, and deployment. Read this file before changing code; follow the linked subsystem specifications too. If sources conflict, stop and ask rather than weakening a locked decision. Current explicit user direction can clarify scope, but does not silently rewrite unrelated decisions.

## Release truth, worktree, and change safety

- Treat application source and checked-in migrations as implementation; reports are dated evidence, not proof of current hosted state. Reconcile claims against callers/UI and record evidence date, scope, and limitations.
- Release and pilot status default to **NO-GO** until fresh, authorized hosted security, migration, recovery, guest-to-staff E2E, performance, rollback, and operator-approval evidence is recorded. Local tests, a READY Preview, or `/api/health` alone never clear those gates.
- Keep `RELEASE-BLOCKER-REPORT.md` as the live blocker register. Separate current observations from historical reports and explicitly mark gates not checked.
- Work only on the active Arena branch. Preserve pre-existing tracked and untracked work; never reset, clean, restore, overwrite, stage, or commit without explicit authorization for that operation.
- `scripts/phase3/staging-baseline.json` is protected user work. Preserve its bytes; its protected SHA-256 is `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`.
- Make the smallest independent fix that addresses a demonstrated defect. Add a targeted regression test for each behavioral change; do not weaken or delete tests to make a run green.

## Approval and scope

- Preserve existing working behavior. Do not alter approved product specifications, financial behavior, database semantics, security controls, or deployment targets without explicit user approval.
- Phase 2+ product implementation requires explicit user approval. Approval is limited to the requested scope; it is not blanket approval to invent additional product behavior. The approved P2–P10 roadmap is already complete per the audit record; do not reopen it or invent new roadmap scope without explicit approval.
- Ask before consequential production database, financial, security, or destructive changes. Apply database changes only through checked-in forward migrations and verify them without using Production for integration tests.
- GST treatment is locked as described below. Do not implement tax-policy changes while approval is outstanding.

## Permanent GST constraint

- GST rules and rates may come only from explicitly approved configuration.
- Never invent GST rates, defaults, classifications, inclusive/exclusive treatment, exemptions, or place-of-supply rules.
- GST calculations must follow a formally approved tax policy; do not infer policy from sample/demo values or existing implementation.
- Until approval, GST-dependent functionality must remain safely gated and fail closed. Preserve existing safe behavior; do not make a tax calculation appear compliant by guessing.

## Approved product and money decisions

- Money is integer paise (`BIGINT` in SQL); never use floating-point money. The database is the source of truth for order pricing; clients do not submit trusted totals.
- Preserve immutable order/item/payment snapshots and idempotency guarantees. Do not rewrite historical financial records as part of unrelated work.
- Customer ordering is **pay at the counter only**. Do not turn on a payment gateway in guest checkout or add a payment-mode selector. Staff settlement remains the simple authorized “mark paid” action; “served” and “paid” are separate states.
- One table has one open sitting/session; later guest submissions create separate tickets containing only the newly submitted items. Preserve the session link, guest-token idempotency, and payment ledger rather than merging or duplicating tickets.
- Invoice, checkout, and printing behavior must follow the approved Invoice Spec v1.0 and the already-implemented flows. Browser/OS printing is the supported printing model; do not add printer hardware integrations without approval. Kitchen tickets remain screen-first; do not reintroduce KOT print without approval.
- Kitchen announcements must retain the approved content in this order: order number, table, items, quantities, and guest note. Preserve deduplication and persistence. Call Waiter copy is `टेबल X, वेटर ध्यान दीजिए。` unless the user explicitly changes it.
- For QR/session throttling, follow `docs/scan-limit-l1.md`: throttle verification/session minting only, never order submission; a refused scan does not create a session or order. Keep the race/idempotency guarantees covered by the database tests.
- **Order submission is never throttled.** Throttle QR verification, session minting and other sensitive endpoints; never count or refuse a legitimate guest order. Migration `20261110000800` removed the per-session, per-restaurant and per-IP attempt budgets from `place_public_order` and `place_public_order_attempt`, keeping the session/tenant check, QR validation, idempotency and replay protection. A guard test in `lib/db/readiness.integration.test.ts` fails if any of those budget keys reappear in a function body.
- **Commercial subscriptions are Model C: one subscription per ACCOUNT, shared by every outlet of the account.** Trial 21 days from activation. Starter Rs 999 / month — 1 outlet; Professional Rs 2,699 / month — 5 outlets; Business Rs 3,699 / month — unlimited outlets. Trial activation must work. A trial that was still running when the length changed keeps its original activation date and runs 21 days from it; a trial that had already expired stays expired — which is why the end date is materialised in `accounts.trial_ends_at` instead of recomputed from a bare interval. Downgrades and expiries preserve every outlet and every row of data: they stop NEW outlet creation and make the account read-only, and nothing is ever deleted. Authority: `supabase/migrations/20261110001000_account_subscriptions.sql` (`public.account_can_write`, `public.account_outlet_limit`, `public.create_outlet`, `public.admin_set_subscription`) and `lib/plans.ts`; `lib/plans.test.ts` pins the two against each other.
- **Public restaurant data is three facts: name, customer-facing phone, customer-facing address.** Read it only through `public_restaurant_profile()` (`lib/db/public-restaurant.ts`, migration `20261110000500`). GSTIN, subscription plan, trial dates, payee details and internal settings are never public — a GSTIN reaches a guest only on a bill the business issues, through `lib/db/bill.ts`, which is staff-authenticated.

## Security and operational invariants

- Never commit secrets, Production credentials, `.env.local`, or test data copied from Production. Secret/service-role keys must never be exposed through `NEXT_PUBLIC_*` variables.
- Production requires the public Supabase URL and key and must never silently render fictional data. Local demo mode requires `AUTODINE_DEMO_MODE=true` under `next dev`; the hermetic build exception is restricted to GitHub Actions CI with `AUTODINE_TEST_DEMO_BUILD=true` and `VERCEL_ENV=test`. Never put either demo flag in a deployment.
- Preserve RLS, least-privilege grants, token-scoped guest reads, fixed `search_path` on security-definer functions, safe redirects, CSP protections, and server-side authorization. Do not “fix” a failing test by bypassing these controls.
- Never run integration, browser, load, or destructive tests against Production services or data. Use disposable local PostgreSQL / local Supabase-compatible services and synthetic seed data only. C4 is proven with the isolated local PostgreSQL harness; it must not be replayed against Production.
- For the database-backed browser throttle suite, use the dedicated isolated setup in `docs/e2e-local.md` and `.github/workflows/throttle-e2e.yml`. The workflow must not require Production secrets. Preserve test logs/results as artifacts and do not call browser E2E complete unless both named tests genuinely pass.
- Only the production deployment may use the Production Supabase project. Preview, Development, CI and local runs must point at another project or none; the build and Supabase environment loader refuse otherwise. The rule, its variables and operator steps are in `docs/preview-isolation.md`. Do not add a bypass.
- Local scaffolds under `scripts/local-pg/` are test-only approximations where repository migrations omit live-schema objects. They are not Production DDL or proof of Production-schema parity.

## Database, payments, and hosted boundaries

- Local migrations and tests may use only disposable, loopback PostgreSQL and synthetic data. Keep migrations additive/forward-only; never apply them to a hosted project without the required explicit approval and recovery gates.
- Production is read-only unless separately authorized for a specific operation. Staging remains NO-GO: until operator acceptance, recovery evidence, and migration gates are satisfied, limit it to authorized read-only metadata/catalog inspection. No hosted DML, DDL, migrations, orders, side-effecting RPCs, or customer/staff messages as part of ordinary development or this merge task.
- Online guest payments remain disabled. Do not invoke provider flows/RPCs, make real charges/refunds, or treat credentials/schema functions as an implemented guest payment path. Subscription billing has no approved/configured provider; provider-dependent actions must fail closed.
- Never print, copy, or commit secrets or environment values. Do not contact operators or send external messages; prepare material for the user to share.
- Do not perform a Production deployment as an incidental side effect of a code task; verify deployment consequences and obtain separate authorization when needed.

## Source-of-truth map

- This `AGENTS.md` is the cross-cutting source of truth for agents and development tasks.
- Exact scan-throttle semantics: `docs/scan-limit-l1.md`; coverage and evidence: `docs/scan-throttle-coverage.md`.
- Reproducible isolated browser E2E setup: `docs/e2e-local.md`; operator setup checklist: `docs/SETUP.md`.
- Current readiness evidence and known integration gaps: `docs/website-readiness-audit.md` and `RELEASE-BLOCKER-REPORT.md`.
- Deployment isolation (which environments may reach Production data): `docs/preview-isolation.md`.
- Deciding what a database still needs from `supabase/migrations/` (method, tools, findings to date): `docs/migration-reconciliation.md`. Hosted rollout steps stay in `PHASE-3-HOSTED-BASELINE.md` and `PRODUCTION-BACKUP-RUNBOOK.md`.
- Migration-specific behavior remains in checked-in SQL migrations and their contract/integration tests. Treat old sections of `AUDIT-REPORT.md` that are explicitly marked historical as snapshots; use its current-status notes only for dated verification evidence.
- Do not create a competing policy or runbook; update the relevant canonical document when a rule or verified result changes.

## Verification and reporting

- Install locked dependencies with `npm ci` when needed. Run targeted Vitest tests first, then relevant `npm test`, `npm run typecheck`, `npm run lint`, `npm run sql:check`, and build/E2E checks as scope permits.
- Distinguish tests run now from historical results; report skips, unavailable fixtures, and any hosted/performance/recovery checks not performed. Do not repeat the completed Phase 5C PostgreSQL suite without a concrete inconsistency.
