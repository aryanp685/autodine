import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ForgotPasswordScreen } from './ForgotPasswordScreen';

// The screen posts to a server action; the action module is server-only.
vi.mock('@/app/auth/actions', () => ({ requestPasswordResetAction: async () => undefined }));

/**
 * What this page must never do is tell a stranger whether an email has an
 * account. Everything else here is a form: one email field, one button.
 */

describe('ForgotPasswordScreen', () => {
  it('asks for the email with a submit button, and nothing else to fill in', () => {
    const html = renderToStaticMarkup(<ForgotPasswordScreen />);
    expect(html).toContain('Reset your password');
    expect(html).toContain('name="email"');
    expect(html).toContain('Send reset link');
    // No "current password" field: it is the thing they have forgotten.
    expect(html).not.toContain('current-password');
  });

  it('says the link is single-use, time-limited, and same-browser', () => {
    const html = renderToStaticMarkup(<ForgotPasswordScreen />);
    expect(html).toContain('single-use');
    expect(html).toContain('expires in an hour');
    expect(html).toContain('different device');
  });

  it('shows the sent notice without claiming the address exists', () => {
    const html = renderToStaticMarkup(
      <ForgotPasswordScreen notice="If that email has an AutoDine account, a reset link is on its way." />,
    );
    expect(html).toContain('If that email has an AutoDine account');
    expect(html).not.toMatch(/we have sent|link sent to|email sent/i);
  });

  it('shows a rate-limit or send failure as an alert', () => {
    const html = renderToStaticMarkup(<ForgotPasswordScreen error="We could not send the email just now." />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('could not send the email');
  });

  it('links back to sign in', () => {
    const html = renderToStaticMarkup(<ForgotPasswordScreen />);
    expect(html).toContain('href="/login"');
  });
});
