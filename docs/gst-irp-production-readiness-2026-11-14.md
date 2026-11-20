# GST / IRP production readiness & risk analysis — 2026-11-14

**Priority 2: local simulation only; NOT APPLIED to any hosted project. All 26 GST/IRP
files are NOT AUTHORIZED for hosted application.** See the [116-file
inventory](migration-manifest-2026-11-14.md) and the [Priority 2 completion
report](../qa-evidence/day1/IRP_PRIORITY_2_LOCAL_COMPLETION.md). Historical
sections below predate the local lifecycle and are not an application plan.
No hosted catalog/data or provider API was accessed in Priority 2.

## Priority 2 operator guide — e-invoice / IRP register

1. **Decide necessity first.** In [GST settings and the owner decision record](gst-two-mode-2026-11-14.md#owner-and-adviser-decision-record),
   distinguish ordinary B2C, B2B registered recipients, exports and special supplies.
   Determine the issuing registration, verified supplier exemptions, and the highest
   PAN-wide aggregate turnover in a covered closed FY. Re-review on India April 1 or
   changed/conflicting evidence. Use [the statutory sources](gst-statutory-workflows-2026-11-18.md#irp-priority-2-effective-dates-and-source-register).
   No live eligibility is implied by the website, a GSTIN checksum, a provider's
   enablement flag, an outlet-only total, or ₹10 crore reporting classification.
2. **Read the immutable source.** Invoice history links to `/dashboard/reports/irp`.
   Owner/Manager can read the selected outlet only: held sources without preparation,
   latest unqueued preparations, date-filtered dispatches and follow-up states,
   reporting deadlines (India dates), and sanitized outcome latency/failures. CSV
   contains document numbers and operational metadata, no buyer particulars, PAN,
   route signer, requests or signed artifacts. Do not treat simulation counts as
   filed documents. No need to use this path for ordinary B2C, retail or BOS.
3. **Local synthetic exercise only.** An entitled Owner validates the held INV,
   CRN or DBN using **Validate IRP payload offline**. This saves a versioned
   INV-01 outbox record against issued facts. In a disposable, explicitly opted-in
   loopback app, choose the pre-provisioned local route and **Queue simulation**.
   No route is installed by the migrations. A private harness worker claims and
   settles the job separately; the web application neither runs nor schedules it.
   Native database role tests and Chromium HTTP fixtures exercise those boundaries separately.
   Do not simply point the harness or the simulation flags at any real database.
4. **Read the result, not a generic status.** Open the dispatch for revisioned
   event history. `Verified simulation` means the ephemeral test signer, signed
   test invoice and QR, exact acknowledgement and document identity matched; it
   is not a legal IRN/ACK/QR and never releases the source. There is no manual
   override. Source GST/number/payment rows are unchanged; no automated GSTR-1,
   amended return, refund, credit/debit note, supplementary payment or final copy.
   A future private printable authority copy requires active authority artifacts,
   not a legacy `generated` field. This build cannot write them. No bearer link or
   plain-text sharing is enabled for IRN-required copies.

## Priority 2 recovery runbook — local model, no hosted authority

| State | Safe next step | Never do |
|---|---|---|
| Unprepared / unknown / source unavailable | Review issue-time snapshots and saved evidence with owner/CA. Do not infer from current settings. | Do not bypass the hold, backdate or allocate another number for the same event. |
| Queued / in progress | Check pinned route/selection, fresh PAN review, entitlement, available rate slot and India deadline. An operator disables a route to stop new claims; a request already in flight may still need reconciliation. | Do not swap providers on an in-flight job, reset leases, or treat a request as a submission. |
| Ambiguous, duplicate, invalid signed reply or abandoned lease | Owner requests **lookup** by seller registration + FY + type + saved number on the original route. The worker holds for 120 seconds after uncertainty or lease recovery in this simulation. If there is no conclusive outcome after lookup, preserve the queue, collect event/revision/digest and timestamps, and escalate privately. | Do not retry on a socket error, HTTP status, a soft not-found, or because time elapsed. Do not paste external tokens/JWS into a ticket. |
| Retry eligible | Only when the operation was definitely never sent or a settled lookup proves no registration. Owner may request a bounded retry of the exact same payload and route while within the reporting window. | Do not reuse or rewrite evidence. Exhaustion / confirmed rejection goes to owner/CA review, not unlimited retries. |
| Verified active / cancellation requested | Same scope and reason code, authenticated cancellation/lookup contract, review existing adjustments, no active e-way bill (availability must be known), strictly before ACK + 24h. An unstarted request that reaches the cutoff restores active status; no bytes were sent. Definite cancellation rejection or an unsent precheck also leaves the original acceptance intact. | Do not cancel through a local void, create an offsetting note automatically, or treat a cancellation as a payment refund. |
| Cancellation uncertain / cancelled | Suppress the active-copy projection until a fresh lookup proves active or confirms cancellation. After confirmed cancellation keep the original number and all signed evidence in private history; it cannot be resubmitted. At window expiry seek adviser disposition; do not synthesize provider evidence. | Do not rerun cancellation or generation on ambiguity, release from an old screen, or assume previous copies can be recalled. |

Preserve evidence during recovery. Disable new claims, snapshot the database
and reconcile every in-flight lease with the approved operator before any future
restore or route change. A restore that loses dispatch evidence does not imply
non-submission. Where external registration cannot be resolved by this connector,
record the case in the organization's controlled register with the owner/CA and
provider; there is deliberately no API to install a manual success or backdate
cancellation. Keep credentials and document bodies outside operational logs.

## Priority 2 API / schema and provider review

- `01800`: private `irp_routes`, `irp_route_choices`, `irp_route_events`,
  `irp_dispatches`, `irp_dispatch_events`, `irp_verified_artifacts`. All have RLS,
  with API table privileges revoked. Signed bodies and private evidence remain
  in that boundary. Signer pin, route identity, version and statutory job identity
  are not mutable through a browser. No table contains provider credentials or private signing keys.
- Owner RPCs: `choose_irp_route(outlet, route|null, expectedRevision)`,
  `queue_irp_dispatch(outlet, preflight)`, `request_irp_dispatch_action(outlet,
  dispatch, expectedRevision, lookup|retry|cancel, reason?)`. Browser selects the
  active membership server-side; SQL independently verifies role and outlet.
  `01900`: Manager/Owner `report_irp_register(outlet, limit, from, until, followup,
  offset)` (until is exclusive) and `read_irp_dispatch(outlet, dispatch)`; no
  account-wide fallback. `read_active_irp_document(outlet, id, invoice|note)` checks
  issued source and staff scope; it **never** projects simulation as authority.
  Active-copy lookup for notes is finance-only; cashiers can read authorized
  invoices, but not the register. `01900` keeps the note gate unless the original
  has an active authority artifact; this is dormant in this build.
- Worker claims and sweeps use only private SQL `claim_irp_dispatch`,
  `sweep_irp_leases`, `finish_irp_dispatch`. No browser/API or `service_role`
  grant. The harness creates a disposable no-login worker role with these
  three calls, and a separate test provider role scoped to its private registry. Dispatch has unique
  `(tier, seller:FY:type:number)` and references immutable preflight + digest.
  Claim commits before transport, takes source and row locks, has a 45-second
  lease, one persistent route rate slot, token/revision CAS and an append-only
  event. No re-send on abandoned lease. Default worker transport bound is 10
  seconds (configurable to 30 seconds, shorter than the lease), with cancellation
  at deadline, sanitized result and latency; uncertainty uses the 120-second
  guard, retry delay is bounded, operation budgets are 8 generate, 4 cancel,
  30 combined lookup claims. No autonomous retry; external exactly-once is
  not inferred from SQL alone.
- `lib/gst/irp/execution/{contracts,worker,verification,simulator}.ts`: versioned
  adapter with explicit capability, owner-approved routing interface, scoped
  session bootstrap for credential-broker/auth/encryption implementations and
  normalized send/lookup/EWB/cancel contract. The worker binds both RS256 objects
  to pinned signer, tier, exact document fields/paise, QR party/date/number/type/
  SAC/count/total and acknowledgement number/time. The signed QR encoding is
  derived from the verified string for an authority-only private printable copy.
  Simulation uses `SIM-` and `SIM-ACK-` identifiers and signed `Simulation:true`;
  no real provider network transport, signing key, broker, worker daemon or
  registration is bundled. Both SQL and worker refuse authority execution.
- **Before a real connection:** obtain a separate decision on provider, outlet and
  GSTIN, permitted test target, version, endpoint allowlist, onboarding/consent,
  approved secret manager + dedicated worker identity, TLS and key provenance/
  rotation, time and retry semantics by response code, rate budgets by GSTIN and
  provider account, retention/encryption/privacy, e-way bill and signatures.
  Validate authenticated envelope and key IDs, number precision, date and schema
  mapping, signed payload quirks and all required master-data checks against the
  exact authorized provider/sandbox. In particular define what a final absence
  or active cancellation lookup means and how a delayed write is ruled out.
  Independently obtain hosted isolation, restore, API/ACL/cache, genuine Auth and
  customer copy checks. New reviewed change and explicit authority acceptance are
  required to remove the simulation-only gate. No activity in this guide is that approval.

## Reproducing local evidence

- `npm run irp:rehearse`: focused local operator driver. It creates and
  destroys a fresh loopback PostgreSQL 17 cluster; it takes no connection
  string, tenant data, provider key or network route. It seeds synthetic
  documents through issuance and owner RPCs, then runs the real SQL worker
  transactions against a separate durable provider registry in the fixture.
  Run as a non-root developer with dependencies installed. `IRP_REHEARSAL`
  prints the redacted abandoned-lease recovery timeline (one send claim,
  one lookup, no legal copy). The suite exercises conflicting signed evidence,
  rate limits, retries, cancellation and ACLs. The database and ephemeral
  test signer are discarded after the command. Fixture-only lease/date
  acceleration is not a supported live operation. This is not a daemon or
  a way to connect the demo/browser to a real restaurant database.
- `npm run test:db:integration`: same native IRP tests plus the other database
  suites. No Auth/PostgREST/IRP call.
- `READINESS_GST_UPGRADE=1 npm run test:db:embedded`: populated 114→116 checkpoints
  plus existing GST regressions. The direct Data API tests require actual
  PostgREST; report their skips rather than reframing database roles as Auth.
- `bash scripts/e2e/run-with-bundled-chromium.sh npx playwright test --config=playwright.gst-fixtures.config.ts --reporter=line`:
  actual Next pages, browser actions, loopback shaped HTTP responses only; not
  genuine Auth, deployed schema/cache, persistence or provider evidence.
- The India clock drill uses the same integration harness with `READINESS_IRP_CLOCK_ONLY=1`,
  `TZ=UTC`, a throwaway `/tmp/autodine-irp-clock.XXXXXX/clock` timestamp file,
  `FAKETIME_NO_CACHE=1`, `FAKETIME_DONT_FAKE_MONOTONIC=1` and a locally built
  libfaketime 0.9.12 on `LD_PRELOAD`. It covers India Day 30→31 and the exact
  24-hour ACK window using native clocks. Do not use fake clocks outside that harness.

---

**Historical B1–B7 risk analysis — 2026-11-14.** See the
[Workstream B closure](../qa-evidence/day1/GST_WORKSTREAM_B_FINAL_CLOSURE.md) for
that separate baseline and the [staging plan](gst-staging-application-plan-2026-11-15.md)
for authorization gates. Neither is an instruction to apply migrations.

## 1. Scope inventory — the 7 files, in dependency order

| # | File | Creates / replaces | Data-affecting? |
|---|---|---|---|
| B1 | `20261113000100_gst_two_mode.sql` | `restaurant_gst_config(+_history)` tables, RLS, `restaurant_gst_config_validate`/`_version`/`_history_track` triggers, `gst_pricing(uuid)`, `orders.gst_mode_snapshot` + `gst_config_version` columns, **replaces `orders_math_check`** with a mode-aware version, rewrites the order-pricing core to the GST identity (regular: `total = subtotal − discount`, tax extracted inclusive; legacy/off/composition: `total = subtotal − discount + tax`), extends `restaurant_invoices` (`gst_snapshot jsonb`, `irn text`, `irp_status text not null default 'not_required'`), replaces `restaurant_invoices_document_type_check`, invoice series allocation, note bridging hooks | Yes — new columns (nullable / defaulted), constraint replacement on a hot table, function replacement |
| B2 | `20261114000101_gst_b2b_einvoice_readiness.sql` | `restaurant_irp_requests` (append-only audit), `items.is_alcoholic` (default `false`), `restaurant_invoices` B2B recipient columns + format/state/email/name constraints, rewrites `close_order_session_and_issue_receipt` / `issue_closed_session_receipt` to carry buyer details into the GST snapshot | Yes — constraints with `check (… is null or …)`-style shapes, nullable additions |
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
