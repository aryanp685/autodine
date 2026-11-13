import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({ pending: false }));

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, useFormStatus: () => ({ pending: mocks.pending }) };
});
vi.mock('@/app/auth/actions', () => ({
  resendSignupConfirmationAction: async () => ({ status: 'idle' }),
}));

import { SignupConfirmationResendFeedback } from '@/components/ResendSignupConfirmationForm';
import { SignupConfirmationPendingScreen } from './SignupConfirmationPendingScreen';

describe('SignupConfirmationPendingScreen', () => {
  it('gives the address holder inbox, spam, resend, cooldown, expired-link and login guidance', () => {
    mocks.pending = false;
    const html = renderToStaticMarkup(<SignupConfirmationPendingScreen email="owner@example.test" />);

    expect(html).toContain('Check your inbox');
    expect(html).toContain('owner@example.test');
    expect(html).toMatch(/spam and junk/i);
    expect(html).toContain('Request another confirmation');
    expect(html).toMatch(/cooldown/i);
    expect(html).toMatch(/expired or already used/i);
    expect(html).toContain('href="/login"');
    expect(html).toContain('Return to sign in');
    expect(html).not.toMatch(/email (?:has been )?sent|we sent you/i);
    expect(html).not.toMatch(/this email is registered|an account exists/i);
  });

  it('offers an editable address when the short-lived email cookie is unavailable', () => {
    const html = renderToStaticMarkup(<SignupConfirmationPendingScreen email={null} />);

    expect(html).toContain('Enter the address you used to sign up');
    expect(html).toContain('name="email"');
    expect(html).toContain('type="email"');
  });

  it('explains expired or reused confirmation links without claiming a delivery or deleting state', () => {
    const html = renderToStaticMarkup(
      <SignupConfirmationPendingScreen email={null} linkProblem />,
    );

    expect(html).toContain('This confirmation link could not be completed');
    expect(html).toMatch(/expired or already used/i);
    expect(html).toContain('Nothing is deleted by this page');
  });

  it('prevents accidental duplicate submissions while the resend action is pending', () => {
    mocks.pending = true;
    const html = renderToStaticMarkup(<SignupConfirmationPendingScreen email="owner@example.test" />);
    mocks.pending = false;

    expect(html).toContain('disabled=""');
    expect(html).toContain('Requesting confirmation');
    expect(html).toContain('aria-busy="true"');
  });

  it('shows the same non-committal result for every valid address and generic cooldown guidance', () => {
    const requested = renderToStaticMarkup(<SignupConfirmationResendFeedback status="requested" />);
    expect(requested).toContain('If a signup for this address is waiting for confirmation');
    expect(requested).toContain('Delivery is not confirmed');
    expect(requested).toMatch(/Auth may apply a sending cooldown/i);
    expect(requested).not.toMatch(/email (?:has been )?sent|accepted the confirmation request/i);
    expect(requested).not.toMatch(/account exists|email is registered/i);

    const invalid = renderToStaticMarkup(<SignupConfirmationResendFeedback status="invalid" />);
    expect(invalid).toContain('Enter a valid email address');
  });
});
