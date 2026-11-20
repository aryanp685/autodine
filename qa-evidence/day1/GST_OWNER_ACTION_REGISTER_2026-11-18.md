# Two-mode GST — final owner-readiness handoff

## Current Workstream B decisions

**All pending. GO for offline review and disposable synthetic work only.** The
[current local proof matrix](GST_WORKSTREAM_B_FINAL_CLOSURE.md) supersedes the older
implementation descriptions below, not their hosted permission, stop or
recovery gates. Each of the [24 GST/IRP files](GST_WORKSTREAM_B_FINAL_CLOSURE.md#forward-migrations-and-preservation) is individually
**NOT AUTHORIZED**. No outlet activation decision, provider, or isolated
hosted target was assumed.

| Owner decision | Evidence / disposition to record privately |
|---|---|
| **O1–O4 · Outlet, access, eligibility and timing** | Name outlet, authorized Owner and read-only Managers for GST Settings, legal registration or non-registration basis, FSSAI-to-premises mapping, reviewed Regular/Composition SAC, supported mode/profile and India effective date. For hotel treatment, record preceding-FY actual room evidence plus the treatment FY and applicable declaration/acknowledgment or negative declaration review (including any Annexure IX); confirm permitted direct supplies and Composition catalog/scheme eligibility. Choose **activate when gates pass** or **defer** with safe interim handling. Owner attestation is required. The normal supported path does not require a universal adviser signature; O6 records advice where obtained, or an escalated/disputed/factually unresolved case that must be deferred. |
| **O5 · Numbering** | Finance owner reconciles logical `INV/BOS/RBL/CN/DN` and reserved prefixes per outlet, GSTIN and India FY with legacy records and each external book. AutoDine checks its own namespace collisions; it cannot verify exclusivity in another system. Keep earlier numbers and counters. Record a resolution for any changed registration, legacy duplication or external overlap. |
| **O6 · Buyer, PAN and exceptional workflows** | Confirm PAN-wide turnover coverage back to FY2017–18 (highest prior FY plus current reporting category), buyer registration, issue-time applicability and review dates. Keep uncertain cases on hold. Agree how to handle unsupported Rule 49 registered-buyer BOS, Rule 46(s) or signature/IT Act exceptions, SEZ/exports, interstate/UTGST, ECO §9(5), reverse charge, B2C dynamic payment QR/cross-reference and other atypical cases; do not route them through a supported choice by omission. For notes confirm immutable original invoice/recipient evidence, legal basis, any earlier annual return/ITC reversal and local correction versus live IRP cancellation. Direct Regular delivery also needs current PAN evidence clearing IRN before ticket and payment; identify any unsupported delivery case before collection. No partial-note/refund/return assumptions; confirm applicable credit-note rules instead of assuming a discount reduces liability. |
| **O7 · Paid, legacy and cutover exceptions** | Get scoped counts and a disposition for active, paid-open and paid-closed unissued sittings, stale/held identity, SAC-less Composition and incompatible tickets and required catalog rollback snapshots. Decide how to preserve the payable/paid amounts and fiscal trail without collecting twice. Unknown is not zero; any shared change affecting an unresolved outlet remains blocked. |
| **IRP · Provider authorization** | If wanted, choose an authorized IRP/GSP, approved synthetic environment and exact API/schema/master versions, authority for seller onboarding, credential custody, pinned signer trust/rotation and evidence retention. Prove duplicate/uncertain dispatch lookup, replay/race, window/cancellation and release-gating with genuine isolated acceptance before authorizing any provider operation. Offline preflight and the local synthetic durable generation rehearsal never issue a legal IRN. No provider/test transport, cancellation write, or release is wired. No secrets or customer payloads in Git/chat. |
| **H0–H3 · Hosted target, recovery and controlled change** | First designate O-B1 and separately authorize scoped read-only preflight with exact project and pinned API/TLS, immutable app SHA/deploy and key provenance, operator/window and evidence controls. Reconcile both ledgers, effects, grants/RLS/cache, legacy specifics and the **114-file** candidate (see the [forward hashes](GST_WORKSTREAM_B_FINAL_CLOSURE.md#forward-migrations-and-preservation)). Then prove target-bound recovery/isolated restore under separate authorization. DDL/DML, deploy, Auth/synthetic writes or billing activation each require specific written approval. Genuine Auth/PostgREST/role and guest-to-staff acceptance, plus the existing non-GST gates, are not satisfied by local tests. |

No action above grants the next operation. Historical hostnames, ready Preview,
matching hashes, fixtures, or a connected account grant no access or change
authority. The next step is a private outlet decision and, if requested, a
separate written read-only target authorization—not a migration command.

## Historical Priority 1 handoff

**Workstream B · Priority 1 · Offline handoff**

**GO for owner/adviser review only. NO-GO for all hosted work and release.**
Local implementation verified. **All 14 GST/IRP Phase B files: NOT AUTHORIZED**
for hosted use. No outlet is approved to activate by this handoff.

The original worktree is still on `arena/ce32f7c8-autodine` at
`7064c912b1b85ab6364f23d1755d855ff4f462ad`; local `main` still points to the
prior handoff, `3e17c44577a5236dca7dea5b4d35a16c0ffc1186`. The candidate is
uncommitted. The 86-path inventory and six recorded hashes matched;
the other eight Phase B files match both local refs. See the [closure report
and exact file hashes](GST_P1_CLOSURE_2026-11-18.md#phase-b-migration-fingerprints)
and [operator guide](../../docs/gst-two-mode-2026-11-14.md#2026-11-19--ca-approved-product-specification-local-only).

| Evidence | Status |
|---|---|
| **Local implementation** | Prior disposable PostgreSQL **235/235** (GST **41/41**) and scoped Next/Chromium HTTP **10/10**. The fixture does not persist a save or exercise genuine Auth/PostgREST. This handoff rechecked files, hashes and offline inventory only; it did not repeat the suites. |
| **Synthetic upgrade** | **230 passed / 2 optional direct PostgREST skips**, 98→104. The [paid GST sitting refusals](GST_P1_CLOSURE_2026-11-18.md#synthetic-populated-upgrade-findings--legacy-paid-sittings) were reproduced locally, including a classified, paid, closed-but-unissued sitting that could neither issue a document nor save a new config. No payment, history or number changed on refusal. If incompatible records exist on the eventual target, they block the applicable cutover until resolved. |
| **Actual hosted evidence** | **None.** No live rows, affected outlets, project identity, build, ledger/catalog, cache, Auth, backup or restore checked for this candidate. Historical observations are not current evidence. |
| **Owner/adviser decisions** | The CA confirmed the product specification for local implementation only. The outlet decisions below are **pending**; the candidate target is unapproved and no hosted access is authorized. |

## 1. Owner action register

Complete and sign one decision record per outlet, with linked registration
and shared-series evidence where applicable. All seven decisions are open;
selecting an intention to activate is **not approval to change settings**.

| Decision | Responsible | Required signed record (all pending) |
|---|---|---|
| **O1 · Outlet activation or deferral** | Owner | Named legal tenant/outlet and state. Record **ACTIVATE WHEN GATES PASS** or **DEFER**, proposed cutover window, reason and safe interim handling. Undecided or deferred does not authorize use of No-GST or continued issuance against adviser advice. |
| **O2 · Owner/Manager authority** | Owner | Confirm the roster and custodian. Only an entitled signed-in **Owner of the selected outlet** may use the versioned GST save. Own-outlet Managers read config/history but cannot save; commercial-account or other-outlet ownership alone confers no rights. If this split is not accepted, stop; do not broaden grants. |
| **O3 · GST registration and FSSAI** | Owner + adviser | Actual GST registration type/status, dates and legal identity where registered; signed non-registration/no-obligation basis and business name/address/phone otherwise. Supply valid FSSAI licence evidence mapped to every outlet. Format/checksum checks are not registry proof. |
| **O4 · Profile and effective date** | Adviser + Owner | **GST** 5% without ITC or qualifying hotel 18% with ITC; or **No-GST** unregistered or Composition. Record business type, applicable SAC and treatment effective date (India date), distinct from application cutover. Attach signed eligibility/acknowledgment and current FY premises proof if applicable; no invented filing date or backdating. |
| **O5 · Numbering ownership and non-overlap** | Owner + finance custodian + adviser | Name responsible custodian, outlet/registration/FY series and starting/continuing reference; reconcile `INV`/`BOS`/`RBL` with retained legacy numbers and shared-GSTIN/external invoices. The app allocates per outlet, not across outlets or external systems. Defer any overlap that cannot be resolved within the supported series. No resets or renumbering. |
| **O6 · Adviser confirmation** | Adviser signs; Owner acknowledges | Dated signed packet for the named registration/outlet with supporting references, conclusion/effective period, exclusions and review triggers. Address actual eligibility, catalog/alcohol, turnover/B2B holds and corrections as applicable; see §3. No inferred sign-off from the CA product confirmation. |
| **O7 · Legacy-record disposition** | Owner + adviser + authorized operator | After separately authorized inventory, record per affected outlet either dated evidence of no blocker or the restricted exception list and approved resolution verified before cutover. Reconcile open and closed-but-unissued paid GST sittings, incompatible saved pricing/identity and needed legacy rollback snapshots. Missing coverage is **unknown**, not zero. Defer a change that could affect unresolved records. |

## 2. Per-outlet sign-off record

Use a restricted owner record, not Git or chat. Reference model:
`[tenant/outlet/state] · [legal registration + FSSAI evidence refs] ·
[role roster ref] · [mode/profile + India effective date] · [series custodian
and non-overlap evidence] · [legacy disposition] · [adviser/sign-off date] ·
[owner decision, date, cutover or deferral/handling]`.
Record current billing state as unknown unless evidenced. Shared
registrations may reference the same evidence, not share a blanket outlet
approval. Do not include real GSTIN/PAN, personal data, secrets or returns in
this repo. An untouched legacy plain receipt is not a reviewed retail bill.

## 3. Evidence to request from the GST adviser

For the signed packet in O6, name the adviser, reviewed legal registration(s)/outlet(s), effective period, evidence references, conclusion, exclusions and conditions that require re-review (for example a registration, premises, turnover or catalog change). The owner records the matching decision and any required acknowledgments. A checksum, valid-looking input, code default, or local test is not evidence of eligibility.

| Item | Required artefact and explicit conclusion |
|---|---|
| **Registration and outlet mapping** | Dated GST registration certificate/portal extract or documented non-registration basis, with effective/status dates. Reconcile the seller record in §2 and the outlet's state/place of supply; identify branches using the same GSTIN/PAN. Confirm consistent legal name, registration type and state for a shared GSTIN, and PAN-level treatment across registrations/accounts, not just within the app's commercial account. Flag any mismatch or unsupported supply. |
| **No-GST · Unregistered (`off`)** | Written basis for unregistered retail billing, absence of registration and obligation, approved business name/address/phone and FSSAI. Check legacy non-GST add-on charges before cutover; the reviewed retail path does not add tax or print a GSTIN. A missing config row is not adviser approval. |
| **Composition** | Evidence of valid Composition registration and dates; adviser calculation of eligibility and turnover basis, with a finding on alcoholic liquor, tobacco, inter-State outward supplies and supplies through a TCS-collecting e-commerce operator. Owner signs the eligibility acknowledgment. Confirm Bill of Supply, the notice “Composition taxable person, not eligible to collect tax on supplies”, no GST collection and no ITC. The app does not require a CMP-02 reference; do not turn that into an activation prerequisite. |
| **Regular 5% or 18%** | Identify the precise supported profile and basis, the qualifying supply/premises and treatment date. Record business type and the applicable six-digit service SAC. Standalone restaurant service and nonqualifying hotel restaurants: 5% without ITC. For qualifying hotel 18% with ITC, document the **preceding FY actual room supply value > ₹7,500 per unit per day** or a **valid opt-in filed within the applicable period**. Record the treatment FY, evidence reference, relevant filed date/applicable filing period or actual value/FY, owner attestation, and effective date (within the relevant current India FY, on/after **2025-04-01**, not future-dated). Review annually; the app does not select a filing deadline or accept a tariff alone. Confirm inclusive menu pricing, one document-level extraction, intra-state split and the odd paisa to CGST, and applicable ITC treatment. If the adviser requires a different profile or tax treatment, defer that scope rather than forcing a selection. |
| **Turnover and B2B** | Preceding financial year and dates, PAN-wide aggregate and included registrations, source returns/accounts and reconciliation, amount in rupees and exact paise, and explicit known/unknown status. Obtain a separate applicability conclusion, including whether any earlier FY or other statutory fact changes it; the current app tests the **recorded preceding-FY** figure, not a full legal history. Confirm how operators verify a Regular buyer's legal name and GSTIN (buyer state is derived; billing address and email are optional in the app), and what to do if an unsupported supply needs different treatment. Composition and unregistered retail do not accept B2B GST details here. Request a named escalation owner and approved interim handling if a document must stay on hold. If the app does not match the adviser's conclusion, defer affected use; never enter guessed turnover or omit buyer details to avoid a hold. |
| **Alcohol classification** | Dated outlet catalog reconciliation with a decision for each affected live, imported, draft or unavailable item and disposition of uncertain/old entries. Use explicit item classification supported by the outlet's inventory/supply record, not names or AI. Confirm the outlet may use its proposed mode: Composition cannot have flagged alcoholic items, and this Regular flow cannot bill those lines. Document how to handle any catalog/restoration exception or defer. |
| **Series allocation** | Reconcile FY numbers with legacy invoices and any other billing systems. These are per-outlet INV/BOS/RBL counters, not a shared-GSTIN allocator. Defer any shared registration or existing external series with overlapping numbers unless its non-overlapping allocation has been independently confirmed and can be supported. Do not renumber history or reset counters. |
| **Corrections and reporting** | Dated procedure for erroneous, held or voided documents and when full-source credit/debit notes or audited void/reissue are lawful. Specify who approves corrections, supporting records, cutoff/return reconciliation and escalation when partial adjustment or a refund is required outside this feature. Preserve source invoice/payment amounts and numbering; a note is not a cash refund and the GST CSV is not a statutory return. Active notes block source void; an authorized note against a held source remains nonfinal. A lawful reissue consumes a fresh number. Do not share a held or voided tax invoice, overwrite snapshots, or reuse numbers. |

**Current B2B hold boundary only:** Regular B2C and Regular B2B with recorded preceding-FY AATO **≤ ₹5 crore** (`5,000,000,000` paise) are `not_required` in this implementation. Unknown or above-threshold Regular B2B records `irp_status='pending'`: nonfinal in the document/print view, with no new share or access via a previously minted link. No validated IRN path or IRP work is in scope.

<a name="4-read-only-staging-preflight--prepared-not-authorized"></a>

## 4. Future read-only hosted preflight — blocked and not authorized

### H0 · Exact target and authorization record

| Identity | Pin and limit |
|---|---|
| Supabase | `autodinetest`, ref **`juwyhslzchjevqkdvwjm`**, API origin `https://juwyhslzchjevqkdvwjm.supabase.co`, recorded direct DB host `db.juwyhslzchjevqkdvwjm.supabase.co` (historical region `ap-northeast-2`). Confirm project identity and connector/DB destination from provider metadata, not just a DB name such as `postgres`. |
| App | Vercel project `new`, **Preview** only. Repo-pinned origin: `https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app` ([guard](../../scripts/staging/verify-acceptance-env.mjs)). This is a prior branch pin, **not** a GST candidate deployment. Verify the current alias assignment, immutable deployment ID and built Git SHA. If the build/origin needed for inspection differs from the approval, stop and obtain a new pin; do not follow redirects or assume a mutable alias is safe. |
| Excluded | Production (`autodine-production` / `bdbaqpevwmgdvghszjno`), protected Staging, and any undesignated backend. No read or connection here. If the owner chooses a separate isolated project, re-pin the verified identities under separate approval; do not follow the old pin. |

**Nothing is designated or authorized by this table.** The repo pin is
historical; the listed project may not be isolated or entirely synthetic.
No provider call, SQL connection or REST request can begin until:

1. **Written O-B1 designation** names one exact isolated, non-production
   target and confirms it is not protected Staging. Record project ref, API
   origin and exact TLS database endpoint/destination. No selection by name
   alone and no default to `autodinetest`. See the [master register §2.6](MASTER_OWNER_ACTION_REGISTER.md#tier-2--launch-communications--operations).
2. **Exact scope and identity** name the authorized metadata to inspect,
   expected Preview project/origin and immutable deployment ID + built Git
   SHA (or verifiable artifact identity), and expected build/runtime backend
   and key provenance. Do not claim the uncommitted candidate is already
   deployed. A missing matching authorized deployment or uncertain binding
   blocks the corresponding app/API check; do not build, deploy or switch
   aliases to unblock it. Verify the pins with approved metadata before
   opening SQL/REST connections.
3. **A separate written read-only authorization** names approval ID, owner
   approver, operator, UTC window, allowed metadata/catalog/ledger queries,
   bounded aggregate scope and approved outlet IDs, optional REST metadata
   and zero-row projections/roles, redacted evidence destination and stop
   conditions. Use an existing project-scoped least-privileged read-only
   principal over verified TLS, bounded `READ ONLY` transactions, and only
   already valid approved project credentials or sessions for permitted
   REST reads. If safe access or a required pin cannot be verified, stop.
   No logging keys, customer/order rows, credentials or tokens.

### Separate approvals — none granted here

| Action | Separate express written approval required |
|---|---|
| **Read-only H1 preflight** | After O-B1, approve the exact non-production target and limited reads above. It grants **no** other action. |
| **Backup or restore (H2)** | Keep the existing hosted backup/restore deferral. Authorize any new backup separately; a restore requires the named backup/recovery point, isolated disposable destination, operator and window. Never restore to Production or protected Staging. Verified recovery evidence is a gate before a later change, not a drill to run during preflight. |
| **DDL / migration / operational change** | Approve the exact target, ordered files and hashes, dependencies, stop/recovery plan and window after reconciliation and recovery proof. An owner operation, grant/catalog fix, ledger repair, bundle replay or reload is not included in a read-only approval. All 24 GST/IRP files in the current manifest remain NOT AUTHORIZED. |
| **DML / data disposition / synthetic placement or Settings acceptance (H3)** | Approve the specific data or isolated fixture scope, roles, permitted actions and cleanup. Even a test expected to be denied, sign-in/refresh, fixture creation, cancel/reissue or a test save is outside H1. Any legacy resolution that needs a write has its own approval; this register only records the decision. |
| **Deploy / configuration / release** | Approve exact compatible build, destination and window, including any environment pin or alias changes. Stage, commit, push, merge, deploy and promotion are not authorized by an evidence review, target designation or migration approval. Production authorization is separate and not in scope here. |
| **Live activation** | After applicable gates and acceptance, approve named outlets, exact configurations, operator and cutover. `ACTIVATE WHEN GATES PASS` and a synthetic pass are not activation or release approval. |

No writes, business RPCs (including receipt/share operations that can update
access/audit counters), fixture or Auth changes, cache reload, recovery
operations or probes of excluded environments in H1. No IRP/e-invoice, full
guest-to-receipt E2E, Realtime or later-priority work in this handoff.

### H1 · Ordered checks and pass criteria

1. **Prove isolation before any SQL or API request.** Read only the approved target's provider metadata, if authorized. Record observed ref, endpoints, environment and immutable deployment-to-commit binding. Review the deployment's effective **build and runtime** binding: `NEXT_PUBLIC_SUPABASE_URL` must be the pinned API origin, `AUTODINE_EXPECTED_PROJECT_REF` must match the designated ref, and both public and any server keys must originate from that project, without copying their values. Compare with the [isolation requirements](../../docs/preview-isolation.md). New-style keys do not encode their ref; use provider/operator provenance, not prefix or inferred `READY` status. Confirm no Production inheritance, alias promotion or checkout linked to another ref. If metadata or access is insufficient, mark **blocked**, not healthy-by-assumption.
2. **Capture and reconcile both ledgers.** Use an existing approved least-privileged TLS connection for the pinned project; no shared writable SQL session. Use short, bounded read-only transactions; if the tool cannot guarantee the boundary, stop. Capture DB version/time as evidence, not as target identity. This is a template for a future authorized operator, **not executed**:

   ```sql
   BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
   SET LOCAL statement_timeout = '10s';
   SET LOCAL lock_timeout = '1s';
   SHOW transaction_read_only; -- must be on; otherwise stop and roll back
   SELECT current_database(), current_user, current_setting('server_version'), statement_timestamp();
   SELECT to_regclass('supabase_migrations.schema_migrations') AS native_ledger,
          to_regclass('supabase_migrations.arena_staging_upgrade_manifest') AS bundle_ledger;
   -- Read each ledger only after checking those columns and SELECT access.
   SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version, name;
   SELECT filename, sha256, applied_at FROM supabase_migrations.arena_staging_upgrade_manifest ORDER BY filename;
   ROLLBACK;
   ```

   Record missing/denied separately. No raw migration `statements`, secrets or business rows in the output package. Join **offline** against the [104-file inventory](../../docs/migration-manifest-2026-11-14.md), matching native names/versions (including console timestamp/name mappings) and bundle filenames/hashes to exact source bytes and verified effects. Check the historical 49-source artifact's `SOURCE` entries in [approved-upgrade.sql](../../scripts/staging/approved-upgrade.sql) for provenance only. The [historical `20261109000400` discrepancy](../../PHASE-5-HOSTED-STAGING-RECONCILIATION.md#20261109000400_order_write_boundarysql-historical-source-byte-investigation) traces to older bundled bytes; recheck the effective revocations and do not count the ledger as independent execution proof.

   For each relevant file, record `filename | repository SHA-256 | native row / bundle record / none | live effect and superseding source | dependencies | disposition`. Use **match / equivalent with proof / absent / partial / conflicting / unknown**. Reconcile all [24 GST/IRP files, each NOT AUTHORIZED](GST_WORKSTREAM_B_FINAL_CLOSURE.md#forward-migrations-and-preservation). `20261114000100` is subscription read hardening, not the B2B GST file. Include prerequisites and any untracked manual/console changes; never infer missing effects from a timestamp, a missing standalone row or an old bundle count. No ledger repair, bundle replay or protected-baseline update. Any unexplained discrepancy blocks a change proposal.

3. **Verify actual catalog effects, effective grants and RLS.** Use the [catalog-only probe](../../scripts/reconcile/catalog-probe.sql) and [offline comparison method](../../docs/migration-reconciliation.md#tools) as a starting point, not as the whole GST check. Capture identities and fingerprints with `pg_proc`/`pg_namespace`, `pg_get_functiondef`, `pg_get_function_identity_arguments`, `pg_get_function_arguments` (REST names/defaults), `pg_get_function_result`, view definitions/security options, trigger definitions and enabled state, `pg_constraint`, indexes, and column types/defaults/nullability. Compare full bodies and overloads to the reviewed candidate (do not equate a source-file hash and a function hash). Check owner, `SECURITY DEFINER`, fixed `search_path`, default ACLs (`pg_default_acl`, including creating roles `postgres`/`supabase_admin`), role inheritance and `BYPASSRLS`. Inspect `pg_class.relrowsecurity`/`relforcerowsecurity`, `pg_policies` (`cmd`, `roles`, `qual`, `with_check`, permissive/restrictive), schema/table/column/sequence ACLs and effective privileges. Check `PUBLIC` grants and use `has_function_privilege`, `has_table_privilege`, `has_column_privilege` and `has_sequence_privilege` for `anon`, `authenticated` and `service_role`. Owner and Manager share the API role `authenticated`; different outlet access comes from the policy and RPC body, not distinct SQL grants. Compare prior and candidate states against these **post-candidate** expectations; a missing candidate object is a compatibility blocker, not evidence of a deny policy:

   | Catalog scope | Expected effect to compare |
   |---|---|
   | `restaurant_gst_config`, `restaurant_gst_config_history`; `save_restaurant_gst_config(uuid,integer,jsonb)` | Both tables use member-scoped Owner/Manager SELECT policies; no direct app-role writes or anon/public access. Check effective grants, including columns. Only `authenticated` among API roles executes save; live Owner membership locked after the outlet lock, `restaurant_can_write`, version, open/closed-unissued sitting guards, and FSSAI/business/SAC/evidence checks enforced in SQL. Verify version and audit triggers record `changed_by` / `changed_at`, declaration fields and append-only client history; check old nullable fields; check no old Owner/Manager direct-write policy or overload bypass. |
   | `public_order_pricing(text)`, `gst_pricing(uuid)`, `gst_pricing_at(uuid,date)`, `orders_finance`, orders/lines/catalog | Quote is active-slug treatment/bps only, executable by anon/authenticated. Private pricing and trigger helpers have no client execute. Scoped finance view and order/item snapshot/rate/classification guards are present; compare `set_order_line_quantities` and `place_public_order_attempt` bodies/grants without executing them; no guest-order attempt cap. Check Composition catalog triggers and `restaurants_billing_configuration_guard`. The new cart expects the quote even for legacy receipts; do not put the app ahead of compatible schema/cache. |
   | `issue_closed_session_receipt(uuid,jsonb)`, `close_order_session_and_issue_receipt(uuid,jsonb)`, `restaurant_invoices` / `restaurant_invoice_lines` / `restaurant_invoice_series` and `restaurant_invoice_share_links` | Verify exact callable signatures and defaults; issued-source/void guards, per-ticket settlement, India FY and INV/BOS/RBL uniqueness/prefix/ACL and scoped invoice/line reads. Review the share table/sequence ACLs and `create_restaurant_invoice_share_link(uuid,text)` / `read_shared_restaurant_invoice(text)`: an approved link read is intentionally public by bearer token but cannot return a held/voided document. **Do not open a link** during preflight: the read path can write rate-limit/access/audit records. |
   | `restaurant_notes`, `restaurant_note_events`, `restaurant_note_series`, `report_gst_documents(uuid,timestamptz,timestamptz)` | Owner/Manager own-outlet notes/audit and report access, no client series mutation, no buyer payload in report, read-only saved amounts and distinct document kind/FY/series/status buckets, including reviewed retail. Compare existing `restaurant_irp_requests` and the legacy profile columns on config/history as inventory markers only, not a separate issuance-profile table or evidence of external integration. Check app-facing projections, scope functions (`has_restaurant_role`, `restaurant_can_write`) and prerequisite RLS on memberships, not just a policy name. |

4. **Check legacy compatibility with scoped aggregates only.** Confirm version-dependent columns in the catalog before referencing them. Use the approved outlet IDs and a recorded snapshot time. Do not exclude still-open or unissued sittings by age. Keep only counts, exception codes and restricted case references, not raw records.
   - Join `orders.order_session_id` to `order_sessions.id` within the same `restaurant_id`, using tickets with `orders.prep_status <> 'cancelled'`. Count distinct open sittings and closed sittings with **no** same-outlet/session `restaurant_invoices` row of any status (the closed-unissued save guard). Report void-only or held/nonfinal documents and orphan/unattached tickets separately; flag inconsistent close timestamps. Classify from saved ticket evidence as Normal, GST, mixed or unknown; don't infer from today's config.
   - For those tickets, compare `gst_mode_snapshot`, `gst_config_version` and `tax_rate_bps_snapshot` to the outlet's config the issue path would use; use history to explain differences, not to approve issuance under a mismatched version. Flag missing or invalid registration/FSSAI/business/SAC and applicable premises proof; check `order_items.is_alcoholic_snapshot IS DISTINCT FROM FALSE` on GST tickets, discounts, missing lines, mismatch with `sum(qty * unit_price_paise)`, and 18% tickets outside the approved effective date/FY in `Asia/Kolkata`. Compare `payments` at `status='recorded'` by `restaurant_id` and **each** `order_id` to that ticket's `total_paise` (never pool surplus). Review Normal exceptions separately; do not reprice ordinary historical receipts.
   - Check `restaurant_publish_history.snapshot.menu_content.items` for missing/NULL `is_alcoholic` on a needed menu restore. Brand-only snapshots without `menu_content` aren't unclassified menu restores. Review live/draft/unavailable alcoholic items for Composition. Compare preservation baselines for config/history, already-issued/held/voided documents/lines, note and invoice series, payments and link records with scoped counts/approved fingerprints (no buyer data or token hashes).
   - Record **unknown**, not zero, if the schema, access or evidence cannot support a check. Before any applicable cutover, record O7 for open and closed-but-unissued GST sittings (paid, partially paid or unpaid) and any incompatible menu rollback, or defer with written safe handling. The synthetic paid refusal does not assert that a live row exists. A deferred outlet still affected by a shared app/schema change does not clear the blocker. The active-ticket save guard also covers Normal sittings. Do not close, settle, reprice, collect twice, backfill, revoke or restore anything during preflight.
5. **Check PostgREST metadata/cache without executing a business RPC.** When specifically authorized, use only the pinned REST origin, no redirects, a key for that project and existing staging synthetic user sessions for authenticated reads (no login/refresh/token minting or app navigation in this step). Compare a bounded `GET /rest/v1/` with `Accept: application/openapi+json`, if permitted, to the SQL catalog: relation names, required columns, RPC path/verb, parameter names/types/defaults and role-appropriate visibility. For Settings, compare the loader's required projection and at minimum the version/declaration columns with separately approved zero-row GETs, for example (not run):

   ```text
   GET /rest/v1/restaurant_gst_config?select=restaurant_id,config_version,off_declared,off_declared_at,fssai_number,business_type,service_sac,premises_evidence,retail_phone&limit=0
   GET /rest/v1/restaurant_gst_config_history?select=restaurant_id,config_version,off_declared_at,fssai_number,business_type,service_sac,premises_evidence,retail_phone&limit=0
   ```

   Record role, projection, status and error code only. Candidate RPC checks include `save_restaurant_gst_config` (`p_restaurant_id`, `p_expected_version`, `p_settings`), `public_order_pricing` (`p_slug`), and `report_gst_documents` (`p_restaurant_id`, `p_from`, `p_to`). Compare other callable signatures in the catalog matrix as exposed; inspect private helpers in SQL, do not invoke them. `PGRST202`/`203` (function missing or ambiguous) and `PGRST204`/`205` (column or relation missing from cache) need diagnosis, not a fallback. If OpenAPI is restricted, permission is denied, expected schema is not applied, or there is no approved valid session, mark that check **blocked/pending**, not current or denied-by-design. Do not escalate to a service key, force reload/`NOTIFY` or call a mutation. Recheck metadata under separate authorization after any separately approved change. Catalog match, empty GET and `/api/health` cannot prove runtime authorization.

**H1 artifact:** approval ID, UTC capture window, ref/deployment/build SHA, observed DB version/time and read-only proof, both ledger snapshots with fingerprints, effect/ACL/RLS matrix, scoped aggregate/exception ledger, cache observations, redacted evidence locations, and reviewer disposition per check. Use `VERIFIED`, `MISMATCH`, `BLOCKED`, or `NOT RUN`; silence/skips are not passes. Stop immediately on target drift, unexpected access/data, an unclear method, missing dependencies or a conflicting catalog. Reconfirm identity, evidence freshness and hashes if the deployment, schema, data cutoff or target changes.

### H2 · Restore evidence review — no backup or restore in preflight

Require a dated, target-bound backup/PITR record (source ref, usable restore point and UTC, retention/coverage, backup manifest and checksum if an artifact). Require a completed drill using that baseline on an explicitly authorized **separate disposable** target, never Production or protected Staging. Record drill target and isolation, verification report, evidence that ledger/schema/function/ACL/RLS fingerprints and expected row counts match, and financial checks for GST versions/history, immutable invoices/lines and numbering, notes, recorded payments and old link records. Record the recovered cutoff/data loss and elapsed time to verified readiness against **owner-approved RPO/RTO**; mark unknown if missing. Record cleanup/authorized retention and who may stop and recover a failed cutover. The prior function-only capture exception and synthetic local upgrade are **not** current hosted restore evidence. The [master register Tier 1](MASTER_OWNER_ACTION_REGISTER.md#tier-1--the-backup-gate-blocks-everything-downstream) records hosted backup/restore as deferred; H2 stays blocked without verified evidence. This package does not lift that deferral or authorize a drill. See [recovery evidence requirements](../../PHASE-7-RECOVERY-RPO-RTO.md).

After recovery evidence and drift/legacy dispositions are accepted, any proposed Staging change needs its own exact ordered filename/byte-hash and dependency list, pre/post catalog markers, compatible app build, window, stop authority and recovery artifact. Do not authorize by phase label, the historical bundle or a local green run. Apply, deployment, Auth/fixture writes and activation are distinct decisions, none granted here.

## 5. Owner verification of Settings authority — later, settings only

**Now, offline:** review the [CA verification matrix](GST_P1_CLOSURE_2026-11-18.md#implementation-versus-specification) when the outlet role/entitlement roster is supplied. Disposable PostgreSQL passed **235/235** (GST **41/41**), including membership/entitlement, config and concurrent numbering checks. The Next Settings action passed in the **10/10** loopback fixture run; the fixture does not persist a save. The populated **98→104** rehearsal also seeded a closed-unissued sitting before the CA pair; **230 passed / 2 optional PostgREST HTTP skips**. These are not genuine Auth, hosted grants/RLS/cache proof or a hosted save.

**Later, only with separate written authorization:** after H0–H2, on an explicitly approved isolated synthetic fixture with the reviewed app/schema and cache verified, run the matrix below. Provisioning/login, POSTs (even expected denials), entitlement changes, and any setup or cleanup are outside read-only preflight. Do not test on a real tenant or use a service/admin key as a client actor. There is no need to activate a real GST mode: use a valid synthetic unregistered retail save for the positive write. Use fixture A and sibling B in one account and foreign outlet C, with distinct populated synthetic configs/history. For successful saves use an entitled synthetic unregistered outlet with business name/address/phone and no open or closed-unissued noncancelled tickets. Include Owner A, an account owner without membership in the target outlet, an Owner with A/B for the stale-tab case, Manager/Cashier/Kitchen A, unassigned and signed-out sessions, and a read-only Owner. Use separate browser contexts and actual project-scoped Auth sessions; never transplant another actor's cookies/token.

- **App path:** go to `/dashboard/settings` → **GST billing** → **Save GST configuration**. For the bounded negative POSTs, use the same deployment's native form action descriptor (see [local fixture spec for request shape](../../e2e/gst-http-fixtures.spec.ts)), same origin and the test actor's own session. Submit `gstOutletId`, the observed `configVersion`, `billingMode=no_gst`, `noGstSubtype=unregistered`, `fssaiNumber=01234567890123` (synthetic) and `offDeclared=on`; leave `offHasObligation` unchecked. Preserve normal CSRF checks. An invalid descriptor or rejected origin is not a GST role refusal.
- **Data API path:** using the approved project public key and each actual actor's access token, read config and history with `restaurant_id=eq.<fixture UUID>` and a minimal projection (including version and history `changed_by`/`changed_at`). For the authorized POST tests only, call `/rest/v1/rpc/save_restaurant_gst_config` with `p_restaurant_id` set to the synthetic UUID, `p_expected_version` to the observed integer version, and `p_settings={"mode":"off","fssai_number":"01234567890123","off_declared":true,"off_has_obligation":false}`. Use well-formed inputs and verify the positive path for the same build, schema and cache.

| Case | Procedure and passing evidence |
|---|---|
| **Entitled Owner A** | In a clean session select A → **Settings → GST billing**. Record A's initial version/history count. Save the approved synthetic declaration once. Confirm the persisted version `v → v+1` and exactly one new A history row with that Owner, timestamp, synthetic FSSAI and declaration, and no GSTIN on the active unregistered row; B/C unchanged. Verify the authenticated Data API RPC `save_restaurant_gst_config` accepts the same scoped contract on a separate fresh fixture/version. |
| **Manager A** | Same outlet in a different real session: GST fields are read-only, with own config/history visible via authorized reads (not a claim of a history screen). Attempt the GST action and direct RPC; expect the Owner-only action error and SQLSTATE `42501` via the API, with no version or history write. Neither “RPC missing” nor an empty fixture proves the refusal. |
| **Other roles / entitlement** | Cashier, Kitchen, unassigned and signed-out cannot load private config/history or save. Read-only Owner can read own but cannot save (`P0001` from the authorized RPC test). Verify both write paths and unchanged state. Confirm by ACLs and an explicitly authorized, bounded raw table write-denial test on synthetic rows that even an Owner cannot bypass the save. |
| **Scope and race** | Verify B/C have rows using their own permitted actors first. With Owner/Manager A or a commercial-account owner without target membership, a forged `ad_outlet` cannot select or reveal an unauthorized outlet; a mismatched form and direct B/C saves are denied with no writes. With an Owner allowed in both A/B at the same version, open A, switch to B in a second tab of that session, then submit stale A: refuse; neither changes. With two A saves using the same expected version, one commits and adds one history row; the other must reload. |

For each row record approval, fixture/actor alias and actual membership, build/project, read/write layer, expected/observed redirect or HTTP/SQL denial, and before/after state. `42501`, a server-action error redirect, or an RLS-filtered empty result can be legitimate depending on the layer; prove the positive path on the same schema/cache and compare row state, not status text alone. If a negative case commits or discloses rows, stop and retain evidence; do not attempt cleanup or broaden grants. This matrix does not begin guest-to-receipt E2E, Realtime, or IRP/e-invoice work.

## Closure rule

Keep **GST NOT DONE** until every required gate has actual dated evidence: outlet decisions and adviser sign-off, Owner/Manager authority, isolation, reconciled migration/catalog/cache parity, legacy disposition, verified hosted recovery and required hosted acceptance. An H3 pass would cover **Settings only**; it does not satisfy separate hosted billing/document continuity or release gates. No deferred outlet counts as activated, and no acceptance result substitutes for separate activation approval.

**This historical handoff ended offline.** No hosted access, fixtures, SQL, migration, deployment, restore, GST activation or Git index/ref/remote mutation was performed. No connected account, file hash or comparison supplies approval to proceed.
