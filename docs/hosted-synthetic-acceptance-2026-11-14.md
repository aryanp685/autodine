# Hosted synthetic acceptance — one coordinated staging run (2026-11-14)

**Status: prepared, not run.** No hosted environment was touched. This is the
single coordinated acceptance run for staging, executed once S0–S7 of
`docs/report-sales-staging-rehearsal-2026-11-14.md` is complete (or waived in
writing) and the other hosted prerequisites below land. Production is never a
target; everything here is **staging with synthetic fixtures only**.

Scope is deliberately flat: each requirement is covered once. Duplicated or
redundant checks from earlier drafts were removed.

## 0. Hosted prerequisites (all six required, in this order)

1. **S0 authorization** naming the staging project `juwyhslzchjevqkdvwjm`
   (`autodinetest`) — see the rehearsal runbook. Confirm the target ref
   before anything else; anything else aborts.
2. **report_sales rehearsal (S1–S7) complete** with evidence attached, or a
   written waiver. Capture-before-replace for any function the run replaces.
3. **Staging backup disposition** (runbook §S3, option a or b) recorded.
4. **Resend/Auth staging SMTP verified** (see
   `docs/resend-auth-readiness-2026-11-14.md`) — only then can scenario A's
   confirmation-mail leg run; or that leg is waived in writing.
5. **Preview/staging app points at staging only** — `docs/preview-isolation-verification-2026-11-14.md`
   (config-level pass, 2026-11-14) plus this run's Scenario F smoke.
6. **Executor + window + evidence location** named by the owner (operator, or
   an authorized connector session, 2026-11-14+).

Fixtures: `scripts/staging/provision-e2e.mjs` namespace (unique per run),
two tenants **T-A** and **T-B**, synthetic users only (no real addresses, no
real payment instruments; pay-at-counter only). Runner: per
`scripts/staging/RUNNER-SETUP.md`.

## 1. Auth and invitations

1.1 Synthetic owner signup (T-A) → confirmation mail received → confirm →
    workspace + 21-day trial visible. Confirmation link is single-use;
    reuse lands on the generic pending/expired guidance.
1.2 Resend-confirmation for a non-existent account → identical generic
    response (no enumeration oracle). Throttled resend → generic 429.
1.3 Staff invitation (owner/manager role) → manual invite link → consume as
    the invited account → lands with exactly the granted role. Kitchen and
    cashier accounts likewise (one each).
1.4 Sign-out/sign-in round-trips for all four roles.

## 2. Customer QR/menu/order

2.1 Scan T-A QR → 6-digit join code → menu renders (item, variant, add-on,
    availability filters).
2.2 Order with variant + add-on qty>1 → order code shown; double-tap submit
    yields exactly one order.
2.3 Order visible on the kitchen screen; kitchen transitions
    `new → preparing → ready`; customer status tracks.

## 3. Kitchen Realtime and reconnection

3.1 Order appears on the kitchen screen without refresh (≤ 2 s observed).
3.2 Audio cue after the required user gesture.
3.3 **Reconnection:** kill the browser tab's network (devtools offline /
    Wi-Fi toggle) for ~20 s, place an order from the guest side, restore the
    network → the kitchen board re-syncs and shows the order **without a
    duplicate and without a manual reload**; realtime status indicator
    returns to live. If it does not self-heal, record the exact recovery
    path observed (reload button, polling, or manual refresh) and file it —
    this is finding, not failure.
3.4 Client reconnect counter is surfaced in the kitchen UI.

## 4. Cashier settlement

4.1 Cashier (T-A) sees the open sitting; records cash payment → due drops
    to zero.
4.2 Settlement with outstanding balance is refused (P8 guard), then paid →
    close succeeds and a receipt issues.
4.3 Receipt issues per configured GST mode (non-GST receipt / Bill of Supply
    / GST tax invoice as switched in §5); document is immutable; a void is
    possible only via the audited void transition.
4.4 Print A4 and 58/80 mm from the browser; secure share link works once,
    then revocation revokes.

## 5. Invoice and GST (per configured mode)

5.1 Mode off → normal receipt, no GST figures anywhere.
5.2 Composition mode → Bill of Supply with statutory notice, no tax, no ITC.
5.3 Regular mode (other premises) → GST tax invoice, 5% extracted
    tax-inclusive, CGST/SGST split, exact-paise allocation.
5.4 Regular mode (specified premises) → 18% variant.
5.5 Invalid GSTIN check digit rejected (builder and DB CHECK);
    incomplete GST config fails closed with the documented message.
5.6 B2B capture → issue-time `irp_status=pending` banner
    (AATO unknown/>₹5 Cr) or `not_required` (B2C); the screen never renders
    a tax invoice as filed without a real IRN; no path claims an IRN was
    issued; attempts via the owner/manager action record the audit rows.
5.7 e-Invoice follow-up panel on `/dashboard/invoices` lists the pending
    document; links to its invoice; shows attempt count/last attempt.

## 6. Permissions (single matrix — one pass each, no duplicates)

| Capability | Standpoint | Owner | Manager | Cashier | Kitchen |
|---|---|---|---|---|---|
| Dashboard/reports | `/dashboard*` | ✓ | ✓ | limited (POS only) | ✗ |
| CSV export (summary/orders/items) | route test | ✓ 200 | ✓ 200 | ✗ 403 | ✗ 403 |
| `report_sales` own outlet | direct RPC | ✓ | ✓ | ✗ 42501 | ✗ 42501 |
| `report_sales` other outlet | direct RPC | ✗ 42501 | ✗ 42501 | ✗ 42501 | ✗ 42501 |
| GST settings / issuance action | settings + invoice screen | ✓ | ✓ | ✗ | ✗ |
| `/api/ops/realtime-alert` | POST | ✓ roles set | ✓ | ✗ 403 | ✓ (kitchen role) |
| e-Invoice reconciliation panel | invoice history | ✓ | ✓ | invisible | invisible |

Kitchen-role hitting the alert endpoint with a bad payload → 400;
cross-origin → 403; sixth call in 10 min → silently dropped (204).

## 7. Two-tenant isolation

7.1 T-A and T-B fixtures, same run. From T-A: menu/order/invoice/report
    surfaces contain only T-A data (lists, direct IDs, share links).
7.2 T-A session calling T-B `report_sales` by restaurant id → 42501.
    T-A reading a T-B invoice by id → denied/empty per surface.
7.3 Shared-GSTIN trigger: two T-B outlets cannot register the same GSTIN
    with divergent PAN identity.
7.4 No cross-tenant rows in `/api/health` operational map; alert keys and
    log lines carry no tenant identifiers.

## 8. report_sales authorization (direct RPC, fixtures only)

8.1 Owner/manager over a 7-day window → `totals`/`buckets`/`orders`.
8.2 Cashier → 42501. Kitchen → 42501. Unauthenticated → 401 at the route.
8.3 `p_order_limit=100000` → success; ≤ 10,000 details returned; range-wide
    totals identical to a `p_order_limit=200` call.
8.4 Range > 400 days → 22023; `p_bucket='week'` → 22023;
    unknown timezone → UTC fallback; `p_include_lines=false` → `lines=[]`.

## 9. Monitoring and alert generation

9.1 With the staging app, trigger the kitchen degraded path (e.g. revoke a
    synthetic realtime channel name) → staging runtime logs show one
    `[autodine:alert] {"event":"incident_opened",…}` line, fixed vocabulary,
    no tenant data; repeat within 10 min → `incident_repeated`, count=2.
9.2 Restore the channel → `{"event":"incident_resolved",…}`.
9.3 `GET /api/health` → 200 with `operational` map; booleans only; a
    deliberately broken build (if the owner authorizes a throwaway staging
    deploy) emits exactly one `health_check_failed` critical line.
9.4 If an alert provider is wired by then (§6 of the action sheet): the
    degraded event pages/notifies the named recipient; record time-to-notify.
    If not wired: record "logs only, delivery unverified" — not a failure.
9.5 Rate limiter drops the 6th call (204) and logs nothing.

## Evidence pack (filed per run)

Scenario ID → PASS/FAIL, UTC timestamps, deploy/preview id under test,
redacted screenshots, raw RPC outputs minimized (no tokens/addresses).
One-page verdict: PASS / PASS WITH FINDINGS / FAIL, signed by runner + owner.

## Non-goals

No production traffic/data. No load numbers (that is the E2E+load workflow).
Not a penetration test. Not a substitute for the Production gates
(backup/restore rehearsal, drift disposition). Scenario 1.2 etc. assume the
enumeration-safe build already committed — defects found here are separate
reviewed changes.
