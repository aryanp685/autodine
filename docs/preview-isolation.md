# Preview isolation

Only the production deployment may use the production Supabase project. Everywhere else the app runs (a Vercel Preview or Development deployment, CI, a laptop) must use a different project, or none.

This file is the single home of that rule. `AGENTS.md` points here.

## Why

A Preview deployment runs whatever branch was pushed, before anyone has reviewed it. Preview and Development shared production's Supabase variables, so unreviewed code was reading and writing real restaurants' orders. `AGENTS.md` already forbade testing against production, but nothing stopped the configuration that did it. That configuration can no longer build or start.

## The rule

A process is refused when its configuration **targets production** and its environment **is not production**.

**Targets production** means either of these:

- The hostname of `NEXT_PUBLIC_SUPABASE_URL` is a production entry, or has one as a DNS label (`<ref>.supabase.co`).
- A configured Supabase key is a legacy JWT whose `ref` claim is a production ref.

Production entries are the refs in `lib/supabase/production-projects.json` plus anything in `NEXT_PUBLIC_AUTODINE_PRODUCTION_SUPABASE_REFS` (comma-separated refs or full hostnames). If production is ever served from a custom domain, list that hostname there, because a custom hostname does not contain the ref.

**Environment** is the first of these that has a value:

1. `VERCEL_ENV`, which Vercel sets to `production`, `preview` or `development`.
2. The build's environment as inlined for the browser: `NEXT_PUBLIC_AUTODINE_DEPLOY_ENV`, which `next.config.mjs` writes (do not set it by hand), or `NEXT_PUBLIC_VERCEL_ENV`.
3. `AUTODINE_DEPLOY_ENV`, a declaration for production hosted somewhere that does not set `VERCEL_ENV`.

Only the exact value `production` may target production. No value at all is refused. Vercel's own value is read first, so a Preview cannot declare itself production. There is no bypass variable; do not add one.

## Where it is enforced

| Place | Runs during | When refused |
|---|---|---|
| `next.config.mjs`, using `scripts/deployment-isolation.mjs` | `next build`, `next dev`, `next start` | Throws. A Vercel build fails; a local server does not start. |
| `lib/supabase/env.ts`, using `lib/supabase/deployment-isolation.ts` | First load, on the server and in the browser | Throws before a Supabase client exists. |
| `npm run env:check` | On demand | Listed with the other configuration problems. |

`lib/supabase/deployment-isolation.test.ts` keeps the two implementations and the ref list in step.

The message starts `AutoDine deployment isolation:` and names what points at production (the URL or a key) and the environment it was found in.

## What has to change in Vercel

Adding this guard changed nothing in Vercel. Until the steps below are done, every new Preview build fails. That is the guard working.

1. Open the project, then **Settings → Environment Variables**.
2. For each of these Supabase variables that the project sets (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), find the entry ticked for **Preview** and **Development** and replace its value with the staging project's. Leave the production value ticked for **Production** only.
3. Give Preview and Development their own `QR_VERIFICATION_SECRET` and `ADMIN_SECRET` as well. The guard does not check these.
4. Push a branch and confirm that its Preview builds.
5. Delete the Preview deployments created before step 2. A deployment keeps the variable values it was created with, so each old preview stays connected to production until it is deleted.
6. Check which environments production's `SUPABASE_SECRET_KEY` was ticked for. If Preview had it, rotate it once the split is done.
7. On each laptop, replace `.env.local`. `npm run dev` refuses to start while it still holds production values.

Leaving the Supabase variables unset for Preview has not been tried; expect operational routes to answer 503.

## What this does not do

- It checks names, not credentials. New-style keys (`sb_publishable_…`, `sb_secret_…`) carry no project ref, so for those only the URL identifies the project.
- It does not reach anything that connects by database URL: `psql`, migration tooling, the Supabase dashboard. Those stay under the rules in `AGENTS.md`, and staging tools under `AUTODINE_EXPECTED_PROJECT_REF`.
- A host that is not Vercel and sets `AUTODINE_DEPLOY_ENV=production` is believed.
- It does not undo anything a preview has already written to production.

## Checking it

```bash
npm run env:check
npx vitest run lib/supabase
# Must throw:
VERCEL_ENV=preview NEXT_PUBLIC_SUPABASE_URL=https://<production-ref>.supabase.co \
  node -e "import('./next.config.mjs')"
```

## Changing the production project

Edit `lib/supabase/production-projects.json` and the matching constant in `lib/supabase/deployment-isolation.ts`. The test fails while they differ.
