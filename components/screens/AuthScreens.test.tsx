import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Sign in and sign up.
 *
 * WHAT THIS GUARDS
 *
 * These are the first screens a returning owner sees and the last screens in
 * the product still wearing the marketing-era two-column layout: a legacy bar,
 * a form card beside three bordered cards of preview copy. They now share one
 * shell — the form gets the column, the honest notes sit under it.
 *
 * The claims pinned here are the ones a signup page is tempted to overstate:
 * that no card is taken, that no trial is counting down, and that nothing is
 * charged. They are true of this build and they are the reason somebody
 * decides to try it.
 *
 * The consent box is asserted to be UNchecked in the markup: a pre-ticked box
 * is not valid consent under India's DPDP Act.
 */

vi.mock('@/app/auth/actions', () => ({
  signInAction: () => Promise.resolve(),
  signUpAction: () => Promise.resolve(),
  requestPasswordResetAction: () => Promise.resolve(),
  updatePasswordAction: () => Promise.resolve(),
}));

import { LoginScreen } from './LoginScreen';
import { SignupScreen } from './SignupScreen';

describe('sign in', () => {
  const html = renderToStaticMarkup(<LoginScreen />);

  it('keeps the sign-in form focused with a separate desktop overview', () => {
    expect(html).toMatch(/Sign in to your\s*<(?:em|span)[^>]*>restaurant<\/(?:em|span)>/);
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('type="submit"');
    // The old shell: a marketing bar and a two-column split with a form card
    // beside a stack of aside cards.
    expect(html).not.toContain('pg__bar');
    expect(html).not.toContain('pg__asideCard');
    // One shell, one card, and the notes under it as a list.
    expect(html).toContain('data-auth-shell');
    expect(html).toContain('Before you sign in');
    expect(html).toContain('Restaurant workspace overview');
    expect(html).toContain('autoComplete="current-password"');
  });

  it('keeps the recovery route next to the password field', () => {
    expect(html).toContain('href="/forgot-password"');
    expect(html).toContain('Reset your password');
  });

  it('keeps saying what is live, without a card competing with the form', () => {
    expect(html).toContain('Ordering, the kitchen board and the counter are live');
    expect(html).toContain('New accounts start with 21 trial days');
    expect(html).toContain('through Cashfree');
    expect(html).not.toContain('Plans are not on sale');
    expect(html).not.toContain('preview');
  });

  it('carries the requested destination through the form', () => {
    const withNext = renderToStaticMarkup(<LoginScreen next="/dashboard/settings" />);
    expect(withNext).toContain('name="next"');
    expect(withNext).toContain('value="/dashboard/settings"');
  });
});

describe('sign up', () => {
  const html = renderToStaticMarkup(<SignupScreen />);

  it('asks for the restaurant name, because the account is one', () => {
    expect(html).toContain('Restaurant setup overview');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('Mobile number (optional)');
    expect(html).toContain('type="tel"');
    expect(html).toContain('name="restaurantName"');
    expect(html).toContain('name="fullName"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
  });

  it('enforces the same password length as the reset form', () => {
    expect(html).toContain('minLength="10"');
    expect(html).toContain('Minimum 10 characters');
  });

  it('carries the setup journey onto a phone, where the forest panel is gone', () => {
    // The journey is drawn twice on purpose: once on the desktop panel and
    // once in the paper block below the form, which is the only copy a
    // 390px screen sees.
    expect(html.match(/Prepare your table cards/g)?.length).toBe(2);
    expect(html).toContain('Your first hour');
    expect(html).toContain('Restaurant setup overview');
  });

  it('does not pre-tick consent', () => {
    expect(html).toContain('name="agree"');
    expect(html.match(/<input[^>]*name="agree"[^>]*>/)?.[0]).toContain('required=""');
    expect(html).not.toMatch(/name="agree"[^>]*checked/);
    expect(html).not.toMatch(/checked[^>]*name="agree"/);
  });

  it('promises nothing that is not connected', () => {
    expect(html).toContain('A 21-day trial starts');
    expect(html).not.toContain('seven-day trial');
    expect(html).not.toContain('no trial is being enforced');
    expect(html).toContain('through Cashfree');
    expect(html).not.toContain('preview');
    expect(html).toContain('No card is required and nothing is charged by this form');
    expect(html).toContain('data-auth-card');
    expect(html).toContain('bg-forest');
    expect(html).toContain('text-white');
  });
});
