# Staging GST/IRP application plan (2026-11-15)

**Status: PREPARED ONLY. NOT APPLIED. NOT AUTHORIZED.**

No GST/IRP migration has been applied to staging or production from this branch.
This document is the exact, isolated staging application sequence and test plan
for when — and only when — the owner issues a separate explicit authorization
naming `juwyhslzchjevqkdvwjm` (`autodinetest`). Applying any part of it without
that authorization is out of scope and must not happen.

Production (`bdbaqpevwmgdvghszjno`) is never a target of any step below.
Nothing here weakens RLS, grants, fail-closed IRP behavior, or the
`report_sales` remediation already applied (2026-11-15, S4,
`docs/report-sales-staging-rehearsal-2026-11-15-result.md`).

## 1. Staging compatibility inspection (executed 2026-11-15, read-only)

Target confirmation: project ref `juwyhslzchjevqkdvwjm` only; production was
never queried.

`list_migrations` (ledger `supabase_migrations.schema_migrations`, 11 rows):

```
20261108091547 20261019000001_init
20261108091623 20261019000002_public_read
20261108092948 autodine_local_test_scaffold
20261108093006 20261020000004_counter_payment
20261108174655 20261021000005_public_place_order
20261108174735 20261021000006_table_qr_verification
20261108174758 20261021000007_table_qr_provisioning
20261109052519 arena_staging_forward_upgrade_55
20261109053540 operational_readiness_catalog_probe
20261113115007 owner_billing_configuration_guard
20261115051514 report_sales_export_authorization
```

`supabase_migrations.arena_staging_upgrade_manifest`: 50 rows
(`arena_staging_forward_upgrade_55` filenames, newest `20261109000900_staff_tts_budget.sql`,
plus `20261112000300_report_sales_export_authorization.sql` added by the
2026-11-15 rehearsal).

**33 of the 89 repo migrations in `supabase/migrations/` are NOT applied on
staging** (repo filename list diffed against manifest ∪ ledger, filename-matched):

Pre-GST, hardening/serialization chain (26):

```
20261108007000_payment_recorded_by.sql
20261108008000_p8_require_settlement_before_close.sql
20261108009000_p9_financial_read_roles.sql
20261108010000_invoice_share_links.sql
20261109001000_operational_readiness.sql
20261110000100_counter_payment_lock_order.sql
20261110000200_financial_session_serialization.sql
20261110000300_shared_wifi_scan_limits.sql
20261110000400_durable_order_attempt_budget.sql
20261110000500_public_restaurant_profile.sql
20261110000600_staff_finance_boundaries.sql
20261110000700_restaurants_member_only.sql
20261110000800_remove_order_submission_caps.sql
20261110000851_payment_audit_provider_actor.sql
20261110000900_converge_qr_verification_attempts.sql
20261110000950_online_payment_attempt_uniqueness.sql
20261110001000_account_subscriptions.sql
20261110001100_subscription_billing.sql
20261110001210_checkout_outstanding_guard.sql
20261110001220_revoke_client_bypass_privileges.sql
20261112000100_schedule_subscription_expiry.sql
20261112000200_immutable_restaurant_account_link.sql
20261112000400_bound_subscription_history.sql
20261112000500_serialize_outlet_creation.sql
20261112000600_serialize_subscription_payments.sql
20261112000700_serialize_subscription_expiry.sql
```

GST/IRP bundle (7):

```
20261113000100_gst_two_mode.sql
20261114000100_gst_b2b_einvoice_readiness.sql
20261114000200_irp_reconciliation.sql
20261114000300_gst_mode_gates.sql
20261114000400_restrict_trigger_functions_execute.sql
20261114000500_credit_debit_notes.sql
20261114000600_einvoice_issuance_profile.sql
```

Catalog-level absence of every GST object was verified directly (all NULL):
`to_regclass('public.restaurant_gst_config')`,
`to_regclass('public.restaurant_gst_config_history')`,
`to_regclass('public.einvoice_attempts')`,
`to_regclass('public.credit_notes')`,
`to_regclass('public.debit_notes')`,
`to_regclass('public.invoice_issuance_profile')`,
`to_regprocedure('public.issue_irn(uuid)')`.

Consequence for hosted acceptance: the staging database is at the 2026-11-09
bundle + `report_sales_export_authorization` + `owner_billing_configuration_guard`.
The hosted preview built from this branch runs current application code against
that older schema. The four browser suites target the core QR/order/kitchen/
cashier/security flows, which exist at both schema levels (the
`place_public_order_attempt` guest entrypoint with the `{code,error}` envelope
and anon/authenticated EXECUTE was verified live on staging 2026-11-15 when the
provision runner completed end-to-end), but any code path that references the
missing 2026-11/2026-12 migrations — settlement-before-close RPC, financial
read roles, invoice share links, subscription billing surfaces, GST — will fail
on staging until Phase A/B below is applied. That is a schema-compatibility
gap, not an application defect; it must be closed by an authorized apply,
never by editing the app to tolerate a different contract.

## 2. Preconditions (all required before the first write)

1. Owner authorization issued **in chat**, naming `juwyhslzchjevqkdvwjm`,
   naming this plan document, and naming which phases are authorized
   (A = pre-GST chain, B = GST bundle; they are separable).
2. Role: Supabase MCP `create_migration` (single transaction per file, rolls
   back on failure) as used in the S4 rehearsal — or an equivalent reviewed,
   transaction-wrapped path. Never psql-bypass, never `--ack-drift`.
3. Pre-flight capture BEFORE the first write, stored under
   `scripts/reconcile/evidence/`:
   - dump of `supabase_migrations.schema_migrations` +
     `supabase_migrations.arena_staging_upgrade_manifest` (filenames + sha256
     records);
   - `md5(prosrc)` of every function the chain will create OR replace
     (per-file `create or replace` targets — extract from the SQL files);
   - existence probe of every object the chain will create (`to_regclass` /
     `to_regprocedure` for each new table/function/type);
   - grants (proacl) of every function the chain replaces or drops privileges
     on (notably anything touching `place_public_order`,
     `place_public_order_attempt`, `report_sales`, `record_counter_payment`,
     `close_order_session_and_issue_receipt`);
   - `count(*)` and RLS state of the 42 public tables (data must not change).
4. Rollback posture: additive-only chain preferred — verify each file contains
   no unexpected `drop table`/`truncate`/`delete from` of pre-existing objects;
   the review in step 5 covers this. Rollback artifacts = the pre-flight
   captures + per-file reverse SQL written and reviewed BEFORE apply
   (drop-created-object / restore-replaced-function). No staging backup is
   assumed or claimed; the owner pre-approves catalog-capture-only for this
   class of change (as in S3 of the rehearsal), or orders otherwise.
5. Static review of the 33 files before apply: confirm each is additive/
   hardening, confirm no production project reference, no GSTIN/IRN constant,
   and that `20261110000800_remove_order_submission_caps.sql` keeps the
   `place_public_order` service_role-only / `place_public_order_attempt`
   anon+authenticated contract (verified 2026-11-15 as present in the file
   text and live on disposable PG 17 with 89/89 applied).

## 3. Application sequence (only after authorization)

Apply in **exact repo filename order** (the chain was developed
as a chain; do not re-order it for cleverness). One `create_migration` call per file, each with
`name` = the repo filename stem, `query` = file bytes re-read from the working
tree at apply time (sha256 logged). After each file, run its markers before
the next file starts; stop on the first mismatch.

Phase A (26 files): `20261108007000` → `20261108008000` → `20261108009000` →
`20261108010000` → `20261109001000` → `20261110000100` → `20261110000200` →
`20261110000300` → `20261110000400` → `20261110000500` → `20261110000600` →
`20261110000700` → `20261110000800` → `20261110000851` → `20261110000900` →
`20261110000950` → `20261110001000` → `20261110001100` → `20261110001210` →
`20261110001220` → `20261112000100` → `20261112000200` → `20261112000400` →
`20261112000500` → `20261112000600` → `20261112000700`.

Phase B (7 files): `20261113000100_gst_two_mode.sql` →
`20261114000100_gst_b2b_einvoice_readiness.sql` →
`20261114000200_irp_reconciliation.sql` →
`20261114000300_gst_mode_gates.sql` →
`20261114000400_restrict_trigger_functions_execute.sql` →
`20261114000500_credit_debit_notes.sql` →
`20261114000600_einvoice_issuance_profile.sql`.

Manifest record after EACH file: `filename`, `sha256`, `applied_at`, recorded
in `supabase_migrations.arena_staging_upgrade_manifest` (mirrors the S4
protocol; keeps the two ledgers reconcilable).

## 4. Post-apply verification markers (Phase B must end green)

- `to_regclass('public.restaurant_gst_config')`,
  `to_regclass('public.restaurant_gst_config_history')`,
  `to_regclass('public.einvoice_attempts')`,
  `to_regclass('public.credit_notes')`,
  `to_regclass('public.debit_notes')`,
  `to_regclass('public.invoice_issuance_profile')` — all non-NULL.
- RLS enabled on every new table (`relrowsecurity = true`); policies exist for
  select/write restricted to member roles (owner/manager as designed).
- Default GST mode is `off` and `restaurant_gst_config` holds **zero rows for
  pre-existing staging tenants** — the mode must be opt-in per tenant, never
  inferred (assert `count(*) = 0` after apply).
- `orders.gst_mode_snapshot` / `gst_config_version` columns exist;
  `orders_math_check` is mode-aware (spot-read `pg_get_functiondef`).
- Fail-closed IRP: with no provider configured, every IRN-issuing path is
  disabled/`manual` — verify no function performs an outbound HTTP call with
  a GSP endpoint unless `gst` configuration explicitly selects a sandbox
  provider **on this staging project only**. Staging must not call the real
  GSTN/IRP production endpoints under any circumstances.
- `report_sales` still returns owner/manager-only data: re-run the S5 marker
  queries from `docs/report-sales-staging-rehearsal-2026-11-15-result.md`
  (grants unchanged `{authenticated, service_role, postgres}`, cross-tenant
  42501 denial) — apply must not regress the remediation.
- Grants spot-check on Phase A files that tighten privileges
  (`revoke_client_bypass_privileges`, `remove_order_submission_caps`,
  `restaurants_member_only`, `staff_finance_boundaries`): anon/public receive
  nothing new; `place_public_order` remains `service_role`-only.
- No staging data row changed: row counts for `orders`, `payments`,
  `restaurant_invoices`, `order_sessions` identical to the pre-flight capture.

## 5. Synthetic GST acceptance test plan (after Phases A+B, still staging-only)

Executed through the standard staging runner pattern (synthetic fixtures only,
`arena-<uuid>@example.invalid` identities, no real customer or payment data,
no real GSTIN — a checksum-valid **synthetic** GSTIN or none):

1. Fixture: fresh synthetic restaurant; set GST mode `regular` via the owner
   settings path; confirm `restaurant_gst_config(+_history)` written; confirm
   a second tenant stays at `off`.
2. Order lifecycle under GST: QR session → order → kitchen flow → cashier
   settlement → close session → invoice. Assert: invoice tax breakdown matches
   `tax_rate_bps` on fixture items; `total = subtotal` with tax as extraction
   (regular mode) — not `subtotal + tax`; `gst_mode_snapshot` frozen on the
   order even if the tenant later switches modes; `orders_math_check` accepts
   the GST identity and still rejects tampering.
3. Invoice immutability: attempt mutation of an issued GST invoice
   (update/delete) as the owner role → refused (immutability triggers from
   `20261109000600_finalized_source_guard.sql` family); credit note issued
   against it instead — note totals net correctly; original unchanged.
4. B2B readiness: set a synthetic valid-checksum GSTIN on the buyer profile;
   issue invoice; assert e-invoice readiness fields populate; attempt IRN
   issuance with no provider configured → must fail closed with a clear
   "manual/not configured" state, zero outbound network calls, no IRN row
   `status='issued'`. (A sandbox GSP, if ever engaged, is a separate
   authorization; production GSTN/IRP is never used.)
5. RBAC: owner vs manager vs kitchen vs cashier — GST settings write owner-only;
   cashier cannot issue credit notes; kitchen cannot read invoice financial
   detail beyond its existing scope; cross-tenant reads denied (42501/RLS).
6. `report_sales` under GST mode: billed vs collected still separate; tax
   figures consistent with invoice snapshots; no double counting after credit
   note.
7. Rollback drill (optional, recommended): on a **disposable local stack only**
   (never staging), replay the rollback artifacts and re-verify the pre-apply
   md5 markers. This mirrors S2/S7 of the report_sales rehearsal.

## 6. Hard stops

- Any marker mismatch → stop, capture state, report; never "fix forward"
  blindly.
- Any file wanting to modify production, or any step executed against
  `bdbaqpevwmgdvghszjno` → refuse.
- Any request to enable real IRP/GSTN calls, real GST credentials, or a real
  GSP without a separate sandbox-specific authorization → refuse.
- `supabase/migrations/` must remain the only apply source; no paste of
  reconstructed SQL from chat.
- GST on this branch is additive to the repo (files already committed); the
  plan above changes nothing until an authorization is issued.
