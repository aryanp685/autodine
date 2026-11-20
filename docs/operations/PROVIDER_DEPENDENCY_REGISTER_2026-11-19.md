# Provider and owner dependency register — 2026-11-19

Everything this release candidate needs from outside the repository, with the
exact state, the evidence that establishes it, and what only the owner can do.
Nothing here is authorization. `BLOCKED` means no safe local step remains;
`NOT AUTHORIZED` means the decision has not been made.

| # | Dependency | State | What exists today | What it blocks | Owner action to close |
|---|---|---|---|---|---|
| 1 | IRP provider + sandbox | **NOT AUTHORIZED** | A local simulator (`lib/gst/irp/execution/simulator.ts`) behind an explicit rehearsal identity; no credential, endpoint or network adapter is resolved at runtime; the register is read-only in a normal production build | Any hosted IRP rehearsal, any real IRN, any legal release | Name the provider, contract or sandbox, sign the data-processing terms, and authorize one exact target + one exact action. Until then a simulated reference is never called an IRN |
| 2 | IRP production credential | **NOT AUTHORIZED** | None. `getIrpPreflightGate` refuses `VERCEL_ENV` production/preview and any non-`sandbox` provider (`lib/gst/adapter.ts`, pinned by `lib/gst/adapter.test.ts`) | Legal e-invoice issuance | Separate written approval after item 1, with a key-custody plan and a cancellation-window check |
| 3 | Payment gateway | **NOT AUTHORIZED** | No live aggregator. Cash and manually verified UPI are recorded per order; subscription refunds are `service_role`-only | Card/UPI-auto collection, automated settlement | Select a provider, complete KYC, authorize a sandbox then one live pilot |
| 4 | Supabase Staging | **BLOCKED / NOT AUTHORIZED** | Only two projects exist: `autodinetest` (candidate, ledger drift incl. `20261119101121 announcement_claim_recovery` applied today) and `autodine-production`; a distinct Staging project does not exist | All 14 hosted acceptance points | Designate or create the Staging project, resolve the drift, authorize the per-file migration set |
| 5 | Supabase Production | **NO-GO** | Read-only metadata only; no deployment, no migration, no fixture | Production release | Separate gate: recovery evidence, authorized migration set, acceptance sign-off |
| 6 | Vercel deployment | **NOT AUTHORIZED** | Local hermetic production build only (`next build` 28/28 pages). No promotion, no alias change | Hosted acceptance, release | Authorize one exact branch/commit/environment |
| 7 | Email (Brevo) | **PARTIAL** | Domainless phase implemented; Preview sender verified; Production sending and the branded domain are separate approvals | Staff invites/resets on a host, branded customer email | Complete the domain purchase/DNS steps and approve Production sending |
| 8 | Backblaze B2 backup | **SELECTED, DEFERRED** | Implementation complete and parked; no bucket, key or dispatch | Hosted backup/restore evidence (acceptance point 14) | Resume the handoff in `docs/operations/B2_BACKUP_IMPLEMENTATION_HANDOFF.md` |
| 9 | Monitoring / paging | **PARTIAL** | `[autodine:alert]` log-line format and incident registry; no external pager | S1/S2 response inside the escalation targets | Choose a pager, approve its secret names, wire the escalation ladder |
| 10 | GST portal | **NOT APPLICABLE locally** | Offline JSON preparation and validation only; no portal upload | Filing, e-way bill | Out of scope until the provider decision (item 1) |
| 11 | Domain / DNS | **NOT AUTHORIZED** | Not purchased | Branded links, deliverability, TLS on a custom host | Purchase and configure, then re-check email and cookies |
| 12 | Legal/CA sign-off | **NOT AUTHORIZED** | Composition declaration text and invoice content rules are implemented and tested; no CA letter | Live GST invoicing for Composition and Unregistered outlets | CA reviews the invoice/declaration text and the reporting rules |

## Dependency order

1. Supabase Staging designation and drift resolution (4) — unblocks every
   other hosted step.
2. Recovery evidence for that target (8) — acceptance writes synthetics.
3. Authorized migration set per file (4, 5) — the register lists 26 GST/IRP
   files plus `20261118002000` and `20261118002100` as **NOT AUTHORIZED**.
4. Deployment authorization (6) — one commit, one environment.
5. Provider decisions (1, 2, 3, 12) — tax and money paths never run on an
   inferred approval.
6. Operational readiness (7, 9, 11) — needed before customers, not before
   synthetic acceptance.

## Rules

- A successful local simulation never grants a hosted authorization.
- A candidate project id, a Preview environment variable or an old approval is
  not evidence of a designated target.
- No secret value is written to this repository, a log or a chat message; the
  preflight script reports presence by name only.
