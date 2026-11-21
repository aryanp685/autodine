# GST two-mode billing — design, decisions and honest limits

**Date:** 2026-11-14 · **Branch:** arena/9b120325-autodine · **Status:** code complete and locally verified. **Not applied to any hosted database. Not deployed. Not legal advice; adviser review still required before charging real customers under GST.**

## What the owner approved (2026-11-14, quoted decisions)

1. Scope: **Full two-mode GST system** — Normal receipts / Composition Bill of Supply / Regular GST, with settings, database migration, immutable document snapshots and invoice issuance wired end to end. Code only; no production deployment.
2. Menu prices are **tax-inclusive**: the bill extracts tax at **document level** (₹105 @5% = ₹100 taxable + ₹5 tax). Issued documents are never recalculated.
3. e-Invoice: **fail closed as `irp_pending`**. No IRP provider is configured or approved; no IRP is ever called by this code.
4. Composition activation: **registration type check plus the owner's acknowledgment only** — no CMP-02 evidence reference required.

## The three modes

| Mode | Document | Tax | Who |
|---|---|---|---|
| `off` (default) | `receipt` — "Receipt · Not a GST tax invoice" | Whatever the legacy exclusive formula produced (`tax_rate_bps`, default 0) | Every restaurant today. **Zero behaviour change.** |
| `composition` | `bill_of_supply` — "Bill of Supply" + statutory notice | None, ever | Composition-registered GSTINs; registration type must be `composition` and the owner must tick the ineligibility acknowledgment (alcoholic liquor, tobacco, inter-State, e-commerce operator). No GSTIN = no document. |
| `regular` | `gst_tax_invoice` — "Tax invoice" | CGST+SGST (intra-State) | Two profiles only: **5%** other than specified premises, no ITC (Notification No. 11/2017-CT(Rate), Sl. 7(i), as amended) · **18%** specified premises only, ITC (Notification No. 05/2025-CT(Rate), w.e.f. 2025-04-01, requires the specified-premises attestation). |

There is no rate field. There is no per-item tax. There is no exemption switch. Place of supply for restaurant services is always the outlet's state, and the config enforces `state_code` == first two digits of the GSTIN and `pan` == characters 3–12 of the GSTIN.

## How money works

- Orders in `regular` mode: menu prices ARE the bill. `total = subtotal` (menu inclusive), `tax_paise` is the extracted tax, e.g. 2 × ₹105 @5% → subtotal 21000, tax 1000, total 21000. `orders_math_check` was made mode-aware so the printed bill always adds up; legacy/off/composition rows keep the old identity.
- Extraction: one rounding at document/order level (half away from zero), never per line. ₹10500, ₹11800, ₹21000 all extract exactly; odd paise split CGST (odd paisa lands in CGST) then SGST, summing exactly (`splitInHalf`).
- `set_order_line_quantities` reprices under the order's own `gst_mode_snapshot` — never under the currently-configured mode.
- A sitting containing tickets priced under a different mode than the current configuration **cannot be issued a document** (fail closed), so a mid-sitting mode switch can never produce a wrong bill.
- Composition tickets with any `tax_paise > 0` **cannot be issued a Bill of Supply** (fail closed).
- Issued documents (`restaurant_invoices`) are **immutable at the database level** — a new trigger refuses UPDATE of anything except the audited void transition (issued→voided, void_reason ≥ 5 chars) and refuses DELETE outright, for every role including superusers. Lines are fully immutable. `issue_closed_session_receipt` returns the existing document on retry.
- `orders.gst_mode_snapshot` / `orders.gst_config_version` record which pricing produced each ticket; GST documents cite `config_version`.

## Normal Billing (GST off) self-declaration

Choosing `off` in Settings is a recorded declaration, never a silent default:

- The owner must tick **"I confirm this restaurant is not issuing GST documents"** (not registered, or registered but issuing ordinary receipts). The declaration and its timestamp are stored on `restaurant_gst_config` (`off_declared`, `off_declared_at`).
- Ticking **"This restaurant IS required to be registered under GST"** refuses to save Normal Billing; the owner is pointed at Regular or Composition. This is the "block if declared GST obligation" arm of the product decision.
- A restaurant with no config row behaves exactly as before (ordinary receipts); the declaration exists once the owner explicitly saves the mode.

## Composition activation and alcohol

The Composition Scheme cannot be activated while the restaurant sells alcoholic items, and this is enforced **at the database** (trigger on `restaurant_gst_config` for the switch, and on `items` for flagging/inserting alcoholic items while Composition is live) — the app layer produces the readable refusal first. Ineligibility list is also acknowledged by the owner at activation (alcoholic liquor, tobacco, inter-State supplies, e-commerce TCS).

## Configuration audit trail

`restaurant_gst_config` (one live row per restaurant) + `restaurant_gst_config_history` (append-only, trigger-written, no grants to anyone; SELECT for staff via RLS). Saving bumps `config_version`. Old versions are never overwritten.

## e-Invoice / IRN (fail closed)

No IRP provider is configured or called. Applicability is decided **at issue time** from the recorded preceding-FY aggregate turnover (AATO > ₹5 crore, Notification No. 10/2023-CT, as amended) and the recipient's presence:

- B2C (no buyer GSTIN) → `irp_status = 'not_required'`, never e-invoice applicable.
- B2B → `'not_required'` only when AATO is known and ≤ ₹5 crore; when AATO is unknown **or** exceeds ₹5 crore, the document is issued as `'pending'`.

`InvoiceScreen` renders `pending` as "IRN pending — not a final tax invoice until the IRP validates this document"; there is **no code path that claims an IRN exists**. `lib/gst/applicability.ts` encodes the same threshold (5,000,000,000 paise) and fails closed on unknown AATO — keep the two in sync if the threshold or scope ever changes. The SQL predicate in `issue_closed_session_receipt` is the enforcement point.

**B2B recipient capture exists (2026-11-14, migration 20261114000100).** Regular-GST tax invoices may carry a buyer legal name, GSTIN (format + state-code agreement in SQL; checksum in the app), optional billing address and email. The buyer is snapshotted (`restaurant_invoices.recipient_*` + `customer_snapshot`) and shown on screen and on shared receipt links. Composition Bills of Supply and normal receipts refuse buyer details at the database (fail closed).

**IRP readiness, not integration.** `lib/gst/irp/` contains the provider-agnostic adapter interface (`IrpAdapter`), a deterministic versioned payload builder (`autodine.irp.v1`, canonical-JSON fingerprint), structural signed-QR validation (offline; signature verification requires the live provider's NIC public key), the `irp-state` document state machine, and an offline sandbox stub used by tests. **Receipt decision still fail-closed pending a provider decision — the sandbox cannot produce a legal IRN and is not an IRP.** The append-only `restaurant_irp_requests` audit table records every attempt (hashes and outcomes only, never payloads or credentials) through the owner/manager `record_restaurant_irp_request()` RPC.

## What was deliberately NOT built

- IGST for restaurant services (not applicable — POS is the outlet's state). The engine supports inter-state explicitly so it can never silently mis-split.
- Per-item rates, exempt/nil items, alcohol as a taxable line (alcohol is outside GST; the composition acknowledgment names it).
- IRP integration (IRP credentials, NIC API, QR/IRN on print). Provider selection is an open decision; the offline sandbox is a test fixture, not an IRP.
- HSN/SAC codes on lines (snapshot has `hsnOrSac`, unused).
- IRN-backed note cancellation workflow; full `e-Invoice` lifecycle for notes (the note *record* lifecycle is built — see below — but no IRN is ever claimed to exist). Full-void only via `void_restaurant_invoice` for invoices and `void_invoice_note` for notes.
- A server-side action that captures a manually obtained IRN (deliberately absent: wiring a live provider requires the owner's approval and a verified GSP contract).
- Effective-dating of the 5% Notification 11/2017-CT(Rate) (in force since 2017-07-01; no sunset applies) — nothing to gate.
- Discounts of any kind — still hard-disabled pending written financial policy approval.
- Any change to guest checkout pricing semantics for restaurants that are not in `regular` mode (default `off` = byte-identical behaviour, modulo new columns).

## Verification (all on disposable local PostgreSQL 17, synthetic data)

- Migrations replay cleanly on disposable local PostgreSQL 17 (`npm run test:db:embedded`): **175 tests, 7 files, all pass** — including `lib/db/gst-two-mode.integration.test.ts` (19 scenarios: the six above plus B2B capture with turnover above/below/unknown AATO, buyer-details-refused-on-wrong-modes, malformed/out-of-range buyer GSTIN, alcoholic lines blocking GST documents but not normal receipts, alcohol blocking Composition activation at the database with both orderings, shared-GSTIN cross-outlet identity consistency incl. one PAN straddling regular/Composition, the IRP attempt audit RPC's owner/manager-only append-only contract, buyer-snapshot exposure on shared receipt links, the IRP reconciliation read surface, and specified-premises effective dating).
- `lib/gst/gst.test.ts` — 27 unit tests (inclusive extraction statutory examples, GSTIN format+checksum+PAN cross-checks, e-invoice applicability edges, snapshot builder, POS determination). `lib/gst/irp/irp.test.ts` — 10 unit tests (deterministic payload fingerprinting, checksum rejection, offline sandbox IRN idempotency + cancel window, signed-QR structure validation, IRP state machine, applicability-vs-SQL parity). **Pass.**
- Full suite: **2,212 passed / 162 skipped** (skips are the pre-existing hosted-gated ones). Typecheck, lint (changed files), `sql:check`, and the CI-style guarded production build all pass.
- The SQL checker is DDL-parser-only; the embedded-PG replay is the execution evidence.

## Rollout gates (not done, in order)

1. Review this migration and the GST code with the GST adviser/CA. The statutory references are encoded as printed on the notifications cited; they are not interpretive advice.
2. Apply to staging (authorized), run the rehearsal: off→receipts unchanged; configure a restaurant; order; close; verify document type, numbering, snapshot immutability, void flow.
3. **Owner decision** on who configures GST and when; then apply to production via the hosted migration gates (never ad hoc), and only then does any restaurant switch a mode.
4. ~~B2B recipient capture~~ — built 2026-11-14 (issue-time, Regular GST only, `irp_status` decided at issue). Next: the owner decides the IRP/GSP provider; until then applicable B2B documents stay `irp_status='pending'` and must never be printed as final. Before any export: same.
5. Update the staging/production reconciliation record and the blocker report; this document is the GST evidence anchor.

## Known limits

- Restaurant table has no `gst_*` columns; the config is a separate table joined by ID — no drift in the hot order path beyond one `gst_pricing()` lookup (STABLE, single row).
- `restaurants.tax_rate_bps` is still honoured for `off` mode restaurants (legacy exclusive semantics) — unchanged.
- The receipt PDF/share text reads the same snapshot; SGST/CGST wording is indicative, please verify against your adviser before customer-facing print.
- FY numbering (`INV/26-27/000042`) is shared across document types per restaurant/FY — intentional: GST law sequences tax invoices per FY and splitting series by document type would create gaps in a mixed off/GST rollout. If the adviser wants separate series for receipts vs tax invoices, that is a small follow-up migration + RPC change.
- History rows are not yet exposed in the UI (audit only).
- Configuration changes apply to NEW orders and NEW documents only; in-flight tickets keep their mode.

## Legal sources recorded with dates (cited 2026-11-14, not legal advice)

Recorded for traceability only; none of the following is interpretive advice and each must be re-verified by the GST adviser/CA before relying on it for a live document:

| Source | Used for | Cited as read on |
|---|---|---|
| Notification No. 11/2017-Central Tax (Rate), Sl. No. 7(i), as amended — restaurant service, other than specified premises, 5% (2.5% CGST + 2.5% SGST), without ITC | Regular profile `other_than_specified_premises` | 2026-11-14 |
| Notification No. 05/2025-Central Tax (Rate), w.e.f. 2025-04-01 — restaurant service supplied at specified premises (hotel accommodation above the notified threshold in the preceding FY), 18% (9% + 9%), with ITC; declaration from the eligible hotel supplier required | Regular profile `specified_premises` (attestation-gated) | 2026-11-14 |
| Notification No. 10/2023-Central Tax, as amended — e-invoice mandatory for persons with aggregate turnover exceeding ₹5 crore in any preceding financial year (B2B / exports / notified categories); B2C excluded | `lib/gst/applicability.ts` + the issue-time SQL predicate (structurally identical) | 2026-11-14 |
| Notification No. 08/2017-Central Tax (Rate), Sl. No. 5 — restaurant service, Composition Scheme (1% of turnover... as amended; composition = Bill of Supply, no tax collection, no ITC) | Composition mode (registration_type must be `composition`; ineligibility acknowledgment) | 2026-11-14 |
| Rule 46, CGST Rules, 2017 — particulars tax invoice must contain (seller/buyer GSTIN, description, HSN/SAC, taxable value, rate, amount of tax) | Document snapshot design; HSN/SAC deliberately not enforced yet (see NOT built) | 2026-11-14 |
| Rule 48(4) / 48(5), CGST Rules — invoice reference number (IRN) and the signed QR code on e-invoice documents | `lib/gst/irp/` adapter contract, signed-QR structural validation | 2026-11-14 |
| Section 24(x) / Rule 24, CGST Rules — Composition Scheme persons; Form GST CMP-02 | Composition activation requires registration_type `composition` + owner acknowledgment (CMP-02 evidence NOT collected by the product) | 2026-11-14 |

Notes: the 05/2025-CT(Rate) specified-premises transaction practice (hotel accommodation supply + preceding-FY declaration) is recorded from the notification's text as read on 2026-11-14; the product enforces only the attestation the owner/AE can truthfully make. If the adviser's reading differs, the profile gate changes — the 5% default remains safe. **This document is not legal advice and no composition/specified-premises decision may be made from it.**

## Addendum — credit/debit notes (2026-11-14, later same day)

Built in `20261114000500_credit_debit_notes.sql` (forward-only, never applied to any hosted database):

- Immutable `restaurant_notes` (CN/DN series per outlet per FY, six digits, row-locked allocation like invoice series), `restaurant_note_events` (append-only issue/void ledger), one live note of each kind per source document (partial unique indexes as backstop + friendly `P0001` check).
- Notes exist only against `gst_tax_invoice` / `bill_of_supply` sources (never plain receipts), cover the **full** source document (line-level partial notes are deliberately excluded — no defensible GST re-derivation), and copy amounts from the parent's immutable snapshots; decomposition inconsistent with the parent total is refused (`P0001`).
- Amounts can never be edited in place; the only transition is the audited owner/manager `void_invoice_note` RPC (reason 5–500 chars). DELETE is refused by trigger; a sibling immutability trigger mirrors the invoice rules.
- `restaurant_irp_requests` gained nullable `note_id` with a exactly-one-of(invoice_id, note_id) check; `record_note_irp_request` is the owner/manager-only append path for note IRP attempts (append-only, per-note attempt sequencing).
- Staff actions `issueInvoiceNoteAction` / `voidInvoiceNoteAction` (`app/(staff)/dashboard/note-actions.ts`) enforce owner/manager before the RPC; kitchen/cashier are refused at the action layer and again at the database.
- IRP: `autodine.irp.v1` payloads for CRN/DBN must reference the immutable source (`originalInvoice`) and are refused without it; INV payloads carrying one are refused. CGST/SGST + IGST on one document fails closed (`values_mismatch`). Applicability (`lib/gst/applicability.ts`) already fails closed (AATO unknown ⇒ required) and covers note kinds.
- A B2B parent pending IRN forces its note to `pending`; nothing in this build claims an IRN exists, and live IRP remains blocked on the provider decision.
- Verified: full replay on disposable PostgreSQL — `lib/db/credit-debit-notes.integration.test.ts` (11 scenarios: issuance/mirroring, series allocation, one-live-note + unique-index backstop, receipt/voided-source refusal, composition Bill-of-Supply notes, role matrix incl. unauthenticated, audited terminal void, note IRP attempt sequencing, B2B-pending inheritance, RLS outlet isolation). `lib/gst/notes.test.ts` + note payload/applicability unit tests. Embedded suite: 197 tests / 8 files, all pass.
