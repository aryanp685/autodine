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

### GST two-mode billing — owner-approved scope (2026-11-14; extended 2026-11-21 to Billing Spec v2.0)

The owner approved building the two-mode GST system on 2026-11-14 and extending it to **Billing Spec v2.0** (`docs/BILLING_SPEC.md`, `docs/GST_COMPLIANCE.md`) on 2026-11-21:
- **Owner-facing two-mode toggle:** Mode 1 is **Normal Billing (GST Disabled)** (`receipt` / Bill / Cash Memo, unchanged default with explicit self-declaration when saved); Mode 2 is **GST Billing (GST Enabled)** where the owner selects either **Regular GST** or **Composition Scheme**.
- **Composition Scheme** — issues a Bill of Supply, never a tax invoice; collects no GST; claims no ITC. Activation requires the GSTIN registration type to be `composition` plus the owner's acknowledgment of the ineligibility list (alcoholic liquor, tobacco, inter-State, e-commerce operator). No CMP-02 evidence reference is required. Statutory notice printed on every Bill of Supply.
- **Regular GST** — exactly two profiles: 5% (other than specified premises, no ITC; Notification No. 11/2017-CT(Rate), Sl. 7(i), as amended) and 18% (specified premises only, w.e.f. 2025-04-01; Notification No. 05/2025-CT(Rate)). The 18% profile requires the specified-premises attestation. Menu prices are **tax-inclusive**; tax is extracted at document level (one rounding), never per line, and never recalculated after issue. Place of supply for restaurant services is always the outlet's state (CGST+SGST).
- **e-Invoice** — no IRP provider is configured or approved. Applicability is decided at issue time (preceding-FY AATO > ₹5 crore, Notification No. 10/2023-CT as amended; B2C never applicable) and applicable B2B documents are issued `irp_status='pending'` — never presented as final tax invoices until a validated IRN exists; unknown AATO fails closed. B2B recipient capture exists only on Regular GST tax invoices (name/GSTIN/state-code derived/optional address+email); Composition bills and normal receipts refuse buyer details. `lib/gst/irp/` holds the provider-agnostic adapter interface, the deterministic offline sandbox used by tests and rehearsals (not an IRP), structural signed-QR validation and the IRP state machine; the append-only `restaurant_irp_requests` table audits every attempt with hashes only.
- **Billing Spec v2.0 extensions (2026-11-21 owner-approved roadmap):** Extend the checked-in billing system via additive migrations with `restaurants.fssai_number`, unified 58mm/80mm/A4/PDF bill branding, role-gated/audited item & bill discounts (applied before GST extraction), configurable charges (packaging/delivery/voluntary service charge), explicit round-off, split & partial counter payments, audited refunds, `DUPLICATE` reprint marking + audit log, Takeaway/Delivery counter billing, optional local ESC/POS Print Bridge for **customer bills/invoices only**, and expanded owner tax/register/Z-report reporting.
- **Out of scope:** IGST for restaurant services, per-item GST rates, and unregistered GST collection remain prohibited.
- GST documents are immutable at the database level; only the audited void transition is permitted. `restaurant_invoices` triggers enforce this for every role.

## Approved product and money decisions

- Money is integer paise (`BIGINT` in SQL); never use floating-point money. The database is the source of truth for order pricing; clients do not submit trusted totals.
- Preserve immutable order/item/payment snapshots and idempotency guarantees. Do not rewrite historical financial records as part of unrelated work.
- Customer ordering is **pay at the counter only**. Do not turn on a payment gateway in guest checkout or add a payment-mode selector. Counter staff settlement handles single, split, partial, and refunded payments at the counter; “served” and “paid” are separate states.
- One table has one open sitting/session; later guest submissions create separate tickets containing only the newly submitted items. Preserve the session link, guest-token idempotency, and payment ledger rather than merging or duplicating tickets.
- Customer bill/invoice printing supports Browser/OS CSS printing (`58mm`, `80mm`, `A4`), downloadable PDF, and the approved optional local **ESC/POS Print Bridge** for customer bills/invoices. **Kitchen KOT paper printing is NOT wanted and must be removed (`lib/kot-print.ts` and Kitchen print buttons); kitchen remains strictly screen-first + voice announcements.**
- Kitchen announcements must retain the approved content in this order: order number, table, items, quantities, and guest note. Preserve deduplication and persistence. Call Waiter copy is `टेबल X, वेटर ध्यान दीजिए。` unless the user explicitly changes it.
- For QR/session throttling, follow `docs/scan-throttle-coverage.md`: throttle verification/session minting only, never order submission; a refused scan does not create a session or order. Keep the race/idempotency guarantees covered by the database tests.
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
- Online guest payments remain permanently disabled (**pay at counter only**). Do not invoke guest online payment RPCs or collect customer food funds through AutoDine.
- **SaaS Subscription Billing uses Cashfree** (`docs/PAYMENT_ARCHITECTURE.md`): restaurants pay AutoDine for Starter/Professional/Business plans via Cashfree only. Until `BILLING_PROVIDER=cashfree` and Cashfree API/webhook secrets are configured in the environment, provider-dependent checkout/webhook actions must continue to fail closed.
- Never print, copy, or commit secrets or environment values. Do not contact operators or send external messages; prepare material for the user to share.
- Do not perform a Production deployment as an incidental side effect of a code task; verify deployment consequences and obtain separate authorization when needed.

## Source-of-truth map

- This `AGENTS.md` is the cross-cutting source of truth for agents and development tasks.
- Canonical product, architecture, billing, GST, and Cashfree payment specs: `docs/PRODUCT_REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/BILLING_SPEC.md`, `docs/GST_COMPLIANCE.md`, `docs/PAYMENT_ARCHITECTURE.md`.
- Exact scan-throttle semantics: `docs/scan-limit-l1.md`; coverage and evidence: `docs/scan-throttle-coverage.md`.
- Reproducible isolated browser E2E setup: `docs/e2e-local.md`; operator setup checklist: `docs/SETUP.md`.
- Current readiness evidence and open release gates: `RELEASE-BLOCKER-REPORT.md` (the live blocker register; the former `docs/website-readiness-audit.md` was removed in the 2026-11-21 cleanup).
- Deployment isolation (which environments may reach Production data): `docs/preview-isolation.md`.
- Deciding what a database still needs from `supabase/migrations/` (method, tools, findings to date): `docs/migration-reconciliation.md`. Hosted rollout steps stay in `PRODUCTION-BACKUP-RUNBOOK.md` and `docs/migration-reconciliation.md` (the former `PHASE-3-HOSTED-BASELINE.md` record was removed in the 2026-11-21 cleanup).
- Migration-specific behavior remains in checked-in SQL migrations and their contract/integration tests. The consolidated `AUDIT-REPORT.md` was removed in the 2026-11-21 cleanup; treat any remaining audit-derived claims in other documents as dated snapshots, and use `RELEASE-BLOCKER-REPORT.md` for current gate status.
- Do not create a competing policy or runbook; update the relevant canonical document when a rule or verified result changes.

## Verification and reporting

- Install locked dependencies with `npm ci` when needed. Run targeted Vitest tests first, then relevant `npm test`, `npm run typecheck`, `npm run lint`, `npm run sql:check`, and build/E2E checks as scope permits.
- Distinguish tests run now from historical results; report skips, unavailable fixtures, and any hosted/performance/recovery checks not performed. Do not repeat the completed Phase 5C PostgreSQL suite without a concrete inconsistency.
