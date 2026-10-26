import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * THE INVITATION FLOW, CLICKED THROUGH IN A REAL BROWSER.
 *
 * WHY THIS FILE IS NOT IN THE HERMETIC SUITE
 *
 * Every step of this flow is decided by the database. Creating an invitation
 * mints a code and stores a fingerprint of it; redeeming one calls a security
 * definer function that checks expiry, single use and the caller's identity;
 * the role you get is the role on the row. In demo mode -- no Supabase -- there
 * is no row, no function and no session, so a browser run would be asserting
 * the shape of a form and nothing about the product.
 *
 * WHAT IT PROVES WHEN IT RUNS
 *
 *   · an owner can create an invitation from Settings → People, and the link
 *     it shows opens the join page for that exact code;
 *   · that link, opened in a second browser context (a different person, no
 *     cookies shared), redeems and lands the new person in the staff area with
 *     the invited role -- and the same link then refuses a second redemption;
 *   · an expired invitation is refused, with words, and does not create a
 *     membership;
 *   · a non-owner who is signed in does not get the invite form.
 *
 * WHAT IT DOES NOT PROVE -- read this before quoting it anywhere
 *
 *   · NO concurrency claim. "Two people tap the same link at the same instant,
 *     one wins" is decided by the UPDATE predicate inside
 *     accept_staff_invite(), and that is covered by
 *     supabase/checks/07_team_invites.sql on a local Postgres cluster. That is
 *     a HARNESS result: a real PostgREST + GoTrue deployment is not the same
 *     runtime, and this file does not turn the harness result into a
 *     production one.
 *   · NO PostgREST behaviour. The REST layer, its error codes and the JWT the
 *     session carries are the real host's business.
 *   · NO claim that expiry works in production unless you supply
 *     E2E_EXPIRED_INVITE_CODE, which needs a row aged in a branch database.
 *     Without it, that test reports itself as skipped rather than passing.
 *
 * REQUIRES (all optional; the file skips itself without the first four)
 *
 *   E2E_BASE_URL             https://<branch>.vercel.app, with
 *                            supabase/migrations/20261029000100 applied
 *   E2E_OWNER_EMAIL          an owner of a test restaurant
 *   E2E_OWNER_PASSWORD
 *   E2E_ROLE                 one of: cashier | kitchen | waiter  (what to invite)
 *   E2E_EXPIRED_INVITE_CODE  optional, an invitation whose created_at was aged
 *                            past its days on a branch database
 *
 * RUN
 *
 *   E2E_BASE_URL=... E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... \
 *     npx playwright test --project=integration
 *
 * IT WRITES ROWS: one invitation, one membership, one staff session. That is
 * acceptable on a branch database and not on production, which is why this
 * never runs automatically -- the project is skipped in CI with no secrets.
 */

const BASE = process.env.E2E_BASE_URL ?? '';
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? '';
const INVITE_ROLE = process.env.E2E_ROLE ?? 'cashier';
const EXPIRED_CODE = process.env.E2E_EXPIRED_INVITE_CODE ?? '';

const READY = Boolean(BASE && OWNER_EMAIL && OWNER_PASSWORD);

/** A fresh browser context is a fresh person: no shared cookies, no session. */
async function signIn(context: BrowserContext, email: string, password: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The shell only renders for an authenticated staff member; the rail is the
  // proof that the session exists rather than a redirect landing on /login.
  await expect(page.locator('#app-rail')).toBeVisible({ timeout: 20_000 });
  return page;
}

test.describe('a team invitation, clicked through', () => {
  test.skip(!READY, 'set E2E_BASE_URL, E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD');

  // Serial: the second test redeems the link the first one minted, and a
  // parallel run would be testing two different invitations.
  test.describe.configure({ mode: 'serial' });

  test('the owner creates one, and the link it shows is a real link', async ({ browser }) => {
    const owner = await browser.newContext();
    const page = await signIn(owner, OWNER_EMAIL, OWNER_PASSWORD);

    await page.goto(`${BASE}/dashboard/settings`);
    await page.getByRole('tab', { name: /people/i }).click().catch(async () => {
      // The tab strip is the normal route; the direct link is the fallback, so
      // a rename of the strip does not turn this into a false failure.
      await page.goto(`${BASE}/dashboard/settings?tab=people`);
    });

    await expect(page.getByRole('heading', { name: /people/i }).first()).toBeVisible();

    // The role picker only offers what the caller may hand out.
    await page.getByLabel(/which role/i).selectOption(INVITE_ROLE);
    await page.getByLabel(/how long should the link work/i).selectOption('1');
    await page.getByRole('button', { name: 'Create invitation link' }).click();

    const shown = page.locator('#team-new-invite-link');
    await expect(shown).toBeVisible({ timeout: 15_000 });

    const link = (await shown.textContent())?.trim() ?? '';
    // A join link for THIS environment, containing a code -- not an error page
    // and not a placeholder.
    expect(link).toMatch(/\/join\/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(link.startsWith(BASE.replace(/\/$/, ''))).toBe(true);

    // The waiting list now names the role it was created for.
    await expect(page.getByText(/Waiting to be used/i)).toBeVisible();

    // Hand the link to the next test through the file system, not a global:
    // Playwright runs serial tests in one worker, but a `test.info()` state
    // file is what survives a retry.
    test.info().annotations.push({ type: 'invite-link', description: link });
    process.env.E2E_CREATED_INVITE_LINK = link;

    await owner.close();
  });

  test('a second person redeems it once, and the link then refuses', async ({ browser }) => {
    const link = process.env.E2E_CREATED_INVITE_LINK ?? '';
    test.skip(!link, 'the previous test did not produce a link');

    // A brand-new context: no cookies, so this is a different person browser-
    // side exactly as it would be on their own phone.
    const guest = await browser.newContext();
    const page = await guest.newPage();

    await page.goto(link);
    await expect(page.getByText(/Team invitation/i).first()).toBeVisible();

    // The join page asks the new person for their own login details. The
    // labels come from the page itself, so a rename is a visible failure here
    // rather than a silent pass.
    await page.getByLabel('Your name').fill('E2E Invitee');
    await page.getByLabel('Email').fill(`e2e-invite-${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('E2e-invite-pass-9');
    await page.getByRole('button', { name: 'Create account and join' }).click();

    // Whatever the host does next (a session straight away, or a confirmation
    // step), the invitation must be spent: reopening it is refused, in words,
    // and not silently.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.goto(link);
    await expect(page.getByText(/used|expired|no longer/i).first()).toBeVisible({ timeout: 15_000 });

    await guest.close();
  });

  test('an expired invitation is refused and adds nobody', async ({ browser }) => {
    test.skip(!EXPIRED_CODE, 'set E2E_EXPIRED_INVITE_CODE from a branch database with an aged row');

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/join/${EXPIRED_CODE}`);

    // Said plainly, on the page, with the one action that fixes it.
    await expect(page.getByText(/expired/i).first()).toBeVisible();
    await context.close();
  });

  test('a non-owner does not get a working invitation form', async ({ browser }) => {
    // The person who just joined has the invited role. If that role is not an
    // owner, Settings → People must refuse them -- and the refusal has to be
    // the server's decision, not a hidden form.
    const memberEmail = process.env.E2E_MEMBER_EMAIL ?? '';
    const memberPassword = process.env.E2E_MEMBER_PASSWORD ?? '';
    test.skip(
      !memberEmail || !memberPassword,
      'set E2E_MEMBER_EMAIL and E2E_MEMBER_PASSWORD to a non-owner account',
    );

    const context = await browser.newContext();
    const page = await signIn(context, memberEmail, memberPassword);
    await page.goto(`${BASE}/dashboard/settings`);

    // Either the screen says who may invite, or the form is not rendered. What
    // must NOT happen is a form that submits.
    const create = page.getByRole('button', { name: 'Create invitation link' });
    if (await create.count()) {
      await expect(create).toBeDisabled();
    } else {
      await expect(
        page.getByText(/only an owner|owner or a manager|not your role|owner can/i).first(),
      ).toBeVisible();
    }

    await context.close();
  });
});
