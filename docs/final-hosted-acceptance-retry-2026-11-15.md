# Final hosted acceptance — retry batch (2026-11-15)

Branch `arena/9b120325-autodine` · base `e0bd608` → head after this batch `40d6f4c`.
Supersedes the run narrative in `docs/final-hosted-acceptance-2026-11-15.md`
(that document is retained unchanged as the record of the first attempt).

**Verdict: NOT EXECUTED. Hosted acceptance is blocked at the zero-write
share-origin gate. The GitHub Actions secret `AUTODINE_STAGING_SHARE_URL`
points at the previous branch's alias (`arena/3711df6a-autodine`), not at the
2026-11-15-approved alias. No hosted browser test ran; zero fixture rows were
written to staging; production (`bdbaqpevwmgdvghszjno`) was never touched.**

## What this batch did (in order)

1. Extended the staging runner (commits `30608b9`, `b9276e6`, `b1e76de`, `40d6f4c`):
   - `scripts/staging/verify-share-origin.mjs` — zero-write, zero-network
     pre-flight; now runs **before** setup-node and fails closed with rule ids.
     On refusal it prints origin-only diagnostics (scheme+host+port — already
     public in the workflow) and parameter **names**; the `_vercel_share`
     token is never printed.
   - `playwright.staging.config.ts` — `invites.spec.ts` (owner creates an
     invitation via Settings → People, a second browser context redeems
     `/join/<code>`, replay refused, aged-invite expiry path) joins the
     staging `testMatch`.
   - `scripts/staging/invite-mint.mjs` — non-blocking mint of one aged
     synthetic cashier invitation via the real `create_staff_invite` RPC; one
     row age-shifted; on any failure the expired-link test reports SKIPPED.
   - `scripts/staging/auth-acceptance.mjs` — hosted Auth/RBAC/monitoring
     probes through real application paths (wrong-password refusal,
     unconfirmed-sign-in refusal, admin confirm, sign-in after confirm,
     recovery link issuance at API level, cashier/kitchen/manager invite →
    redeem → single-use chain, `report_sales` owner/manager allowed +
     cashier/kitchen/cross-tenant denied (42501), roster RBAC, `/api/health`,
     `/api/ops/realtime-alert` kitchen 204 vs cashier 403). Counts only;
     hard-fails the job on any failed check; SKIP-clean when unprovisioned.
   - `.github/workflows/staging-e2e.yml` — pre-flight step placement; probe
     step guarded to SKIP when dependencies absent. No gate weakened.

2. Three staging dispatches, all failed closed at the pre-flight with **zero
   fixture writes** (PII-free annotations):
   - run `43688024676` — `SHARE_URL_ORIGIN_MISMATCH`
   - run `43688142825` — `SHARE_URL_ORIGIN_MISMATCH`
   - run `43688232498` — `SHARE_URL_ORIGIN_MISMATCH` with diagnostics:
     `baseOrigin=https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app`
     `shareOrigin=https://new-git-arena-3711df6a-autodine-iamjarvis9896-3988s-projects.vercel.app`
     `shareHostMatchesBase=false shareHasVercelShare=true shareParamNames=_vercel_share`

   The secret is a well-formed share URL, scoped to the **previous branch's**
   preview alias. The `workflow_dispatch` and push trigger for `staging-e2e.yml`
   still referencing `arena/3711df6a-autodine` appears to be the source of the
   mix-up; that is an owner decision, not something this batch changed.
   (`gh secret list` is 403 for this repo for integrations — secret values are
   unreadable by design; the origin-only diagnostic from the gate is the
   evidence above.)

3. Auth configuration independently re-verified against the owner's restoration
   report (Supabase `get_auth_config`, staging `juwyhslzchjevqkdvwjm`):
   - `site_url` = `https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app` ✔ matches the approved alias
   - `uri_allow_list` = same origin + `/**` ✔
   - `external_email_enabled=true`, `disable_signup=false`, `mailer_autoconfirm=false`,
     `jwt_exp=3600`, `refresh_token_rotation_enabled=true`, `security_captcha_enabled=false`,
     `external_phone_enabled=false`, `security_refresh_token_reuse_interval=10`.
   Note: `security_captcha_provider=hcaptcha`, `sms_provider=twilio` and six
   similar fields still carry the values set during the 2026-11-15 nulling
   incident (`rate_limit_email_sent=2`, `sessions_inactivity_timeout=0`,
   `sessions_timebox=0`). `0` is also the "disabled" default for the session
   timeouts and captcha is disabled outright (`security_captcha_enabled=false`,
   secret null), so there is no live security exposure; but these cannot be
   independently confirmed as "restored to prior originals" — the connector
   exposes no endpoint to set them to arbitrary previous values.
   **Site URL now pointing at the approved alias is positive confirmation that
   the owner's restoration work landed.**

4. Vercel state (project `new`, team `iamjarvis9896-3988s-projects`): the
   approved branch alias `new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app`
   is assigned to the READY preview deployment for commit `40d6f4c`
   (`dpl_ALDrgrpzqC2cL8MQxsaxZ7WSz8YZ`, readySubstate STAGED, aliasAssigned at
   apply time). Preview deployments auto-track the branch; nothing was
   deployed by this batch beyond normal git-push preview builds. No production
   deployment was created, promoted, paused or edited. Existing READY
   deployments are untouched.

5. Staging database read-only probes (SELECT-only via connector, no writes):
   - Ledger `supabase_migrations.schema_migrations`: 11 rows (8 repo files +
     1 local scaffold + `arena_staging_forward_upgrade_55` umbrella +
     `owner_billing_configuration_guard` + `report_sales_export_authorization`).
   - Realtime publications: `supabase_realtime` contains `public.orders` and
     `public.table_waiter_calls` (exactly the tables the app subscribes to);
     `supabase_realtime_messages_publication` covers `realtime.messages_2026_11_08…14`.
     Note: the project-health info panel still reports
     `realtime.db_connected=false` / `replication_connected=false` while the
     service health check reports ACTIVE_HEALTHY — actual end-to-end delivery
     was not provable from the sandbox and remains unverified.
   - RLS: 42/42 public tables `relrowsecurity=true`.
   - Function ACLs: `create_staff_invite`, `preview_staff_invite`,
     `redeem_staff_invite`, `list_staff_members`, `revoke_staff_invite`,
     `remove_staff_member`, `report_sales`, `current_verification_code` =
     SECURITY DEFINER with `{postgres, authenticated, service_role}` EXECUTE —
     **no `anon`, no PUBLIC**; `place_order` = `{postgres, service_role}` only.

6. `report_sales` authorization (remediation from S4 rehearsal) re-checked at
   catalog level: EXECUTE grants unchanged (`{postgres, authenticated,
   service_role}`), prosecdef=true. Runtime behavior (owner/manager allowed,
   others denied with 42501) is wired into `auth-acceptance.mjs` but has **not
   been executed** — see "Not run".

7. GST/IRP migration dependency analysis — **inspect-only, nothing applied**
   (see §"GST dependency analysis" below). 33 of 89 repo migrations are not on
   staging (26 pre-GST + 7 GST/IRP). The application plan remains
   `docs/gst-staging-application-plan-2026-11-15.md` and is **NOT authorized,
   NOT applied**.

## What is blocked, exactly

Everything requiring the hosted preview URL behind the share secret is blocked:
provisioning of synthetic fixtures, the four browser suites, the invites
browser flow, and the hosted Auth/RBAC/`/api/health` probes. The block is one
repository Actions secret value, not code and not staging state.

**Owner action required to unblock (never to be worked around):**
in the Vercel dashboard for project `new`, open the READY deployment for branch
`arena/9b120325-autodine` (branch alias host
`new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app`,
currently `40d6f4c`), use "Share" to create a fresh share link for **that alias
host**, and replace repository Actions secret `AUTODINE_STAGING_SHARE_URL`
(Settings → Secrets and variables → Actions) with exactly that URL
(`https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app/?_vercel_share=…`).
Then re-dispatch: `gh workflow run staging-e2e.yml --ref arena/9b120325-autodine`.
Pointing `STAGING_BASE_URL`/`APPROVED_ORIGIN` at the 3711df6a alias instead is
**not an acceptable fix** — that preview serves a different branch.

## Passed / failed / skipped / not run (this batch)

**Passed**
- CI `43688461250`, E2E (browser) `43688461254`, Throttle `43688461180` on `40d6f4c`.
- Local gates on `40d6f4c`: `tsc --noEmit` ✔, `eslint .` on the three new
  scripts ✔, `test:staging:guards` 25/25 ✔, `design:check` ✔, `isolation:verify` ✔,
  `npm run sql:check` ✔.
- Pre-flight gate: refused three dispatches with zero writes (correct fail-closed
  behavior; diagnostics used no secret values).
- Auth configuration re-read matches the approved alias (see above).
- Staging identity/health: project `autodinetest` (`juwyhslzchjevqkdvwjm`),
  ACTIVE_HEALTHY, ap-northeast-2, PG 17.11.0.018; auth/db/realtime/rest
  ACTIVE_HEALTHY (GoTrue v2.197.0).
- Read-only staging SQL probes: publications, RLS 42/42, function ACLs (§5–6).
- GST dependency analysis completed (below). No migration applied.

**Failed**
- CI/E2E on `b9276e6` and `b1e76de` — `no-unused-expressions` lint on
  `auth-acceptance.mjs`; fixed in `40d6f4c` (local gates + CI/E2E/Throttle green).
- Staging dispatches `43688024676`, `43688142825`, `43688232498` — refused at
  the share-origin gate (owner-secret scope mismatch; zero writes).

**Skipped / not run (unblocked only by the owner action above)**
- Hosted browser suites: guest QR → order → kitchen → waiter → cashier →
  settlement → invoice (`guest-order-flow`, `kitchen-flow`, `cashier-flow`,
  `security-flow`) — not run.
- Hosted invitation browser flow (`invites.spec.ts`) — not run.
- Hosted Auth/RBAC/monitoring probes (`auth-acceptance.mjs`) — not run.
- Actual hosted Realtime delivery/reconnection/fallback — not verified (health
  ACTIVE_HEALTHY but `db_connected=false` in the info panel; delivery is an
  end-to-end property that needs the gated browser/probe paths).
- `/api/health` and `/api/ops/realtime-alert` over HTTP — not run.
- Settlement-before-close, financial read roles, invoice share links,
  subscription billing, GST runtime paths — not run (schema gap, see plan doc).
- GST Phases A/B — not applied (no authorization; per plan doc §6 hard stops).

## GST dependency analysis (inspect-only)

Method: extracted every `CREATE TABLE/TYPE/SEQUENCE/VIEW/FUNCTION` from the 89
repo migrations and every `public.<name>` reference in the 33 missing files;
tagged each reference as created-earlier-in-chain / missing-later-in-chain /
not-created-by-repo; then probed every external dependency against the live
staging catalog (read-only).

**Result: the 33 files form a self-consistent chain in exact repo filename
order. Zero unresolved references; zero "missing-later-in-chain" violations.**
Phase A (26 files, `20261108007000` … `20261112000700`) → Phase B (7 files,
`20261113000100` … `20261114000600`) ordering is valid and required.

External dependencies all verified present on staging today:
- 25/25 tables/collections (incl. `orders`, `payments`, `order_sessions`,
  `restaurant_invoices(+lines,+series)`, `restaurant_payment_receipts`,
  `payment_audit_events`, `kitchen_announcement_claims`, `rate_limit_hits`,
  `qr_verification_attempts`, …). `qr_verification_attempt_budgets` is absent —
  by design; `20261110000900` handles its possible absence/shape mismatch and
  fails closed on unrecognized shapes.
- 23/23 functions probed (incl. `place_public_order`,
  `place_public_order_attempt`, `place_public_order_core_with_code_retry`,
  `close_order_session_and_issue_receipt`, `issue_closed_session_receipt`,
  `hit_rate_limit`, `stamp_guest_verification`, `current_table_session`,
  `reserve_qr_verification_attempt`). `restaurant_invoice_share_audit` is a
  **table** (in-chain), not a function.
- Type `member_role` present; `subscription_receipt_seq` present.

Pre-existing staging objects the chain also creates (all idempotent creates):
`restaurant_invoice_share_links`, `restaurant_invoice_share_audit` (both
`create table if not exists` in `20261108010000`) and `subscription_receipt_seq`
(`create sequence if not exists` in `20261110001100`). No conflict; pre-flight
must still shape-check them, not just existence.

Static safety review of the 33 files:
- **Zero** non-idempotent `create table/type/sequence/view` statements.
- **Zero** plain `create function` (all `or replace` or drop-if-exists + create).
- **Zero** `truncate` of real tables (two occurrences are `on commit drop`
  temp tables in `20261113000100`; the rest are prose/DDL keywords in
  `revoke truncate` statements in `20261110001220`).
- **Zero** `drop table` without `if exists`.
- The only apply-time data mutation outside function bodies is
  `delete from public.rate_limit_hits where key like 'po:s:%' or key like 'po:t:%'`
  (`20261110000800`, documented stale-counter cleanup). Pre-flight must capture
  `count(*)` of matching rows to size the blast radius before apply.
- `delete from` inside `order_items`/`qr_verification_attempts`/`qr_verification_attempt_budgets`
  statements are runtime function bodies (order edit, attempt-budget reset),
  not migration-time deletes.
- `20261110000900_converge_qr_verification_attempts` is the one high-risk file:
  it renames/migrates the attempts table for unrecognized legacy shapes or
  fails closed. Pre-flight should capture the live shape
  (`information_schema.columns` + constraint names) in addition to md5(prosrc).

Bottom line for authorization (if ever granted): the chain is internally
consistent and staging-compatible as of this probe; remaining risk is
concentrated in `20261110000900` (shape convergence) and requires the
pre-flight captures + rehearsal on disposable PG before touching staging.
**Nothing in this analysis authorizes the apply. It remains forbidden without a
separate explicit authorization naming `juwyhslzchjevqkdvwjm`.**
