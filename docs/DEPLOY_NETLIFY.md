# Deploying AutoDine to Netlify (Free plan)

**Status: the repository is ready to deploy. I cannot press the button for you — here's why, and here's exactly what to do.**

---

## Why I can't deploy it myself

Two hard limits, not a choice:

1. **This sandbox has no network access to Netlify.** Outbound traffic is restricted to GitHub, npm and PyPI only. I can't reach `api.netlify.com`, so the Netlify CLI cannot authenticate or upload.
2. **You should not give me your Netlify credentials.** I will never ask for your password, personal access token or 2FA code. Creating the account and connecting GitHub is yours to do — it takes about two minutes.

What I *have* done is make sure that when you connect the repo, the build succeeds first time.

---

## The good news: it needs no configuration

Netlify detects Next.js automatically and provisions its [OpenNext adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), which handles SSR, ISR, route handlers, image optimisation and edge middleware. I verified this against Netlify's current docs and deliberately honoured their two rules in `netlify.toml`:

- **No `publish` directory** — the adapter owns the output layout. Setting it would break the deploy.
- **No pinned adapter version** — Netlify updates it on each build.

There is **no `.env` needed.** The app runs entirely on mock data in `lib/demo-data.ts`, so your first deploy works with zero environment variables. `.env.example` documents the names we'll use when the backend arrives.

---

## Steps (about 2 minutes)

1. **Commit state is already clean and pushed.** Branch `arena/62c92cc6-new` is up to date on GitHub.

2. Go to **[app.netlify.com](https://app.netlify.com)** → **Add new site** → **Import an existing project**.

3. Choose **GitHub**, authorise Netlify, and select the repository **`aryanp685/new`**.

4. Under *Branch to deploy*, select **`arena/62c92cc6-new`**.
   > Use this branch for now — it's where all current work lives. Switch to `main` once we merge.

5. Leave the build settings as Netlify detects them. If it asks:
   - **Build command:** `npm run build`
   - **Publish directory:** *leave empty*
   - **Node version:** picked up from `.nvmrc` (22)

6. Click **Deploy**. First build takes roughly 1–2 minutes.

7. When it's live, check all 13 routes resolve (replace `<your-site>` with your Netlify subdomain):

   ```
   /  /pricing  /signup  /dashboard  /dashboard/menus  /dashboard/tables
   /menu  /menu/item  /menu/cart  /menu/checkout  /kitchen  /cashier  /states
   ```

---

## What the Free plan gives you, and the one thing to watch

| | |
|---|---|
| Cost | **₹0**, no card required |
| Commercial use | **Allowed.** Netlify's own announcement states it: *"On the Free plan, you can deploy commercial projects"* |
| Custom domain + SSL | Included |
| Monthly limit | **300 credits — a hard cap.** It cannot be exceeded and cannot incur charges. |
| Members / concurrent builds | 1 / 1 |

**The one thing to watch: production deploys cost credits (~15 each).** Under Netlify's credit model, deploy *previews* and *branch deploys* are free while production deploys draw from the 300. That means roughly 20 production deploys a month if you spend nothing else — comfortable, but not unlimited. Worth confirming the exact number in your dashboard the first time you deploy, since Netlify has revised credit rates before.

Practical habit: **develop on branch/preview deploys, and only promote to production when there's something worth showing.** Costs nothing extra and keeps your credit headroom for bandwidth.

One caveat I'd rather state than hide: Netlify's Self-Serve Subscription Agreement says the Free Usage Tier is *"offered at Netlify's sole discretion"* and they may change or discontinue it. That's true of every free tier we're using, including Supabase. Don't put anything on free infrastructure you couldn't afford to lose.

---

## Still outstanding (not blockers for this deploy)

- **Custom domain** — buy the domain, then Netlify → *Domain management* → *Add custom domain*. SSL is automatic. This is the only spend you've approved.
- **Supabase account** — needed before any real data. See §8 of `docs/PHASE_6_ARCHITECTURE.md`.
- **Razorpay account (test mode)** — needed before any payment work.

---

## Sources

- Netlify Next.js overview — [docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- Netlify Free plan announcement (commercial use) — [netlify.com/blog/introducing-netlify-free-plan](https://www.netlify.com/blog/introducing-netlify-free-plan/)
- Netlify pricing — [netlify.com/pricing](https://www.netlify.com/pricing/)
- Netlify Self-Serve Subscription Agreement, §6 Free Usage Tier — [netlify.com/legal/self-serve-subscription-agreement](https://www.netlify.com/legal/self-serve-subscription-agreement/)
