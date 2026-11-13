# Phase 7 — pilot scope and decision record (Phase 1)

**Phase 1 status: SCOPE CONSTRAINTS RECORDED; live pilot not approved.** This record translates the explicit owner constraints supplied for the master execution into testable release boundaries. It does not invent a tax, financial, commercial, retention, legal, support, or capacity policy, and does not authorize a production release.

**Current release disposition:** `NO-GO` pending the gates in `PHASE-7-EXECUTION-BASELINE.md` and the remaining Phase 7 evidence.

## 1. Bounded product scope for a future QR-ordering pilot

| Area | Agreed boundary | Release/test treatment |
|---|---|---|
| Guest ordering | QR menu, cart, and order submission may be considered for a limited pilot only after current-release Staging acceptance and tenant-security gates pass. | Use synthetic identities/orders for tests. No Production/customer-data tests or fabricated acceptance. |
| Guest payment | **Online guest payment is off.** No gateway checkout, payment initiation, guest payment claim, or financial settlement test is part of this execution. | Counter/manual collection only. Any staff payment record must represent an actual owner-authorized offline collection, which is outside these synthetic tests. Do not perform a transaction, refund, subscription charge, or settlement in this task. |
| SaaS subscription | Paid SaaS self-checkout is unavailable and out of pilot scope. | No subscription purchase, charge, trial reset, or vendor payment activation. Existing account/trial rules remain unchanged. |
| Discounts | Disabled pending written policy. | Keep the existing fail-closed behavior. Do not introduce or test a discount by changing policy. |
| GST/tax | Locked pending written financial/tax policy. No rate, classification, inclusive/exclusive treatment, exemption, rounding, invoice or place-of-supply rule is inferred. | Do not alter rates or tax configuration. Do not represent non-GST receipts or existing screens as legal GST invoices or tax compliance. |
| AI / translation / TTS | Optional and nonblocking. No paid feature/vendor activation is authorized. | Core ordering/staff work must not require AI, translation, external TTS, or a provider key. Keep failure fallback graceful; voice/device audibility is a separate acceptance gate. |
| Printing | Browser/OS print dialog only. | No KOT printer integration, USB/Bluetooth/LAN control, print bridge, agent, or hardware purchase. Physical printer/receipt acceptance is not inferred from rendered HTML or a browser test. |
| Legal/privacy | Existing Terms/Privacy routes are not legal/privacy certification. | No compliance, legal, tax, or retention certification is claimed. Human legal/privacy review remains a release decision. |
| Identity/data | Synthetic users and synthetic data for tests. | No real customer or restaurant records, addresses, emails, orders, payments, or communications in test fixtures or logs. |

These are release boundaries, not a declaration that any hosted workflow has passed. Staff-facing roles and tenant isolation must be tested against an approved non-Production target with synthetic identities before a pilot can be considered.

## 2. Pilot-specific limits that remain unspecified

No named pilot venue, restaurant/account, owner/operator acceptance, go-live date/window, number of locations, staff roster, guest volume, support contact, service window, incident owner, target browser/device matrix, or numeric SLO/capacity limit has been supplied. No values are guessed here.

**Safe default:** do not admit live customer traffic or call the pilot approved until those details are supplied and every pilot-relevant security, recovery, Auth/domain, current-release Staging, operations, and Production gate is independently evidenced. Until then, execution is limited to repository work and isolated synthetic/local or explicitly gated Test/Preview work. No target project is selected for a hosted mutation in this document.

## 3. Signup/workspace lifecycle — owner decision remains open

### Observed source behavior (from the existing Phase 6D/source evidence; to be re-verified in the current-code phase)

For a genuinely new Auth identity, source provisions a profile and calls the workspace-creation path before email confirmation completes. That path creates an account/trial, linked restaurant, published starter menu, and owner membership; the restaurant is active and its global slug is reserved. The exact-slug public profile can expose a public projection before confirmation. Identity-less, rejected, or error paths are intended not to provision a workspace. This is repository/source evidence, not current hosted Auth or browser evidence.

### Choices and consequences — no choice is made here

| Option | Consequences to resolve |
|---|---|
| Keep immediate provisioning/activation | Preserves the existing flow, but an unconfirmed identity can start the trial, reserve a slug, and expose an active storefront. The owner must explicitly accept the visibility and retention consequences. |
| Provision only after email confirmation | Avoids trial/workspace activation before confirmation, but needs a durable pending intent, retry-safe/idempotent callback, and a decision about slug reservation and concurrent signup collisions. |
| Create a pending/hidden workspace before confirmation | Could reserve the slug without an active public storefront, but requires a new hidden/public-projection rule and a decision on when the trial starts. A hidden state must not accidentally disclose more data. |

Required owner decision: trial start; slug reservation and release; whether any public profile/menu is visible before confirmation; abandoned/unconfirmed workspace retention; confirmation retry/idempotency; and who may authorize recovery of a pending signup. **Until written decision and tests exist, preserve current behavior; do not add deletion, automated cleanup, trial reset, or slug cleanup.** This unresolved behavior remains a release blocker rather than a reason to invent policy.

## 4. Other product/operating decisions held open

- The recorded quantity behavior caps quantities above 99 at 99, while the stated contract may be read as a 1–99 bound. Owner/product decision is still required: cap or reject. Do not silently change either behavior.
- The staff role matrix for financial reads and permissible manual payment methods still needs owner/finance confirmation. Do not narrow or broaden grants based on an assumed business policy.
- Pilot operating hours, backup interval/RPO, recovery time/RTO, alert thresholds, response/acknowledgement target, support path, and capacity ceiling have not been approved. These must be explicit inputs to the recovery/operations gates; they are not derived from historical sample measurements.
- Current hosted clock differs from the authoritative task date. No time-sensitive trial, expiry, retention, or rate-window conclusion is accepted until the discrepancy is resolved.
- Domain ownership, Auth redirect origins, sender identity, email provider, abuse/CAPTCHA policy, and user-facing legal copy are not approved by this scope record. Do not create a vendor account, purchase a domain/service, accept paid terms, or send mail.

## 5. Required acceptance boundary before any limited pilot

1. Identify the owner-approved pilot tenant/location and exact bounded window/participants; record the numeric operating/capacity/response limits without guessing.
2. Confirm Test/Preview is isolated and identify the specific approved Staging target; do not treat `autodinetest` as Staging solely by name.
3. Close the account-link and current/default ACL security findings; independently review the migration/RPC plan and verify actual PostgREST authorization using synthetic identities.
4. Obtain current recovery/PITR evidence and approve RPO/RTO; prove an isolated restore with a named owner/target before any Production schema change.
5. Pass Auth/domain and current-commit Staging workflows with two synthetic tenants and the applicable owner/manager/kitchen/cashier role matrix, including guest QR order through kitchen and counter-only handling. No real money or Production fixtures.
6. Prove monitoring, operational ownership, bounded capacity and rollback/reconciliation procedures. Optional AI/translation/TTS and physical devices cannot block the core counter-only flow and are not accepted without their separate tests.
7. Meet the separate Production gate and obtain named release sign-off before public/customer traffic or any Production mutation.

## 6. Decision record

- **Accepted for this execution:** the explicit boundaries in §1 and the prohibition on inventing policy.
- **Not decided:** venue, tenant, dates, user/volume bounds, numeric SLOs/capacity, signup lifecycle, quantity >99 contract, staff financial role/method matrix, tax/GST, discounts, legal/privacy, Auth/email/vendor settings, and data retention.
- **Default while undecided:** preserve existing behavior where safe, do not enable paid/financial/legal features, do not delete/reset/reassign user data, and do not launch live traffic.
- **Phase 1 outcome:** constraints are recorded; the limited pilot is **not yet approved**. Independent local/repository work may continue; hosted writes remain gated.
