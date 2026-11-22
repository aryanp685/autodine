# Migration authorization register — 130 files, 2026-11-19

**Generated file — do not edit by hand.** `npm run register:migrations`
rewrites it from `docs/migration-manifest-2026-11-14.md` and the files on
disk. A row here is repository evidence, never authorization: nothing is
applied by generating or reading it, and `NOT AUTHORIZED` means exactly that.

- Files on disk: **130**
- Manifest rows: **130**
- Ordering / uniqueness / coverage problems: **0**
- Files containing DROP/TRUNCATE/DELETE statements: **65** (inventory below)

## Per-file register

| # | Version | File | Classification | Authorization | Note |
|---|---|---|---|---|---|
| 1 | `20261019000001` | `20261019000001_init.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 2 | `20261019000002` | `20261019000002_public_read.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 3 | `20261020000004` | `20261020000004_counter_payment.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 4 | `20261021000004` | `20261021000004_missing_qr_tables.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 5 | `20261021000005` | `20261021000005_public_place_order.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 6 | `20261021000006` | `20261021000006_table_qr_verification.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 7 | `20261021000007` | `20261021000007_table_qr_provisioning.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 8 | `20261021000008` | `20261021000008_charge_for_portions.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 9 | `20261021000009` | `20261021000009_report_sales.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 10 | `20261021000010` | `20261021000010_realtime_orders.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 11 | `20261021000200` | `20261021000200_item_spoken_name.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 12 | `20261021000300` | `20261021000300_item_addons.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 13 | `20261021000400` | `20261021000400_multiple_menus.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 14 | `20261021000500` | `20261021000500_restaurant_settings.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 15 | `20261021000600` | `20261021000600_cancel_and_change_order.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 16 | `20261022000700` | `20261022000700_multi_outlet.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 17 | `20261022000800` | `20261022000800_online_payments.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 18 | `20261023000900` | `20261023000900_table_verification_code.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 19 | `20261024000900` | `20261024000900_drop_old_qr_scan.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 20 | `20261025001000` | `20261025001000_restaurant_branding.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 21 | `20261026001100` | `20261026001100_trial_plans_and_write_gate.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 22 | `20261026001200` | `20261026001200_plan_entitlements.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 23 | `20261026001300` | `20261026001300_restaurant_upi.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 24 | `20261026001400` | `20261026001400_default_accent.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 25 | `20261026001500` | `20261026001500_place_order_addon_pricing_where.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 26 | `20261027000900` | `20261027000900_idempotent_guest_orders.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 27 | `20261028000100` | `20261028000100_renew_the_king_trial.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 28 | `20261028000900` | `20261028000900_guest_scan_confirm.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 29 | `20261029000100` | `20261029000100_staff_invites.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 30 | `20261103000100` | `20261103000100_brand_studio.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 31 | `20261105000100` | `20261105000100_veg_tri_state.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 32 | `20261106000000` | `20261106000000_menu_translations.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 33 | `20261107000000` | `20261107000000_storefront_settings.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 34 | `20261107074545` | `20261107074545_order_sessions.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 35 | `20261107080000` | `20261107080000_payment_audit_ledger.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 36 | `20261107082936` | `20261107082936_session_manual_payment_p4.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 37 | `20261107104440` | `20261107104440_p5_voice_waiter.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 38 | `20261108000000` | `20261108000000_guest_rate_limits.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 39 | `20261108000200` | `20261108000200_drift_reconcile.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 40 | `20261108000300` | `20261108000300_publish_menu_snapshot.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 41 | `20261108000500` | `20261108000500_order_session_staff_read.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 42 | `20261108001000` | `20261108001000_order_code_and_kitchen_announce_guard.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 43 | `20261108002000` | `20261108002000_invoice_receipts.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 44 | `20261108003000` | `20261108003000_session_checkout_payment_receipts.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 45 | `20261108005000` | `20261108005000_p9_security_hardening.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 46 | `20261108006000` | `20261108006000_restore_public_order_session_attach.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 47 | `20261108007000` | `20261108007000_payment_recorded_by.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 48 | `20261108008000` | `20261108008000_p8_require_settlement_before_close.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 49 | `20261108009000` | `20261108009000_p9_financial_read_roles.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 50 | `20261108010000` | `20261108010000_invoice_share_links.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 51 | `20261109000100` | `20261109000100_restore_hold_fields.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 52 | `20261109000200` | `20261109000200_order_attempt_lock.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 53 | `20261109000300` | `20261109000300_payment_state_guards.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 54 | `20261109000400` | `20261109000400_order_write_boundary.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 55 | `20261109000500` | `20261109000500_session_payment_guard.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 56 | `20261109000600` | `20261109000600_finalized_source_guard.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 57 | `20261109000700` | `20261109000700_order_line_removal.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 58 | `20261109000800` | `20261109000800_table_activity_summary.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 59 | `20261109000900` | `20261109000900_staff_tts_budget.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 60 | `20261109001000` | `20261109001000_operational_readiness.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) | health gate — /api/health green |
| 61 | `20261110000100` | `20261110000100_counter_payment_lock_order.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 62 | `20261110000200` | `20261110000200_financial_session_serialization.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 63 | `20261110000300` | `20261110000300_shared_wifi_scan_limits.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 64 | `20261110000400` | `20261110000400_durable_order_attempt_budget.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 65 | `20261110000500` | `20261110000500_public_restaurant_profile.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 66 | `20261110000600` | `20261110000600_staff_finance_boundaries.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 67 | `20261110000700` | `20261110000700_restaurants_member_only.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) | Batch B — apply only after app deploy |
| 68 | `20261110000800` | `20261110000800_remove_order_submission_caps.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) | removes guest order-submission caps (AGENTS.md) |
| 69 | `20261110000851` | `20261110000851_payment_audit_provider_actor.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) | **PROBED 2026-11-16 (prod, read-only): EFFECT ABSENT** — `payment_audit_events.actor_id` still NOT NULL, no FK to `profiles`; live settlement defect persists. Apply candidate (before `20261110000950`); pre-apply orphan-`actor_id` data preflight required (file validates FK and fails closed) |
| 70 | `20261110000900` | `20261110000900_converge_qr_verification_attempts.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 71 | `20261110000950` | `20261110000950_online_payment_attempt_uniqueness.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) | **PROBED 2026-11-16: EFFECT PARTIAL** — hosted `begin/settle_online_payment` are older bodies (signatures identical; begin lacks the per-order pending guard, settle lacks the stale-balance guard; bodies 3540/2480 vs repo 4300/3427). `CREATE OR REPLACE` — no duplicate-object risk. Apply candidate after `20261110000851` (settle inserts NULL actor) |
| 72 | `20261110001000` | `20261110001000_account_subscriptions.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 73 | `20261110001100` | `20261110001100_subscription_billing.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 74 | `20261110001210` | `20261110001210_checkout_outstanding_guard.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) | **RESOLVED 2026-11-16: EFFECT PRESENT, behaviour-identical.** Full `pg_get_functiondef` diff vs the repo file: signature, `SECURITY DEFINER`, `search_path=public, pg_temp`, volatility, auth/role guards (`owner/manager/cashier`, 42501/P0002), write-gate, both outstanding-balance guards and error texts, close update and receipt call are statement-for-statement identical. Only differences: function COMMENT wording and inline body comments (no behaviour). Grants end-state identical (anon: none; authenticated + service_role: EXECUTE; the repo revoke list does not touch service_role's explicit grant). **No reconciliation migration needed; excluded from the apply batch to avoid a needless production write.** Optional ledger-parity application is owner-discretionary and changes only the comment |
| 75 | `20261110001220` | `20261110001220_revoke_client_bypass_privileges.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) | **PROBED 2026-11-16: EFFECT PARTIAL — DO NOT APPLY VERBATIM.** TRUNCATE/REFERENCES/TRIGGER already revoked on tables, but `MAINTAIN` remains for `anon`+`authenticated` on **17 tables** (D2 confirmed) and in `postgres` default ACLs; `supabase_admin` defaults untouched (owner-operation scope). Two live sequences (`restaurant_invoice_share_audit_id_seq`, `subscription_receipt_seq`) grant client USAGE/SELECT/UPDATE; source verification (2026-11-16) shows both are consumed only inside SECURITY DEFINER functions, so the sequence revoke is safe — but production should apply the scoped revision `20261116000100` (below) instead of this file, which stays in the chain for local/staging parity |
| 76 | `20261112000100` | `20261112000100_schedule_subscription_expiry.sql` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | Reported applied historically; re-probe required (no new authorization) |  |
| 77 | `20261112000200` | `20261112000200_immutable_restaurant_account_link.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 | P0 security — effect absent in prod (D1) |
| 78 | `20261112000300` | `20261112000300_report_sales_export_authorization.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 | staging-applied 2026-11-15; prod unverified |
| 79 | `20261112000400` | `20261112000400_bound_subscription_history.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 |  |
| 80 | `20261112000500` | `20261112000500_role_scoped_order_reads.sql` | main (PR #191 main-merge reconciliation, 2026-11-16) — staff-access boundary | Per manifest — no new authorization in P6 | NOT AUTHORIZED for hosted application by this merge; arrived via main merge |
| 81 | `20261112000501` | `20261112000501_serialize_outlet_creation.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 |  |
| 82 | `20261112000600` | `20261112000600_cap_subscription_history_ceiling.sql` | main (PR #191 main-merge reconciliation, 2026-11-16) — subscription boundary | Per manifest — no new authorization in P6 | NOT AUTHORIZED for hosted application by this merge; arrived via main merge |
| 83 | `20261112000601` | `20261112000601_serialize_subscription_payments.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 |  |
| 84 | `20261112000700` | `20261112000700_order_line_edit_boundary.sql` | main (PR #191 main-merge reconciliation, 2026-11-16) — order-line boundary | Per manifest — no new authorization in P6 | NOT AUTHORIZED for hosted application by this merge; arrived via main merge |
| 85 | `20261112000701` | `20261112000701_serialize_subscription_expiry.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 |  |
| 86 | `20261113000100` | `20261113000100_gst_two_mode.sql` | GST/IRP Phase B — NOT AUTHORIZED | NOT AUTHORIZED |  |
| 87 | `20261114000100` | `20261114000100_owner_manager_subscription_reads.sql` | main (PR #191 main-merge reconciliation, 2026-11-16) — subscription boundary | Per manifest — no new authorization in P6 | NOT AUTHORIZED for hosted application by this merge; arrived via main merge |
| 88 | `20261114000101` | `20261114000101_gst_b2b_einvoice_readiness.sql` | GST/IRP Phase B — NOT AUTHORIZED | NOT AUTHORIZED |  |
| 89 | `20261114000200` | `20261114000200_irp_reconciliation.sql` | GST/IRP Phase B — NOT AUTHORIZED | NOT AUTHORIZED |  |
| 90 | `20261114000300` | `20261114000300_gst_mode_gates.sql` | GST/IRP Phase B — NOT AUTHORIZED | NOT AUTHORIZED |  |
| 91 | `20261114000400` | `20261114000400_restrict_trigger_functions_execute.sql` | GST/IRP Phase B — NOT AUTHORIZED | NOT AUTHORIZED | Phase B5 — EXECUTE revoke; independent hardening, still NOT AUTHORIZED (Phase B) |
| 92 | `20261114000500` | `20261114000500_credit_debit_notes.sql` | GST/IRP Phase B — NOT AUTHORIZED | NOT AUTHORIZED |  |
| 93 | `20261114000600` | `20261114000600_einvoice_issuance_profile.sql` | GST/IRP Phase B — NOT AUTHORIZED | NOT AUTHORIZED |  |
| 94 | `20261115000100` | `20261115000100_fix_redeem_staff_invite_status_returns.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 | P0 auth — invite single-use fix |
| 95 | `20261115000200` | `20261115000200_owner_billing_configuration_guard.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 | P0 security — owner-only tax/GSTIN trigger (PR #181 content, renumbered) |
| 96 | `20261115000300` | `20261115000300_audit_restaurant_account_reassignment.sql` | Branch set — apply only with B1 (release prep §2) | Per manifest — no new authorization in P6 | P0 security — account-reassignment audit ledger |
| 97 | `20261116000100` | `20261116000100_revoke_client_maintain_privileges.sql` | Scoped ACL revision — NOT AUTHORIZED (own decision; production substitute for `20261110001220`, see its probed row) | NOT AUTHORIZED | Added 2026-11-16 after production catalog probes: completes the MAINTAIN/default-ACL scope 01220 misses in the production-shaped catalog, with fail-closed post-revoke verification; sequence revokes justified by definer-only consumption (verified in source). Locally replay-tested; never applied to any hosted project |
| 98 | `20261118000100` | `20261118000100_merge_boundary_gst_order_line_edits.sql` | GST/IRP Phase B dependency — NOT AUTHORIZED | NOT AUTHORIZED | PR #191 main-merge reconciliation (2026-11-16). Re-asserts main's order-line edit boundary (owner/manager/cashier only; Kitchen 42501) on the GST replacement; NOT AUTHORIZED for hosted application by this merge |
| 99 | `20261118000200` | `20261118000200_gst_configuration_boundary.sql` | GST/IRP Phase B follow-up — NOT AUTHORIZED | NOT AUTHORIZED | Owner/write/version checks, role-scoped registration/history, account consistency and Composition admission |
| 100 | `20261118000300` | `20261118000300_gst_pricing_boundary.sql` | GST/IRP Phase B follow-up — NOT AUTHORIZED | NOT AUTHORIZED | Minimal public quote, private pricing, ticket mode/rate/version and immutable classification on new lines |
| 101 | `20261118000400` | `20261118000400_gst_document_integrity.sql` | GST/IRP Phase B follow-up — NOT AUTHORIZED | NOT AUTHORIZED | Validates source and settlement, document rounding, correction guards and IRN sharing hold |
| 102 | `20261118000500` | `20261118000500_gst_document_report.sql` | GST/IRP Phase B follow-up — NOT AUTHORIZED | NOT AUTHORIZED | Owner/manager aggregates from immutable document amounts; not cash or a GST return |
| 103 | `20261118000600` | `20261118000600_gst_ca_onboarding.sql` | GST/IRP Phase B follow-up — NOT AUTHORIZED | NOT AUTHORIZED | Two-mode onboarding, FSSAI, business/SAC and qualifying hotel evidence, legacy preservation and zero-tax reviewed retail pricing |
| 104 | `20261118000700` | `20261118000700_gst_ca_documents.sql` | GST/IRP Phase B follow-up — NOT AUTHORIZED | NOT AUTHORIZED | Immutable identity and SAC, independent India FY series, and billing document aggregates (including retail) |
| 105 | `20261118000800` | `20261118000800_gst_outlet_activation.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Explicit outlet activation, audit and shared-registration series reservations |
| 106 | `20261118000900` | `20261118000900_gst_recipient_documents.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Recipient profiles, immutable snapshots, series and issue-time IRP hold |
| 107 | `20261118001000` | `20261118001000_gst_irp_readiness.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Local INV-01 validation evidence only; no dispatch or legal IRN transition |
| 108 | `20261118001100` | `20261118001100_gst_reconciliation.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Outlet-scoped internal GST document and payment reconciliation |
| 109 | `20261118001200` | `20261118001200_gst_review_lifecycle.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Private versioned deferral; hotel FY review and declaration windows |
| 110 | `20261118001300` | `20261118001300_gst_direct_fulfilment.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Authenticated same-state direct tickets, protected destination and settlement/issue guards |
| 111 | `20261118001400` | `20261118001400_gst_irp_rehearsal_store.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Private synthetic generation CAS and events; in-flight local void guard; no release |
| 112 | `20261118001500` | `20261118001500_gst_finance_scope.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Versioned selected/account ledger with independent payment and document lifecycle evidence |
| 113 | `20261118001600` | `20261118001600_gst_document_particulars.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Reviewed Composition SAC and original note particulars; shared PAN review readers; no backfill |
| 114 | `20261118001700` | `20261118001700_gst_irp_rehearsal_recovery.sql` | GST/IRP Workstream B — NOT AUTHORIZED | NOT AUTHORIZED | Private restart read and conditional generation CAS evidence; durable dispatch age; no artifact promotion |
| 115 | `20261118001800` | `20261118001800_irp_execution.sql` | GST/IRP Priority 2 — NOT AUTHORIZED | NOT AUTHORIZED | Dispatch sidecar, pinned simulation routing, lease/CAS, recovery and cancellation history. No routes or worker grants installed. |
| 116 | `20261118001900` | `20261118001900_irp_document_projection.sql` | GST/IRP Priority 2 — NOT AUTHORIZED | NOT AUTHORIZED | Scoped operational projections and inactive authority-only private-copy boundary. Depends on `01800`. |
| 117 | `20261118002000` | `20261118002000_guest_checkout_integrity.sql` | Guest-to-receipt Priority 3 — NOT AUTHORIZED | NOT AUTHORIZED | Same-table replay and atomic whole-basket validation; no change to GST/IRP, amounts, discount policy or payment grants. |
| 118 | `20261118002100` | `20261118002100_operational_realtime.sql` | Operational delivery Priority 4 — NOT AUTHORIZED | NOT AUTHORIZED | Adds the `waiter` membership role, membership-scoped floor projections, a coalesced metadata-only outlet revision and publication, sitting transfer, waiter acknowledgement and a guest-version edit cursor. No order amounts, GST/IRP, payment grants or hosted routing are changed by it. |
| 119 | `20261118002200` | `20261118002200_qr_code_staff_boundary.sql` | Privileged-function review — NOT AUTHORIZED | NOT AUTHORIZED | Adds the owner/manager membership check to `rotate_table_qr_code`/`retire_table_qr_code` before they touch `table_qr_codes` (findings QR-01/QR-02). Signature, return type, grants and the subscription gate unchanged; no table, policy or data change. |
| 120 | `20261118002300` | `20261118002300_qr_owner_management.sql` | Ported from `main` (3b1ca5b) so both lineages share one inventory — NOT AUTHORIZED | NOT AUTHORIZED | Owner-side QR management on top of the membership boundary: rotate/retire through the staff RPCs with an owner gate, and the `table_qr_codes` write policy narrowed to the owning restaurant. |
| 121 | `20261119000100` | `20261119000100_restore_receipt_helper_boundary.sql` | Main-inherited security correction — NOT AUTHORIZED | NOT AUTHORIZED | Revokes `EXECUTE` on `issue_closed_session_receipt(uuid, jsonb)` from `public`, `anon`, `authenticated` and `service_role`. `20261114000101` granted it to `authenticated`, which let a signed-in client issue a document for an already-closed sitting and skip the settlement wrapper's outstanding-balance check (local check `supabase/checks/07_p8_close_settlement.sql` fails without it). Forward-only; no data, policy or signature change. |
| 122 | `20261119000200` | `20261119000200_new_outlet_tax_default.sql` | Ported from `main` (3b1ca5b) so both lineages share one inventory — NOT AUTHORIZED | NOT AUTHORIZED | A new outlet starts with the account’s tax mode rather than an empty one, so the first bill cannot be issued without a tax decision. |
| 123 | `20261119000300` | `20261119000300_public_guest_gst_quote.sql` | Ported from `main` (3b1ca5b) so both lineages share one inventory — NOT AUTHORIZED | NOT AUTHORIZED | Guest-facing GST quote RPC: the storefront shows the same tax split the invoice will carry, computed in SQL from the restaurant’s mode. |
| 124 | `20261119000400` | `20261119000400_announcement_claim_recovery.sql` | Ported from `main` (3b1ca5b) so both lineages share one inventory — NOT AUTHORIZED; supersedes the locally-authored `20261122000100` | NOT AUTHORIZED | `claim_kitchen_order_announcement(uuid)` expires a claim older than two minutes before inserting, so a crashed device no longer holds an order announcement forever. This is `main`’s repository file for the hosted correction (`20261119101116`), so the locally-authored duplicate was removed. |
| 125 | `20261121000100` | `20261121000100_item_allergens_jain.sql` | Ported from `main` (3b1ca5b) so both lineages share one inventory — NOT AUTHORIZED | NOT AUTHORIZED | Additive menu metadata: allergen list and a Jain flag per item, surfaced on the guest menu only when set. |
| 126 | `20261121000200` | `20261121000200_upi_ref_at_mark_paid.sql` | Ported from `main` (3b1ca5b) so both lineages share one inventory — NOT AUTHORIZED | NOT AUTHORIZED | Adds `payments.upi_ref` and requires it when a counter payment is recorded with method `upi` — a UPI settlement with no TRN cannot be reconciled. Cash and card stay nullable. |
| 127 | `20261122000100` | `20261122000100_single_counter_payment_function.sql` | Ported from `main` (3b1ca5b) so both lineages share one inventory — NOT AUTHORIZED | NOT AUTHORIZED | Drops the superseded five-argument `record_counter_payment` and defines the six-argument one with `p_upi_ref default null`, so five- and six-argument calls both resolve. Without it every `unknown`-typed PostgREST call fails with 42725 "function is not unique". |
| 128 | `20261122000200` | `20261122000200_announcement_claim_and_table_delete_fixes.sql` | Ported from `main` (3b1ca5b) so both lineages share one inventory — NOT AUTHORIZED | NOT AUTHORIZED | Announcement claim and table-delete corrections: the table delete path releases live QR cards first, and the claim RPCs return a typed result instead of null. |
| 129 | `20261122000400` | `20261122000400_qr_one_active_cleanup.sql` | Hosted correction brought into the repository — NOT AUTHORIZED | NOT AUTHORIZED | Collapses duplicate live cards (keeping the newest) so the unique index can be created on a database that drifted. A separate file from the index on purpose: the UPDATE fires `revoke_sessions_on_qr_revocation`, which leaves pending trigger events until commit, and PostgreSQL refuses `CREATE INDEX` on such a table (55006) — the whole-chain replay in `scripts/verify-database.mjs` failed exactly there on 2026-11-21. |
| 130 | `20261122000500` | `20261122000500_qr_one_active_per_table.sql` | Hosted correction brought into the repository — NOT AUTHORIZED | NOT AUTHORIZED | `20261118002200` added the QR membership gates but no database invariant. Creates `table_qr_codes_one_active_per_table` (unique partial index, `table_id` where `revoked_at is null`) and re-creates rotate/retire with `pg_advisory_xact_lock(hashtext(table_id))` in addition to the row lock. Ported from production `20261120190546` and candidate `20261120190508`. Newer than every hosted ledger row, so a push ends on these bodies. |

## Destructive or broad statements (review list, not authorization)

Every `DROP` below is either a forward replacement of a function, policy,
trigger or constraint the same file recreates, or a drop guarded by
`if exists`; the reviewer still needs to read each one for the target.
`TRUNCATE` appears only on session temporary `tt_*` tables inside trigger
helpers, and each `delete from public.<table>` is scoped by a predicate
(one order, one membership, expired rate-limit windows, one QR attempt key,
or one menu snapshot); the deletion lines are listed so a reviewer can
confirm that rather than trust it.

### `20261019000002_public_read.sql`
- `drop policy if exists restaurants_public on public.restaurants`
- `drop policy if exists menus_public on public.menus`
- `drop policy if exists items_public on public.items`

### `20261021000004_missing_qr_tables.sql`
- `drop policy if exists table_qr_codes_staff_select on public.table_qr_codes`

### `20261021000006_table_qr_verification.sql`
- `drop function if exists public.place_public_order(text, jsonb, text)`

### `20261021000007_table_qr_provisioning.sql`
- `drop trigger if exists trg_dining_tables_ensure_qr on public.dining_tables`

### `20261021000009_report_sales.sql`
- `truncate the moment a -- list got too long. Aggregating in the database is one round trip, integer -- arithmetic throughout, and there is no row limit to quietly lose money from. -- -- TWO DEFINITIONS THAT MUST NOT BE MIXED UP -- -- billed `

### `20261021000200_item_spoken_name.sql`
- `drop constraint if exists items_spoken_name_length`

### `20261021000300_item_addons.sql`
- `drop trigger if exists order_items_reject_unpriced_addons on public.order_items`
- `drop function if exists public.reject_unpriced_order_addons`
- `truncate tt_order_lines`
- `truncate tt_line_addons`

### `20261021000400_multiple_menus.sql`
- `truncate tt_order_lines`
- `truncate tt_line_addons`

### `20261021000500_restaurant_settings.sql`
- `drop policy if exists restaurants_update on public.restaurants`

### `20261021000600_cancel_and_change_order.sql`
- `delete from public.order_items i where i.order_id = v_order.id and i.qty <= 0`

### `20261023000900_table_verification_code.sql`
- `drop policy if exists table_qr_codes_staff_read on public.table_qr_codes`

### `20261024000900_drop_old_qr_scan.sql`
- `drop function if exists public.verify_table_qr(text, text)`

### `20261025001000_restaurant_branding.sql`
- `drop constraint if exists restaurants_accent_check`
- `drop constraint if exists restaurants_branding_path_check`
- `drop policy if exists "restaurant assets are publicly readable" on storage.objects`
- `drop policy if exists "managers upload their own restaurant assets" on storage.objects`
- `drop policy if exists "managers replace their own restaurant assets" on storage.objects`
- `drop policy if exists "managers delete their own restaurant assets" on storage.objects`

### `20261026001100_trial_plans_and_write_gate.sql`
- `drop constraint if exists restaurants_plan_check`
- `drop constraint if exists restaurants_plan_status_check`
- `drop trigger if exists restaurants_plan_guard on public.restaurants`
- `drop policy if exists orders_staff_update on public.orders`
- `drop policy if exists orders_staff_insert on public.orders`

### `20261026001300_restaurant_upi.sql`
- `drop constraint if exists restaurants_upi_id_check`

### `20261026001500_place_order_addon_pricing_where.sql`
- `truncate tt_order_lines`
- `truncate tt_line_addons`

### `20261029000100_staff_invites.sql`
- `drop policy if exists restaurant_invites_read on public.restaurant_invites`
- `drop policy if exists menus_staff on public.menus`
- `drop policy if exists menus_staff_read on public.menus`
- `drop policy if exists menus_staff_insert on public.menus`
- `drop policy if exists menus_staff_update on public.menus`
- `drop policy if exists menus_staff_delete on public.menus`
- `drop policy if exists menus_member_read on public.menus`
- `drop policy if exists menus_manage on public.menus`
- `drop policy if exists categories_staff on public.categories`
- `drop policy if exists categories_staff_read on public.categories`
- `drop policy if exists categories_staff_insert on public.categories`
- `drop policy if exists categories_staff_update on public.categories`
- `drop policy if exists categories_staff_delete on public.categories`
- `drop policy if exists categories_member_read on public.categories`
- `drop policy if exists categories_manage on public.categories`
- `drop policy if exists items_staff on public.items`
- `drop policy if exists items_staff_read on public.items`
- `drop policy if exists items_staff_insert on public.items`
- `drop policy if exists items_staff_update on public.items`
- `drop policy if exists items_staff_delete on public.items`
- `drop policy if exists items_member_read on public.items`
- `drop policy if exists items_manage on public.items`
- `drop policy if exists variants_staff on public.item_variants`
- `drop policy if exists variants_staff_read on public.item_variants`
- `drop policy if exists variants_staff_insert on public.item_variants`
- `drop policy if exists variants_staff_update on public.item_variants`
- `drop policy if exists variants_staff_delete on public.item_variants`
- `drop policy if exists variants_member_read on public.item_variants`
- `drop policy if exists variants_manage on public.item_variants`
- `drop policy if exists addon_groups_staff on public.item_addon_groups`
- `drop policy if exists addon_groups_member_read on public.item_addon_groups`
- `drop policy if exists addon_groups_manage on public.item_addon_groups`
- `drop policy if exists addons_staff on public.item_addons`
- `drop policy if exists addons_member_read on public.item_addons`
- `drop policy if exists addons_manage on public.item_addons`
- `drop policy if exists tables_staff on public.dining_tables`
- `drop policy if exists tables_staff_read on public.dining_tables`
- `drop policy if exists tables_staff_insert on public.dining_tables`
- `drop policy if exists tables_staff_update on public.dining_tables`
- `drop policy if exists tables_staff_delete on public.dining_tables`
- … 13 more

### `20261103000100_brand_studio.sql`
- `drop policy if exists "managers read their own brand sources" on storage.objects`
- `drop policy if exists "managers upload their own brand sources" on storage.objects`
- `drop policy if exists "managers replace their own brand sources" on storage.objects`
- `drop policy if exists "managers delete their own brand sources" on storage.objects`
- `drop policy if exists brand_assets_member_read on public.restaurant_brand_assets`
- `drop policy if exists brand_assets_manage on public.restaurant_brand_assets`
- `drop policy if exists brand_profiles_member_read on public.restaurant_brand_profiles`
- `drop policy if exists brand_profiles_manage on public.restaurant_brand_profiles`
- `drop policy if exists brand_profiles_delete_draft on public.restaurant_brand_profiles`
- `drop policy if exists publish_history_member_read on public.restaurant_publish_history`
- `drop policy if exists publish_history_append on public.restaurant_publish_history`

### `20261105000100_veg_tri_state.sql`
- `truncate tt_order_lines`
- `truncate tt_line_addons`

### `20261107000000_storefront_settings.sql`
- `drop constraint if exists restaurants_announcement_text_len`

### `20261107080000_payment_audit_ledger.sql`
- `drop policy if exists payment_audit_events_staff_read on public.payment_audit_events`

### `20261107082936_session_manual_payment_p4.sql`
- `drop constraint if exists payments_method_check`
- `drop constraint if exists payment_audit_events_method_check`
- `drop constraint if exists payment_audit_events_event_type_check`

### `20261107104440_p5_voice_waiter.sql`
- `drop constraint if exists orders_kitchen_announcement_status_check`

### `20261108000000_guest_rate_limits.sql`
- `drop function if exists public.place_public_order(text, jsonb, text, text, uuid)`
- `delete from public.rate_limit_hits where window_started_at < statement_timestamp() - interval '1 day' returning 1 ), bumped as ( insert into public.rate_limit_hits as h (key, window_started_at, count) values (p_key, statement_timestamp(), 1`

### `20261108000200_drift_reconcile.sql`
- `delete from public.qr_verification_attempts where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash`

### `20261108000300_publish_menu_snapshot.sql`
- `delete from public.item_addons where group_id = any(v_group_ids)`
- `delete from public.item_addon_groups where item_id = any(v_item_ids)`
- `delete from public.item_variants where item_id = any(v_item_ids)`
- `delete from public.items where category_id = any(v_cat_ids)`
- `delete from public.categories where menu_id = v_menu_id`

### `20261108003000_session_checkout_payment_receipts.sql`
- `drop trigger if exists payments_stamp_recorded_at on public.payments`
- `drop trigger if exists payments_issue_invoice_receipt on public.payments`

### `20261108005000_p9_security_hardening.sql`
- `drop trigger if exists staff_security_audit_log_immutable on public.staff_security_audit_log`
- `drop trigger if exists restaurant_invites_security_audit on public.restaurant_invites`
- `drop trigger if exists memberships_security_audit on public.memberships`

### `20261108009000_p9_financial_read_roles.sql`
- `drop policy if exists restaurant_invoices_staff_read on public.restaurant_invoices`
- `drop policy if exists restaurant_invoice_lines_staff_read on public.restaurant_invoice_lines`
- `drop policy if exists restaurant_payment_receipts_staff_read on public.restaurant_payment_receipts`

### `20261109000300_payment_state_guards.sql`
- `delete from public.order_items i where i.order_id = v_order.id and i.qty <= 0`

### `20261109000400_order_write_boundary.sql`
- `drop policy if exists orders_staff_insert on public.orders`
- `drop policy if exists order_items_insert on public.order_items`
- `drop trigger if exists orders_guard_direct_progress on public.orders`

### `20261109000700_order_line_removal.sql`
- `delete from public.order_items i using jsonb_array_elements(p_lines) e where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int = 0`

### `20261110000200_financial_session_serialization.sql`
- `delete from public.order_items i using jsonb_array_elements(p_lines) e where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int = 0`

### `20261110000600_staff_finance_boundaries.sql`
- `drop policy if exists payment_audit_events_staff_read on public.payment_audit_events`
- `drop policy if exists payment_audit_events_finance_read on public.payment_audit_events`
- `drop policy if exists orders_staff_update on public.orders`

### `20261110000700_restaurants_member_only.sql`
- `drop policy if exists restaurants_public on public.restaurants`

### `20261110000800_remove_order_submission_caps.sql`
- `delete from public.rate_limit_hits where key like 'po:s:%' or key like 'po:t:%' or key like 'po:i:%' or key like 'po:attempt:s:%' or key like 'po:attempt:t:%'`

### `20261110000900_converge_qr_verification_attempts.sql`
- `delete from public.qr_verification_attempts where qr_code_id = p_qr_code_id and ip_hash = p_ip_hash`
- `delete from public.qr_verification_attempt_budgets where qr_code_id = $1 and ip_hash = $2' using p_qr_code_id, p_ip_hash`

### `20261110001000_account_subscriptions.sql`
- `drop policy if exists accounts_read on public.accounts`
- `drop trigger if exists accounts_plan_guard on public.accounts`

### `20261110001100_subscription_billing.sql`
- `drop constraint if exists accounts_plan_status_check`
- `drop policy if exists subscription_payments_member_read on public.subscription_payments`
- `drop policy if exists subscription_receipts_member_read on public.subscription_receipts`
- `drop policy if exists subscription_events_member_read on public.subscription_events`
- `drop trigger if exists subscription_payments_append_only on public.subscription_payments`
- `drop trigger if exists subscription_receipts_append_only on public.subscription_receipts`
- `drop trigger if exists billing_webhook_events_evidence on public.billing_webhook_events`
- `drop trigger if exists accounts_plan_guard on public.accounts`

### `20261110001220_revoke_client_bypass_privileges.sql`
- `TRUNCATE. REFERENCES and TRIGGER are not needed by -- browser-facing roles, and PostgreSQL 17's MAINTAIN is maintenance authority, -- not an application permission. Keep those privileges off client roles. -- -- The ordinary table DML/SELECT`
- `truncate, references, trigger on table %s from public, anon, authenticated', v_relation )`
- `truncate, references, trigger on tables from public, anon, authenticated'`

### `20261112000200_immutable_restaurant_account_link.sql`
- `drop trigger if exists restaurants_account_id_immutable on public.restaurants`

### `20261112000500_role_scoped_order_reads.sql`
- `drop table public.%I', v_table)`

### `20261112000700_order_line_edit_boundary.sql`
- `delete from public.order_items i using jsonb_array_elements(p_lines) e where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int = 0`

### `20261113000100_gst_two_mode.sql`
- `drop trigger if exists restaurant_gst_config_validate on public.restaurant_gst_config`
- `drop trigger if exists restaurant_gst_config_version on public.restaurant_gst_config`
- `drop trigger if exists restaurant_gst_config_history_track on public.restaurant_gst_config`
- `drop policy if exists restaurant_gst_config_staff_read on public.restaurant_gst_config`
- `drop policy if exists restaurant_gst_config_history_staff_read on public.restaurant_gst_config_history`
- `drop policy if exists restaurant_gst_config_owner_manager_write on public.restaurant_gst_config`
- `drop policy if exists restaurant_gst_config_owner_manager_update on public.restaurant_gst_config`
- `drop constraint if exists orders_math_check`
- `drop constraint if exists restaurant_invoices_document_type_check`
- `drop trigger if exists restaurant_invoices_immutable on public.restaurant_invoices`
- `drop trigger if exists restaurant_invoice_lines_immutable on public.restaurant_invoice_lines`
- `truncate tt_order_lines`
- `truncate tt_line_addons`
- `delete from public.order_items i using jsonb_array_elements(p_lines) e where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int = 0`

### `20261114000100_owner_manager_subscription_reads.sql`
- `drop policy if exists accounts_read on public.accounts`
- `drop policy if exists accounts_owner_manager_read on public.accounts`
- `drop policy if exists subscription_payments_member_read on public.subscription_payments`
- `drop policy if exists subscription_payments_owner_manager_read on public.subscription_payments`
- `drop policy if exists subscription_receipts_member_read on public.subscription_receipts`
- `drop policy if exists subscription_receipts_owner_manager_read on public.subscription_receipts`
- `drop policy if exists subscription_events_member_read on public.subscription_events`
- `drop policy if exists subscription_events_owner_manager_read on public.subscription_events`

### `20261114000101_gst_b2b_einvoice_readiness.sql`
- `drop constraint if exists restaurant_invoices_recipient_gstin_format`
- `drop constraint if exists restaurant_invoices_recipient_state_matches_gstin`
- `drop constraint if exists restaurant_invoices_recipient_email_plausible`
- `drop constraint if exists restaurant_invoices_recipient_requires_name`
- `drop policy if exists restaurant_irp_requests_staff_read on public.restaurant_irp_requests`
- `drop trigger if exists restaurant_gst_config_shared_identity on public.restaurant_gst_config`
- `drop function if exists public.issue_closed_session_receipt(uuid)`
- `drop function if exists public.close_order_session_and_issue_receipt(uuid)`

### `20261114000300_gst_mode_gates.sql`
- `drop trigger if exists restaurant_gst_config_no_alcohol on public.restaurant_gst_config`
- `drop trigger if exists items_no_alcohol_under_composition on public.items`

### `20261114000500_credit_debit_notes.sql`
- `drop constraint if exists restaurant_irp_requests_one_document`
- `drop policy if exists restaurant_notes_staff_read on public.restaurant_notes`
- `drop policy if exists restaurant_note_events_staff_read on public.restaurant_note_events`
- `drop trigger if exists restaurant_notes_immutable on public.restaurant_notes`
- `drop trigger if exists restaurant_note_events_no_rewrite on public.restaurant_note_events`

### `20261114000600_einvoice_issuance_profile.sql`
- `drop constraint if exists restaurant_gst_config_einvoice_location`
- `drop constraint if exists restaurant_gst_config_einvoice_pincode`
- `drop constraint if exists restaurant_gst_config_einvoice_hsn_sac`

### `20261115000200_owner_billing_configuration_guard.sql`
- `drop trigger if exists restaurants_billing_configuration_guard on public.restaurants`

### `20261115000300_audit_restaurant_account_reassignment.sql`
- `drop policy if exists restaurant_account_link_audit_support_select on public.restaurant_account_link_audit`
- `drop trigger if exists restaurant_account_link_audit_no_rewrite on public.restaurant_account_link_audit`
- `drop trigger if exists restaurants_account_id_immutable on public.restaurants`

### `20261116000100_revoke_client_maintain_privileges.sql`
- `TRUNCATE/REFERENCES/TRIGGER are already revoked on tables, -- but MAINTAIN (PostgreSQL 17) is still granted to anon and authenticated on -- 17 postgres-owned public tables, and the postgres default ACLs still grant -- MAINTAIN on future tab`
- `truncate, references, trigger on table %s from public, anon, authenticated', v_relation )`
- `truncate, references, trigger on tables from public, anon, authenticated'`
- `TRUNCATE/REFERENCES/TRIGGER may remain -- on any public table owned by this role after the revokes above. select count(*) into v_remaining from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace cross join latera`

### `20261118000100_merge_boundary_gst_order_line_edits.sql`
- `delete from public.order_items i using jsonb_array_elements(p_lines) e where i.id = (e->>'line_id')::uuid and i.order_id = v_order.id and (e->>'qty')::int = 0`

### `20261118000200_gst_configuration_boundary.sql`
- `drop trigger restaurant_gst_config_no_alcohol on public.restaurant_gst_config`
- `drop trigger items_no_alcohol_under_composition on public.items`
- `drop policy restaurant_gst_config_owner_manager_write on public.restaurant_gst_config`
- `drop policy restaurant_gst_config_owner_manager_update on public.restaurant_gst_config`
- `drop policy restaurant_gst_config_history_staff_read on public.restaurant_gst_config_history`
- `drop policy restaurant_gst_config_staff_read on public.restaurant_gst_config`

### `20261118000400_gst_document_integrity.sql`
- `drop policy restaurant_notes_staff_read on public.restaurant_notes`
- `drop policy restaurant_note_events_staff_read on public.restaurant_note_events`
- `drop policy restaurant_irp_requests_staff_read on public.restaurant_irp_requests`

### `20261118000600_gst_ca_onboarding.sql`
- `drop constraint restaurant_gst_config_registration_type_check`
- `truncate tt_order_lines`
- `truncate tt_line_addons`

### `20261118000700_gst_ca_documents.sql`
- `drop constraint restaurant_invoice_series_pkey`
- `drop constraint restaurant_invoices_sequence_unique`
- `drop constraint restaurant_invoices_format_check`
- `drop function public.report_gst_documents(uuid, timestamptz, timestamptz)`

### `20261118000900_gst_recipient_documents.sql`
- `drop constraint restaurant_invoices_format_check`
- `drop constraint restaurant_notes_format_check`

### `20261118002100_operational_realtime.sql`
- `drop policy order_sessions_staff on public.order_sessions`

### `20261118002200_qr_code_staff_boundary.sql`
- `drop policy if exists table_qr_codes_staff_select on public.table_qr_codes`

### `20261118002300_qr_owner_management.sql`
- `delete from public.dining_tables where id = p_table_id`

### `20261119000400_announcement_claim_recovery.sql`
- `delete from public.kitchen_announcement_claims where order_id = p_order_id and claimed_at < statement_timestamp() - interval '2 minutes'`

### `20261122000100_single_counter_payment_function.sql`
- `drop function if exists public.record_counter_payment(text, uuid, text, bigint, uuid)`

### `20261122000200_announcement_claim_and_table_delete_fixes.sql`
- `delete from public.dining_tables where id = p_table_id`
- `delete from public.kitchen_announcement_claims where order_id = p_order_id and claimed_at < statement_timestamp() - interval '2 minutes' and not exists ( select 1 from public.orders o where o.id = p_order_id and o.kitchen_announcement_statu`

### `20261122000500_qr_one_active_per_table.sql`
- `drop policy if exists table_qr_codes_staff_select on public.table_qr_codes`

## Authorization rules

- The 26 GST/IRP files, `20261118002000` and `20261118002100` each need a
  separate written decision naming the file and the exact target.
- `20261118002100` additionally changes the `supabase_realtime` publication
  and refuses to run if that publication carries other tables.
- No hosted migration has been applied from this branch, and this register
  does not authorize one.
