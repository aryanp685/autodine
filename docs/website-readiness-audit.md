# AutoDine website readiness audit

> **Historical snapshot, superseded (2026-11-12).** This audit's production claim—28 migrations behind with `/api/health` returning `ok: false`—describes the pre-rollout state from 2026-11-11 and is no longer the current recorded status. The 2026-11-12 [handoff report](autodine-handoff-report-2026-11-12.md) records the production rollout and application merge as complete. This branch did not re-query production; verify live state before taking action. The NO-GO launch assessment below remains relevant for unverified backup/restore, monitoring, real-device, hosted integration, and capacity gates.
> The rest of this file is kept as the reasoning behind the readiness verdict.
>
> Three specific claims below are now known to be out of date, and are left as
> written because they were accurate when recorded:
> - "The Realtime publication has zero tables" — rechecked 2026-11-11: both
>   projects publish `orders` and `table_waiter_calls`.
> - "Realtime reports `db_connected=false`" — rechecked 2026-11-11, both
>   projects report the `auth`, `db`, `rest` and `pooler` services healthy.
> - "six of 45 repository migrations applied (39 remain)" — staging has since
>   received the bundled forward upgrade and is schema-complete.

## Continuation update (2026-10-28)

On `autodinetest` only, migrations `20261021000005_public_place_order`, `20261021000006_table_qr_verification`, and `20261021000007_table_qr_provisioning` were applied after the earlier snapshot. The hosted project now has six of 45 repository migrations applied (39 remain), plus the local-only scaffold. A catalog check confirmed 16/16 public tables have RLS enabled and 22 policies exist. The expected QR/order functions are present, but `restaurant_can_write(uuid)` and later migration dependencies are not yet available. The Realtime publication has zero tables. Its database clock remains future-dated at 2026-11-08 versus the authoritative 2026-10-28 date; do not run date-sensitive tests. An authorized metadata-only lookup confirmed production is active/healthy, but the connector returned no backup/PITR settings; no production database rows or configuration were accessed or changed, and no restore test was run. This is progress, not a passed full-schema or app-integration gate.

**Snapshot:** 2026-10-28 · branch `arena/e9e78732-autodine` · latest reviewed code `068dd68`; website audit update `04635e0` (active branch; not merged or deployed).

**Latest hosted checks on audit commit `04635e0`:** CI `42505924731` passed; browser E2E `42505924527` passed (64 passed, 47 skipped, 0 failed); isolated PostgreSQL/browser E2E `42505924515` passed. These doc-only commits do not change application code.

**Current decision:** **NO-GO for a broad commercial launch.** The website has broad UI and application-level test coverage, but not all real service journeys are verified. A carefully limited one-restaurant pilot could be considered only after the P0 gates in the [production SaaS readiness audit](production-saas-readiness-audit.md) pass and there is separate approval for production deployment. This report is not legal/tax approval. GST Option A remains locked.

## Evidence reviewed

- Current repository routes, screens, server actions, SQL migration set, configuration guards, tests, and operating instructions.
- Latest hosted workflow checks on audit commit `04635e0`: CI `42505924731` passed; browser E2E `42505924527` passed with 64 passed, 47 skipped, 0 failed; isolated PostgreSQL/browser workflow `42505924515` passed. The preceding commit's isolated workflow `42467588323` first failed, then passed on failed-job rerun. Its uploaded log artifact could not be downloaded in this environment, so the first failure's cause remains unknown; the new passing run is useful evidence but does not explain that failure.
- Local checks rerun on the same code: `npm ci` (310 packages, 0 vulnerabilities), Vitest (all executed tests passed; five database-gated tests skipped without `THROTTLE_DB_URL`), lint, typecheck, design check, SQL syntax check, hermetic production build, and `npm audit --omit=dev` (0 vulnerabilities). SQL syntax checking does not validate function bodies, privileges, RLS behavior, or deployed-schema parity.
- On the user-designated non-production Supabase project `autodinetest`, three repository migrations plus the explicitly local-only inferred scaffold have been applied. A disposable SQL `place_order` smoke succeeded with two 1,234-paise items and the expected 2,591-paise total, then its fixtures were removed and counts were checked. This project has only a partial schema: 42 repository migrations remain. It is not a live app integration or production-parity test.
- The test project database clock reports 2026-11-08, ahead of the authoritative 2026-10-28 date. Realtime reports healthy service status but `db_connected=false` and `replication_connected=false`; the Realtime publication migration has not yet been applied, so recheck after completing migrations. Do not treat date-sensitive tests as verified.
- The user-provided dashboard screenshot identifies `autodine-production` as **PRODUCTION** and shows “No backups.” This is screenshot evidence, not a live query. Production was not queried, tested, or changed.

## Feature-by-feature status

| Website area / customer journey | Implemented and evidenced | Not yet demonstrated / decision |
|---|---|---|
| Landing, pricing, terms, privacy, responsive layout | Routes render in the hermetic browser suite; latest browser workflow passed. | Demo-mode browser tests do not prove deployed metadata, real account/data behavior, production headers, or customer conversion. Browser workflow historically reports 64 pass / 47 credential-dependent skips. |
| Signup, login, confirmation, password reset, staff invites | UI/actions and unit tests exist; environment-gated integration specs are present. | Real email delivery, live Supabase Auth account lifecycle, invitation redemption and recovery are not verified against an approved test app/account. |
| QR/table verification | Token/code flows and throttling logic exist; isolated local PostgreSQL/PostgREST browser workflow covers throttle behavior. | The actual user-designated test project has not received the full schema; cross-tenant, expired/revoked/replayed-token and abuse cases need end-to-end verification after migrations. |
| Guest menu, cart, checkout, order | UI/unit tests and server-side pricing/idempotency code exist; a synthetic SQL order smoke passed on `autodinetest`; isolated DB workflow has previously proven the order lifecycle. | The hosted test project has only a partial schema; full guest browser → PostgREST → order persistence on the current app is not yet demonstrated. Network-loss-after-commit and repeated-submit behavior need a real test-app run. |
| Owner dashboard, menus, imports, translation, branding, outlets | Screens/actions and many unit/demo-browser tests exist. | Real multi-tenant persistence is not covered by demo mode. AI/translation behavior is mocked without authorized non-production provider credentials. |
| Kitchen and order state | UI/action tests, polling fallback and database announcement logic exist; disposable PostgreSQL lifecycle has advanced a synthetic order through kitchen state. | Realtime delivery/reconnect and authenticated kitchen browser behavior are not proven on the designated project; no restaurant hardware/physical kitchen trial was run. |
| Cashier, payment, session close, invoice/receipt | Counter settlement and immutable receipt flows are implemented; the isolated DB lifecycle previously verified settlement, close and idempotent receipt retry. | Full cashier role/browser authorization on the designated project remains untested. Online guest payments and subscription checkout are not available in the approved scope. Physical printer behavior is not verified; browser/OS printing remains the supported path. |
| TTS / kitchen voice | Route has bounded/authenticated access and unit tests; browser speech fallback exists. | Microsoft Read Aloud is unsupported/without a commercial SLA and has not been verified as a live provider. Treat TTS as optional, noncritical. |
| Health, errors, security headers | Health output is allowlisted/redacted; production config fails closed without required Supabase settings; unit/build checks pass. | `/api/health` is not monitoring. Production response headers, cookie/origin behavior and external scanning were not verified. |
| GST and tax display | Existing configured-rate behavior is preserved under locked Option A. | No legal approval is claimed. Do not change tax behavior or add rates/classifications without written adviser approval. |

## Outstanding launch gates (latest recorded status, not live-rechecked)

The following list is reconciled against the 2026-11-12 hand-off, rather than the older snapshot below. Production migrations and application deployment are recorded as complete; do not rerun the historical schema-gap plan. Live provider state has not been re-queried during this code audit.

1. **Restore readiness:** the production dashboard screenshot showed “No backups.” Establish provider backup/PITR, retention, and a successful restore plan/drill before real orders. No production setting was changed.
2. **Reconcile the production migration ledger (read-only).** The 2026-11-12 hand-off records production rollout complete, but 49 production-only migration versions still need exact catalog classification. Do not edit the ledger or rerun migrations based on version names alone; use bounded, read-only catalog probes and resolve each version before action.
3. **SMTP and email rate limit:** configure through the provider dashboard and test invite/password-reset flows on staging. The hand-off says this remains pending; do not disable `mailer_autoconfirm` absent explicit approval.
4. **Run real app integration:** exercise QR → menu → order → kitchen → cashier/session close → receipt with synthetic data in the test environment; include auth roles, two-tenant isolation, retry/network failure, cleanup counts, and mobile/desktop browsers.
5. **Resolve and verify Preview/Development isolation.** Staging URL and publishable key were updated, but the server secret is masked and its staging value has not been independently verified. Finish retirement of older pre-isolation Preview deployments using the exact-ID process; preserve the latest READY deployment and never delete Production.
6. **Hosted application acceptance:** complete synthetic QR → menu → order → kitchen → cashier/session close → receipt, two-tenant isolation, retry/network failure, and supported mobile/desktop flows on an approved non-production hosted project. Local E2E skipped 49 tests because no disposable Supabase E2E stack was configured.
7. **Monitoring, operations and capacity:** wire health/realtime signals to an approved alert destination; verify alert receipt/acknowledgement, incident ownership, rollback procedure, recoverable backups and a hosted restore drill, real-device/printing acceptance, and capacity sized for the pilot. CI/local evidence does not satisfy these gates.
8. **Release gate:** this code audit authorizes no new production mutation, deployment, merge, or release. Keep tests on isolated non-production systems.

## Owner-controlled billing settings — approved in this review

Only the restaurant owner may change the tax rate or GSTIN. This branch implements that rule in the settings UI, server actions, and a database guard so direct authenticated database writes cannot bypass it. It does not change existing order snapshots, tax math, or GST invoice availability. The migration has not been deployed; production behavior remains unchanged until a separately approved release.

## Quantity contract — owner decision pending

The current behavior caps a requested quantity above 99 at 99, while the SQL description says quantities are bounded from 1 to 99. No choice between rejecting and capping has been implemented as part of this audit; the owner will decide. Until that decision is recorded, preserve existing behavior and do not silently change the client/server/database contract.

## Final assessment

The website is a credible pre-production foundation, not a verified “everything works” commercial service. Local automated checks and selected disposable-PostgreSQL flows pass, but full hosted authentication/role acceptance, app integration, Realtime, operational recovery, and capacity evidence are incomplete. The broad launch decision remains **NO-GO**. A one-restaurant pilot is conditional on passing the gates above, with an on-site owner and a manual fallback for orders. See [production-saas-readiness-audit.md](production-saas-readiness-audit.md) for architecture, tenant/security, capacity assumptions, detailed evidence, cost model, and the complete prioritized go-live checklist.
