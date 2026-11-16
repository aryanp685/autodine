# Production migration manifest — 2026-11-14 (all 93 files accounted for; updated 2026-11-16)

**Generated from `supabase/migrations/` on branch `arena/9b120325-autodine`;
extended 2026-11-16 on `arena/2670dd12-autodine`.**
Purpose: nothing reaches production without appearing in this table with a
classification and the probe that confirms (or refutes) its presence. Counts:
**76 legacy-rollout-scope · 9 branch set (pending owner authorization B1) ·
7 GST/IRP Phase B (NOT AUTHORIZED) · 1 scoped ACL revision
(`20261116000100`, pending its own authorization)**. Zero duplicate versions
(checked 2026-11-14; rechecked 2026-11-16, `migrations:verify` 93/93). The
release-prep document
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
| `20261110001210` | `checkout_outstanding_guard` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | **PROBED 2026-11-16: EFFECT EQUIVALENT-PRESENT** (console variant) — both outstanding-balance guards, write-gate and grants (`authenticated` only) verified in the hosted body; wording/comment differ from repo (3216 vs 3451 chars incl. comments). **Hold out of first apply batch** pending full `pg_get_functiondef` diff so no console-only behaviour is lost |
| `20261110001220` | `revoke_client_bypass_privileges` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 | **PROBED 2026-11-16: EFFECT PARTIAL — DO NOT APPLY VERBATIM.** TRUNCATE/REFERENCES/TRIGGER already revoked on tables, but `MAINTAIN` remains for `anon`+`authenticated` on **17 tables** (D2 confirmed) and in `postgres` default ACLs; `supabase_admin` defaults untouched (owner-operation scope). Two live sequences (`restaurant_invoice_share_audit_id_seq`, `subscription_receipt_seq`) grant client USAGE/SELECT/UPDATE; source verification (2026-11-16) shows both are consumed only inside SECURITY DEFINER functions, so the sequence revoke is safe — but production should apply the scoped revision `20261116000100` (below) instead of this file, which stays in the chain for local/staging parity |
| `20261112000100` | `schedule_subscription_expiry` | Legacy rollout scope — reported applied 2026-11-12; re-probe via A1 |  |
| `20261112000200` | `immutable_restaurant_account_link` | Branch set — apply only with B1 (release prep §2) | P0 security — effect absent in prod (D1) |
| `20261112000300` | `report_sales_export_authorization` | Branch set — apply only with B1 (release prep §2) | staging-applied 2026-11-15; prod unverified |
| `20261112000400` | `bound_subscription_history` | Branch set — apply only with B1 (release prep §2) |  |
| `20261112000500` | `serialize_outlet_creation` | Branch set — apply only with B1 (release prep §2) |  |
| `20261112000600` | `serialize_subscription_payments` | Branch set — apply only with B1 (release prep §2) |  |
| `20261112000700` | `serialize_subscription_expiry` | Branch set — apply only with B1 (release prep §2) |  |
| `20261113000100` | `gst_two_mode` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000100` | `gst_b2b_einvoice_readiness` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000200` | `irp_reconciliation` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000300` | `gst_mode_gates` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000400` | `restrict_trigger_functions_execute` | GST/IRP Phase B — NOT AUTHORIZED | Phase B5 — EXECUTE revoke; independent hardening, still NOT AUTHORIZED (Phase B) |
| `20261114000500` | `credit_debit_notes` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261114000600` | `einvoice_issuance_profile` | GST/IRP Phase B — NOT AUTHORIZED |  |
| `20261115000100` | `fix_redeem_staff_invite_status_returns` | Branch set — apply only with B1 (release prep §2) | P0 auth — invite single-use fix |
| `20261115000200` | `owner_billing_configuration_guard` | Branch set — apply only with B1 (release prep §2) | P0 security — owner-only tax/GSTIN trigger (PR #181 content, renumbered) |
| `20261115000300` | `audit_restaurant_account_reassignment` | Branch set — apply only with B1 (release prep §2) | P0 security — account-reassignment audit ledger |
| `20261116000100` | `revoke_client_maintain_privileges` | Scoped ACL revision — NOT AUTHORIZED (own decision; production substitute for `20261110001220`, see its probed row) | Added 2026-11-16 after production catalog probes: completes the MAINTAIN/default-ACL scope 01220 misses in the production-shaped catalog, with fail-closed post-revoke verification; sequence revokes justified by definer-only consumption (verified in source). Locally replay-tested; never applied to any hosted project |

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
- **Branch set (9):** the forward migrations this cycle adds on top of the
  boundary. Apply in filename order, only under B1 authorization, per release
  prep §2. `20261112000300_report_sales_export_authorization` is already applied
  on **staging only** (2026-11-15 rehearsal); production presence is unverified.
- **GST/IRP Phase B (7):** `20261113000100` → `20261114000600` (B1–B7 in
  `docs/gst-irp-production-readiness-2026-11-14.md`). **NOT AUTHORIZED. Do not
  apply.** Note: B5 (`20261114000400_restrict_trigger_functions_execute`) is
  data-safe privilege hardening and could be authorized separately as a pure
  security item — it is listed as Phase B here because that is its dependency
  grouping in the GST analysis; it must still not be applied without an
  explicit authorization decision.
