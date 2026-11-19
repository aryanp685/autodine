# AUTODINE — VERCEL PREVIEW DEPLOYMENT EVIDENCE (PR #194)

Date: 2026-11-19 · Subject: the deployment event associated with PR #194 ·
Branch `arena/88c342c2-autodine` · PR head `e90ab824bff191b994a63fb2b83dc461271c0faa`

---

## Why this document exists

An earlier version of the PR #194 description carried a blanket statement
under "What is deliberately NOT here":

> **No deployment.**

**That statement was inaccurate.** A Vercel **Preview** deployment *was*
produced for the PR's head commit. It was produced automatically by the
Vercel GitHub App when the branch was pushed — nobody created it, nobody
promoted it, and it is not a Production deployment. But "no deployment" is
a false claim about what happened, and a false claim in a readiness record
is exactly the kind of thing that makes the rest of the record untrustworthy.

This document states the facts, so the record is accurate rather than
comfortable.

## The facts

| Field | Value | How it was established |
|---|---|---|
| **Deployment id** | `6pFExiBEDXx7kooBgt6Puu4ksNE4` | the `Vercel` commit status on the head SHA |
| **Project** | `new` | the status target URL path: `.../iamjarvis9896-3988s-projects/new/6pFExiBEDXx7kooBgt6Puu4ksNE4` |
| **Team / scope** | `iamjarvis9896-3988s-projects` | the status target URL path |
| **Commit SHA** | `e90ab824bff191b994a63fb2b83dc461271c0faa` | the commit the status is attached to (the PR head) |
| **Source branch** | `arena/88c342c2-autodine` | the branch the SHA belongs to; it is **not** on `main` |
| **Environment** | **Preview** | the deployment hostname (below) follows Vercel's `git-<branch>` Preview naming convention and contains the branch name |
| **Deployment type** | automatic Git-push/PR-triggered Preview build by the Vercel GitHub App | the status description is the app's standard "Deployment has completed"; no deployment was created, promoted or dispatched by this work |
| **Status** | `success` — "Deployment has completed" | the `Vercel` commit status context on the head SHA |
| **Preview host** | `new-git-arena-88c342c2-autodine-iamjarvis9896-3988s-projects.vercel.app` | the `Vercel Preview Comments` check-run output on the head SHA |
| **DNS** | resolves to Vercel's edge addresses (`216.198.79.67`, `64.29.17.67`) | read-only DNS lookup from the sandbox |

## Why this is a Preview and not a Production deployment

Three independent facts establish it:

1. **The commit is not on `main`.** `e90ab82` is a branch-only commit
   (`git merge-base --is-ancestor e90ab82 origin/main` → false). Vercel
   builds a Production deployment from the production branch; this SHA is
   not it.
2. **The deployment hostname carries the branch.** The Preview host is
   `new-git-arena-88c342c2-autodine-…`, i.e. Vercel's
   `<project>-git-<branch>-<team>` Preview convention, with the branch name
   in the hostname. A Production deployment resolves to the project's own
   alias/apex, never a `git-<branch>` subdomain.
3. **The check that carries the host is the Preview one.** The
   `Vercel Preview Comments` check-run output contains a
   `vercel.live/open-feedback/…-git-arena-88c342c2-autodine-…vercel.app`
   link — Vercel's own PR-preview feedback surface.

For contrast, `origin/main`'s head `ff00d38d0abe72bfabf85fb84ac4b3423b62b6f6`
(the PR #190 merge) carries deployment `2trfWGS2puf4YrEiyWSe6VCvNMGe`.
That is the **Production** deployment produced by merging into `main` — the
side effect the PR #194 body must warn about, and the reason the body says
merging PR #194 will trigger a Production build.

## What was NOT done

- **No** deployment was created, promoted, redeployed or dispatched by this
  work.
- **No** Vercel setting was changed: no environment variable, no domain,
  no project setting, no feature flag, no webhook.
- **No** Production deployment was produced by the branch push.
- **No** Production data was reached. The deployment isolation guard
  (`lib/supabase/deployment-isolation.ts`) refuses a build whose Supabase
  URL or keys belong to the Production project in a non-production
  environment, and `npm run isolation:verify` is green.

## The honest wording, for reuse

Use this, and not "no deployment":

> **No deployment was created or promoted by this work.** Pushing the
> branch caused the Vercel GitHub App to produce a **Preview** deployment
> automatically (deployment `6pFExiBEDXx7kooBgt6Puu4ksNE4`, project `new`,
> head `e90ab82`, Preview host
> `new-git-arena-88c342c2-autodine-iamjarvis9896-3988s-projects.vercel.app`).
> It is a Preview: the commit is not on `main`, the hostname carries the
> branch name, and no Vercel setting was changed. **Merging this branch
> into `main` will trigger a Production deployment** — that is Vercel's
> behaviour for the production branch and is a side effect of the merge,
> not of the code.

## How this is kept true

`scripts/hosted-verification/preflight.mjs` reports the live deployment
state alongside the rest of the hosted readiness picture, and this document
is referenced from the master launch-readiness record so the claim cannot
drift back to "no deployment" unnoticed.
