# Phase 6D — Account-entitlement link security

**Evidence date:** 2026-11-06 UTC

**Branch / base:** `arena/3878e9b8-autodine` / `e13720652440fc69280caa09e2e60bc151288426`

**Disposition:** the P0 source finding is reproduced against the pre-fix schema and remediated by a forward-only local migration; disposable PostgreSQL security and regression tests pass. The migration has **not** been applied to hosted Staging or Production. Staging remains **NO-GO**, Production **read-only**, and release **NO-GO** pending the independent release gates.

## 1. Scope and operating boundary

Phase 6D reconstructed the restaurant-to-account authorization path, inventoried the existing restaurant update surface, audited the account/trial gate and its callers, and added the smallest targeted forward fix. It does not add account transfers, unlinking, signup cleanup, deletion, a new billing policy, or a non-null requirement for `restaurants.account_id`.

All database work used the repository's fresh disposable embedded PostgreSQL harness with synthetic users, restaurants, accounts and menu data. No hosted Supabase connection, secret, Staging/Production query or mutation, migration deployment, email, payment, or Vercel deployment was attempted. The embedded cluster was PostgreSQL **17.11** and was destroyed by the harness after each run.

## 2. Root cause — exact authorization and data flow

### 2.1 How the client gained the write

The relevant source history is:

| Migration | Effective behavior relevant to this finding |
|---|---|
| `20261019000001_init.sql` | Creates `public.restaurants` with RLS and initial member-scoped policies. |
| `20261021000500_restaurant_settings.sql` | Replaces the restaurant update policy. `USING` and `WITH CHECK` both require the restaurant id to be in the caller's membership-derived ids and `can_manage_restaurant(id)` (owner or manager). It then grants **table-level** `UPDATE ON public.restaurants TO authenticated`. The comments explicitly preserve settings edits after a trial ends. |
| `20261026001100_trial_plans_and_write_gate.sql` | Adds the legacy per-restaurant plan/trial columns and `restaurants_plan_guard`. For an authenticated JWT, that trigger restores `trial_started_at`, `plan`, `plan_status`, `plan_started_at` and `plan_expires_at`. It never restores or checks `account_id`. |
| `20261110000700_restaurants_member_only.sql` | Removes the public restaurant read policy and revokes `INSERT`, `UPDATE` and `DELETE` from `anon`. It leaves authenticated `UPDATE` and the owner/manager policy intact. |
| `20261110001000_account_subscriptions.sql` | Adds `restaurants.account_id uuid REFERENCES accounts(id) ON DELETE SET NULL`, nullable, and backfills links. It does not revoke or narrow the earlier authenticated table-level update grant and adds no immutable-link guard. Account reads are membership-derived through `restaurants.account_id`. `restaurant_can_write(uuid)` follows the linked account, but when the link is null it deliberately falls back to legacy restaurant active/plan/trial rules. |
| `20261110001100_subscription_billing.sql` | Adds the account plan guard and service-role trial/payment functions. `protect_account_plan()` is a trigger on `accounts`, not `restaurants`; it does not freeze `restaurants.account_id`. |
| `20261110001220_revoke_client_bypass_privileges.sql` | Removes client `TRUNCATE`, `REFERENCES`, `TRIGGER`, PostgreSQL-17 `MAINTAIN`, and sequence privileges. Its comments expressly preserve ordinary DML grants, including `restaurants` update. |

The resulting authorization was **row-scoped, not column-scoped**. A manager/owner could update a restaurant they managed, and the policies checked which row was written. They did not constrain which columns could change on that row. Because the table-wide grant included the newly added `account_id`, the row-policy checks all passed for an update that changed only that association.

### 2.2 Consequence for entitlement and account isolation

`restaurant_can_write(restaurant_id)` reads the row's `account_id`:

- For a non-null link, it returns `account_can_write(account_id)`, which uses the account's trial or paid-period state.
- For a null link, it applies the legacy per-restaurant fallback, including `is_active` and legacy plan/trial fields.

The account read policy similarly follows the restaurant link: a caller who is a member of a restaurant can read an `accounts` row when that restaurant's `account_id` points to it. Thus a crafted update could both detach an expired account into the legacy gate, or reassign a restaurant to a known other account and change the entitlement and account-scoped access resolved for its members.

### 2.3 Database-backed proof of the pre-fix state

Before applying the new migration, `scripts/verify-account-link-guard.mjs` runs inside the clean migration replay and verifies the existing authenticated table/column update privilege and owner/manager policy, including the absence of an `account_id` condition and the absence of the new trigger. It then uses the actual local `authenticated` role with simulated JWT subjects:

1. An owner detaches a synthetic restaurant whose linked account is expired while its legacy trial fields are still current. The update succeeds under the old grant and policy; `restaurant_can_write()` changes from false to true through the null-link legacy fallback.
2. A manager reassigns that same restaurant to a different writable account. The update succeeds; the gate follows the target account and the manager can read that account through `accounts_read` RLS.

Each demonstration is rolled back to a savepoint, and the surrounding synthetic fixture transaction is rolled back. This reproduces the authorization and entitlement effects; it is not inferred solely from source text.

## 3. Restaurant write-column inventory

The checked-in migration history defines **30 restaurant columns**. The table-level grant means an owner/manager can attempt updates to all of them, subject to RLS, constraints, and the existing plan trigger. Phase 6D therefore retained the broad grant and changed only the entitlement link.

| Columns / group | Existing supported behavior and caller inventory |
|---|---|
| `name`, `tagline`, `address`, `phone`, `gstin`, `slug` | `app/(staff)/dashboard/settings/actions.ts` saves these through ordinary authenticated updates. Slug uniqueness and input validation also apply. |
| `tax_rate_bps` | Settings action writes the owner-selected tax rate. The tax workflow is intentionally not trial-gated. |
| `guest_verification_mode` | Settings action selects `code`, `scan_confirm`, or `scan`; the database check remains in force. |
| `announcement_text`, `announcement_on` | Branding action updates the public menu announcement; the 200-character database limit remains. |
| `is_active` | Branding/storefront action opens or closes ordering. It is storefront state, not a subscription write lock. |
| `logo_path`, `banner_path`, `updated_at` | Logo/banner upload and removal actions update the restaurant row. Storage paths remain tenant-prefixed and constrained. |
| `brand_theme_enabled`, `brand_theme`, `brand_profile_id` | Menu-brand publication and rollback update these in `publish_menu_brand_pair()` / `rollback_last_publish()`, which are SECURITY DEFINER and membership/write-gate checked. Their restaurant updates continue to pass because the account link is unchanged. |
| `online_payments_enabled` | `20261022000800_online_payments.sql` explicitly documents an owner settings switch using ordinary restaurant `UPDATE`. No current application writer was found in this checkout; the migration contract and authenticated grant are preserved. |
| `upi_id`, `upi_payee_name` | Retained by the UPI schema and guest payment-detail path. No current application write action was found in this checkout; no grant or column behavior was changed. |
| `accent` | Branding palette column, constrained to the supported palette. No current direct restaurant update caller was found; it remains available under the existing grant. |
| `timezone` | Read by Settings/billing/reporting; current settings action does not update it. No restriction was changed. |
| `trial_started_at`, `plan`, `plan_status`, `plan_started_at`, `plan_expires_at` | Legacy billing/trial columns. `restaurants_plan_guard` restores them for an authenticated JWT; Phase 6D leaves that trigger untouched. |
| `account_id` | Account/subscription association. The current application has no `.update()` caller for this field: signup and outlet creation insert it through trusted/checked creation functions; the migration backfill writes it as migration work. The new trigger blocks authenticated changes to an existing link. |
| `id`, `created_at` | Row identity/creation metadata; no current application update action was found. Existing constraints and row policy remain unchanged. |

The application write search covered `app`, `lib`, and `components`; it found no client `.update()` caller assigning `account_id`. This does not remove the vulnerability: table privileges and RLS are the security boundary, not the current form shape.

## 4. Account/trial functions, grants, triggers and callers

| Object | Security / grant / behavior established by the migrations | Application/data-flow finding |
|---|---|---|
| `restaurant_can_write(uuid)` | SECURITY DEFINER, fixed search path. `20261026001100` explicitly grants execute to `anon`; the account migration grants `authenticated`/`service_role` but does not revoke the earlier anon or default `PUBLIC` execute. The function uses the account gate for linked rows and the legacy fallback for null links. | `lib/db/kitchen-screen.ts` calls it as authenticated staff; RLS policies and SECURITY DEFINER RPCs also call it. The later local-only counterfactual confirmed that current gate-bearing `PUBLIC` RLS policies need anon execute for guest menu reads. No grant change was made. |
| `account_can_write(uuid)` | SECURITY DEFINER. Revoked from `PUBLIC` and `anon`; explicitly granted to `authenticated` and `service_role`. It returns a boolean for a named account id and is called internally by `restaurant_can_write()` under the definer. | No direct application caller was found. The authenticated direct-execute grant remains a separate entitlement-probe consideration below. |
| `account_outlet_limit(text)` | Stable plan-to-outlet-limit helper. It returns the static plan allowance. | Used by `create_outlet()` and application plan/display helpers. No association write. |
| `account_trial_ends_at(uuid)`, `restaurant_has_feature(uuid,text)` | SECURITY INVOKER readers from `20261110001000`; `PUBLIC`/`anon` are revoked and authenticated/service-role are granted. | Account/trial state remains scoped by the underlying table privileges/RLS. |
| `account_outlet_count(uuid)`, `restaurant_trial_ends_at(uuid)`, `restaurant_features(uuid)`, `restaurant_access(uuid)` | The current checkout's later `20261114000100` definitions are SECURITY DEFINER and remain revoked from `PUBLIC`/`anon`, with authenticated/service-role execute. `restaurant_access()` checks `auth.uid()` and restaurant membership before returning its role-scoped projection; Owner/Manager receive billing presentation and operational staff receive only operational fields. | `lib/db/staff.ts` reads `restaurant_access()`; account/subscription screens use scoped RPCs. `restaurant_access()` calls `restaurant_can_write()` internally as definer, so it creates no anon dependency. No account-link update caller. |
| `create_account_with_restaurant(text,text,text,uuid)` | SECURITY DEFINER, fixed `public, pg_temp` search path; execute revoked from `PUBLIC`, `anon`, and `authenticated`, granted to `service_role`. It inserts the account, first restaurant with its link, starter menu, and owner membership. | `app/auth/actions.ts` calls it via the server-side admin client. It is an insert path, not a transfer or update path. |
| `create_outlet(text,text)` | SECURITY DEFINER; execute revoked from `PUBLIC`/`anon`, granted to `authenticated` and `service_role`. Requires an authenticated owner membership, finds that owner's account, applies the outlet limit, then inserts the restaurant linked to that account and its owner membership/menu. | `app/(staff)/dashboard/outlet/new/route.ts` calls the RPC. It is the supported additional-outlet flow; its insert remains unaffected. |
| `claim_account_trial(uuid)` | SECURITY DEFINER; execute revoked from `PUBLIC`, `anon`, and `authenticated`, granted to `service_role`. The unique `accounts_owner_key` and `trial_grants` owner key prevent duplicate trials on supported paths. | Called inside the privileged signup/outlet creation path; no client caller. No trial policy changed. |
| `protect_restaurant_plan()` / `restaurants_plan_guard` | SECURITY DEFINER BEFORE UPDATE trigger. Restores only the listed legacy plan/trial fields when `auth.uid()` is non-null. | Does not protect `account_id`; retained as the legacy-plan guard. |
| `protect_account_plan()` / `accounts_plan_guard` | SECURITY DEFINER BEFORE UPDATE on `accounts`; freezes owner/plan/trial dates for authenticated callers, with the existing bounded cancellation-request/withdrawal exception. | Does not update or freeze restaurant association. Retained unchanged. |
| Subscription state/history/payment/receipt functions | `account_subscription_state`, history, payment-history, and receipt functions retain their membership checks and authenticated/service-role grants. Payment recording, failure, refund, cancellation confirmation, and expiry functions remain service-role-only; request/withdraw cancellation remain owner-checked authenticated flows. | `lib/db/subscription-screen.ts`, `lib/billing/actions.ts`, and `app/api/billing/webhook/route.ts` use these RPCs. No billing/recovery path writes `restaurants.account_id`. |

The FK remains nullable and `ON DELETE SET NULL`, and the null-link write-gate fallback is unchanged. Authenticated callers cannot delete `accounts` through the current table grants/policies. No account deletion/cleanup behavior was introduced.

## 5. Minimal forward remediation

Added `supabase/migrations/20261112000200_immutable_restaurant_account_link.sql`, after the repository's latest existing migration `20261112000100_schedule_subscription_expiry.sql`.

The migration creates a fixed-search-path SECURITY DEFINER trigger function and a `BEFORE UPDATE ON public.restaurants` trigger. If `OLD.account_id IS DISTINCT FROM NEW.account_id` and `auth.uid()` is non-null, it raises SQLSTATE `42501`. It uses the signed PostgREST JWT subject already used by the existing plan guard; there is no caller-settable custom bypass GUC. The trigger does not run on INSERT, does not require a non-null link, and allows trusted service/migration connections with no end-user subject to perform explicitly authorized repairs.

The migration deliberately does **not**:

- revoke the table-wide authenticated update grant or replace it with a guessed column list;
- change either restaurant RLS policy or the public probe grants;
- change `restaurant_can_write(uuid)`, `account_can_write(uuid)`, trial rules, or account billing functions;
- add a transfer/link/unlink RPC, cleanup/deletion behavior, or a `NOT NULL` constraint.

## 6. Disposable PostgreSQL evidence

`npm run test:db:embedded` completed successfully using a fresh embedded **PostgreSQL 17.11** cluster. It replayed **77 repository migrations** (including the Phase 6D guard), without application-table scaffolds, and destroyed the database afterward. The runner also executed the pre-migration reproduction above before applying the new migration.

After migration, the actual `authenticated`, `anon`, and `service_role` database roles were exercised directly in SQL. Authenticated tests set synthetic `request.jwt.claim.sub` values and `SET LOCAL ROLE authenticated`, matching the local Supabase shim. **This is direct-SQL role/RLS/trigger validation; it is not an HTTP/PostgREST validation.**

| Database test set | Result |
|---|---:|
| Phase 6D account-link tests (`lib/db/restaurant-account-link.integration.test.ts`) | **8 passed** |
| Readiness / operational database regression | **62 passed** |
| Subscription and billing database regression | **32 passed** |
| Phase 0 database security regression | **23 passed** |
| Database-backed guest throttle/order regression | **5 passed** |
| **Total database tests** | **130 passed, 0 failed** |

The Phase 6D cases verify both owner and manager attempts to detach and reassign are rejected; cross-restaurant row updates remain denied; ordinary settings/tax/verification/storefront/branding/UPI/online-payment-switch updates still work; brand publish and rollback still update the restaurant; nullable legacy restaurants can still be inserted and use the legacy gate; service-role first-account creation and authenticated `create_outlet()` still link correctly; account/trial RPC grants are unchanged; and the existing public probe behavior remains intact.

The test harness itself is local and synthetic. It does not establish hosted schema parity, PostgREST behavior, Supabase Auth/Storage behavior, email delivery, or Staging/Production rollout readiness.

## 7. Separate follow-up: public entitlement probes

**No grant change is included in the Phase 6D migration.** The database test confirms:

- `restaurant_can_write(uuid)` is callable by `anon` because `20261026001100_trial_plans_and_write_gate.sql` explicitly grants anon execute and the account migration does not revoke that privilege or PostgreSQL's default `PUBLIC` execute. It returns one boolean for a restaurant id, and the public restaurant profile exposes the restaurant UUID. The current integration suite explicitly allows the guest call.
- `account_can_write(uuid)` is denied to anon/PUBLIC but directly executable by any authenticated role for a supplied account UUID. No direct application caller was found; its required internal call from `restaurant_can_write()` runs as the definer.
- Guest ordering RPCs invoke their own server-side authorization paths; the source audit found no guest application requirement to call either gate RPC directly. That source finding is not proof that no external/older client depends on it.

**Current-checkout caller/dependency follow-up (local only; no hosted state checked):** The source scan found the only direct application call to `restaurant_can_write(uuid)` in authenticated Kitchen (`lib/db/kitchen-screen.ts`). Current function-body callers, including guest session/order RPC paths, are SECURITY DEFINER; the final `restaurant_access()` definition is SECURITY DEFINER as well. However, `20261029000100_staff_invites.sql` creates eight gate-bearing `FOR ALL` policies without a `TO` clause, so they apply to `PUBLIC`: `menus_manage`, `categories_manage`, `items_manage`, `variants_manage`, `addon_groups_manage`, `addons_manage`, `tables_manage`, and `qr_tokens_manage`. The old `orders_staff_insert` policy is later dropped; the surviving `orders_staff_update` policy is restricted to `authenticated`.

A local-only counterfactual on a fresh disposable embedded PostgreSQL replay of all 83 migrations revoked `EXECUTE` on the restaurant gate from `PUBLIC` and `anon`. The direct guest probe and a public menu/category/item RLS query failed with SQLSTATE `42501`; guest calls to `open_table_session` and `place_public_order_attempt` succeeded. Thus SECURITY DEFINER guest RPC bodies do not need anon execute, but the current RLS policy shape does need it to preserve public menu reads. This follow-up does not establish hosted migration state or PostgREST behavior. No grant, policy, or test change was made.

**Updated recommendation:** do not revoke `PUBLIC`/`anon` execute by itself. The product/security owner should decide whether to retain this boolean disclosure or authorize a separate forward migration that first scopes/refactors the gate-bearing policies away from anon, then verifies public menu/add-on reads, guest session/order flows, private-table isolation, and authenticated staff writes. Review authenticated direct execution of `account_can_write(uuid)` separately; neither decision belongs in the account-link P0 fix.

## 8. Separate owner decision: pending-signup lifecycle

`app/auth/actions.ts` provisions a genuinely new Auth identity's profile and calls `create_account_with_restaurant()` before email confirmation is complete. That function creates the account/trial, linked restaurant, published starter menu, and owner membership. The restaurant is active by default, and the exact-slug public profile can expose its public projection before confirmation. The 21-day trial and global slug reservation therefore begin at signup, not at confirmation. Error/identity-less enumeration-protection paths do not provision a workspace.

No lifecycle policy is changed here. The owner must choose and document:

| Choice | Benefits / costs to decide |
|---|---|
| Keep immediate provisioning and activation | Simple, idempotent signup; but an unconfirmed identity starts the trial, reserves a permanent slug, and may expose a working storefront. Retention/cleanup remains unresolved. |
| Provision only after email confirmation | Avoids charging trial time or creating a public restaurant for an unconfirmed address; requires a durable pending intent, safe callback retry/idempotency, and a decision about slug reservation and races. |
| Create a pending/hidden workspace before confirmation | Can reserve the slug and avoid an active storefront; requires a hidden-state/public-projection rule and a decision whether the trial starts at signup or confirmation. A closed public projection may still expose some restaurant details. |

Owner approval is still required for trial start, slug reservation, public visibility, and retention. Do not add pending-owner deletion, automated cleanup, billing changes, or trial reset behavior without that approval.

## 9. Release gates, checks and unavailable tests

The migration is local evidence only. Staging **NO-GO**, Production **read-only**, and release **NO-GO** remain in force. A reviewed hosted rollout, exact hosted-schema preflight, owner approval for pending-signup lifecycle, and independent release gates are still outstanding.

Final local validation status:

| Check | Result | Boundary |
|---|---|---|
| `npm run test:db:embedded` | **5 files / 130 tests passed** on disposable PostgreSQL 17.11 after replaying 77 migrations. | Direct-SQL role/RLS/trigger evidence only; not PostgREST. |
| `npm test -- --reporter=dot` | **188 files passed, 5 skipped; 2,152 tests passed, 130 skipped.** Skipped tests are not counted as passes. | Ordinary Vitest run; database tests use the dedicated runner above. |
| `npm run typecheck`, `npm run lint`, `npm run sql:check`, `npm run design:check` | **Passed.** | SQL check is a static parser, not PostgreSQL behavior evidence. |
| `GITHUB_ACTIONS=true CI=true AUTODINE_TEST_DEMO_BUILD=true VERCEL_ENV=test npm run build` | **Passed.** | Guarded optimized build; no deployment. |
| `git diff --check` and untracked-text whitespace/conflict scan | **Passed.** | Workspace hygiene only. |

No HTTP/PostgREST test, local Supabase Auth/Storage/SMTP integration, hosted Staging or Production check, real confirmation-email delivery, or owner lifecycle decision was performed. Those are separate gates and are not implied by the embedded PostgreSQL or build results.
