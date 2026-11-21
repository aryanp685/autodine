# Production migration inventory — 122 repository files (GST/IRP, guest journey, operational delivery and QR-boundary local inventory)

**Repository inventory only — not an apply list.** On `arena/ce32f7c8-autodine`,
the recovered base has the same committed tree as PR #191 (98 files). Six
recovered GST follow-ups include the CA pair, and ten further forward files
implement Workstream B locally. Two Priority 2 files add a simulation-only
IRP execution sidecar and private document projections. One Priority 3 file
changes the guest checkout wrapper only, and one Priority 4 file adds the
outlet revision, floor projections and guest-version edit boundary. Counts:
**76 legacy-rollout scope · 9 Branch set · 4 main-inherited boundary files · 1
scoped ACL revision · 14 prior GST/IRP Phase B files · 10 GST/IRP Workstream B
files · 2 GST/IRP Priority 2 files · 1 guest-checkout Priority 3 file · 1
operational-delivery Priority 4 file**. All 26 GST/IRP files and the separate
Priority 3 and Priority 4 files remain individually **NOT AUTHORIZED**.
The separate owner operation is not a migration.
See the [GST baseline hashes](../qa-evidence/day1/GST_WORKSTREAM_B_FINAL_CLOSURE.md) and the [two Priority 2 hashes](../qa-evidence/day1/IRP_PRIORITY_2_LOCAL_COMPLETION.md#migration-authorization).

**Evidence boundary:** "Reported applied" means the 2026-11-12 hand-off report
records the legacy rollout as completed. The A1 ledger + catalog-effect
probes were executed read-only against production on 2026-11-16 (72/92 repo
versions present at that time; see the probed rows below) and supersede the
reported-applied assumption for the flagged files. Nothing here
authorizes any application. GST/IRP files are not to be applied in any form
without separate written authorization each.

| Version | Migration | Classification | Note |
|---|---|---|---|
| `20261019000001` | `init` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261019000002` | `public_read` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261020000004` | `counter_payment` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000004` | `missing_qr_tables` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000005` | `public_place_order` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000006` | `table_qr_verification` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000007` | `table_qr_provisioning` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000008` | `charge_for_portions` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000009` | `report_sales` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000010` | `realtime_orders` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000200` | `item_spoken_name` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000300` | `item_addons` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000400` | `multiple_menus` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000500` | `restaurant_settings` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261021000600` | `cancel_and_change_order` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261022000700` | `multi_outlet` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261022000800` | `online_payments` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261023000900` | `table_verification_code` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261024000900` | `drop_old_qr_scan` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261025001000` | `restaurant_branding` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261026001100` | `trial_plans_and_write_gate` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261026001200` | `plan_entitlements` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261026001300` | `restaurant_upi` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261026001400` | `default_accent` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261026001500` | `place_order_addon_pricing_where` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261027000900` | `idempotent_guest_orders` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261028000100` | `renew_the_king_trial` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261028000900` | `guest_scan_confirm` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261029000100` | `staff_invites` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261103000100` | `brand_studio` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261105000100` | `veg_tri_state` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261106000000` | `menu_translations` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261107000000` | `storefront_settings` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261107074545` | `order_sessions` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261107080000` | `payment_audit_ledger` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261107082936` | `session_manual_payment_p4` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261107104440` | `p5_voice_waiter` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108000000` | `guest_rate_limits` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108000200` | `drift_reconcile` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108000300` | `publish_menu_snapshot` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108000500` | `order_session_staff_read` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108001000` | `order_code_and_kitchen_announce_guard` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108002000` | `invoice_receipts` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108003000` | `session_checkout_payment_receipts` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108005000` | `p9_security_hardening` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108006000` | `restore_public_order_session_attach` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108007000` | `payment_recorded_by` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108008000` | `p8_require_settlement_before_close` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108009000` | `p9_financial_read_roles` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261108010000` | `invoice_share_links` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000100` | `restore_hold_fields` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000200` | `order_attempt_lock` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000300` | `payment_state_guards` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000400` | `order_write_boundary` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000500` | `session_payment_guard` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000600` | `finalized_source_guard` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000700` | `order_line_removal` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000800` | `table_activity_summary` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109000900` | `staff_tts_budget` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261109001000` | `operational_readiness` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | health gate — /api/health green |
| `20261110000100` | `counter_payment_lock_order` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110000200` | `financial_session_serialization` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110000300` | `shared_wifi_scan_limits` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110000400` | `durable_order_attempt_budget` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110000500` | `public_restaurant_profile` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110000600` | `staff_finance_boundaries` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110000700` | `restaurants_member_only` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Batch B — apply only after app deploy |
| `20261110000800` | `remove_order_submission_caps` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | removes guest order-submission caps (AGENTS.md) |
| `20261110000851` | `payment_audit_provider_actor` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | **PROBED 2026-11-16 (prod, read-only): EFFECT ABSENT** — `payment_audit_events.actor_id` still NOT NULL, no FK to `profiles`; live settlement defect persists. Apply candidate (before `20261110000950`); pre-apply orphan-`actor_id` data preflight required (file validates FK and fails closed) |
| `20261110000900` | `converge_qr_verification_attempts` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110000950` | `online_payment_attempt_uniqueness` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | **PROBED 2026-11-16: EFFECT PARTIAL** — hosted `begin/settle_online_payment` are older bodies (signatures identical; begin lacks the per-order pending guard, settle lacks the stale-balance guard; bodies 3540/2480 vs repo 4300/3427). `CREATE OR REPLACE` — no duplicate-object risk. Apply candidate after `20261110000851` (settle inserts NULL actor) |
| `20261110001000` | `account_subscriptions` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110001100` | `subscription_billing` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261110001210` | `checkout_outstanding_guard` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | **RESOLVED 2026-11-16: EFFECT PRESENT, behaviour-identical.** Full `pg_get_functiondef` diff vs the repo file: signature, `SECURITY DEFINER`, `search_path=public, pg_temp`, volatility, auth/role guards (`owner/manager/cashier`, 42501/P0002), write-gate, both outstanding-balance guards and error texts, close update and receipt call are statement-for-statement identical. Only differences: function COMMENT wording and inline body comments (no behaviour). Grants end-state identical (anon: none; authenticated + service_role: EXECUTE; the repo revoke list does not touch service_role's explicit grant). **No reconciliation migration needed; excluded from the apply batch to avoid a needless production write.** Optional ledger-parity application is owner-discretionary and changes only the comment |
| `20261110001220` | `revoke_client_bypass_privileges` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | **PROBED 2026-11-16: EFFECT PARTIAL — DO NOT APPLY VERBATIM.** TRUNCATE/REFERENCES/TRIGGER already revoked on tables, but `MAINTAIN` remains for `anon`+`authenticated` on **17 tables** (D2 confirmed) and in `postgres` default ACLs; `supabase_admin` defaults untouched (owner-operation scope). Two live sequences (`restaurant_invoice_share_audit_id_seq`, `subscription_receipt_seq`) grant client USAGE/SELECT/UPDATE; source verification (2026-11-16) shows both are consumed only inside SECURITY DEFINER functions, so the sequence revoke is safe — but production should apply the scoped revision `20261116000100` (below) instead of this file, which stays in the chain for local/staging parity |
| `20261112000100` | `schedule_subscription_expiry` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261112000200` | `immutable_restaurant_account_link` | Branch set — apply only with B1 (release prep §2) | P0 security — effect absent in prod (D1) |
| `20261112000300` | `report_sales_export_authorization` | Branch set — apply only with B1 (release prep §2) | staging-applied 2026-11-15; prod unverified |
| `20261112000400` | `bound_subscription_history` | Branch set — apply only with B1 (release prep §2) |  |
| `20261112000500` | `role_scoped_order_reads` | main (PR #191 main-merge reconciliation, 2026-11-16) — staff-access boundary | NOT AUTHORIZED for hosted application by this merge; arrived via main merge |
| `20261112000501` | `serialize_outlet_creation` | Branch set — apply only with B1 (release prep §2) |  |
| `20261112000600` | `cap_subscription_history_ceiling` | main (PR #191 main-merge reconciliation, 2026-11-16) — subscription boundary | NOT AUTHORIZED for hosted application by this merge; arrived via main merge |
| `20261112000601` | `serialize_subscription_payments` | Branch set — apply only with B1 (release prep §2) |  |
| `20261112000700` | `order_line_edit_boundary` | main (PR #191 main-merge reconciliation, 2026-11-16) — order-line boundary | NOT AUTHORIZED for hosted application by this merge; arrived via main merge |
| `20261112000701` | `serialize_subscription_expiry` | Branch set — apply only with B1 (release prep §2) |  |
| `20261113000100` | `gst_two_mode` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000100` | `owner_manager_subscription_reads` | main (PR #191 main-merge reconciliation, 2026-11-16) — subscription boundary | NOT AUTHORIZED for hosted application by this merge; arrived via main merge |
| `20261114000101` | `gst_b2b_einvoice_readiness` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000200` | `irp_reconciliation` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000300` | `gst_mode_gates` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000400` | `restrict_trigger_functions_execute` | GST/IRP Phase B — NOT AUTHORIZED | Phase B5 — EXECUTE revoke; independent hardening, still NOT AUTHORIZED (Phase B) |
| `20261114000500` | `credit_debit_notes` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000600` | `einvoice_issuance_profile` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261115000100` | `fix_redeem_staff_invite_status_returns` | Branch set — apply only with B1 (release prep §2) | P0 auth — invite single-use fix |
| `20261115000200` | `owner_billing_configuration_guard` | Branch set — apply only with B1 (release prep §2) | P0 security — owner-only tax/GSTIN trigger (PR #181 content, renumbered) |
| `20261115000300` | `audit_restaurant_account_reassignment` | Branch set — apply only with B1 (release prep §2) | P0 security — account-reassignment audit ledger |
| `20261116000100` | `revoke_client_maintain_privileges` | Scoped ACL revision — NOT AUTHORIZED (own decision; production substitute for `20261110001220`, see its probed row) | Added 2026-11-16 after production catalog probes: completes the MAINTAIN/default-ACL scope 01220 misses in the production-shaped catalog, with fail-closed post-revoke verification; sequence revokes justified by definer-only consumption (verified in source). Locally replay-tested; never applied to any hosted project |
| `20261118000100` | `merge_boundary_gst_order_line_edits` | GST/IRP Phase B dependency — NOT AUTHORIZED | PR #191 main-merge reconciliation (2026-11-16). Re-asserts main's order-line edit boundary (owner/manager/cashier only; Kitchen 42501) on the GST replacement; NOT AUTHORIZED for hosted application by this merge |
| `20261118000200` | `gst_configuration_boundary` | GST/IRP Phase B follow-up — NOT AUTHORIZED | Owner/write/version checks, role-scoped registration/history, account consistency and Composition admission |
| `20261118000300` | `gst_pricing_boundary` | GST/IRP Phase B follow-up — NOT AUTHORIZED | Minimal public quote, private pricing, ticket mode/rate/version and immutable classification on new lines |
| `20261118000400` | `gst_document_integrity` | GST/IRP Phase B follow-up — NOT AUTHORIZED | Validates source and settlement, document rounding, correction guards and IRN sharing hold |
| `20261118000500` | `gst_document_report` | GST/IRP Phase B follow-up — NOT AUTHORIZED | Owner/manager aggregates from immutable document amounts; not cash or a GST return |
| `20261118000600` | `gst_ca_onboarding` | GST/IRP Phase B follow-up — NOT AUTHORIZED | Two-mode onboarding, FSSAI, business/SAC and qualifying hotel evidence, legacy preservation and zero-tax reviewed retail pricing |
| `20261118000700` | `gst_ca_documents` | GST/IRP Phase B follow-up — NOT AUTHORIZED | Immutable identity and SAC, independent India FY series, and billing document aggregates (including retail) |
| `20261118000800` | `gst_outlet_activation` | GST/IRP Workstream B — NOT AUTHORIZED | Explicit outlet activation, audit and shared-registration series reservations |
| `20261118000900` | `gst_recipient_documents` | GST/IRP Workstream B — NOT AUTHORIZED | Recipient profiles, immutable snapshots, series and issue-time IRP hold |
| `20261118001000` | `gst_irp_readiness` | GST/IRP Workstream B — NOT AUTHORIZED | Local INV-01 validation evidence only; no dispatch or legal IRN transition |
| `20261118001100` | `gst_reconciliation` | GST/IRP Workstream B — NOT AUTHORIZED | Outlet-scoped internal GST document and payment reconciliation |
| `20261118001200` | `gst_review_lifecycle` | GST/IRP Workstream B — NOT AUTHORIZED | Private versioned deferral; hotel FY review and declaration windows |
| `20261118001300` | `gst_direct_fulfilment` | GST/IRP Workstream B — NOT AUTHORIZED | Authenticated same-state direct tickets, protected destination and settlement/issue guards |
| `20261118001400` | `gst_irp_rehearsal_store` | GST/IRP Workstream B — NOT AUTHORIZED | Private synthetic generation CAS and events; in-flight local void guard; no release |
| `20261118001500` | `gst_finance_scope` | GST/IRP Workstream B — NOT AUTHORIZED | Versioned selected/account ledger with independent payment and document lifecycle evidence |
| `20261118001600` | `gst_document_particulars` | GST/IRP Workstream B — NOT AUTHORIZED | Reviewed Composition SAC and original note particulars; shared PAN review readers; no backfill |
| `20261118001700` | `gst_irp_rehearsal_recovery` | GST/IRP Workstream B — NOT AUTHORIZED | Private restart read and conditional generation CAS evidence; durable dispatch age; no artifact promotion |
| `20261118001800` | `irp_execution` | GST/IRP Priority 2 — NOT AUTHORIZED | Dispatch sidecar, pinned simulation routing, lease/CAS, recovery and cancellation history. No routes or worker grants installed. |
| `20261118001900` | `irp_document_projection` | GST/IRP Priority 2 — NOT AUTHORIZED | Scoped operational projections and inactive authority-only private-copy boundary. Depends on `01800`. |
| `20261118002000` | `guest_checkout_integrity` | Guest-to-receipt Priority 3 — NOT AUTHORIZED | Same-table replay and atomic whole-basket validation; no change to GST/IRP, amounts, discount policy or payment grants. |
| `20261118002100` | `operational_realtime` | Operational delivery Priority 4 — NOT AUTHORIZED | Adds the `waiter` membership role, membership-scoped floor projections, a coalesced metadata-only outlet revision and publication, sitting transfer, waiter acknowledgement and a guest-version edit cursor. No order amounts, GST/IRP, payment grants or hosted routing are changed by it. |
| `20261118002200` | `qr_code_staff_boundary` | Privileged-function review — NOT AUTHORIZED | Adds the owner/manager membership check to `rotate_table_qr_code`/`retire_table_qr_code` before they touch `table_qr_codes` (findings QR-01/QR-02). Signature, return type, grants and the subscription gate unchanged; no table, policy or data change. |
| `20261122000100` | `announcement_claim_recovery` | Hosted correction brought into the repository — NOT AUTHORIZED | `claim_kitchen_order_announcement(uuid)` expires a claim older than two minutes before inserting, so a crashed device no longer holds an order announcement forever (the insert is `on conflict do nothing`). Ported from production `20261119101116` and candidate `20261119101121`, which had no repository file. Same signature, gate and grants; plus the waiter-board partial index on `table_waiter_calls(announcement_claimed_at)`. |
| `20261122000200` | `qr_one_active_per_table` | Hosted correction brought into the repository — NOT AUTHORIZED | `20261118002200` added the QR membership gates but no database invariant. This collapses duplicate live cards, creates `table_qr_codes_one_active_per_table` (unique partial index, `table_id` where `revoked_at is null`) and re-creates rotate/retire with `pg_advisory_xact_lock(hashtext(table_id))` in addition to the row lock. Ported from production `20261120190546` and candidate `20261120190508`. Newer than every hosted ledger row, so a push ends on these bodies. |
| `20261119000100` | `restore_receipt_helper_boundary` | Main-inherited security correction — NOT AUTHORIZED | Revokes `EXECUTE` on `issue_closed_session_receipt(uuid, jsonb)` from `public`, `anon`, `authenticated` and `service_role`. `20261114000101` granted it to `authenticated`, which let a signed-in client issue a document for an already-closed sitting and skip the settlement wrapper's outstanding-balance check (local check `supabase/checks/07_p8_close_settlement.sql` fails without it). Forward-only; no data, policy or signature change. |

## Owner-operation (never applied automatically — separate on purpose)

| File | Status |
|---|---|
| `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql` | **OWNER-ONLY OPERATION.** Not part of the 118 migrations. Requires the owner to run it deliberately against the chosen project; closes the `supabase_admin` default-privilege residual (baseline drift D6/D7). Exercised only under the synthetic owner role in disposable PostgreSQL, never applied to a hosted target in this cycle. Verify per §A2 of the closure package after the owner runs it. |

## Reading the classes

- **Legacy rollout scope (76):** everything from the repository baseline
  through `20261112000100_schedule_subscription_expiry.sql`. Production exposure
  is plausible (hand-off, 2026-11-12) but **unproven at this SHA** — this is
  exactly what A1 re-probes. Two of these carry release-critical behaviour:
  `20261109001000_operational_readiness` (health goes green) and
  `20261110000700_restaurants_member_only` (Batch B; only after app deploy).
- **Branch set (9):** the forward migrations this cycle adds on top of the
  boundary. Apply in filename order, only under B1 authorization, per release
  prep §2. `20261112000300_report_sales_export_authorization` is already applied
  on **staging only** (2026-11-15 rehearsal); production presence is unverified.
- **GST/IRP Phase B (14):** the 7 files listed as B1–B7 in
  `docs/gst-irp-production-readiness-2026-11-14.md`, plus the seven
  `20261118000100`–`20261118000700` dependencies/follow-ups identified above.
  **NOT AUTHORIZED. Do not apply.** Note: B5 (`20261114000400_restrict_trigger_functions_execute`) is
  data-safe privilege hardening and could be authorized separately as a pure
  security item — it is listed as Phase B here because that is its dependency
  grouping in the GST analysis; it must still not be applied without an
  explicit authorization decision.

- **GST/IRP Workstream B (10):** `20261118000800`–`20261118001700`, in forward order after the other GST/IRP files. Local implementation and synthetic tests only. **NOT AUTHORIZED.** No hosted apply, backfill, IRP provider or legal release is enabled by this inventory.
- **GST/IRP Priority 2 (2):** `20261118001800`–`20261118001900`, after `01700`. Each is **NOT AUTHORIZED**. Applying them alone installs neither routing data nor private worker privileges.

- **Guest-to-receipt Priority 3 (1):** `20261118002000` is local-only and **NOT AUTHORIZED** for hosted application. It must not be appended to the frozen staging upgrade bundle.
- **Privileged-function review (1):** `20261118002200` is local-only and **NOT AUTHORIZED**. It is a security correction to two already-granted RPCs; applying it cannot weaken any grant, but it still needs its own written decision per target.
- **Operational delivery Priority 4 (1):** `20261118002100` is local-only and **NOT AUTHORIZED**. Hosted application additionally requires the Realtime publication change to be reviewed on the target project; the migration refuses to alter a publication that already contains other tables.
