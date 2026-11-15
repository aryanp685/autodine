# Hosted synthetic acceptance — preparation (2026-11-14)

**Status: prepared, not run.** No hosted environment was touched for this
document. This is the acceptance script for the staging environment once the
S0–S7 report_sales rehearsal (`docs/report-sales-staging-rehearsal-2026-11-14.md`)
and any other authorized staging applies have landed. Production is never a
target; "hosted synthetic acceptance" means **staging with synthetic data only**.

## Pre-conditions (all required)

1. Explicit owner authorization naming the staging project
   (`autodinetest`, `juwyhslzchjevqkdvwjm`) for the acceptance run.
2. The staging rehearsal for `20261112000300_report_sales_export_authorization`
   is complete with evidence (or explicitly waived in writing).
3. A staging backup disposition (a/b in the rehearsal runbook) and a
   capture-before-replace artifact for any function the run will replace.
4. Synthetic fixtures only: `scripts/staging/provision-e2e.mjs` namespace
   (unique per run), no real customer data, no real email addresses, no real
   payment instruments (pay-at-counter only).
5. Preview/staging app points at staging only; preview isolation verified
   (`docs/preview-isolation.md`); no `NEXT_PUBLIC_*` production values.

## Scenarios (each recorded pass/fail with evidence)

### A. Owner onboarding and GST configuration
1. Synthetic owner signup → confirmation mail received (Resend/Auth gate
   passed) → confirmed → workspace + 21-day trial visible.
2. Menu/tables/QR setup via dashboard; QR card printed or displayed.
3. GST settings: mode off → a receipt issues as a normal receipt; switch to
   composition → Bill of Supply with statutory notice, no tax anywhere;
   switch to regular (both profiles) → GST tax invoice with CGST/SGST split;
   incomplete config fails closed with the documented message; invalid GSTIN
   check digit rejected (DB+config CHECK).

### B. Guest order flow
4. Scan QR → 6-digit code → menu renders; order with variant + add-on qty>1;
   submit; order code shown; duplicate submit (double-tap) yields ONE order.
5. Order appears on kitchen screen ≤ 2s; audio announcement fires (after
   gesture); kitchen marks preparing → ready.

### C. Cashier settlement and invoice
6. Cashier sees the sitting; records payment (cash); due drops to zero;
   receipt issues: non-GST receipt / Bill of Supply / GST tax invoice per
   configured mode; immutability trigger blocks edit; void transition is the
   only allowed mutation and is audited.
7. Print A4 and 58/80mm from the browser; PDF matches; secure share link
   works once, then revocation revokes.

### D. Reports and export
8. Owner/Manager: reports screen loads; CSV export summary/orders/items
   downloads with BOM, no-store, correct filename. Cashier: 403 on export.
9. Oversized direct RPC call (`p_order_limit=100000`) returns ≤ 10000 details
   and unchanged range totals.

### E. Adversarial (synthetic)
10. Expired/reused confirmation link → generic pending page, no enumeration.
11. Kitchen role hitting `/api/ops/realtime-alert` with bad payload → 400;
    cross-origin → 403; sixth call in 10 min → silently dropped (204).
12. Session close with outstanding balance → refused (P8 guard), then paid →
    close succeeds and receipt issues.

### F. Regression smoke
13. `/api/health` 200 on staging after the run; `operational` map all
    applied; subscription-expiry cron (if scheduled per runbook) ticks clean.

## Evidence pack (filed per run)

- Scenario checklist with pass/fail, UTC timestamps, and the deploy/preview
  id under test.
- Raw outputs minimized: no tokens, addresses, or full rows; screenshots
  redacted.
- A one-page verdict: PASS (all) / PASS WITH FINDINGS (advisory items) /
  FAIL (any blocking scenario), signed by the runner and the owner.

## Non-goals

- No production traffic, accounts, or data. No load numbers from this run.
- Not a penetration test; F-scenarios are abuse-boundary smoke only.
- Not a substitute for the production backup/restore gate or the migration
  convergence decisions (`docs/migration-reconciliation.md`).
- A pass authorizes planning the pilot; it never authorizes production
  deployment by itself.
