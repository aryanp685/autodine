import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ResetPasswordScreen } from './ResetPasswordScreen';

vi.mock('@/app/auth/actions', () => ({ updatePasswordAction: async () => undefined }));

/**
 * Two states, decided on the server: a live session gets the form, no session
 * gets an explanation. Getting this wrong is the difference between "your link
 * expired" and "your new password is wrong", and only one of those is true.
 */

describe('ResetPasswordScreen', () => {
  it('asks for the new password twice, for the account in the session', () => {
    const html = renderToStaticMarkup(<ResetPasswordScreen email="owner@restaurant.in" />);
    expect(html).toContain('Choose a new password');
    expect(html).toContain('owner@restaurant.in');
    expect(html).toContain('name="password"');
    expect(html).toContain('name="confirmation"');
    expect(html).toContain('Save the new password');
  });

  it('states the minimum length on the form itself', () => {
    const html = renderToStaticMarkup(<ResetPasswordScreen email="owner@restaurant.in" />);
    expect(html).toContain('At least 10 characters');
    expect(html).toContain('minLength="10"');
  });

  it('warns that other sessions end', () => {
    const html = renderToStaticMarkup(<ResetPasswordScreen email="owner@restaurant.in" />);
    expect(html).toContain('signs out every other device');
  });

  it('renders no password form when there is no session', () => {
    const html = renderToStaticMarkup(<ResetPasswordScreen email={null} />);
    expect(html).toContain('This reset link has expired');
    expect(html).not.toContain('name="password"');
    expect(html).toContain('href="/forgot-password"');
  });

  it('still shows the server message in the expired state', () => {
    const html = renderToStaticMarkup(<ResetPasswordScreen email={null} error="This reset link has expired." />);
    expect(html).toContain('role="alert"');
  });
});
