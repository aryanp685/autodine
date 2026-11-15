# Credential exposure — exact scope and remediation sequence (2026-11-14)

**Status: OPEN — B5 remains CRITICAL until the owner completes §4 and the
verification in §5.** Redaction of the working tree (commit `1193327`) did not
remove the values from Git history and does not rotate anything.

No secret value is printed in this document. Every identifier below is either a
deployment/file reference or a placeholder.

---

## 1. Exactly which credentials are affected

| # | Credential (class) | Protects | Exposure |
|---|---|---|---|
| C1 | Vercel `_vercel_share` token for the **review preview** of branch `arena/a5344572-autodine` — host `new-git-arena-a5344572-autodine-…vercel.app`, deployment `dpl_2i2oYjgNje5xQtkD9CzFSoWEmH9U` | Bypass of Vercel Deployment Protection (SSO) for that one preview deployment | Committed in `docs/review-deployment-2026-11-11.md` (usage section) and `docs/autodine-handoff-report-2026-11-12.md` (environments table). Present from base `b866601` until redaction in `1193327`. |
| C2 | Shared password of **four synthetic staging accounts** on `autodinetest` (`juwyhslzchjevqkdvwjm`): `owner@`, `manager@`, `kitchen@`, `cashier@autodine-review.test` | Sign-in to the staging app as any of the four review roles | Committed in the same two files (handoff §3 review block; review-deployment §1). Same history window. |

**Not affected (verified):** the current staging share token lives only in the
`AUTODINE_STAGING_SHARE_URL` GitHub Actions secret — never in the tree; the
`arena/9b120325-autodine` preview token was never committed. The staging-e2e
workflow consumes it via secrets and fail-closes without it.

## 2. Where the values still live

1. **Git history, this repository:** every commit from `b866601` (merge of
   PR #185, 2026-11-14T11:56Z) to `1193326`⁻ contains both files with the
   values. Verified with `git log -S` (count delta at `b866601` only; removed
   by `1193327`) and `git grep` across `git rev-list --all` (40 commits).
   The values exist in: local clone, `origin` on GitHub, any fork, any CI cache
   created from those commits, and any tarball/export of the repo.
2. **Pull request #181 diff:** its redaction edits display the values as
   removed diff lines to anyone with repo read access. (PR #181 itself stays
   unmerged; it neither introduced nor caused the exposure.)
3. **GitHub UI/search caches** and any e-mail/Slack copies of the docs outside
   the repository are out of our visibility — assume they exist.
4. **Tracked working tree today:** CLEAN. Verified post-redaction:
   the tree scan for the two retired literals returns nothing; the only
   `_vercel_share=` occurrences are placeholders, tests and guards.

## 3. What depends on them (blast radius)

| Dependent | Type | Evidence |
|---|---|---|
| Review preview deployment `dpl_2i2oYjgNje5xQtkD9CzFSoWEmH9U` | Vercel | **Read-only check 2026-11-15: GET returns 404 — deployment is gone** (deleted or aged out; Hobby previews expire after 180 days). The share token bypasses SSO for *that deployment only*, so C1 is very likely inert — but this is not proof of non-exposure of the underlying account data, and the value should still be regenerated/retired per §4. |
| Four review accounts | Supabase Auth on staging `juwyhslzchjevqkdvwjm` | Accounts are synthetic (`*@autodine-review.test`), staging-only, no production data. Roles: owner/manager/kitchen/cashier. If the shared password is known, any repo reader could sign in to staging as any reviewer and read/test staging data (no real customer data; staging is fixtures). |
| Repo automation (CI/E2E/staging-e2e) | — | **None.** No script, workflow, fixture or env file consumes either value (verified by repository-wide search; e2e takes credentials from env vars; integration specs use `E2E_OWNER_*` from the environment, never the committed value). |
| Production (`bdbaqpevwmgdvghszjno`) | — | **None.** Neither credential exists there; production was untouched by the exposure. |
| Current preview / staging alias (`arena-9b120325…`) | Vercel | **Not affected** — different deployment, different token, stored only as the `AUTODINE_STAGING_SHARE_URL` secret. |

## 4. Rotation sequence (owner-run; order matters; no lock-out risk if followed)

The old review deployment is already gone (§3), so step 1 is confirmatory.
Budget ≈ 20 minutes. Do **not** skip step 3.

1. **Vercel (C1, confirmatory):** Dashboard → team `iamjarvis9896-3988's
   projects` → Project `new` → Deployments → search `arena/a5344572-autodine`.
   - If the deployment is absent (matches the 404) or already "deleted", C1 is
     inert — record that.
   - If it still exists: open it → **Share** → **Revoke/regenerate** the share
     link (or delete the deployment — it is a stale review build; deleting a
     *preview* deployment is safe and does not touch production).
   - Leave Deployment Protection (SSO) **enabled** for Preview and Production.
2. **Supabase staging (C2):** Dashboard → `autodinetest` → Authentication →
   Users → for each of `owner@`, `manager@`, `kitchen@`, `cashier@autodine-review.test`:
   - **Preferred:** delete the four users (the review phase that needed them is
     over; nothing in automation depends on them).
   - **Or:** send password recovery to each and set new, distinct random
     passwords; store them in your password manager, never in the repo.
   - If any account was used to provision data you still need, snapshot row
     counts first — deleting an Auth user does not delete app rows, but treat
     staging as disposable regardless.
3. **GitHub / repo hygiene:** consider the shared value compromised permanently.
   Do **not** reuse the retired shared password for anything, anywhere. If the same password
   was reused on any other account (owner habit check) — change it there too.
4. **History rewrite (optional, destructive, owner-gated — §6).** Only after
   steps 1–3. Recommendation: rotate-then-decide; with both credentials dead,
   history rewrite becomes cosmetic rather than necessary.
5. **Verification (§5).**

## 5. Verification after rotation (split of duties)

Owner confirms: (a) old share link → "Protected Deployment – Vercel" or 404;
(b) sign-in with the old shared password fails for all four accounts (or the
accounts are gone); (c) staging app still works for legitimate access via the
current staging share alias.
Arena can then verify (read-only): (d) `git grep` across the tree and history
shows no occurrence of the retired values; (e) Vercel deployment list for the
review branch shows no READY deployments with share links issued recently;
(f) CI remains green; (g) staging suite was NOT re-run (no fresh dispatch —
not required for rotation; a fresh run needs separate authorization).

## 6. History cleanup procedure (OPTIONAL — do not run without explicit approval)

If you decide the historical exposure is unacceptable after rotation:

**Pre-flight (all required):**
1. Written owner approval for a destructive history rewrite of
   `aryanp685/autodine`.
2. Freeze: no PR merges, no pushes, no CI dispatches during the operation.
   PR #181 must be closed or explicitly re-created after the rewrite (it will
   conflict); the branch `arena/9b120325-autodine` will be rewritten too.
3. Mirror backup:
   `git clone --mirror https://github.com/aryanp685/autodine.git autodine-mirror-backup.git`
   stored offline.
4. Notify collaborators: every clone must be re-cloned or hard-reset
   (`git fetch --force --tags && git reset --hard origin/<branch>` is NOT
   enough for dirty/local branches — re-clone is safest). Forks must be
   re-created. GitHub may serve cached commits/diffs (including PR #181's
   redaction diff) for an indeterminate period — history rewrite cannot
   guarantee removal there.
5. Force-push consequences: all SHAs change; any reference to a SHA in docs,
   Arena session state, Vercel deployments, or release records becomes stale;
   the current CI badges and deployment SHAs (`6c7e187`, `1193327`, `bc54eab`)
   will no longer exist. The consolidated execution report cites those SHAs and
   must be re-issued after the rewrite.

**Procedure (on a fresh clone with `git filter-repo` ≥ 2.38):**

```sh
git clone https://github.com/aryanp685/autodine.git autodine-clean
cd autodine-clean
printf 'literal:<C1 token>==>' docs/review-deployment-2026-11-11.md-removed ...  # use --replace-text with exact strings
cat > /tmp/replace.txt <<'R'
<C1 token>==>[REDACTED-SHARE-TOKEN]
<the shared review password>==>[REDACTED-REVIEW-PASSWORD]  # exact literal; see history
R
# Real file contains the two literal strings; they are documented in
# docs/autodine-handoff-report-2026-11-12.md@HEAD history if needed.
git filter-repo --replace-text /tmp/replace.txt
# verify: git grep -i '<the shared review password>\|_vercel_share=[A-Za-z0-9]' $(git rev-list --all)  → expect nothing
git push origin --force --all && git push origin --force --tags
```

Then: re-create PR #181 from the rewritten branches; re-run CI; re-issue the
execution report; ask GitHub support to expire cached views if the data was
sensitive enough to warrant it.

**Why rotation-first is the correct default:** the values are useless once
rotated/revoked, regardless of history. History rewrite is cosmetic, carries
real operational risk (including breaking every recorded SHA in your release
documentation), and cannot purge caches. Do it only if compliance requires it.

## 7. Additional secret-exposure audit of history (performed 2026-11-14)

Scanned `git rev-list --all` (40 commits) for credential classes; results:

| Class | Result |
|---|---|
| `_vercel_share` real token | only the two docs (C1) |
| Shared review password | only the two docs (C2) |
| JWTs (`eyJhbGciOi…`) | test fixtures only (`lib/supabase/env.test.ts`, `lib/supabase/deployment-isolation.test.ts`) — synthetic, constructed from dummy payloads; not credentials |
| Stripe (`sk_live_`/`sk_test_`) | 0 |
| Groq/OpenAI-style keys (`gsk_`), Google (`AIza`), Slack (`xox`), PEM private keys | 0 |
| Connection strings with embedded passwords | loopback disposable-cluster defaults on `127.0.0.1` only (`scripts/local-pg/*`, `scripts/reconcile/*`, docs examples); `docs/e2e-local.md` uses `autodine-local-only-e2e` (throwaway, local-only) — not hosted credentials |
| Tracked `NEXT_PUBLIC_*` secrets | none; isolation enforced by CI + `deployment-isolation.mjs` |
| GitHub Actions workflows | reference `secrets.*` only; no inline values |
| Current tracked tree | no `_vercel_share` real token, no review password, no full JWTs outside tests |

Conclusion: **the exposure is exactly C1 and C2; no other committed secrets were
found.** This audit does not crawl outside the repository.

## 8. B5 status tracking

B5 stays **CRITICAL-OPEN** until steps 1–3 are done and §5 verification is
recorded. On completion, update this file and the owner-action register
(B5 → done, with date and method).
