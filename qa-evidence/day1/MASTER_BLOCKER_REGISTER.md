# AUTODINE — MASTER BLOCKER REGISTER

**One register. One row per blocker. One owner, one acceptance condition and
one evidence requirement each.**

Date: 2026-11-19 · Supersedes the narrative blocker lists in
`MASTER_LAUNCH_READINESS.md` §3/§3b and `MASTER_OWNER_ACTION_REGISTER.md`
Tier 1–4 (those remain as the owner's working checklists; **this** is the
consolidated view that answers "who moves what, and what closes it").

**Every row is an owner action or a hosted run.** Additional technical
follow-on work is described in `LOCAL_POPULATED_RESTORE_REHEARSAL.md`: the
branch fixes a bare-container restore failure, Mode B value precision loss,
and restore URL overrides. Those changes still require review and integration;
local results do not establish hosted recovery.

**Overall decision: NO-GO because twelve rows are open**, with technical
follow-on integration also pending.

---

## How to read a row

| Column | Meaning |
|---|---|
| **Owner** | Exactly one accountable party. `Owner` = the repository owner. `Owner (via a dashboard)` = the same person, acting in a named third-party dashboard. No row has two owners. |
| **Acceptance condition** | Exactly one observable thing that must become true. Not a description of the work — the end state. |
| **Evidence requirement** | Exactly one artifact that must exist, filed under `qa-evidence/`, proving the condition was met. Names only — never a secret value. |
| **Status** | `OPEN` · `CLOSED` (condition met, evidence filed) · `BLOCKED — OWNER AUTHORIZATION REQUIRED` (the work is ready but a human must authorize a hosted run first). |

---

## The register

| # | Blocker | Owner | Acceptance condition | Evidence requirement | Status |
|---|---|---|---|---|---|
| **B1** | **B2 backup + restore evidence** — bucket and secret state unverified; no hosted backup or restore evidence filed | Owner (Backblaze console → GitHub Settings → two workflow dispatches) | One `Hosted backup (B2)` run prints `uploaded:true, verified:true` **and** one `Hosted restore rehearsal (disposable)` run is green with zero unexplained deltas | The manifest (`counts` + `financialSpotChecks`) and the drill's `restore-report.json` filed under `qa-evidence/day1/`, plus the run URLs | **OPEN** |
| **B2** | **Migration canonicalization** — colliding live function bodies | Owner (a paper decision per body; never an inferred source edit) | Every colliding body has a written decision naming which version is canonical | The signed decision list filed under `qa-evidence/day1/` | **OPEN** |
| **B3** | **Email domain + Brevo SMTP** — no domain purchased; branded sending unclaimable; Authorized IPs must be cleared | Owner (Brevo console + a registrar) | A domain is authenticated in Brevo (SPF + DKIM + DMARC published) **and** Supabase Auth mail is delivered to an owner-controlled mailbox | A delivery record (recipient, timestamp, provider event id — no address) in `qa-evidence/day1/BREVO_DOMAINLESS_ACTIVATION_COMPLETION.md`'s successor | **OPEN** |
| **B4** | **Staging designation (O-B1)** — the test project is a candidate, never designated | Owner (a verbatim written designation) | `autodinetest` (`juwyhslzchjevqkdvwjm`) is designated in writing as the non-production Staging project, **or** a third dedicated Staging project is created and its ref designated | The written designation filed under `qa-evidence/day1/`; if a third project, one repo ref update + `AUTODINE_EXPECTED_PROJECT_REF` re-target | **OPEN** |
| **B5** | **Production trusted-project pin (O-B2)** — the pin is a dashboard value, not in the repo | Owner (Vercel → Settings → Environment Variables → Production only) | `AUTODINE_EXPECTED_PROJECT_REF=bdbaqpevwmgdvghszjno` is set on the Production target only, and a Production build proves the pin | The Vercel build log showing the pin enforced, filed under `qa-evidence/day1/` | **OPEN** |
| **B6** | **Designated demo project list** — the demo seed authorizes no project by default (corrected 2026-11-19) | Owner (names the projects that may carry demo data) | The owner names the designated demo project(s); a later run supplies them in `AUTODINE_DEMO_SEED_APPROVED_REFS` | The designation recorded in this register and the seed run's printed SQL header (project ref only) filed under `qa-evidence/day1/` | **OPEN** |
| **B7** | **Hosted browser evidence** — the guest QR-to-receipt E2E has never run against a hosted stack | Owner (one authorization naming `disposable-supabase-e2e-load`) | One authorized CI run of `disposable-supabase-e2e-load` on a disposable environment is green with `retries: 0` | The CI run URL and its green summary filed under `qa-evidence/day1/` | **BLOCKED — OWNER AUTHORIZATION REQUIRED** |
| **B8** | **Realtime multi-device proof** — needs three devices and a human watching the fallback | Owner (one authorization + an observer) | One hosted run shows the single degradation alert, the fallback, the recovery, and zero cross-restaurant rows | The run log and the observation note filed under `qa-evidence/day1/` | **BLOCKED — OWNER AUTHORIZATION REQUIRED** |
| **B9** | **Alert sink + cron live proof** — the sink is the owner's to point at a human; the cron needs a Production redeploy | Owner (Vercel env var → `AUTODINE_ALERT_WEBHOOK`; then a redeploy) | One real alert is paged, acknowledged and resolved, **and** the cron answers 401 without a header, 401 with a wrong header, 200 with the correct one | The three status codes and the alert delivery id filed under `qa-evidence/day1/` | **BLOCKED — OWNER AUTHORIZATION REQUIRED** |
| **B10** | **Production migration per-file authorizations** — each file needs its own written authorization | Owner (one written authorization per file) | Every migration file that may touch Production has its own authorization naming that file | The authorization list filed under `qa-evidence/day1/` | **OPEN** |
| **B11** | **Billing provider + GST/IRP tracks** — a separate track with its own approvals | Owner (a separate approval track, outside this decision) | A provider is selected and certified, and the GST/IRP/e-invoice migrations are separately authorized | The provider selection record filed under `qa-evidence/day1/` | **OPEN** — out of scope for this decision |
| **B12** | **Auth redirect allow lists (O-B3) + `mailer_autoconfirm` (O-B5)** | Owner (Supabase console; each a separate explicit decision) | The test project's allow-list accepts the Preview origin, and the Production `mailer_autoconfirm` decision is recorded (applied or explicitly deferred) | The two decisions recorded under `qa-evidence/day1/` | **OPEN** |

---

## Closed — do not re-open

| Item | Closed | Why |
|---|---|---|
| **PR #190 — restore drill registration** | 2026-11-19 | Merged as `ff00d38` after its head, base, one-file diff, result blob `793d2a3c` and 15/15 checks were verified. The drill is registered **by name**. |
| **PR #187 — Cloudflare R2 implementation** | 2026-11-19 | Closed as superseded by merged PR #188. Merging it would have replaced the owner's approved B2 provider with the superseded R2 implementation. |
| **PR #192 — Auth silent-failure incidents** | 2026-11-19 | Closed as superseded by PR #194, after every one of its changes was verified present there (10 of its 12 files byte-identical, 2 supersets). |
| **Demo-seed isolation guard** | 2026-11-18, corrected 2026-11-19 | `lib/staging/demo-seed-isolation.ts` + `npm run staging:seed-demo`. Corrected 2026-11-19: the guard hard-codes **no** project ref, so the historical candidate cannot be authorized by default; the owner supplies the designated list per run; Production is refused unconditionally first. |
| **Migration chain integrity** | 2026-11-19 | `npm run migrations:verify` → **102 files, 102 unique versions**, 4 deployed anchors present and hashable. Reconciled with the Batch 2 conflict report merged in PR #193: **no literal same-version file collisions**, and the ordered history `20261112000400` → `20261112000600` → `20261114000100` is already correct — no combined function body is needed. The count rose from 98 when `main`'s four `20261119*` migrations were merged into this branch on 2026-11-19. |

---

## The one technical prerequisite that was outside this register

**PR #194** (the shared-infrastructure pull request,
https://github.com/aryanp685/autodine/pull/194) is **open and unmerged**.
The branch contains recovery fixes with local evidence that still need review
and integration before the default-branch hosted drill can use them. Merging
is a separate decision and will trigger a Vercel **Production** deployment
as a side effect.

**A Vercel Preview deployment already happened**, produced automatically by
the Vercel GitHub App when the branch was pushed (deployment
`6pFExiBEDXx7kooBgt6Puu4ksNE4`, project `new`, head `e90ab82`, Preview host
`new-git-arena-88c342c2-autodine-iamjarvis9896-3988s-projects.vercel.app`).
It is a **Preview** — the commit is not on `main`, the hostname carries the
branch name — and **no Vercel setting was changed**. Full facts:
`qa-evidence/day1/VERCEL_PREVIEW_DEPLOYMENT_EVIDENCE.md`.

---

## What is deliberately NOT in this register

- **Implementation follow-on work.** See `LOCAL_POPULATED_RESTORE_REHEARSAL.md`;
  local implementation fixes do not close any owner/hosted row.
- **Any secret value.** Only names, shapes and destinations appear here.
- **Any action this repository or an agent may take on the owner's behalf.**
  Every row above is something only the owner can do, in their own
  dashboard, under their own authorization.
