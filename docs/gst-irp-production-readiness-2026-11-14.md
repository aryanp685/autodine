# GST / IRP production readiness & risk analysis — 2026-11-14

**Status: ANALYSIS ONLY. NOT APPLIED. NOT AUTHORIZED.
NOT a go-live approval.** Nothing in this document has been executed against
production (`bdbaqpevwmgdvghszjno`) or staging (`juwyhslzchjevqkdvwjm`). The 7
GST/IRP migrations remain unapplied everywhere except the disposable local
PostgreSQL 17 used by the test harness. No IRP/NIC endpoint has ever been
called; no GSP is selected; no credentials exist.

Companion documents: `docs/gst-staging-application-plan-2026-11-15.md`
(staging application plan, PREPARED ONLY), `docs/production-release-baseline-2026-11-14.md`
(release ordering), `PRODUCTION-READINESS.md`.

## 1. Scope inventory — the 7 files, in dependency order

| # | File | Creates / replaces | Data-affecting? |
|---|---|---|---|
| B1 | `20261113000100_gst_two_mode.sql` | `restaurant_gst_config(+_history)` tables, RLS, `restaurant_gst_config_validate`/`_version`/`_history_track` triggers, `gst_pricing(uuid)`, `orders.gst_mode_snapshot` + `gst_config_version` columns, **replaces `orders_math_check`** with a mode-aware version, rewrites the order-pricing core to the GST identity (regular: `total = subtotal − discount`, tax extracted inclusive; legacy/off/composition: `total = subtotal − discount + tax`), extends `restaurant_invoices` (`gst_snapshot jsonb`, `irn text`, `irp_status text not null default 'not_required'`), replaces `restaurant_invoices_document_type_check`, invoice series allocation, note bridging hooks | Yes — new columns (nullable / defaulted), constraint replacement on a hot table, function replacement |
| B2 | `20261114000100_gst_b2b_einvoice_readiness.sql` | `restaurant_irp_requests` (append-only audit), `items.is_alcoholic` (default `false`), `restaurant_invoices` B2B recipient columns + format/state/email/name constraints, rewrites `close_order_session_and_issue_receipt` / `issue_closed_session_receipt` to carry buyer details into the GST snapshot | Yes — constraints with `check (… is null or …)`-style shapes, nullable additions |
| B3 | `20261114000200_irp_reconciliation.sql` | `list_restaurant_irp_reconciliation()` (read-only reconciliation read) | No |
| B4 | `20261114000300_gst_mode_gates.sql` | `restaurant_gst_config.off_declared` / `off_declared_at`; composition-mode gate triggers (`reject_alcohol_straddle_composition`, `items_no_alcohol_under_composition`) | Yes — new NOT-NULL column with default (table is empty pre-apply) |
| B5 | `20261114000400_restrict_trigger_functions_execute.sql` | `revoke all` EXECUTE on 13 SECURITY DEFINER **trigger** functions from all runtime roles | No (privilege boundary only; no data/policy/function-body change; verified idempotent) |
| B6 | `20261114000500_credit_debit_notes.sql` | `restaurant_notes` / `restaurant_note_events` (append-only) / `restaurant_note_series`, partial unique indexes (one live credit/debit note per source document), `restaurant_irp_requests.note_id` (+ `invoice_id` nullable, `one_document` CHECK, note-attempt uniqueness), `issue_invoice_note(uuid,text,text,text)`, `void_invoice_note(uuid,text)`, `record_note_irp_request(…)` | Yes — new tables, an `ALTER … drop not null` + constraint replacement on `restaurant_irp_requests` |
| B7 | `20261114000600_einvoice_issuance_profile.sql` | `restaurant_gst_config` issuance-profile columns (`einvoice_location`, `einvoice_pincode`, `einvoice_hsn_sac` + format checks), `restaurant_gst_config_history` mirror, re-revokes `restaurant_gst_config_history_track()` EXECUTE (defence-in-depth after column additions) | Yes — format CHECKs on future rows only |

All seven replay cleanly in order on disposable PostgreSQL 17 (verified via
`npm run test:db:integration`, which applies all 90 files to a fresh cluster,
plus the GST suites — see §6).

## 2. Dependency & ordering analysis

- B1–B7 sit **after** the whole pre-GST chain: `report_sales` authorization,
  `payment_audit_*`, `staff_invites` fix, subscription billing. Applying B1
  without `20261110001000`/`20261112000700` leaves `expire_subscriptions` and
  the account model undefined — B1 does not reference them, but the release
  ships as one train; see `docs/production-release-baseline-2026-11-14.md` §5.
- B6 depends on B1's `restaurant_invoices_document_type_check` (GST document
  types) and on B2's `restaurant_irp_requests` table. **B6 cannot precede B2.**
- B7 depends on B1's config table/history trigger; B4 adds columns to the same
  table — order B4 → B7 required (or B7 after B4; either way B3 may float).
- B5 is independent but belongs after B4 (it revokes EXECUTE on
  `reject_alcohol_straddle_composition()`, created by B1 — actually by the
  composition gates inside B1/B4; confirmed present in the replay) and after
  B1's GST trigger functions exist. Do not move B5 earlier.
- The pre-GST `20261110000800_remove_order_submission_caps` **deletes**
  `rate_limit_hits` rows — it is Phase A, not GST, but the same "snapshot first"
  discipline applies.

## 3. Destructive / data-affecting operations (full list, no omissions)

| File | Operation | Blast radius |
|---|---|---|
| B1 | `alter table orders drop constraint if exists orders_math_check` → re-add, mode-aware | Every subsequent order write is checked by the new predicate. Existing rows are **not** rewritten, but any row violating the new expression fails the next UPDATE. Requires the preflight row audit (§5). |
| B1 | `alter table restaurant_invoices drop constraint if exists restaurant_invoices_document_type_check` → re-add | Invoice writes validated against new document types. |
| B1 | `alter table restaurant_invoices add column gst_snapshot jsonb / irn text / irp_status ... not null default 'not_required'` | Adds a NOT-NULL default column — in-place, but takes an ACCESS EXCLUSIVE lock briefly. On a large invoice table this blocks writes for the rewrite duration (PG 11+ usually avoids the rewrite; verify on target size). |
| B2/B6 | `alter table restaurant_irp_requests … drop not null`, `drop constraint if exists …` | Narrow; audit table is empty pre-enablement. |
| B6 | New partial unique indexes on `restaurant_notes` | Creation on an empty table is trivial. |
| B4 | `alter table restaurant_gst_config add column off_declared boolean not null default false` + similar timestamps | Empty table → metadata-only. |
| B5 | 13× `revoke ... from public, anon, authenticated, service_role` | Privilege removal only; trigger firing unaffected (functions remain owned by the migration role). |
| B7 | Format CHECKs on `restaurant_gst_config` | Future rows only. |

**No file drops a column, drops a table, truncates, or deletes pre-existing
data.** `truncate tt_order_lines` / `truncate tt_line_addons` strings inside
B1 are `pg_temp` bookkeeping tables inside the pricing function, not tenant
data. B1's rewritten pricing core executes inside `place_public_order_core`;
a bug there breaks ordering for every restaurant, which is why local replay +
the 198-assertion PG suites gate this.

## 4. Idempotency & rollback limits

- All files are re-runnable **only where** they guard with `if not exists` /
  `create or replace` / `drop … if exists`. Re-running by hand outside the
  one-transaction `create_migration` path is still forbidden: a half-applied
  file leaves the catalog between two states with no ledger row.
- `20261110000900` (Phase A, not GST) is **not** re-runnable blindly: it
  archives a non-canonical `qr_verification_attempts` into a timestamp-suffixed
  legacy table. B-files did not inherit that footgun, but the discipline is the
  same: apply once, verify markers, never replay "to be safe".
- **Nothing in B1–B7 is rollback-able by reverse SQL once tenants write under
  the new rules.** `gst_mode_snapshot` is stamped per order; invoices carry
  `gst_snapshot`/`irn`; `restaurant_notes` rows become immutable; series
  sequences allocate. Reverse means restoring the pre-apply snapshot, not
  dropping objects.
- Append-only artifacts (`restaurant_irp_requests`, `restaurant_note_events`,
  invoice series) are never reusable after a rollback — invoice numbers and IRN
  attempt audit are permanent. Reversed schema must ship with forward-fix
  migrations instead.
- **Rollback in practice = PITR (or provider backup) restore.** Until the
  owner confirms a hosted backup destination and PITR, B1 in particular must be
  treated as irreversible in planning. See
  `docs/pitr-verification-procedure-2026-11-14.md`.

## 5. Preflight & blast-radius requirements (before any hosted apply)

1. Baseline row counts for `orders`, `order_items`, `payments`,
   `restaurant_invoices`, `order_sessions`, `restaurant_invites` — plus a
   **row-level audit** that existing `orders` satisfy the *new*
   `orders_math_check` (the
   two expressions agree for `tax_paise = 0` and for legacy rows only if the
   data was produced by the released pricing logic; hand-edited rows are the
   known exception). Any violating row must be quarantined by a reviewed
   one-off, not discovered by the constraint failing mid-`ALTER`.
2. `restaurant_invoices_document_type_check`: audit existing `document_type`
   values against the new enumeration before B1 re-adds the constraint.
3. Confirm `restaurant_invoices` is small enough for a `NOT NULL DEFAULT`
   column add without a long write block (or schedule in a maintenance window).
4. Capture: ledger dump, manifest dump, `md5(prosrc)` of every replaced
   function, `to_regclass`/`to_regprocedure` for every new object, ACL of
   every replaced function.
5. Zero-tenant expectation: `restaurant_gst_config` must contain **0** rows
   after apply for pre-existing tenants (GST is opt-in; default `off`).
6. Announce a maintenance window; `orders_math_check` replacement takes a
   brief ACCESS EXCLUSIVE lock.
7. Verify `/api/health` before and after; verify `place_public_order` path
   end-to-end on a synthetic fixture before declaring the window closed.

## 6. Local verification evidence (disposable PostgreSQL 17, this machine)

| Check | Result |
|---|---|
| Full chain replay, 90 migrations onto a fresh cluster | PASS (`npm run test:db:integration`) |
| PG-gated suites (8 files, incl. `gst-two-mode.integration.test.ts` 20 assertions, `credit-debit-notes.integration.test.ts` 11 assertions, `report-sales.integration.test.ts` 26, `subscription-billing.integration.test.ts` 41, `phase0-security.integration.test.ts` 25) | **198 passed, 0 failed** |
| Unit suites touching GST (`lib/gst/*.test.ts`) | included in `npm test` (2334 passed / 198 skipped) |
| Embedded cold physical recovery after replay (`test:recovery:cold`) | PASS (`LOCAL_COLD_RECOVERY_VERIFIED … migrations:90, tables:51`) |
| Logical backup → restore after replay (`test:db:logical-restore`) | PASS (47 tables / 58 policies / 160 functions byte-identical fingerprint) |
| Embedded SQL contract check (`npm run sql:check`) | DDL parses; functions/policies/triggers explicitly reported UNVERIFIED by the checker (embedded PG replay is the real proof, and it passes) |
| Synthetic GST lifecycle (regular mode extraction identity, composition gating, alcohol/composition rejection, mode snapshot freeze at order time, note issuance/void uniqueness) | Covered by the PG suites above; **no hosted execution performed** |

What local evidence does **not** prove: production catalog compatibility, the
`orders_math_check` predicate against **real tenant rows**, hosted ACL state
(§4 D2 in the release-baseline doc), or any IRP round trip.

## 7. Live-IRP/NIC vs fail-closed scope (what "done" can mean today)

- **Implemented and fail-closed:** B2's audit table records IRP attempts; the UI
  surfaces an "IRN not required / manual" status; B3's reconciliation read
  exists; B6's note IRP requests are owner/manager-only, audit-first, and
  payload-hash-only (no raw GSTIN payloads logged).
- **Fail-closed guarantees that must remain until authorization:**
  - no function performs an outbound HTTP call to any GSP/IRP endpoint;
  - `issue_closed_session_receipt` leaves `irp_status = 'not_required'` unless
    an issuance profile is configured;
  - staging/production must not call GSTN production or sandbox endpoints;
  - `EinvoiceAttemptButton` actions only ever record an audit "attempt" — they
    cannot obtain an IRN by themselves (no provider adapter exists).
- **Out of scope entirely until owner + adviser sign-off:** credential handling
  (GSP/NIC ASPP/API), certificate/key custody, IRN verification against GSTN
  sandbox, QR/IRN print on tax invoices, automatic retry/reconciliation, NIC
  fiscal-year-end changeover, e-way bills. Activating any of these is a new
  workstream with real money and legal exposure; none of it is started.

## 8. Incomplete workflows (must be disclosed, not papered over)

1. **Credit/debit notes have no UI.** `app/(staff)/dashboard/note-actions.ts`
   exposes `issueInvoiceNoteAction`/`voidInvoiceNoteAction`; unit tests pin the
   validation contract (GST-only source documents, owner/manager roles,
   trimmed reason). No page renders a control that calls them. Notes therefore
   cannot be issued by a user today — fail-closed in practice, incomplete as a
   product. DB lifecycle (issuance, void, uniqueness backstop, audit events,
   series allocation) is proven locally.
2. **Partial notes are unsupported by design.** Only full-document credit/debit
   notes exist; partial-adjustment workflows require a product decision.
3. **IRP reconciliation is read-only** and only useful once something records
   attempts; with no provider, all rows are manual fixtures.
4. **No GST e-invoice QR on PDFs** (no IRN → no QR, by design).
5. **Reconciliation cron** for IRP attempts does not exist; polling strategy,
   backoff and alert wiring are unimplemented.
6. **Composition + GST tax invoice mixing**: `orders_math_check` forks on
   `gst_mode_snapshot`; any row with NULL snapshot is legacy-exclusive. A
   tenant switching modes keeps old tickets on the old identity — intended, but
   support tooling to explain this to a restaurant does not exist.
7. **`EinvoiceReconciliationPanel`** exists on the invoices page and renders
   only when reconciliation returns `visible`; with no attempts recorded it is
   silent.

## 9. Blast-radius summary for the first hosted enablement

| Failure | Consequence | Mitigation |
|---|---|---|
| Existing order violates new `orders_math_check` | `ALTER` fails; release stops at B1 (single transaction → no partial apply) | §5.1/§5.2 audit |
| Pricing core regression | All restaurants unable to place orders | Local suites + canary synthetic order in the release window; immediate app rollback (deploy rollback) for the code path; DB fix-forward |
| Non-zero `restaurant_gst_config` after apply | Tenant silently billed with wrong tax | Post-apply assertion `count(*) = 0`; any row → stop, capture, revert tenant to unset |
| IRP accidentally attempted with real provider | Live tax submission to GSTN | No adapter exists; no credentials exist; keep it that way without owner authorization |
| Note series/duplicate live note | Backstop unique index refuses the write | By design; error is P0001 with customer-safe message |

## 10. Staged enablement sequence (when — and only when — authorized)

0. Owner authorization naming the project (staging first, then production as a
   separate decision), this document, the file set and the SHA. Adviser
   sign-off on mode profiles (5% no-ITC vs 18% specified premises) and on
   composition handling.
1. Preflight §5 complete; snapshot verified restorable.
2. Phase A (25 files) per the release-baseline doc — or, if already live,
   straight to:
3. B1 → verify pricing identity on a synthetic order → B2 → B4 → B3 → B5 → B6 → B7.
4. Synthetic acceptance on staging only (fixtures at `.invalid` identities):
   regular-mode lifecycle, composition rejection of tax invoice, mode freeze at
   order time, B2B buyer-block fail-closed validation, note issue/void/uniqueness,
   reconciliation panel rendering, report_sales S5 regression.
5. Only then: owner decision on which tenant (if any) flips `gst mode` —
   default remains `off` for everyone.
6. Production application of B1–B7 is a **separate** authorization, after
   staging evidence is attached to this document.

## 11. Standing warnings

- Never `supabase db push` / `--include-all` / ledger repair to force this
  chain in. One file, one transaction, markers verified, stop on first mismatch.
- Never mint a migration version from a clock you do not trust; repo versions
  and sandbox/provider clocks have diverged by ~8 days.
- If any marker fails, **stop**. Do not "fix forward" a failed B-file without
  owner review.
- Do not re-use `20261114000600`'s column additions to sneak in a different
  e-invoice design; B-files are frozen for review.
