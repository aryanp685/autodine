# Preview isolation — read-only hosted verification (2026-11-14)

**Method.** Vercel connector, read-only calls only (`list_teams`,
`list_projects`, `get_project`, `get_deployment`). No secret value was
decrypted, no log was read, nothing was created, changed, or deleted. The
environment-variable listing shows key names, targets and (for
non-sensitive/plain entries) values — plain values shown below are public
hosts or publishable keys, not secrets.

**Target.** Team `iamjarvis9896-3988s-projects` (Hobby/legacy), project
`new` (`prj_S6aU68euwLsJsaEdzolSdsJHSyS7`) — the AutoDine deployment.

## Verified (metadata level)

1. **Supabase URL split is correct.** `NEXT_PUBLIC_SUPABASE_URL` carries
   two entries: `[preview, development]` = `https://juwyhslzchjevqkdvwjm.supabase.co`
   (**staging** `autodinetest`) and `[production]` = `https://bdbaqpevwmgdvghszjno.supabase.co`
   (**production**). The exact failure mode that leaked production data
   into preview builds is closed at the configuration level.
2. **Publishable keys are split per environment** (separate entries for
   `[preview, development]` and `[production]`; plain, publishable-only).
3. **`SUPABASE_SECRET_KEY` exists as three distinct sensitive entries**
   (production `MsYiKLWdLAMWS1Tk`, preview `TDXBzUOLnK0iNuGi`, development
   `LcmWsHHAYBWtn7NU`). Distinctness of values is not decrypt-verified
   (verified at entry/target level only); the preview and development
   entries were updated 2026-11-13/14, after the production entry.
4. **`QR_VERIFICATION_SECRET`** — separate entries for production
   (`ZCYIScujUPJxQq9d`) and preview (`5IYRxMclhusWe9mV`). **None for
   development.**
5. **`ADMIN_SECRET`** — production only (`A3vOawnhrKNp9sZb`). **Absent in
   preview and development** — fail-safe (admin surface unavailable off
   production), but a gap against `docs/preview-isolation.md` step 3,
   which calls for preview/development to have their own.
6. **The two READY previews preserved by the programme remain READY and
   are not production builds.**
   - `dpl_EGp5hW9sTXvuhHzEFp5jUSfo1wpe` — branch `arena/3878e9b8-autodine`
     (PR #182), build env 2026-11-14T17:~Z, `ready_state READY`,
     `target null`, OIDC `environment: preview`, alias
     `new-git-arena-3878e9b8-autodine-…vercel.app`.
   - `dpl_HrRZ7y25453GvEEwkCMucfkCXsqB` — branch `arena/fee715c2-autodine`
     (PR #185), `ready_state READY`, `target null`, OIDC
     `environment: preview`, alias `new-git-arena-fee715c2-autodine-…vercel.app`.
     Its build environment included `AUTODINE_EXPECTED_PROJECT_REF` — the
     staging guard was in the build env for that build.
   - Both were built **after** the preview/development Supabase env split
     timestamps. This does not prove what their runtime calls reach.
7. `npm run isolation:verify` — 14/14 PASS (repo self-test, offline).

## Failures / findings (no action taken; owner decisions)

1. **Production AI/LLM secrets are shared with preview.**
   `GEMINI_API_KEY` (`krCJr6wGw7UOOlGz`) and `GROQ_API_KEY`
   (`jLjYcOGSDLbVh1DZ`) are single entries targeting **both**
   `production` and `preview`. `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL`
   are likewise shared (plain, non-secret). Preview deployments therefore
   receive the production AI provider credentials. Not a Supabase
   data-path leak, but shared credentials across environments — the owner
   should split or consciously accept them.
2. **Development `GEMINI_KEY_VERIFY_TMP`** (`YU9eMPTZpqC608Q7`) — a
   leftover-looking one-off variable in development only. Flagged for
   deletion by the owner (not deleted here).
3. **Branch-scoped overrides for `arena/3711df6a-autodine`** —
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `AUTODINE_MODE` (ids `Ftf7W0vJgmZTvmQG`,
   `1O7OphHqbXc7TfYU`, `h18hhqOMpabtWmlw`, `fxeqGPHMFZ4SVP0u`), created
   2026-11-08/09. Values encrypted, not audited, and for a different
   session branch. If that branch is done, the entries should be removed
   by the owner. They override the base preview values for that branch
   only.
4. **Old pre-isolation previews** — the isolation checklist step 5
   (delete previews created before the split) is **not** verifiable here
   without enumerating and deleting deployments, which is destructive and
   not authorized. The two current READY previews post-date the split.
5. **Runtime is not proven by this document.** This is a configuration
   audit. Whether a preview's actual database calls land on staging is
   shown only by the hosted staging smoke run in
   `docs/hosted-synthetic-acceptance-2026-11-14.md` (Scenario F/A/B/C),
   which remains gated on owner authorization.

## Verdict

**Preview isolation is satisfied at the configuration level for the
Supabase variables, with findings 1–4 outstanding.** The programme's
"no new builds until preview isolation is proven" posture can be relaxed
to: new previews may build, but (a) findings 1–3 should be dispositioned
by the owner, (b) runtime smoke against staging remains outstanding,
(c) old pre-split previews remain unverified. Do not treat this document
as the hosted checklist being complete.
