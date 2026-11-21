# AutoDine security remediation register

**Evidence date:** 2026-11-06 UTC

**Branch:** `arena/3878e9b8-autodine`

**Release boundary:** Staging **NO-GO**; Production **read-only**; overall release **NO-GO**.

No dedicated security-remediation-register file was present in the checked-in workspace at Phase 6D start, so this register is new. It does not replace the historical audit reports. The full Phase 6D evidence and test limitations are in [`PHASE-6D-ACCOUNT-ENTITLEMENT-SECURITY.md`](PHASE-6D-ACCOUNT-ENTITLEMENT-SECURITY.md).

## Findings and actions

| ID | Priority / state | Finding | Remediation / evidence | Remaining gate |
|---|---|---|---|---|
| SEC-6D-01 | **P0 — code remediated; hosted rollout pending** | `restaurants.account_id` was mutable by authenticated owners/managers. The existing table-level `UPDATE` grant and row-scoped owner/manager policy allowed both detach-to-NULL and reassignment. Detachment could switch an expired linked restaurant into the legacy write-gate fallback; reassignment could switch entitlement and account-scoped RLS. | Added forward-only `20261112000200_immutable_restaurant_account_link.sql`, which rejects a changed account link on authenticated UPDATE without revoking ordinary restaurant UPDATE rights. A clean disposable PostgreSQL 17.11 replay reproduced both attacks before the migration, then passed 8 Phase 6D SQL-role regression tests and the combined 130-test DB suite after it. | Not applied to hosted Staging/Production. Requires independent migration review, exact hosted-schema preflight and release approval. No HTTP/PostgREST test was run. |
| SEC-6D-02 | **Open — product/security decision; standalone revoke is unsafe** | `restaurant_can_write(uuid)` returns one boolean for a public restaurant UUID and remains executable by anon; `account_can_write(uuid)` is denied to anon but directly executable by authenticated users for a supplied account id. The only direct app caller of the restaurant gate found is authenticated Kitchen, and guest RPC function-body calls run under SECURITY DEFINER. But eight active gate-bearing `FOR ALL` policies in `20261029000100_staff_invites.sql` target `PUBLIC`. | A local-only disposable PostgreSQL counterfactual after replaying all 83 migrations revoked `PUBLIC`/`anon` execute: direct anon probe and public guest menu/category/item RLS read failed with SQLSTATE `42501`; `open_table_session` and `place_public_order_attempt` succeeded. No hosted state or ACL was queried or changed. No grant/policy/test change was made. If the owner chooses to remove the direct disclosure, first scope/refactor the gate-bearing policies away from anon, then add regression coverage for public menu/add-on reads, guest session/order paths, private-table isolation and staff write gates. The authenticated direct `account_can_write(uuid)` grant remains a separate review item. | Product/security owner must decide whether to retain the boolean disclosure or authorize a reviewed forward RLS/grant/test change; no standalone revoke. |
| SEC-6D-03 | **Open — owner/product/billing decision** | A genuinely new owner workspace and its 21-day trial, slug reservation, starter menu and active restaurant can be created before email confirmation. The public exact-slug profile can expose its projection before confirmation. | Alternatives and consequences—immediate provisioning, post-confirmation provisioning, or a pre-confirmation hidden/pending workspace—are documented in the Phase 6D report. No cleanup, deletion, billing or trial-policy change was made. | Owner must choose trial start, slug reservation, visibility, retention and callback/idempotency behavior. |
| SEC-6C-01 | **Open — hosted Auth/abuse integration** | Hosted email confirmation, SMTP/from-domain/templates, redirect allowlist support, CAPTCHA and effective rate limits have not been independently verified. | Phase 6C implemented generic confirmation-pending/resend behavior and documented the unknown hosted settings. No email, provider or hosted Auth configuration was exercised in Phase 6D. | Separate hosted Auth/email/abuse verification and independent release gate. |

## Phase 6D change boundary

The new trigger protects only changes to an existing `restaurants.account_id` made by an authenticated JWT. It leaves the following unchanged:

- the owner/manager `restaurants_update` RLS policy and authenticated table-level UPDATE grant;
- ordinary settings, tax, guest verification, branding, storefront, operational, UPI, and online-payment-switch write paths;
- the `restaurants_plan_guard` legacy trial/plan protection;
- the `account_id` nullable FK, `ON DELETE SET NULL`, and `restaurant_can_write()` legacy fallback for unlinked rows;
- service-role initial-account creation, authenticated `create_outlet()`, trial claims, subscription cancellation/recovery and billing RPC behavior;
- existing public entitlement-probe grants pending a separate compatibility decision.

No transfer/linking RPC, nullable-link cleanup, account deletion policy, trial reset, or payment behavior was added.

## Validation and boundaries

- Fresh embedded PostgreSQL **17.11** replay: **77 migrations** applied locally; pre-guard attack reproduction rolled back; post-guard DB regression suite **5 files / 130 passed / 0 failed**.
- The direct-SQL tests use actual `authenticated`, `anon`, and `service_role` roles with synthetic JWT-subject claims through the local Supabase shim. They are not HTTP/PostgREST validation.
- General Vitest: **188 files passed, 5 skipped; 2,152 tests passed, 130 skipped**. Typecheck, lint, SQL-static, design checks, and the guarded optimized build passed. Skipped tests are not counted as passes; SQL-static checks are not PostgreSQL behavior evidence.
- Hosted Staging and Production were not accessed or changed. No deployment, email, payment, or destructive Git operation occurred.
