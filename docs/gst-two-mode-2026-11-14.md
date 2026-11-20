# GST two-mode billing — implementation and operating limits

> Current: [Workstream B local closure and tests](../qa-evidence/day1/GST_WORKSTREAM_B_FINAL_CLOSURE.md). The [Priority 2 IRP sidecar](gst-irp-production-readiness-2026-11-14.md#priority-2-operator-guide--e-invoice--irp-register) is local simulation only. All 26 GST/IRP migrations are **NOT AUTHORIZED** for hosted use; no outlet activation, live IRP or release is approved. Priority 1 below is the historical product baseline where it differs.

## Using the supported flows on an isolated local stack

- **Settings → GST billing:** the selected outlet Owner can record a deferral
  without switching mode or reserving numbers. Manager can read only. For a
  hotel, review the **supply FY** as well as prior FY actual room supplies.
  5% needs a qualifying negative room review and no declaration in force
  (or valid IX opt-out); IX cannot negate a qualifying room value. 18%
  needs the actual >₹7,500 basis or a valid declaration. The treatment
  start and the date AutoDine activates are separate; no backdated bills.
  Regular and Composition both require the **reviewed service SAC**. No
  automatic SAC, no IRP fields on Composition and no default tax profile.
- **Dashboard or Counter → New takeaway or delivery**: entitled counter staff record a
  published, classified menu selection for pickup or direct local delivery.
  No guest bypass, marketplace, interstate supply, optional discounts or
  separate transport. The guest flow still requires its verified table QR.
  Regular delivery requires current PAN evidence clearing mandatory IRN,
  both before making the ticket and before taking payment. If this or a
  different gate fails, stop and review; do not relabel fulfilment or buyer.
- **Active billing sessions → settle and close**: the prep board has a route
  label only, while the authorized counter sees the destination. Review the
  buyer/POS and issue from the saved sitting. Identified consumer delivery
  uses the complete staff print/PDF copy only, not a receipt link or text.
  Record unregistered recipient particulars at ₹50,000 taxable or more, or
  below on request. If a registered buyer requests a Composition Bill of
  Supply with Rule 49 particulars, stop and use a separately reviewed path;
  do not omit the GSTIN to complete checkout. The paper invoice/BOS has a
  supplier signature line; text is unsigned. Missing historical SAC stays
  missing and labelled. A supplemental payment acknowledgement only shows
  FSSAI if its saved seller snapshot has it; it does not alter the invoice.
  Held and recorded-cancelled docs have no final print/share. Owner can issue
  linked full adjustments only for eligible tax-invoice originals with saved
  recipient/reference/rate; anonymous, held and BOS sources refuse. The
  private note page hides incomplete historical evidence in print media.
  Notes are neither refunds nor GST returns.
- **Reports → GST reconciliation**: use selected outlet or the Owner/Manager
  outlet memberships in that account. Switch to an authorized sibling before
  opening one of its documents. Lifecycle and profile filter documents, not
  collections; recorded payments remain on their original recording date.

## 2026-11-19 — CA-approved product specification (local only)

**Complete for local Workstream B Priority 1, not approved for hosted use.**
Use this section for the reviewed product spec. The dated checkpoints and
original design below are historical where they differ. No enrolment or
external validation has been performed. Staging, Production and release are
**NO-GO**; all 14 GST/IRP Phase B files remain **NOT AUTHORIZED**.

| Select in Settings → GST billing | Review before saving | Saved pricing and issued document |
|---|---|---|
| **GST · Standalone** | Regular registration, legal name and registered address, valid 15-character GSTIN, 14-digit FSSAI, business type, adviser-confirmed six-digit service SAC. | **5% without ITC** for restaurant service, including dine-in, takeaway and delivery. Inclusive menu gross. **TAX INVOICE**, `INV` series, with FSSAI, SAC, place of supply and applicable breakup. No separate 18% switch. |
| **GST · Hotel restaurant** | Same identity checks. Confirm whether this outlet is at Specified Premises. Select 18% only with a signed record of **actual** room supply in the preceding FY exceeding **₹7,500 per unit per day**, **or** a valid opt-in filed within the applicable period. Record the signed reference, applicable FY, effective date and acknowledgment. | **18% with ITC** only on a qualifying basis. Otherwise **5% without ITC**. Same **TAX INVOICE** and `INV` series. |
| **No-GST · Unregistered business** | Outlet business name, address and phone already saved in Settings; valid 14-digit FSSAI and explicit declaration of no registration or obligation. No GSTIN. | Menu price only, zero tax. **RETAIL BILL / CASH MEMO**, `RBL` series. Name/address/phone/FSSAI, no GSTIN or tax rows. |
| **No-GST · Composition dealer** | Composition registration, validated GSTIN/FSSAI, reviewed six-digit service SAC, legal name and registered address, and the existing Composition acknowledgment. Do not classify a business in this subtype to avoid a real GST liability. | No GST collected, no ITC or tax breakup. **BILL OF SUPPLY**, `BOS` series, with GSTIN, FSSAI and “Composition taxable person, not eligible to collect tax on supplies”. |

1. **Confirm the business and the outlet.** A signed-in **Owner member of
   the selected outlet**, with write access, submits the versioned Settings
   form. A Manager reads their own outlet's config/history but cannot save.
   A change to name, address or phone for unregistered issuance requires a
   new reviewed save after resolving active tickets, not a change to past
   documents. The GSTIN check validates format, checksum, state and embedded
   PAN; FSSAI validates exactly 14 digits. Neither verifies a government
   registration/licence or authenticates qualification evidence. Do not mail
   credentials or paste supporting private documents into Settings.
2. **Confirm hotel evidence, not a tariff.** Exactly ₹7,500 does **not**
   qualify via actual room supply. On the opt-in route, enter the filed date
   and the start/end of the filing period as confirmed by the adviser for
   this outlet and treatment FY; AutoDine does not calculate a filing
   deadline. A reviewed effective date is within the applicable current India
   FY, on/after 1 April 2025 and not in the future. Reconfirm 18% at the FY
   change. If proof has lapsed, new orders fail closed (no auto-5% or auto-18%).
   Already-priced qualifying tickets use their supply date when issuing.
   These rates govern the supported restaurant-service pricing, not a new
   delivery or takeaway workflow or a new place-of-supply rule.
3. **Check sittings before any change.** An open noncancelled ticket or a
   closed-but-unissued noncancelled sitting blocks saving. A deferred legacy
   ordinary outlet keeps the old plain receipt and saved charges until
   explicitly reviewed; that is not a third onboarding choice. A legacy
   registered outlet missing FSSAI/business/SAC/evidence does not admit new
   GST or Composition orders. Do not backfill or relabel tickets. Finish or
   obtain owner/adviser disposition for incompatible existing GST sittings
   **before** authorized cutover; if they cannot safely issue, reconcile
   without reopening, changing money or re-collecting. Pre-classification
   rollback snapshots still refuse restoration rather than guess item status.
4. **Close only after each ticket is settled.** Registered and reviewed
   retail documents also enforce this in direct issue. GST amounts are
   extracted once from recorded gross (CGST + SGST for the outlet state; the
   odd paisa goes to CGST). The document rounding delta never changes the
   ledger receipt or money due. Menu/item/portion/add-on prices, refunds and
   payment paths are unchanged. No discounts, other tax rates, payment
   gateway, GST returns or new tax services are enabled.
5. **Use the issued document, not a ticket summary.** `/invoice/[id]` and
   approved secure links use the same snapshot and print template (A4,
   58 mm, 80 mm; browser Save as PDF). Numbering by outlet, financial year
   (1 April in India) and series uses `INV/26-27/000001`, `BOS/26-27/000001`,
   `RBL/26-27/000001` shapes, only uppercase letters/digits/slashes/hyphens,
   max 16 characters. The existing INV counter continues for that outlet/FY;
   a mode switch cannot renumber documents or reuse an allocation. Verify
   an appropriate non-overlapping allocation before activating a GSTIN shared
   by outlets; these fixed series do not coordinate between outlets or
   external invoicing systems. Published documents remain immutable; audited
   voids retain the number and a permitted replacement uses the next one and
   links back. A held or voided document cannot be shared; an audit copy of a
   void is clearly marked. Existing IRN holds and buyer gates are unchanged.
6. **Reconcile from saved documents.** Reports → **Billing documents** and
   its CSV (Owner/Manager, existing `type=gst` link) group by document type,
   FY, series, rate, status and hold. RBL is separate and has no tax amounts;
   old registered INV buckets are labelled legacy without rewriting anything.
   Legacy plain receipts remain in ticket reports and invoice history.
   Notes are separate, are not refunds, and do not change collections.

Use the [closure report](../qa-evidence/day1/GST_P1_CLOSURE_2026-11-18.md)
for reproducible local checks and [owner-action register](../qa-evidence/day1/GST_OWNER_ACTION_REGISTER_2026-11-18.md)
for per-outlet approvals, safe cutover, authorized target designation and
fresh preflight requirements. Do not infer eligibility for any outlet from
the CA decision approving the product. No hosted gate has changed.

---

## 2026-11-18 — Workstream B Priority 1 local checkpoint

*Historical; the 2026-11-19 specification above supersedes differences.*

**Branch:** `arena/ce32f7c8-autodine`, checkout HEAD
`3e17c44577a5236dca7dea5b4d35a16c0ffc1186` (merged PR #191).
**Status:** implemented and locally verified; not DONE. **GST/IRP
Phase B is NOT AUTHORIZED. Release and Staging remain NO-GO.** No hosted
query, migration, activation, deployment, provider call, or real payment
was made. The dated design notes below are historical where they differ.
This is not tax advice or evidence that an outlet is registered or eligible.

| Selection | What is saved and issued |
|---|---|
| Normal Billing (`off`, not a GST mode) | No configuration row still means ordinary receipts with the legacy exclusive rate (default zero). An explicit save requires the owner's declaration and refuses a declared registration obligation. Ordinary receipts are not GST documents. |
| Composition Scheme | Matching registration, valid GSTIN identity, and the owner's eligibility acknowledgment (alcohol, tobacco, interstate, e-commerce); no CMP-02 reference. Bill of Supply uses the saved supply value and prints the statutory notice. No GST or ITC. |
| Regular GST | Exactly 5% other than specified premises/no ITC, or 18% specified premises with attestation and effective date. No earlier than 1 April 2025 and not future-dated in India. GSTIN format/checksum/state and embedded PAN are validated, not checked against a registry. Prices are inclusive; place of supply is the outlet state. |

### Set up and operate (authorized test tenant only)

- **Settings → GST billing:** outlet owner with write entitlement only. A
  manager can read the configuration/history, not save it. This matches the
  narrower staging acceptance plan and legacy owner-only tax guard; confirm
  this authority with the owner before rollout (the old GST editor allowed
  managers). PostgreSQL checks authorization and version and records the
  acknowledgment, actor and time. The form must match the selected outlet
  and version; reload after an outlet switch or a save in another tab. Close
  sittings with active tickets before any save. Shared GSTIN identity
  and registration type under one PAN are checked within a commercial
  account; cross-account legal consistency remains an owner/adviser check.
- **Catalog:** classify alcoholic items explicitly in the editor, import
  review or a homogeneous bulk batch. Names and AI output never determine
  alcohol or tax. Composition refuses alcohol even in drafts/unavailable
  items and refuses activation while any classified item remains. Regular GST
  cannot order such lines either; no alternative tax is invented. Normal
  receipts retain existing ordering. Publishing/undo do not remove the
  classification; the publish rollback uses the same database gate. Review
  any old catalog without reliable classification; do not guess or backfill.
- **Cart/checkout:** guest quote returns only treatment and basis points for
  the active slug. GST quotes show paise; the browser sends item, portion,
  add-on and quantity IDs, not prices or a client tax rate. PostgreSQL prices
  at admission and saves ticket mode/version/rate and line classification.
  Counter payments only. No gateway, exemptions, per-item rates, IGST,
  discounts, or submission caps were introduced.
- **Counter → record payment → Close & invoice:** each active ticket must be
  settled, even when another has excess payment. The issued document uses
  the saved ticket lines, gross and configuration; it refuses drift,
  unclassified historical GST lines or out-of-period 18% supplies. Close and
  issuance roll back together on refusal; already-recorded payments stay
  recorded. Do not recollect, reprice or decrement a series to fix a refused
  sitting. The pre-existing direct-issue exception for already-closed normal
  receipts is not a GST settlement path.
- **Rounding:** one inclusive extraction over the whole document, not the
  sum of rounded ticket taxes. Two ₹105.10 tickets have ₹5.00 tax apiece;
  ₹210.20 gross issues with ₹10.01 tax (₹5.01 CGST + ₹5.00 SGST). Two ₹105.11
  tickets instead have ₹5.01 apiece; ₹210.22 issues with the same ₹10.01 tax.
  The document saves the signed +1/−1 paise delta without changing collected
  gross. The odd paisa goes to CGST. Old documents/lines are not rewritten.
- **Output:** `/bill/[id]` is a staff ticket summary, not the issued GST
  document; print or share from `/invoice/[id]` only when permitted. Only
  Regular GST accepts B2B recipient details. B2C and B2B with recorded AATO
  ≤ ₹5 crore are `not_required`; above ₹5 crore or unknown AATO is an IRN
  hold. There is no validated IRN path. Held records are nonfinal, including
  in print media, and cannot be shared by a new **or previously minted** link.
  A voided record can be printed for audit with its void marking, but its
  share link is unavailable. Do not supply a held or voided tax invoice.
- **Corrections:** Owner/Manager full-document credit/debit notes use
  immutable saved amounts and a separate series. No partial notes, tax
  recomputation or refund. Note issuance controls are hidden for held
  sources; any existing pending note is not a final GST document. An active
  note prevents voiding its source. Audited void/reissue retains the old
  record and consumes a fresh number; no invoice-void UI was added.
- **Reports → GST documents / GST CSV:** Owner/Manager only. Separate from
  ticket sales and payment collections. Uses saved snapshots grouped by kind,
  rate, current status, and IRN hold for the selected issue-date range. Credit
  and debit notes are separate buckets, not netted automatically. A blank
  rounding value from old snapshots differs from zero. No buyer identity or
  GST return is exported. A missing report RPC is shown as unavailable.

### Release and evidence boundary

The four new forward migrations (`20261118000200`–`20261118000500`) bring
repository inventory to **102**. See the [manifest](migration-manifest-2026-11-14.md)
and the [staging plan's current preflight](gst-staging-application-plan-2026-11-15.md).
The 98-file PR #191 history and protected staging baseline were not edited.
The app expects the full reviewed database contract; do not deploy these
routes ahead of it or replay an older bundle into an unknown catalog.

The populated local upgrade preserved old documents, numbers, payments,
config/history and link records. An older final invoice kept its saved tax
instead of acquiring the new rounding; its link still opened. An old held
link became unavailable without delivering a payload. The local test also
confirmed two cutover limits:

- **Existing GST sittings:** pre-upgrade lines do not gain a classification.
  Resolve open and closed-but-unissued GST sittings before replacing the
  billing implementation. The new issue path refuses unknown history; it
  does not reprice, settle a second time, consume a number, or undo payment.
  Preserve the ledger and escalate unresolved cases to the owner/adviser.
- **Catalog rollback:** a menu snapshot from before `items.is_alcoholic`
  cannot be restored as a classified menu. A real old snapshot failed
  atomically (no menu/brand/history changes). Keep the original snapshot;
  if a rollback is needed, have staff build and review a newly classified
  replacement draft. Never insert `false` for missing classifications or
  infer them from dish names. Snapshots with recorded flags are still subject
  to the Composition gate and existing finalized-source protections.

Read the [closure evidence](../qa-evidence/day1/GST_P1_CLOSURE_2026-11-18.md)
and [live blocker register](../RELEASE-BLOCKER-REPORT.md) for exact counts and
commands. Disposable PostgreSQL tests exercise real roles/RLS and SQL. The
Chromium tests run current Next.js pages, Settings POSTs and CSV handling
against loopback synthetic responses; they do **not** use GoTrue Auth or
PostgREST, persist a config save, or verify the full guest-to-receipt flow.
Hosted grants, Auth, schema cache, drift, acceptance, and recovery are not
verified by either harness.

### Owner and adviser decision record

Keep a dated written record **for each legal tenant/registration and each
outlet** before activation. Do not put credentials or real customer data in
the repo or in test fixtures.

1. **Authority and rollout:** confirm that only an entitled outlet Owner
   saves GST settings; a Manager reads the outlet's config/history but
   cannot edit. Specify which outlets (if any) activate and which defer.
2. **Registration and treatment:** match seller legal/trade name, registered
   address, GSTIN/PAN and state to the registration and document approved
   outlet-state place of supply and shared-registration consistency. Record
   Normal Billing only if the non-GST declaration is appropriate;
   Composition only with matching registration and adviser-confirmed
   eligibility/acknowledgment; or Regular with the exact 5% no-ITC or 18%
   specified-premises profile. Record inclusive pricing and the effective
   date; for 18% retain the eligible premises declaration and attestation.
   Format/checksum validation is not registration or eligibility verification.
3. **Catalog, B2B and corrections:** sign off liquor classification of
   live/draft/imported items and the approved treatment of uncovered cases.
   Record preceding-FY AATO and evidence (or explicitly unknown), buyer
   details and the operator escalation for IRN-held documents. Approve the
   full-document note/void correction procedure, not a refund or a new tax
   rule. Direct authorized note records against held sources remain held and
   nonfinal; the normal UI does not offer issue controls for those sources.
4. **Hosted verification is separate:** name the isolated non-production
   target and authorize a fresh read-only preflight first. Once ledgers,
   data compatibility and restore evidence are reviewed, separately approve
   the exact migration filenames/checksums and synthetic acceptance steps.
   Follow the [staging plan](gst-staging-application-plan-2026-11-15.md);
   no existing connection or local pass grants approval to deploy or apply.

---

## Historical design (2026-11-14)

## What the owner approved (2026-11-14, quoted decisions)

1. Scope: **Full two-mode GST system** — Normal receipts / Composition Bill of Supply / Regular GST, with settings, database migration, immutable document snapshots and invoice issuance wired end to end. Code only; no production deployment.
2. Menu prices are **tax-inclusive**: the bill extracts tax at **document level** (₹105 @5% = ₹100 taxable + ₹5 tax). Issued documents are never recalculated.
3. e-Invoice: **fail closed as `irp_pending`**. No IRP provider is configured or approved; no IRP is ever called by this code.
4. Composition activation: **registration type check plus the owner's acknowledgment only** — no CMP-02 evidence reference required.

## Two GST modes and Normal Billing

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

**B2B recipient capture exists (2026-11-14, migration 20261114000101).** Regular-GST tax invoices may carry a buyer legal name, GSTIN (format + state-code agreement in SQL; checksum in the app), optional billing address and email. The buyer is snapshotted (`restaurant_invoices.recipient_*` + `customer_snapshot`) and shown on screen and on shared receipt links. Composition Bills of Supply and normal receipts refuse buyer details at the database (fail closed).

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
