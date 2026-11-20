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

### Workstream B local extension — not hosted approval

The supported direct-outlet extension is recorded in
`qa-evidence/day1/GST_WORKSTREAM_B_FINAL_CLOSURE.md`. The Priority 1 text below
is the baseline, not the latest implementation description of recipient or
IRP readiness. For new supported Regular documents, record the issue-time
PAN-wide highest prior FY since FY2017–18, not just the immediately prior
FY. Never clear unknown applicability; use the saved buyer and actual outlet
place of supply, not the buyer GSTIN state.

Priority 2 adds a separate local-only IRP execution sidecar. It supports
owner-requested offline INV-01 preparation, simulation queue, private worker
verification, lookup, cancellation and an outlet-scoped register. `SIM-`
artifacts are not legal IRN/ACK/QR and do not release any held invoice or
note. No live adapter, authority route, worker grant, credential, legal QR
or hosted operation is approved. Keep bearer and text release restricted;
never use a synthetically verified outcome to clear documents or to create
adjustments/refunds. [Local completion / no-go gates](qa-evidence/day1/IRP_PRIORITY_2_LOCAL_COMPLETION.md)
cover the new chain. All 26 GST/IRP files remain separately **NOT AUTHORIZED**.
No general tax, payment or release approval follows.

### GST two-mode billing — CA-confirmed specification (local Workstream B Priority 1)

This supersedes the 2026-11-14 treatment choices for reviewed onboarding, not
any hosted or outlet activation gate. See `docs/gst-two-mode-2026-11-14.md`.
- **GST:** valid 15-character GSTIN, valid 14-digit FSSAI, business type and service SAC. Standalone restaurant services are 5% without ITC, including dine-in, takeaway and delivery. A hotel restaurant uses 18% with ITC only at Specified Premises: the preceding FY actual room supply value exceeded ₹7,500 per unit per day, **or** a valid opt-in was filed within the applicable adviser-confirmed period. Otherwise it uses 5%. No free rate choice or invented filing deadline. Qualifying evidence, effective date and attestation are recorded for the FY. The **TAX INVOICE** uses inclusive menu prices, one document-level tax extraction and the outlet-state place of supply (CGST + SGST), without re-deriving saved issued amounts.
- **No-GST (unregistered):** declaration, FSSAI, saved name/address/phone, no GSTIN or tax. Issue **RETAIL BILL / CASH MEMO**. Pre-enrolment legacy plain receipts are not CA-reviewed retail bills; keep their saved amounts and identity, and do not auto-enrol any outlet.
- **No-GST (Composition):** a subtype, not a third mode. Requires Composition registration, validated GSTIN/FSSAI and the existing eligibility acknowledgment (alcoholic liquor, tobacco, inter-State, e-commerce operator). No CMP-02 reference is required. Issue **BILL OF SUPPLY** with “Composition taxable person, not eligible to collect tax on supplies”; no GST collected or shown, no ITC.
- **Series:** `INV`, `BOS`, `RBL` counters by outlet and India financial year, transaction-safe, six-digit sequence, maximum 16 allowed characters. Legacy INV records and numbers remain reserved. No reset on mode changes or voids. A registration shared across multiple outlets needs a separately reviewed series allocation before activation.
- **e-Invoice** — no IRP provider is configured or approved. Applicability is decided at issue time (preceding-FY AATO > ₹5 crore, Notification No. 10/2023-CT as amended; B2C never applicable) and applicable B2B documents are issued `irp_status='pending'` — never presented as final tax invoices until a validated IRN exists; unknown AATO fails closed. B2B recipient capture exists only on Regular GST tax invoices (name/GSTIN/state-code derived/optional address+email); Composition bills and normal receipts refuse buyer details. `lib/gst/irp/` holds the provider-agnostic adapter interface, the deterministic offline sandbox used by tests and rehearsals (not an IRP), structural signed-QR validation and the IRP state machine; the append-only `restaurant_irp_requests` table audits every attempt with hashes only.
- Restaurant checkout behaviour, IGST for restaurant services, per-item rates, exemptions, discounts (still disabled) and any other rate are all **out of scope** and remain locked. Discounts stay disabled until written financial policy approval exists.
- GST documents are immutable at the database level; only the audited void transition is permitted. `restaurant_invoices` triggers enforce this for every role.

## Approved product and money decisions

- Money is integer paise (`BIGINT` in SQL); never use floating-point money. The database is the source of truth for order pricing; clients do not submit trusted totals.
- Preserve immutable order/item/payment snapshots and idempotency guarantees. Do not rewrite historical financial records as part of unrelated work.
- Customer ordering is **pay at the counter only**. Do not turn on a payment gateway in guest checkout or add a payment-mode selector. Authorized staff record already-verified cash/card/UPI at the counter (or the existing staff-manual settlement where appropriate); the app does not process those tenders. “Served” and “paid” are separate states. An unconfirmed recording is reconciled against the original attempt and the saved ledger, never by asking the guest to pay again.
- One table has one open sitting/session; later guest submissions create separate tickets containing only the newly submitted items. Preserve the session link, guest-token idempotency, and payment ledger rather than merging or duplicating tickets.
- The guest checkout attempt is scoped to the live outlet/table. It keeps the same UUID, basket and note through uncertain replies; a confirmed response consumes only the matching cart. A confirmation URL is a read, not authority to clear a cart. No safe shared browser storage/locking means order with staff, not a best-effort new key. Migration `20261118002000` is a local-only candidate and needs separate hosted authorization.
- **Live delivery is an invalidation signal, never business data.** `outlet_live_revisions` holds only an outlet id, an event id, a version and a commit time; operational tables are not published raw. Operational changes coalesce to one revision per committed transaction, and screens re-read persisted rows through the API rather than applying a wire payload. Do not add per-page refresh timers back on top of the shared coordinator. Migration `20261118002100` is local-only and needs separate hosted authorization, including a review of the target's Realtime publication.
- **The `waiter` role is floor-scoped.** Waiters see the outlet through `list_my_waiter_outlets`, `floor_service_snapshot` (bounded tables/calls with truncation flags) and the `table_waiter_calls` live columns only; broad staff policies keep their previous role list. Never widen a waiter into order, payment or finance reads, and keep acknowledgement separate from the device's speech claim.
- **A table transfer moves the sitting, not the ticket.** Preserve `orders.table_id`, the guest bearer and the sitting link; revoke both tables' verification proofs and refuse a move that is occupied, held, has an open call, or carries money. Guest calls are bound to the exact displayed verified table label.
- **Guest edits are version-conditioned.** `get_guest_order_status` returns a minimal status plus `guest_live_version`; `set_guest_order_lines_at_version` refuses a stale version before delegating to the existing authority and pricing core. Do not reintroduce quantity-only client state or unconditional edits.
- Guest status is not a final, numbered receipt. Close a settled sitting through authorized staff checkout to issue its saved document. Print privately where required; only eligible ordinary receipts may use expiring, revocable share links. Neither a payment acknowledgement nor a shared link releases an IRN hold.
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
