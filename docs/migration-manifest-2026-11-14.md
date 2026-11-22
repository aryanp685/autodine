# Production migration manifest — 2026-11-14 (all 104 files accounted for; updated 2026-11-19)

**Generated from `supabase/migrations/` on branch `arena/9b120325-autodine`;
extended 2026-11-16 on `arena/2670dd12-autodine`; extended 2026-11-19 on
`arena/bbf0f31b-autodine`.**
Purpose: nothing reaches production without appearing in this table with a
classification and the probe that confirms (or refutes) its presence. Counts:
**76 legacy-rollout-scope · 12 branch set (B1 authorized 2026-11-20 — includes 3
QR/reliability migrations now on hosted) ·
7 GST/IRP Phase B (NOT AUTHORIZED) · 1 scoped ACL revision
(`20261116000100`, pending its own authorization)** — plus three local
remediation migrations added 2026-11-19 (`20261119000100`–`20261119000300`),
plus one announcement claim-recovery (`20261119000400`), plus two QR
migrations (`20261118002200` staff boundary F-01/F-02/F-03 + `20261118002300`
owner management), three of the six branch set now on hosted (announcement
recovery + QR pair, see rows). Zero duplicate versions (checked 2026-11-14;
rechecked 2026-11-16 at 93/93 and 2026-11-19 at 104/104, rechecked 2026-11-20
post-B1 at 104/104). The release-prep document
(`docs/production-release-prep-2026-11-14.md`) binds this manifest into the
ordered release sequence.

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
| `20261118000100` | `merge_boundary_gst_order_line_edits` | PR #191 main-merge reconciliation (2026-11-16) | Re-asserts main's order-line edit boundary (owner/manager/cashier only; Kitchen 42501) on the GST replacement; NOT AUTHORIZED for hosted application by this merge |
| `20261116000100` | `revoke_client_maintain_privileges` | Scoped ACL revision — NOT AUTHORIZED (own decision; production substitute for `20261110001220`, see its probed row) | Added 2026-11-16 after production catalog probes: completes the MAINTAIN/default-ACL scope 01220 misses in the production-shaped catalog, with fail-closed post-revoke verification; sequence revokes justified by definer-only consumption (verified in source). Locally replay-tested; never applied to any hosted project |
| `20261119000100` | `restore_receipt_helper_boundary` | Local remediation — NOT AUTHORIZED for hosted application | Restores the P8 boundary loosened by `20261114000101`: revokes EXECUTE on `issue_closed_session_receipt(uuid,jsonb)` from public/anon/authenticated/service_role, so settlement continues to go through `close_order_session_and_issue_receipt`. Verified by `supabase/checks/07_p8_close_settlement.sql` in the local harness |
| `20261119000200` | `new_outlet_tax_default` | Local remediation — NOT AUTHORIZED for hosted application | Owner decision (2026-11-19): new restaurants start at `tax_rate_bps = 0` instead of the sample 500 bps; existing rows are unchanged and the owner sets a rate explicitly |
| `20261119000300` | `public_guest_gst_quote` | Local remediation — NOT AUTHORIZED for hosted application | Adds the guest-only `public_restaurant_gst(text)` projection (mode plus the closed Regular profile rate, never tenant identity) so the cart quote matches `place_public_order` in off, composition and regular modes |
| `20261118002200` | `qr_code_staff_boundary` | Branch set — P0 QR security (F-01/F-02/F-03) | **APPLIED 2026-11-20 via B1:** autodinetest `20261120190508_qr_code_staff_boundary` + autodine-production `20261120190546_qr_code_staff_boundary` — fixes F-01/F-02 via `has_restaurant_role` + `is_member`, F-03 via `table_qr_codes_one_active_per_table` + `pg_advisory_xact_lock`, heals duplicates, re-asserts RLS. Verified: index present, 4 functions present, `is_member` policy active, both projects `ACTIVE_HEALTHY`. |
| `20261118002300` | `qr_owner_management` | Branch set — QR owner management completeness | **APPLIED 2026-11-20 via B1:** autodinetest `20261120190520_qr_owner_management` + autodine-production `20261120190553_qr_owner_management` — `restore_table_qr_code` + `delete_table_safe` (archive vs delete, owner/manager only, advisory-locked). Verified: both functions present with correct grants, health green. |
| `20261119000400` | `announcement_claim_recovery` | Branch set — announcement delivery reliability (order claim stale-expiry + waiter-call poll index) | Added 2026-11-19: fixes `claim_kitchen_order_announcement` to expire stale `kitchen_announcement_claims` (>2 min) before INSERT so a crashed device does not hold the announcement forever; mirrors waiter-call API re-queue of `announcement_status='claimed'` >2 min; adds `table_waiter_calls_announcement_claimed_idx` for efficient poll. Applied to hosted autodine-production (20261119101116) and autodinetest (20261119101121). `migrations:verify` 104/104; `sql:check` DDL parses. |
| `20261121000100` | `item_allergens_jain` | Rewritten-main snapshot — menu item allergen/Jain flags | Added with the 2026-11-21 main rewrite. Hosted presence **not verified** in this cycle. |
| `20261121000200` | `upi_ref_at_mark_paid` | Rewritten-main snapshot — required UPI reference at Mark Paid | Added with the 2026-11-21 main rewrite. Its six-argument `record_counter_payment` left the five-argument overload in place (42725 "not unique"); fixed forward by `20261122000100`. Hosted presence **not verified**. |
| `20261122000100` | `single_counter_payment_function` | Fix — drop the five-argument overload and restore the session-lock and pending-online guards in the six-argument `record_counter_payment` | Forward-only; apply immediately after `20261121000200`. **Not applied** to any hosted project. |

## Owner-operation (never applied automatically — separate on purpose)

| File | Status |
|---|---|
| `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql` | **OWNER-ONLY OPERATION.** Not part of the 92. Requires the owner to run it deliberately against the chosen project; closes the `supabase_admin` default-privilege residual (baseline drift D6/D7). Not run anywhere as part of this cycle. Verify per §A2 of the closure package after the owner runs it. |

## Reading the classes

- **Legacy rollout scope (76):** everything from the repository baseline
  through `20261112000100_schedule_subscription_expiry.sql`. Production exposure
  is plausible (hand-off, 2026-11-12) but **unproven at this SHA** — this is
  exactly what A1 re-probes. Two of these carry release-critical behaviour:
  `20261109001000_operational_readiness` (health goes green) and
  `20261110000700_restaurants_member_only` (Batch B; only after app deploy).
- **Branch set (12):** the forward migrations this cycle adds on top of the
  boundary. Apply in filename order, only under B1 authorization, per release
  prep §2. `20261112000300_report_sales_export_authorization` is already applied
  on **staging only** (2026-11-15 rehearsal); production presence is unverified.
  `20261119000400_announcement_claim_recovery` + `20261118002200_qr_code_staff_boundary`
  + `20261118002300_qr_owner_management` are now on both hosted projects as of
  2026-11-20 B1 (see rows) — tracked here for 104/104 completeness.
- **GST/IRP Phase B (7):** `20261113000100` → `20261114000600` (B1–B7 in
  `docs/gst-irp-production-readiness-2026-11-14.md`). **NOT AUTHORIZED. Do not
  apply.** Note: B5 (`20261114000400_restrict_trigger_functions_execute`) is
  data-safe privilege hardening and could be authorized separately as a pure
  security item — it is listed as Phase B here because that is its dependency
  grouping in the GST analysis; it must still not be applied without an
  explicit authorization decision.
