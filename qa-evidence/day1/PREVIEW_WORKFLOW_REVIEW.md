# PR #191 — Permanent Preview Workflow Review (2026-11-18)

Scope: complete PR diff (256 files, secret-scanned), with line-level
review of `fb76313` (7 Preview-workflow files) and `940bc34` (docs).
No merge, no Production change, no protection change performed.

## Verdict: NO-GO for merge until R1–R3 are fixed (code) — all small.
Everything else reviewed is GO. Owner actions O1–O3 after the fixes.

## Secret-leak review

**Checker (`scripts/preview/check-preview.mjs`) — PASS.**
Secret enters only as the `x-vercel-protection-bypass` header object;
output is fixed-vocabulary JSON; base URL is redaction-stripped before
use (a secret pasted into a URL query is dropped, never fetched or
logged); response bodies and error messages are never printed; unit
test asserts the secret string appears nowhere in output. Wrong-bypass
probe uses a constant obviously-fake value.

**Playwright + workflow — FAIL (R1).**
`playwright.preview.config.ts` sets `trace: 'retain-on-failure'`, and
the workflow uploads `test-results/` on failure. Playwright traces
record fill-action values: a failed login run can therefore put the
test-account password (and screenshots showing the account email) into
a downloadable artifact of a **public** repo. The bypass header itself
is not in trace DOM/network data for same-origin page loads, but the
credential risk alone blocks upload-as-is.
**Fix:** `trace: 'off'` (keep screenshots), or drop the artifact step;
with a dedicated synthetic test account (O2) screenshots become
harmless. Retention is already 14 days.

**Whole-PR secret scan — PASS.** 34,352-line diff scanned for real key
formats (Brevo `xkeysib-`, Stripe, AWS, GitHub, private keys, generic
assignments): hits only labeled fixtures (`xkeysib-testkey1234567890`,
sandbox webhook secrets in tests).

**URL/header discipline — PASS.** Header is the only transport used by
checker, config and tests; `x-vercel-set-bypass-cookie: true` only in
the browser config (Vercel's documented pattern); query-parameter form
appears nowhere in the new code (it remains Brevo-webhook-only by
earlier design, via headers there too).

## Required code fixes

- **R1 (High, leak):** disable trace retention and/or artifact upload
  as above.
- **R2 (Medium, Production safety):** the workflow takes an arbitrary
  `preview_url` input; dispatching it against the Production alias
  would run the signup/invitation specs against Production Supabase
  (a real workspace-creation attempt). Add a fail-closed host guard in
  the workflow/checker: require a `*.vercel.app` branch-alias host and
  explicitly deny Production aliases/domains (`new-git-main-…`, any
  custom production domain).
- **R3 (Medium, test correctness):** `auth-flows.spec.ts` anonymous
  probe creates `playwright.request.newContext({})`, which does not
  inherit the config `baseURL` — the relative `/login` request will
  throw instead of asserting. Pass `baseURL: process.env.PREVIEW_URL`
  explicitly.

## Test-data hygiene (item 4)

- **Isolation: good.** Throwaway addresses are timestamped
  `@example.test` (reserved domain, no real recipient); reset test
  uses a nonexistent address (no mail sent); the only real account is
  the env-supplied test account; runs are serial, single-worker.
- **Cleanup: absent (accepted-risk note, not a blocker once O2 is
  done).** Each full run leaves on `autodinetest`: one unconfirmed
  signup Auth user + workspace (created before confirmation by
  design), and one staff invitation (self-expires, default 7 days).
  Nothing deletes them — the suite holds no service-role key, by
  design. On the dedicated test project this is tolerable; schedule a
  periodic manual purge of `preview-*@example.test` artifacts, or
  accept accumulation. Never point the suite anywhere else (R2).

## Credentials (item 5)

- Do **not** use the owner's personal mailbox account
  (`kingprateek255@…`) as `PREVIEW_TEST_*`. Recommend a **dedicated
  Preview test account**: a separate owner-controlled mailbox (or a
  plus-addressed alias of a non-personal inbox), signed up once on the
  Preview alias, confirmed once via the verified Brevo path, used
  nowhere else.
- Handling: values only in GitHub Actions secrets (masked) or a local
  shell env; never in workflow inputs, code, docs, artifacts (R1);
  rotate by changing the account password + updating the secret;
  the account owns only synthetic test data on `autodinetest`.

## Production isolation (item 6) — PASS with R2

Workflow `permissions: contents: read`; references exactly three
named Actions secrets, all Preview/test-scoped by value; no
`environment:` with access to deployment secrets; no Vercel/Supabase
Production identifiers anywhere in the new files; manual dispatch
only (no push/PR triggers). The single Production-reach path is the
unguarded URL input — R2 closes it.

## Owner SSO access (item 7) — CONFIRMED

Per Vercel docs, logged-in team members (≥ viewer) pass Vercel
Authentication automatically and get a cookie; access requests exist
only for non-members. The deployment creator/team owner here is
`iamjarvis9896-3988`. Rule for the owner: use the branch-alias URL in
a browser signed in as that owner account → no request, no approval,
no seat; ignore/reject any request from unfamiliar identities and
never approve one for tooling (Hobby allows only one external grant
in total). Collaborators were not touched.

## Static test evidence (this review, exact)

- Checker unit tests: **5/5 pass** (`node --test`), incl.
  protection-off → exit 1, wrong-bypass → fail, missing secret →
  blocked/exit 2, secret-absent-from-output assertion.
- Checker CLI unreachable-target: **exit 2** with
  `preview_check_blocked` alert line (honest blocked, no leak).
- Playwright: **6 tests listed**; unconfigured run: **6 skipped**
  (never fake-green). TypeScript (isolated): clean. ESLint on new TS
  files: clean.
- Workflow YAML sanity: keys/indentation valid; secrets gate present;
  artifact step confirmed as R1 source.
- Full repo unit suite: **227 files / 2,545 passed / 223 skipped /
  0 failed**. (Not rerun against the PR tree here; the committed
  subset was clean-tree built green at `fb76313` push time.)

## Remaining owner actions

- **O1:** Approve fixes R1–R3 (agent can implement on request), then
  re-review quickly.
- **O2:** Create the dedicated Preview test account (above), confirm
  it once, and set Actions secrets `VERCEL_AUTOMATION_BYPASS_SECRET`,
  `PREVIEW_TEST_EMAIL`, `PREVIEW_TEST_PASSWORD`.
- **O3:** After merge (workflow_dispatch requires the file on the
  default branch), dispatch **Preview checks** once and confirm the
  first full live run; keep Deployment Protection settings untouched.

---

## Resolution — R1–R3 implemented (2026-11-18, owner-approved)

**R1 (leak) — FIXED.** `playwright.preview.config.ts` now sets
`trace: 'off'`, `screenshot: 'off'`, `video: 'off'` with the rationale
in-line; the workflow's artifact-upload step is removed entirely (a
comment records why). No browser state from credential-typing tests
can be captured or downloaded.

**R2 (Production targeting) — FIXED.** A strict allowlist validator
(`validatePreviewUrl` in the checker, mirrored verbatim in the
Playwright config; a test asserts the two host patterns stay
identical) accepts only
`new-git-<branch>-iamjarvis9896-3988s-projects.vercel.app` over https
with no credentials, query, fragment or explicit port. The Production
alias (`…<branch>=main…`) is rejected with reason `production_alias`;
unique per-deployment URLs, custom domains and arbitrary hosts are
`host_not_permitted`. Rejection happens **before any request** and
never echoes the rejected value.
Live proof (this session): Production alias → exit 2
`production_alias`; custom domain → `host_not_permitted`; alias with
bypass-in-query → `query_or_fragment`; http → `not_https`;
Playwright config refuses to even list tests for the Production URL.

**R3 (anonymous context) — FIXED.** The probe now constructs its
context with `baseURL: process.env.PREVIEW_URL` and an explicitly
empty header set; a regression test pins both.

**Regression coverage:** checker suite grew 5 → 14 tests total across
`check-preview.test.mjs` (8-check stub run + 5-case URL matrix +
redaction) and the new `preview-config.test.mjs` (R1 capture/upload
invariants, exact three-secret reference set, R2 pattern-sync, R3
context construction) — **14/14 pass**.

**Gates:** full unit suite 227 files / **2,545 passed / 0 failed**;
typecheck exit 0; ESLint clean on touched TS; Playwright **6 listed /
6 skipped** unconfigured; clean-tree verification at the PR head
(checker tests, spec discovery, `next build`) repeated for this
change — see deployment note in `PREVIEW_ACCESS_AUTOMATION.md`
series. Resulting diff secret-scanned (patterns as in the original
review): only labeled fixtures.

## Fresh verdict after fixes: **GO** for merge (owner's decision),
subject to owner actions O2–O3 above. The personal-account warning
stands until O2 is done: until then, simply do not set
`PREVIEW_TEST_*` to personal credentials.

---

## Owner-approved conflict resolution (2026-11-16) — new head

The owner approved resolving the conflicts **without merging**. `main` was
merged into this branch (merge commit, never squash, never rebase):

- Merge commit `2832b9d` — parents `3803b5b` (reviewed head) and
  `b385bf4` (latest `main`). Merge-base was `b866601`; the branch was
  63 commits ahead, `main` 4 ahead.
- Text conflicts: only 3 files — `package.json` (branch is a superset;
  main's differing line is identical), `scripts/e2e/prepare-local-supabase.mjs`
  (kept main's stronger named-boundary-migration assertion), and
  `scripts/verify-database.mjs` (kept the union of both integration test
  lists). **R1–R3 files are byte-identical before and after the merge.**
- Semantic conflict (no text markers): main's
  `20261112000700_order_line_edit_boundary` restricted
  `set_order_line_quantities` to owner/manager/cashier (Kitchen → 42501,
  write-gate before payment-state guards); this branch's later GST
  migration `20261113000100` replaced the function and silently
  re-admitted Kitchen. Neither applied migration was edited. Forward
  reconciliation migration `20261118000100_merge_boundary_gst_order_line_edits`
  (commit `3b21bdf`) re-asserts main's boundary, role scope, guard order,
  and grants on the GST body (tax math copied verbatim).
- Duplicate migration versions: the merge created 4 (main's boundary set
  vs this branch's serialize/GST files). Neither colliding file is a
  deployed-history anchor, so the branch-side files renumbered past main
  (`20261112000501`, `...601`, `...701`, `20261114000101`) in commit
  `c73dd6f`; the fail-closed release verifier and the migration manifest
  now track the merged inventory of **98 migrations** honestly (93 + 4
  from main + 1 reconciliation), with all five additions marked
  NOT AUTHORIZED for hosted application by this merge.

### Fresh verification at the merged head (local, clean tree)

- Preview checker/config tests: **14/14 pass** (R1–R3 invariants intact).
- Typecheck: clean. ESLint: clean. Design guard: pass.
- `sql:check`: pass. `migrations:verify`: pass (98 files, 98 unique
  versions, 4 deployed anchors). `verify:release`, isolation,
  staging guards, backup selftest, DR verifiers, D2 probe: all pass.
- Unit suite: **2,496 passed / 221 skipped / 0 failed**.
- Embedded PostgreSQL replay of all 98 migrations: **207 passed / 2
  skipped** (`test:db:integration`: 10 files, **212 passed**).
- Clean-tree production build (placeholder env): **green**.
- Secret scan of the full PR diff vs `main`: no credential patterns;
  hits only inside test fixtures with labeled fake credentials.
- GitHub checks and the Vercel Preview deployment for the final head:
  recorded in the PR after this addendum (final head SHA below).

### Verdict

**GO — conflict resolution complete; PR is mergeable against latest
`main` with the permanent Preview workflow and R1–R3 intact.** Per the
owner's instruction this stops here: **merge requires a separate
explicit approval**, and the eventual merge must use a **merge commit**
(not squash). Production remains untouched: no Production merge,
deployment, setting, Vercel, plan, collaborator, or secret change was
made. Remaining owner actions are unchanged (dedicated Preview test
account + three Actions secrets per
`docs/operations/PREVIEW_TEST_ACCOUNT_SETUP.md`, then one manual
**Preview checks** dispatch after merge).
