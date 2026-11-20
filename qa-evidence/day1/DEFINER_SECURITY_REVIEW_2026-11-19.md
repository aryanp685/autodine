# Report B — Security review of the 81 flagged SECURITY DEFINER functions (2026-11-19)

**Scope:** every function the 2026-11-19 audit flagged (81 of 148 `SECURITY
DEFINER` functions in `public`), reviewed individually against the live
catalogue of a disposable database replayed from this branch's 119 migrations.
Each function is classified once; a flag is a question, not a verdict.

**Headline:** **2 confirmed vulnerabilities** (one flagged, one that the
heuristic could not see), **0 high-risk design findings**, **28 internal
functions with restricted invocation**, **26 justified exceptions** and **26
validated RPCs**. Both vulnerabilities are the same defect in the same pair of
functions, both are reproduced on a disposable database, and both are **fixed
locally** with regression coverage. **Hosted remediation is NOT AUTHORIZED.**

| Class | Meaning | Count |
|---|---|---|
| A | Confirmed security vulnerability | **1** flagged (`retire_table_qr_code`) + **1** unflagged (`rotate_table_qr_code`, §2.1) |
| B | High-risk design requiring remediation | **0** |
| C | Valid privileged function with adequate controls | **26** |
| D | Internal trigger/function with restricted invocation | **28** (13 triggers + 15 owner-only helpers) |
| E | False positive / acceptable exception, justified | **26** |
| F | Insufficient evidence | **0** |

Total reviewed: **81 flagged + 1 unflagged finding = 82 functions**, 148 audited.

## 0. Post-review delta (2026-11-19, Priority 7)

This report is the record of the review **as performed**. Three things have
changed since, and none of them alters a classification:

1. **The audit now reports 148 audited / 80 flagged.** The local fix
   (`20261118002200_qr_code_staff_boundary.sql`) re-declares both QR functions
   with `has_restaurant_role(…)`, so neither carries `NO_TENANT_PREDICATE` any
   more. The 81-flag list in this report is preserved because it is what the
   review saw; the two class-A rows remain **open findings** until the file is
   applied to a target.
2. **A third defect was found by reading the bodies, not by the audit** —
   rotation was not serialised, so two concurrent rotations could leave two live
   cards (F-03). It is fixed by the same file and proven with two concurrent
   sessions. The audit's heuristic cannot see isolation problems, which is worth
   knowing the next time a flagged list looks short.
3. **The staging anomaly** that this review could only describe from the
   candidate is now proven (Report A §4.1). It does not touch any function
   classified here.

## 1. The finding

### 1.1 QR-01 / QR-02 — cross-outlet table-code rotation and retirement

| | |
|---|---|
| Functions | `public.rotate_table_qr_code(uuid)`, `public.retire_table_qr_code(uuid)` |
| Privilege | `SECURITY DEFINER`, owner `postgres`, `search_path=public, pg_temp`, `EXECUTE` to `authenticated` |
| Defect | Their only guard is `restaurant_can_write(p_restaurant_id)`, which answers *"may this outlet write under its plan/trial?"* — not *"is the caller a member of this outlet?"*. RLS is suspended inside a definer function, so nothing else checked the caller. |
| Preconditions | Any authenticated account. A table uuid is not secret: `current_table_session(p_token)` returns `table_id` to `anon`, so any guest who scans a table learns it. |
| Impact — rotate | Revokes the outlet's live printed cards **and returns the replacement `public_token` to the attacker**, who can then open guest sessions and place orders at that outlet (cross-tenant integrity + ordering fraud + availability). |
| Impact — retire | Revokes the outlet's live printed cards; guest ordering stops until staff re-provision (cross-tenant denial of service). No data disclosure. |
| Reproduction | `node scripts/local-pg/with-embedded-postgres.mjs node scripts/local-pg/verify-qr-finding.mjs` — replays the chain without the fix, a stranger rotates another outlet's code and receives a 64-character token, then the fixed chain refuses both calls with `42501` and still allows the owner. |
| Local fix | `supabase/migrations/20261118002200_qr_code_staff_boundary.sql` adds `has_restaurant_role(v_restaurant_id, ARRAY['owner','manager'])` before the entitlement check. Signatures, return types, grants and the entitlement gate are unchanged; the role set matches the existing `dining_tables` write policy. **NOT AUTHORIZED** for any hosted target. |
| Regression | `lib/db/phase0-security.integration.test.ts` → *table QR lifecycle*: an outsider and another outlet's owner are refused; the card still opens a guest session; the outlet's owner can rotate (exactly one live code) and retire (none left). |
| Hosted state | Verified read-only on `autodinetest`: both hosted functions carry the entitlement check, **not** the membership check, and `authenticated` holds `EXECUTE`. The defect is live there today. Production was not accessed (policy); the same two functions ship from `20261021000007`, so the defect must be assumed present wherever that file is applied until proven otherwise. |
| Hosted authorization | Required. Applying `20261118002200` (or an equivalent) to any hosted target is a separate written decision. |

**Why the audit missed `rotate_table_qr_code`:** the body inserts
`created_by = auth.uid()`, so the `NO_TENANT_PREDICATE` heuristic concluded the
function "has a tenant predicate". It never checked that the `auth.uid()` was
an *authorization* use rather than a *value*. `retire_table_qr_code` was caught
only because it has no `auth.uid()` at all — i.e. the flag fired for the wrong
reason. Both are fixed; the heuristic gap is recorded in §4.

## 2. Method

- Replayed this branch's 119 migrations into a disposable database and dumped
  every `SECURITY DEFINER` function with owner, grants (anon / public /
  authenticated / service_role), `proconfig`, return type, attached triggers and
  full body (`npm run audit:definer`, plus
  `scripts/local-pg/dump-definer-audit.mjs` for the JSON that produced this
  table).
- For each flagged function: read the body, identified the authorization
  primitive (membership, role, guest token, session token, share-token hash,
  service-role-only, trigger-only), checked whether the gate comes before the
  first write, and checked whether the function can resolve another tenant's
  object from its arguments.
- A flag alone was never treated as a finding, and no function was marked safe
  without reading it.

## 3. All 81 flagged functions, individually classified

EXECUTE column = runtime roles holding `EXECUTE` (verified with
`has_function_privilege`), or `trigger` / `owner only` where no runtime role
holds it.

| # | Function | EXECUTE to | Audit flags | Class | Basis |
|---|---|---|---|---|---|
| 1 | `retire_table_qr_code`(p_table_id uuid) | authenticated | NO_TENANT_PREDICATE | **A** | Same defect, no token return: revokes another outlet's printed cards (guest ordering stops). Flagged NO_TENANT_PREDICATE; the guard it had answered a different question. Fixed locally in 20261118002200. |
| 2 | `account_payment_history`(p_restaurant_id uuid, p_limit integer) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **C** | Owner/manager of that outlet only; capped at 50 rows. |
| 3 | `account_receipt`(p_receipt_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **C** | Requires owner/manager on some restaurant of the receipt's account. |
| 4 | `account_subscription_history`(p_restaurant_id uuid, p_limit integer) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **C** | Same role gate as above. |
| 5 | `account_subscription_state`(p_restaurant_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **C** | Same role gate as above. |
| 6 | `call_verified_waiter_at`(p_slug text, p_table_label text, p_session_token text, p_request_key uuid) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Thin wrapper: verifies slug+label+token through read_verified_waiter_state, then delegates. |
| 7 | `call_waiter`(p_session_token text, p_request_key uuid) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Guest RPC: 64-hex session token hashed, joined through session→restaurant→table→live QR; request key for idempotency. |
| 8 | `cancel_order`(p_order_id uuid, p_guest_token uuid, p_reason text) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE | **C** | Guest token or finance-role staff; locks the session before the order. |
| 9 | `claim_upi_payment`(p_slug text, p_code text, p_token uuid) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Guest token + order code + slug; rejects the nil uuid. |
| 10 | `create_outlet`(p_name text, p_slug text) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **C** | auth.uid() + account ownership + outlet limit; serialized per caller. |
| 11 | `current_table_session`(p_token text) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | 64-hex token only; returns that session's restaurant/slug/table/expiry. |
| 12 | `get_guest_order_status`(p_slug text, p_code text, p_token uuid) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Slug + code + guest token; returns status fields only. |
| 13 | `get_public_order`(p_slug text, p_code text, p_token uuid) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Slug + code + guest token; returns that order and its lines. |
| 14 | `open_table_session`(p_public_token text, p_ip_hash text) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Public token + sandbox-safe ip fingerprint; per-card (10/h) and per-address (20/h) caps; creates at most one session. |
| 15 | `place_public_order`(p_slug text, p_lines jsonb, p_note text, p_session_token text, p_guest_token uuid, p_ip_hash text) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **C** | service_role only; validates the session token and delegates to the core writer. |
| 16 | `place_public_order_attempt`(p_slug text, p_lines jsonb, p_note text, p_session_token text, p_guest_token uuid, p_ip_hash text) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **C** | Anon wrapper: session token lookup by slug, guest token required, rate limits, delegates to service-only core; returns structured errors only. |
| 17 | `public_order_pricing`(p_slug text) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Returns only mode + rate for one public slug, through the staff-only pricing function. |
| 18 | `public_qr_intro`(p_public_token text) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Validated public token; returns intro text/name only, no ids. |
| 19 | `public_upi_details`(p_slug text, p_code text, p_token uuid) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **C** | Slug + code + guest token; returns payee and due amount for that order only. |
| 20 | `read_shared_restaurant_invoice`(p_token_hash text) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE | **C** | 64-hex token hash, rate-limited, expiry+revocation checked, and refuses private delivery documents. |
| 21 | `read_verified_waiter_state`(p_slug text, p_table_label text, p_session_token text) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Token hash + slug + table label; returns one of idle/waiting/acknowledged/expired. |
| 22 | `request_subscription_cancellation`(p_restaurant_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **C** | Owner of a restaurant on the account only. |
| 23 | `restaurant_access`(p_restaurant_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **C** | Membership-scoped; returns null for a non-member. |
| 24 | `set_guest_order_lines_at_version`(p_order_id uuid, p_guest_token uuid, p_version text, p_lines jsonb) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Guest token + live-version CAS before delegating to the pricing authority. |
| 25 | `set_order_line_quantities`(p_order_id uuid, p_lines jsonb, p_guest_token uuid) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE | **C** | Guest token (or staff role for staff edits); locks session, re-prices through GST authority. |
| 26 | `verify_table_qr_with_code`(p_public_token text, p_code text, p_ip_hash text) | anon, authenticated | ANON_OR_PUBLIC_EXECUTE, NO_TENANT_PREDICATE | **C** | Public token + 6-digit code + ip fingerprint; per-card attempt cap, restaurant-wide failure counter that rotates the code. |
| 27 | `withdraw_subscription_cancellation`(p_restaurant_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **C** | Same owner gate as request. |
| 28 | `check_live_table_stamp`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only (`order_stamp_requires_live_table`); EXECUTE revoked from anon/public/authenticated/service_role; reads the table row to refuse a stale stamp. |
| 29 | `check_live_waiter_session`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only (`waiter_call_requires_live_table`); EXECUTE revoked from every runtime role. |
| 30 | `claim_irp_dispatch`(p_outlet uuid, p_route uuid, p_job uuid) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE (fixture/worker roles only in a rehearsal); claim is lease+phase gated and every statement is outlet/route scoped. |
| 31 | `clear_qr_verification_attempts`(p_qr_code_id uuid, p_ip_hash text) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; called by the verification path after a correct code; deletes one (qr, ip_hash) key. |
| 32 | `finish_irp_dispatch`(p_job uuid, p_token uuid, p_code text, p_ms integer, p_digest text, p_evidence jsonb) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; requires the lease token, re-reads the source snapshot and refuses mismatched digests. |
| 33 | `gst_bind_number_namespace`(p_outlet uuid, p_gstin text, p_fy text, p_kind text, p_prefix text) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; invoice-series namespace binding with an advisory lock and prefix validation. |
| 34 | `gst_pricing`(p_restaurant_id uuid) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; internal pricing read used by staff RPCs and the public pricing projection. |
| 35 | `gst_pricing_at`(p_restaurant_id uuid, p_india_date date) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; as-of-date pricing read; raises when the saved profile was not yet active. |
| 36 | `guard_gst_invoice_void`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only (`restaurant_invoices_guard_gst_void`); refuses a void once GST/IRP facts exist. No runtime EXECUTE. |
| 37 | `guard_order_gst_snapshot`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only (`orders_guard_gst_snapshot`); keeps the order's GST snapshot append-only. No runtime EXECUTE. |
| 38 | `irp_guard_source_void`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only (invoice + note source void guards). No runtime EXECUTE. |
| 39 | `issue_payment_receipt_after_invoice_payment`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only (`payments_issue_invoice_receipt`); issues the receipt in the payment transaction. No runtime EXECUTE. |
| 40 | `new_invite_code`() | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; unbiased 16-symbol code generator, no table access. |
| 41 | `place_order`(p_restaurant_slug text, p_table_token text, p_items jsonb, p_note text) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE (legacy entrypoint, superseded by place_public_order_attempt); keeps its own table-session and pricing validation. |
| 42 | `place_public_order_core`(p_slug text, p_lines jsonb, p_note text, p_session_token text) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; the real order writer, reachable only through the service-role wrapper; validates session token, line caps, menu publication and pricing. |
| 43 | `place_public_order_core_with_code_retry`(p_slug text, p_lines jsonb, p_note text, p_session_token text) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; retry wrapper limited to the order-code unique violation, 8 attempts. |
| 44 | `protect_billing_history`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only append-only guard; body reads no table (so `search_path=public` without pg_temp cannot be shadowed into a write); raises on every UPDATE/DELETE. |
| 45 | `protect_webhook_evidence`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only evidence guard; compares NEW/OLD only, no table access. |
| 46 | `record_verification_failure`(p_restaurant_id uuid) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; restaurant-wide failure counter that rotates the displayed code — the compensating control that makes a caller-supplied ip_fingerprint tolerable. |
| 47 | `reject_alcohol_straddle_composition`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only Composition/alcohol refusal on two tables; no table access beyond NEW. |
| 48 | `reserve_qr_verification_attempt`(p_qr_code_id uuid, p_ip_hash text) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; server-side counter for one (qr, ip_hash) with a 15-minute window and a 5-attempt cap. |
| 49 | `restaurant_gst_config_history_track`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only history writer for the GST config; writes only the history child row. |
| 50 | `restaurant_gst_config_shared_identity`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only shared-identity guard across outlets of one PAN. |
| 51 | `signal_operational_revision`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only coalesced revision bump on seven operational tables; writes one revision row per outlet. |
| 52 | `snapshot_order_item_gst_classification`() | trigger | NO_TENANT_PREDICATE | **D** | Trigger-only snapshot writer for line-level GST classification. |
| 53 | `staff_email`(p_user_id uuid) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; returns one email from auth.users for server-side staff lists. Not reachable from any client role. |
| 54 | `stamp_guest_verification`(p_code text, p_restaurant_id uuid, p_session_token text) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; validates the 64-hex session token and its restaurant before stamping verification. |
| 55 | `sweep_irp_leases`(p_outlet uuid, p_route uuid) | owner only | NO_TENANT_PREDICATE | **D** | No runtime EXECUTE; expires leases for one outlet/route only. |
| 56 | `account_can_write`(p_account_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | Account plan/trial fact; no tenant data. |
| 57 | `account_outlet_count`(p_account_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **E** | Count filtered by account role or the caller's restaurant role. |
| 58 | `admin_set_subscription`(p_restaurant_name text, p_plan text, p_days integer, p_months integer) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; operator/admin action, no client EXECUTE. |
| 59 | `begin_online_payment`(p_provider text, p_provider_order_ref text, p_slug text, p_order_id uuid, p_guest_token uuid, p_amount_paise bigint) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; validates provider ref, slug, guest token, payability and exact outstanding amount. |
| 60 | `can_manage_restaurant`(p_restaurant_id uuid) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE | **E** | Returns the caller's own owner/manager fact for one id (`auth.uid()` inside); no data beyond a boolean. |
| 61 | `claim_account_trial`(p_account_id uuid) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; one-shot trial claim keyed by account. |
| 62 | `confirm_subscription_cancellation`(p_restaurant_name text, p_provider text, p_provider_event_id text) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; provider-event idempotent. |
| 63 | `counter_claims`(p_restaurant_id uuid) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE | **E** | Returns pending UPI claim rows, but only when the caller is owner/manager/cashier of that restaurant; the id is the caller's own outlet in practice. |
| 64 | `create_account_with_restaurant`(p_name text, p_slug text, p_timezone text, p_owner uuid) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; account bootstrap. |
| 65 | `current_restaurant_ids`() | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE | **E** | Returns only the caller's own membership ids; used by RLS policies. |
| 66 | `expire_subscriptions`() | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; scheduled sweep. |
| 67 | `has_account_role`(p_account_id uuid, p_roles text[]) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **E** | Caller's own account-role fact. |
| 68 | `has_restaurant_role`(p_restaurant_id uuid, p_roles text[]) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE | **E** | Returns the caller's own role fact for one id. This is the correct tenant primitive; `restaurant_can_write` is not. |
| 69 | `hit_rate_limit`(p_key text, p_limit integer, p_window_seconds integer) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only counter helper; keys are server-chosen. |
| 70 | `is_member`(p_restaurant_id uuid) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE | **E** | Boolean membership fact for the caller only. |
| 71 | `operational_schema_readiness`() | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only readiness probe; read-only catalog checks. |
| 72 | `public_online_due`(p_slug text, p_code text, p_token uuid) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; guest token required; returns the due amount for one order. |
| 73 | `public_restaurant_profile`(p_slug text) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | By-design public storefront projection (tested to equal PUBLIC_RESTAURANT_COLUMNS, inactive outlets included with is_active=false so the screen can say 'closed'). |
| 74 | `record_subscription_payment`(p_restaurant_name text, p_provider text, p_provider_event_id text, p_plan text, p_amount_paise bigint, p_currency text, p_months integer, p_occurred_at timestamp with time zone) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; webhook path, idempotent on provider event id. |
| 75 | `record_subscription_payment_failure`(p_restaurant_name text, p_provider text, p_provider_event_id text, p_plan text, p_amount_paise bigint, p_reason text, p_occurred_at timestamp with time zone) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; webhook path. |
| 76 | `record_subscription_refund`(p_restaurant_name text, p_provider text, p_provider_event_id text, p_reference text, p_occurred_at timestamp with time zone) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; webhook path. |
| 77 | `restaurant_can_write`(p_restaurant_id uuid) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | Plan/trial entitlement fact, deliberately caller-independent (it answers 'may this outlet write'). Adequate as an entitlement gate; it must never be the only check in a definer RPC — QR-01/QR-02 were exactly that misuse, now fixed. |
| 78 | `restaurant_features`(p_restaurant_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **E** | Feature list for the caller's own membership of that outlet (join on `auth.uid()`). |
| 79 | `restaurant_is_active`(p_restaurant_id uuid) | anon, authenticated, service_role | ANON_OR_PUBLIC_EXECUTE, SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | One boolean for one uuid; the storefront already publishes active state. |
| 80 | `restaurant_trial_ends_at`(p_restaurant_id uuid) | authenticated, service_role | SERVICE_ROLE_EXECUTE | **E** | Trial date only when the caller is owner/manager of the outlet. |
| 81 | `settle_online_payment`(p_provider text, p_provider_order_ref text, p_provider_payment_ref text, p_amount_paise bigint) | service_role | SERVICE_ROLE_EXECUTE, NO_TENANT_PREDICATE | **E** | service_role only; locks session→order→payment; no client EXECUTE. Its stricter candidate body remains unapplied (documented Phase 5D gap). |

## 4. What the flags actually meant

| Flag | Count among the 81 | Reading |
|---|---|---|
| `NO_TENANT_PREDICATE` | 61 | Mostly functions whose tenant identity is the *argument* (`p_restaurant_id`, `p_outlet`) combined with a role or token check the heuristic does not recognise, plus every trigger function. Two real defects hid here (§1.1). |
| `SERVICE_ROLE_EXECUTE` | 37 | Deliberate server-side surface. `service_role` bypasses RLS by design; these functions are called from server code with the service key and are unreachable from a browser role. |
| `ANON_OR_PUBLIC_EXECUTE` | 25 | Guest entry points and RLS helper predicates. Every guest RPC validated a token (session token, guest token, share-token hash, or public QR token) or returned only permission/public facts. |
| `NO_FIXED_SEARCH_PATH` | 0 | Every one of the 148 pins `search_path`. |
| Flagged, reviewed, not a vulnerability | 80 | See the table; each has the primitive that the flag could not see. |

### 4.1 Heuristic gap (not a vulnerability, a review defect)

`auth.uid()` appears in `rotate_table_qr_code` only as an inserted value
(`created_by`), which suppressed the `NO_TENANT_PREDICATE` flag on a function
with no caller check. A second, weaker pattern exists: 19 functions set
`search_path=public` without `pg_temp` (e.g. `report_sales`,
`record_counter_payment`, `list_staff_members`, `remove_staff_member`,
`publish_menu_brand_pair`, `rollback_last_publish`, and the four trigger guards
that read no table). Temp-schema shadowing is not reachable through PostgREST —
a client cannot create a temp table in a request session — so this is
defence-in-depth, not an exploitable path. Recommendation recorded, not applied
silently: add `pg_temp` to those `search_path` values in a future forward
migration, and extend the audit heuristic to look for `has_restaurant_role` /
`is_member` / `account_can_write` as *guards* (an `if not … then raise`) rather
than any occurrence of a tenant signal.

### 4.2 Residual risks that are neither A nor B today

- `settle_online_payment`/`begin_online_payment` keep the Phase 5D-identified
  gaps on the hosted project (no current-state/duplicate-pending checks). They
  are `service_role`-only, so no client can reach them; the stricter candidate
  bodies exist in the repository and remain unapplied.
- `verify_table_qr_with_code` takes the address fingerprint as a parameter, so a
  direct API caller can vary it. The compensating control is real: every wrong
  code increments a **restaurant-wide** counter that rotates the displayed code,
  so blind guessing from off-site does not converge. No host-visible alternative
  exists for an anon RPC without moving the limit to the edge.
- The account/billing RPCs are gated on membership of the outlet, not on an
  `account`-level role; documented behaviour, no cross-tenant read found.

## 5. Local remediation and verification

| Item | Result |
|---|---|
| Fix | `supabase/migrations/20261118002200_qr_code_staff_boundary.sql` (new, **NOT AUTHORIZED** hosted) |
| Manifest / register | 119 files / 119 rows, register regenerated, 0 problems |
| Reproduction script | `scripts/local-pg/verify-qr-finding.mjs` — PRE-FIX both calls succeed (token returned), POST-FIX both `42501`, owner still allowed |
| Regression tests | 2, in `lib/db/phase0-security.integration.test.ts` |
| Integration suite | **13 suites, 288 passed / 1 skipped** (+2) |
| Replay | **272 passed / 3 skipped** on 119 migrations |
| Definer audit after the fix | 148 audited, **80 flagged** (retire no longer flagged; rotate still invisible to the heuristic) |
| Lint / typecheck / verify:release | exit 0 / exit 0 / OK (47 checks, 119 files) |
| Hosted changes | **None.** Read-only catalogue queries only. |

**Security review verdict: COMPLETE. Confirmed vulnerabilities: 2. High-risk
findings: 0. Local remediations: 1 migration (2 functions) + 1 reproduction
script + 2 regression tests. Hosted actions: NOT AUTHORIZED.**
