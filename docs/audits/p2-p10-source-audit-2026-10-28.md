# AutoDine P2–P10 source audit

> **Historical snapshot:** the findings below describe source on 2026-10-28 and are not the current implementation status. Since then, session invoice history and secure receipt-share links were implemented; the full multi-ticket → settlement → invoice/share/revoke → print-layout → closed-history → fresh-session browser scenario was added; an explicit Hinglish kitchen mode was added; and 48 migrations plus the new P3/P8/P9 SQL checks passed the embedded PostgreSQL runner. Current workflow guidance/evidence and sandbox limitations are maintained in [`docs/e2e-local.md`](../e2e-local.md). Discounts remain blocked on missing approved tax/discount arithmetic; no GST behavior was guessed or changed.

**Audit date:** 2026-10-28 (UTC)  
**Repository/branch:** `aryanp685/autodine`, `arena/e9e78732-autodine`  
**Scope:** Fresh source-and-test audit of P2–P10. No production services/data were accessed; database checks used disposable local PostgreSQL and synthetic fixtures only. No deployment was performed.

## Executive result

Several core paths are implemented and covered, but the complete P2–P10 product is **not ready to claim end-to-end completion**. The strongest verified areas are counter-only checkout/settlement, idempotent ticket writes, the voice/waiter building blocks, and immutable receipt snapshots. Remaining blockers include a secure guest receipt-share link, discount application and audit policy, a closed-session history view, duplicate-copy print marking, real browser verification of the consolidated-session lifecycle, final physical/PDF parity, the unresolved Realtime load failure, and read-only backup/PITR evidence.

Two safe fixes were made during this audit:

1. The guest checkout CTA now matches the required exact wording: **PLACE ORDER & PAY AT COUNTER**.
2. Checkout now refuses to close an unpaid or partially paid session both in the dashboard UI and the database transaction. Direct authenticated execution of the lower-level receipt-issue function was revoked so it cannot bypass that settlement gate. Finance receipt reads are also restricted to owner/manager/cashier roles rather than every restaurant member.

The new migrations are source changes only; they have **not** been deployed.

## Requirement findings

### P2 — Counter-only guest checkout: **COMPLETE (customer-facing behavior)**

- **Evidence:** `app/menu/checkout/page.tsx`, `components/screens/CheckoutScreen.tsx`, `components/PlaceOrderButton.tsx`, `app/menu/checkout/actions.ts`, `components/screens/OrderPlacedScreen.tsx`; counter settlement at `app/(staff)/cashier/` and `supabase/migrations/20261020000004_counter_payment.sql`.
- Checkout shows the reviewable cart and totals, states that nothing is charged from the guest’s phone, and submits the server-priced order. Orders are written as unpaid/pending; counter payment is recorded separately by cashier/staff. The CTA was changed to the specified uppercase text and is covered by `components/screens/CheckoutScreen.test.tsx`.
- No customer-facing online-payment button, API route, payment SDK or Razorpay reference was found in the app. SaaS subscription billing is explicitly disconnected in `lib/plans.ts`; it is not mixed with food-order payments.
- **Caveat:** dormant service-role-only online-payment database functions and the `online_payments_enabled` column remain in migrations `20261022000800_online_payments.sql` and `20261107000000_storefront_settings.sql`. Settings and guest UI do not expose them. They are not a customer flow, but should remain inaccessible until deliberately removed or separately approved and reviewed.
- **Tests:** `components/screens/CheckoutScreen.test.tsx`, `components/screens/OrderPlacedScreen.test.tsx`, `app/(staff)/cashier/` tests; `e2e/integration/cashier-flow.spec.ts` and `guest-order-flow.spec.ts` (latest isolated GitHub run noted below).

### P3 — One active table session, incremental tickets, idempotency, consolidated bill: **PARTIAL**

- **Evidence:** table `public.order_sessions`, `orders.order_session_id`, partial unique index `order_sessions_open_unique`, and `place_public_order(...)` in `supabase/migrations/20261107074545_order_sessions.sql`; replay protection in `supabase/migrations/20261027000900_idempotent_guest_orders.sql`; current wrapper in `supabase/migrations/20261108006000_restore_public_order_session_attach.sql`.
- The database enforces one open sitting per table. New guest tokens make distinct tickets, while a replay of the same `guest_token` returns the existing order before creating another ticket. A closed sitting is not reused; a later order opens a fresh sitting. The final receipt builder snapshots all non-cancelled session tickets and their lines.
- Added `supabase/checks/08_p3_incremental_tickets.sql`: against disposable PostgreSQL, two identical intentional tickets with distinct guest tokens produced two ticket codes in one open session; replaying the second token returned its original code and left the count at two.
- **Gap:** the sequential multi-ticket flow was verified at the SQL boundary, not through a browser guest placing two rounds at the same table. The browser integration suite tests a single order/double tap and a single-ticket bill, not the complete multi-round session journey.
- **Tests:** `lib/db/order-sessions-migration.test.ts`; new disposable SQL check above; `e2e/integration/guest-order-flow.spec.ts` and `security-flow.spec.ts` cover single-order/double-submit behavior.

### P4 — Active table dashboard, history, bill, unpaid counter state, staff settlement/RBAC: **PARTIAL**

- **Evidence:** `lib/db/dashboard-screen.ts`, `components/screens/DashboardScreen.tsx`, `app/(staff)/dashboard/actions.ts`, `components/owner/MarkSessionPaidButton.tsx`, `components/owner/CloseSessionButton.tsx`, `lib/db/cashier-screen.ts`, `components/screens/CashierScreen.tsx`; payment function `mark_order_session_paid(uuid)` in `supabase/migrations/20261107082936_session_manual_payment_p4.sql`.
- Dashboard cards now show session UUID, table, opened time, ticket codes, item names, quantities, variants/add-ons, session total, paid/outstanding totals, and payment status. Settlement and close actions are available only to owner/manager/cashier; the database functions independently enforce role and restaurant membership. Unpaid/partial balances remain visible in cashier/dashboard flows.
- The new “settle before close” message suppresses the close action while any balance remains.
- **Gap:** there is no staff-facing closed-session/invoice-history list or searchable session history. `/dashboard/orders` is ticket-oriented; `/invoice/[id]` requires a known receipt UUID. Active-session UI is not yet browser-tested with real multi-ticket data.
- **Tests:** `lib/db/dashboard-screen.test.ts` (including new line details), `components/screens/DashboardScreen.test.tsx`, `app/(staff)/dashboard/actions.test.ts`, cashier unit/integration tests.

### P5 — Automatic Hindi/English/Hinglish voice, status/retry/replay, waiter call: **PARTIAL**

- **Evidence:** `components/screens/KitchenScreen.tsx`, `lib/db/kitchen-screen.ts`, `lib/announce.ts`, `lib/speech.ts`, `lib/server-speech.ts`, `app/api/tts/route.ts`, `app/(staff)/kitchen/announcement-actions.ts`, `supabase/migrations/20261107104440_p5_voice_waiter.sql`; guest waiter action at `app/menu/waiter-actions.ts` and `components/CallWaiterButton.tsx`.
- Source implements per-ticket voice claims, persisted announced/failed outcomes, retries/manual replay, cross-device speaker locking, and a durable waiter-call queue with dedupe/cooldown and staff announcement status. Kitchen and waiter updates are separated from order creation, so replaying speech does not create an order.
- **Gaps/limits:** the kitchen language selector is Hindi or English (`AnnounceLang = 'hi' | 'en'`); Hinglish occurs in phrasing but is not an explicit selectable mode. Voice availability and sound remain device/browser-dependent. The high-load Realtime issue below means continuous status delivery is not yet reliable enough to claim complete under load; its direct impact on voice delivery was not measured.
- **Tests:** `components/screens/KitchenScreen.test.tsx`, `app/(staff)/kitchen/announcement-actions.test.ts`, `lib/announce.test.ts`, `lib/speech.test.ts`, `lib/server-speech.test.ts`, `app/menu/waiter-actions.test.ts`; browser kitchen integration checks appear in `e2e/integration/kitchen-flow.spec.ts`.

### P6 — Consolidated bill, discounts/permissions, sequential invoice history, frozen GST policy: **PARTIAL**

- **Evidence:** invoice schema and `issue_closed_session_receipt(uuid)` in `supabase/migrations/20261108002000_invoice_receipts.sql`; receipt screens/loaders at `app/invoice/[id]/`, `lib/db/invoice.ts`, `components/screens/InvoiceScreen.tsx`; receipt formatting in `lib/invoice.ts`.
- The database allocates per-restaurant, financial-year sequential receipt numbers transactionally; snapshots immutable line, tax, payment and total values across all tickets. Voids remain in the ledger and replacements receive a new number. The current document is explicitly a **non-GST receipt**; it uses only tax recorded on tickets and does not invent rates or CGST/SGST splits. This audit did not change the frozen tax policy.
- **Gap:** no ticket- or bill-discount application action/UI was found. `bill_discount_paise` is currently written as zero, and receipt issuance explicitly fails closed if a ticket has a discount (`discount_paise > 0`) until the approved item-level tax/discount audit configuration exists. Owner/Manager discount permissions and a closed-invoice history UI are therefore incomplete. Do not enable discounts by guessing tax arithmetic or authority rules.
- **Tests:** `lib/db/invoice-receipts-migration.test.ts`; `components/screens/InvoiceScreen.test.tsx` has 15 named scenario cases plus parity assertions for rendered receipt HTML and shared text.

### P7 — A4/58/80mm browser/OS print, KOT, PDF, share, reprint marking: **PARTIAL**

- **Evidence:** `components/screens/InvoiceScreen.tsx`, `components/PrintButton.tsx`, `lib/kot-print.ts`, `components/screens/KitchenScreen.tsx`.
- Receipt screen offers A4, 58mm and 80mm `@page` layouts and `Print / Save PDF` through the browser/OS print dialog. Kitchen offers a separate browser KOT print document (80mm). Share currently produces text through Web Share/WhatsApp; it does not create a public receipt URL.
- **Gaps:** no secure digital share token/route, no explicit downloaded PDF artifact, no “DUPLICATE COPY” marker or audit-safe reprint workflow. Actual device/printer/browser layout, pop-up blocking, and PDF file-total parity were not verified by this audit. No printer bridge or local agent was introduced.
- **Tests:** `lib/kot-print.test.ts`; `components/screens/InvoiceScreen.test.tsx` verifies three layout options, totals and share-text parity, but not generated PDF bytes or physical paper output.

### P8 — Payment/invoice/print/share/close lifecycle, partial/unpaid/paid, closure and release: **PARTIAL (settlement gate fixed)**

- **Evidence:** `public.order_sessions`, `public.payments`, `public.restaurant_invoices`, `public.restaurant_payment_receipts`; close function in `supabase/migrations/20261108003000_session_checkout_payment_receipts.sql`; new hardening in `supabase/migrations/20261108008000_p8_require_settlement_before_close.sql`; UI `components/owner/CloseSessionButton.tsx` and action `app/(staff)/dashboard/actions.ts`.
- **Pre-audit defect fixed:** the prior close path accepted unpaid/partially paid balances and issued an invoice. The new UI and database gate compute outstanding from recorded ledger payments per non-cancelled ticket and refuse closure until the balance is zero. The lower-level receipt helper is no longer executable directly by authenticated/service-role clients, preventing bypass of the close gate. The `close_order_session_and_issue_receipt(uuid)` operation remains atomic/idempotent. `restaurant_payment_receipts` preserves later payment acknowledgements without mutating an issued snapshot.
- **Database evidence:** `supabase/checks/07_p8_close_settlement.sql` verifies unpaid close is rejected and leaves the session open, payment permits closure, the snapshot is fully paid, retries return the same invoice, and helper execution is revoked.
- **Gaps:** no full browser test of the whole multi-ticket settle → print/share → close → fresh table session sequence. Closed-session history navigation is absent. No actual share link exists. The migration does not inspect or remediate any legacy closed/unpaid production rows; no production data was queried, so that state is unknown.

### P9 — Validation, tenant isolation, RBAC, audit, expiry, invoice/share security, retries: **PARTIAL**

- **Evidence:** `supabase/migrations/20261108005000_p9_security_hardening.sql`, `supabase/migrations/20261108009000_p9_financial_read_roles.sql`, `supabase/migrations/20261108008000_p8_require_settlement_before_close.sql`, plus guest rate limits and verification migrations `20261108000000_guest_rate_limits.sql`, `20261108000200_drift_reconcile.sql`, `20261023000900_table_verification_code.sql`.
- Tenant-scoped database functions derive restaurant/actor/amounts from session and membership; writes are role-checked and idempotent; verification sessions expire; append-only staff security and payment audit structures exist. Invoice, invoice-line and payment-receipt read policies were tightened in this audit to owner/manager/cashier (migration `20261108009000...`), while issue/void/close actions remain database-guarded.
- **Gaps:** no expiring/revocable, session-bound public share credential exists. Existing invoice route is staff-authenticated; sharing sends text only. Backup/PITR configuration has not been verified because minimum read-only access is not available here; no restore drill was run because a separately approved non-production target is required. No production schema/data comparison occurred.
- **Tests:** `lib/db/p9-security-migration.test.ts`, guest security/invite unit tests, `e2e/integration/security-flow.spec.ts`; final migration chain applied to disposable PostgreSQL. RLS visibility for each staff role still needs a dedicated disposable Supabase/PostgREST test, not just migration application/source assertions.

### P10 — 15 existing real-world scenarios and printed/PDF total parity: **PARTIAL**

- **Evidence:** `components/screens/InvoiceScreen.test.tsx` contains 15 named “P10 real-world receipt scenarios” for invoice identity, layout options, line snapshots, unpaid/paid/partial presentation, discounts/taxes, void/replacement, multi-ticket totals, and supplemental payments. It also compares the screen’s rendered totals with `buildReceiptMessage()` output. `e2e/integration/` includes guest, kitchen, cashier and security suites.
- **Verified limitation:** the 15 cases are component-level fixture tests, not 15 end-to-end real-world workflows. The parity test compares HTML and share text; it does not render/inspect an actual PDF or a physical print. The complete 15-scenario checklist was not independently mapped to live database/browser journeys in this audit.

## Tests run and outcomes

| Command/evidence | Result | What it does / does not prove |
|---|---|---|
| `npm ci` | Passed; 313 packages installed, audit reported 0 vulnerabilities | Installed locked dependencies; no application behavior. |
| `npm test` | **157 files passed, 1 skipped; 1,913 passed, 5 skipped** | Full Vitest suite. The five skipped tests require the disposable PostgreSQL harness. |
| `npm run typecheck` | Passed | TypeScript no-emit check. |
| `npm run lint` | Passed | ESLint across repository. |
| `npm run sql:check` | Passed when last run; parser explicitly says function bodies/RLS are unverified | Syntax-oriented DDL parsing only; actual migration execution below is stronger for syntax. |
| `LOCAL_LOAD_USERS=100 npm run test:db:local` | **Passed on final source:** 47 migrations applied; 33 tables, 309 columns, 75 functions, 48 policies; P8/P3 SQL checks passed; 5 PostgreSQL-gated tests passed; 100 synthetic sessions/orders verified | Uses an ephemeral local PostgreSQL 17 cluster, local Supabase object shim and synthetic rows. It does not provide Supabase Realtime or production evidence. |
| Earlier `npm run test:db:local` default synthetic load | **5,000/5,000 sessions and 5,000/5,000 orders verified** before the final P3/P9 check additions | One disposable PostgreSQL SQL load only; no Realtime. Final 100-user run exercised the final migration chain. |
| `npm run e2e:local` | **Build passed; 64 browser E2E passed, 47 integration tests skipped** | Uses the local demo build. The skipped integration project needs a configured isolated Supabase E2E environment. No live customer data. |
| Latest existing isolated GitHub run `42601073059` (remote commit `edd64dd6de10…`, before this turn’s edits) | **64 hermetic + 47 Supabase integration tests passed; synthetic Realtime load failed** | 5,000 sessions, 5,000 orders, 1,000 reads and 75/75 kitchen writes passed. Realtime delivered 1,000/1,500 events: `preparing=0/500` matched and **0 raw events**, `ready=500/500`, `served=500/500`. This unresolved result remains a reliability blocker; no rerun was made against production. |

## Security/reliability and approvals

- **Realtime reliability:** the latest 5,000-user isolated Supabase run failed at `preparing` with zero raw events. Do not report the load/Realtime requirement as passed. The local PostgreSQL load cannot reproduce this because the harness has no Realtime publication worker.
- **Financial reads:** this audit changed invoice/payment-receipt reads to finance-capable roles; migration was applied in disposable PostgreSQL. A separate PostgREST/RLS role matrix is still needed.
- **Receipt share:** a secure session-scoped link needs an explicit expiry/revocation and disclosure policy before implementing public access; the existing text-share is not a substitute.
- **Backup/PITR:** not verified. Requires minimum read-only access. Any restore drill requires a separately approved non-production target. Neither was inferred or attempted.
- **Production/deployment:** none. No production tests, schema comparisons, destructive work, paid services or printer integrations were used.

## Remaining work, in priority order

1. Diagnose and fix missing `preparing` Postgres Changes events in isolated Supabase; rerun the same synthetic load with per-state raw/matched event assertions.
2. Add a closed-session/receipt history screen with session/ticket/payment links and a browser E2E test for a second order at the same table.
3. Approve and implement a secure receipt-share credential policy (expiry, revocation, exact shared data, and access logging); then test cross-session/tenant denial.
4. Define approved discount authority and tax handling before implementing ticket/bill discounts; currently final receipt issuance deliberately fails closed for ticket-discount rows and bill discount is zero.
5. Add duplicate-copy/reprint marking and test actual browser print/PDF outputs on A4, 58mm and 80mm, including printed/PDF/share total parity.
6. Run a full end-to-end multi-ticket settlement→receipt→close→new-session browser workflow against an isolated Supabase project, plus a finance-role RLS matrix.
7. Obtain read-only backup/PITR evidence and separately approve a non-production restore target before any restore drill.
