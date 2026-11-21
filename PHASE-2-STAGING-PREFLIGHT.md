# Read-only staging preflight — PR 174

## Scope

Inspected only the Supabase project identified by list_projects as `autodinetest`
(`juwyhslzchjevqkdvwjm`, ACTIVE_HEALTHY, PostgreSQL 17.11.0.018). The separate
`autodine-production` project was identified in project metadata only; no SQL
query was run against production. No customer/order rows, API keys or secrets
were retrieved. No mutation or migration was executed.

PR 174 is OPEN at `64ce1eaec4420a44ae4d07324ff6d615418e345e`.

## Observed migration ledger

The staging ledger records an historical scaffold, the initial repository
migrations under generated versions, `arena_staging_forward_upgrade_55`, and
`operational_readiness_catalog_probe`. It does not list the four new Phase 1/2
migration names. Because staging has bundled/historical ledger entries, do not
run a blind full-history push solely based on missing repository filenames.

## Observed function catalog

- `place_public_order_attempt`: absent.
- Old six-argument `place_public_order`: present, anon/authenticated executable.
- `record_counter_payment`, `settle_online_payment`, `cancel_order`,
  `set_order_line_quantities`: present; their bodies lack the new explicit
  `FOR UPDATE OF s` session lock pattern.
- `open_table_session`: present; no `FOR UPDATE` pattern in its body.
- `operational_schema_readiness`: present, not anon/authenticated executable.
- Counter collection remains authenticated-only; provider settlement is not
  anon/authenticated executable.

Body hashes captured for repeatable drift comparison:

| Function | md5(prosrc) |
|---|---|
| cancel_order | 4dd19752f4108536024a0418afc77e4b |
| open_table_session | 196e2aeba5f3955e0c025fa7618c70ee |
| record_counter_payment | ed721313afc568cd8754707c9ee215a3 |
| set_order_line_quantities | 633ba6d2eda433b39650a6573da3807b |
| settle_online_payment | 145e808e862fef95dc7b4784599d5223 |

These pattern observations establish that the new implementations are not
present; they are not an exhaustive proof that every other live body matches
repository history. No function definitions were changed.

## REST transaction inspection

No pg_db_role_setting entries were found for `pgrst.db_tx_end` or
`pgrst.db_tx_rollback_all`. That does NOT prove the running REST service's
configuration or commit semantics. HTTP/PostgREST persistence and client
`Prefer: tx=rollback` behaviour remain untested. No API key retrieval was needed.

## Conclusion: cutover is blocked pending approval

The PR app requires a new RPC that staging does not have. New app/old schema
ordering is incompatible, irrespective of green build/CI. Runtime Vercel target
mapping, active consumers, proxy provenance, backup/restore access and real REST
persistence still need verification before any guest reopening.

Proposed next scope, requiring explicit approval:

1. Confirm all active consumers of this nonproduction database and restrict
   staging ordering during the coordinated cutover.
2. Validate reviewed four-migration delta against the actual staging bodies,
   preserve pre-change fingerprints/ACLs, and use transactional approved
   migrations (no resets, no historical ledger rewriting).
3. Deploy/associate only the matching staging app SHA and verify isolated
   REST/guest fixtures. Preserve all existing data.
4. Record before/after evidence and reopen staging ordering only after checks.

Do not merge/deploy to production or apply migrations based on this read-only
report. Independent review and explicit staging mutation approval remain gates.

## Vercel connector scope

Project search for `autodine` returned no projects both in default scope and in
all teams returned by the connected account (one team). Thus this connector
session did not establish the relevant deployment's runtime database target.
This is an access/scope limitation, not proof that the GitHub preview is absent
or that it uses staging. No environment-variable values or deployment logs were
retrieved, and no deployment/settings change was made.

## Follow-up: actual Vercel project found through PR metadata

The earlier name-search limitation is resolved: GitHub's Vercel PR comment
identifies project `new` (`prj_S6aU68euwLsJsaEdzolSdsJHSyS7`), not `autodine`.
A read-only get_project confirms its preview deployment
`dpl_E3Qi1QGcQ9nwxAru6H899AbnYaub` is READY for exact SHA
`64ce1eaec4420a44ae4d07324ff6d615418e345e`.

**Isolation warning:** visible default preview/development configuration for
NEXT_PUBLIC_SUPABASE_URL points to the production project
`bdbaqpevwmgdvghszjno`, not the inspected staging project. The response also
contains branch overrides for an earlier branch. Because the project response
was truncated, absence of a current-branch override cannot be asserted and the
immutable deployment's effective runtime target remains unproven. Treat this
preview as potentially production-connected: do not submit orders, scan/verify
sessions or run mutating probes against it.

The project metadata endpoint included environment configuration automatically;
no secret was decrypted, no credential is copied into this report and no
configuration was changed. Before testing, explicitly scope the current branch
to a complete matching staging configuration, ensure no production service
credential is inherited, then deploy a new preview and verify its target.
Those changes require separate approval.

GitHub review list is empty at this SHA. Independent review remains outstanding;
no review request was sent to an unapproved/guessed reviewer.

## Approved isolation follow-up: secure configuration gate

User approved current-branch preview isolation. Repository inspection found only
.env.example, no local staging credentials. GitHub secret-name enumeration
returned HTTP 403 (integration permission); GitHub secret values are not a
retrievable transfer source regardless. Do not overwrite configured GitHub
secrets or ask for credentials in chat.

The app accepts both modern and legacy credential names:
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY and
SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY. Both pairs must be audited so
legacy production credentials cannot be inherited. Setting only the staging URL
is not a complete isolation operation. No partial override or redeployment was
made while a secure complete staging configuration was unavailable locally.

Next secure configuration action: in Vercel project `new`, scope preview
configuration specifically to `arena/7596a37b-autodine`, using the staging
Supabase URL and staging-only public/server credentials, plus a staging-only QR
verification secret. Remove/override production fallbacks for this branch only.
Do not alter global preview or production settings. Verify target and credential
scope before any new preview deployment or mutating probe. Configuration can be
supplied through provider dashboards, never chat or committed .env files.
