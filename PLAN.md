# AutoDine — Swagat Warmth auth and welcome pass

## Goal and users
First-time restaurant owners in India, mostly on a phone, arriving from the landing page.
Working means: they sign up, get a warm "setting your table" welcome, and land on the
confirmation-pending step; sign-in, reset and forgot-password wear the same room.

## Scope
In scope: landing palette alignment, sign-in / sign-up / forgot / reset surfaces, the
signup confirmation-pending splash (with replay), and the auth loading screen.
Out of scope: OTP login (needs a Supabase phone provider and SMS gateway), onboarding
wizard redesign, owner/kitchen/guest re-skin, billing changes.

## Design brief
- For: a first-time owner on a phone who has just decided to trust this product.
- Job: one screen, one action. Sign in; create the workspace; confirm the inbox.
- Mood: warm, unhurried, hand-set.
- Direction: Swagat Warmth — cream paper `#FAF6F0`, forest room `#183D32`, saffron
  action `#EA6A2A`, Fraunces display, botanical waiter line-art.
- Memorable: the cloche lift — the waiter raises the dome on submit and again in the
  "Setting your table…" welcome after signup.

## Architecture
- Next.js 16 App Router, existing Supabase auth (server actions), no new data model.
- Palette lives in `app/globals.css` in two scoped blocks (`.public-landing` and
  `[data-surface='owner'][data-auth-shell]`), so staff and guest screens keep their tokens.
- Accessible derivatives of the notes palette: `#B24A15` saffron-ink for text on cream
  (5.0:1), `#F08A55` on forest (4.8:1), espresso ink on the `#EA6A2A` button (5.0:1).
- Splash: client component mounted on `/signup/confirmation-pending?welcome=1`; the
  success redirects append `welcome=1`. Replay button on the pending screen; URL cleaned
  after play so a reload does not loop. Reduced motion shows the final frame.
- Auth pending/loading stays server-rendered; no new API surface.

## Risks and assumptions
- The exact orange cannot carry white text at 4.5:1, so CTA labels use espresso ink.
- Notes pricing ₹999/2,699/3,699 already matches `lib/plans.ts`; the landing's ₹600 is a
  sample dish total, not a plan. No pricing change needed.
- The trust block already uses enforced facts; keep it.
- Demo mode still cannot complete a real Supabase signup locally.

## Phase 1: Palette, auth polish and post-signup welcome
Goal: the landing, auth screens and signup splash share the notes palette end to end.
- [x] Exact hexes in both scoped token blocks, with documented contrast.
- [x] Accent used only for fills/graphics; text accents use the accessible derivative.
- [x] Splash "Setting your table…" on signup success, replayable, reduced-motion safe.
- [x] Loading screen and pending screen read from the same tokens.

Acceptance: opening `/login`, `/signup` and `/signup/confirmation-pending?welcome=1` on a
phone shows the cream/forest/saffron room, the splash lifts its cloche, and replay works.

## Phase 2: Onboarding welcome and "All Set!" screens
Goal: the three-step wizard opens with a welcome card and closes on the reference's
"All Set! Your restaurant is ready." moment.
- [ ] Welcome card with the cloche illustration and one "Get started" action.
- [ ] Completion screen with a single "Go to dashboard" action.

Acceptance: a newly confirmed owner sees the welcome, completes setup, sees All Set.

## Phase 3: Owner surface reskin
Goal: menu, tables, orders and reports inherit the same room.
- [ ] Token mapping for owner chrome, ratcheted through the design guard.

Acceptance: owner pages match the auth room and the guard still passes.
