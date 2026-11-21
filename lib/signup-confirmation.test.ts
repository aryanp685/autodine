import { describe, expect, it } from 'vitest';
import {
  normalizeAuthEmail,
  signupConfirmationRedirectTo,
} from './signup-confirmation';

describe('owner signup confirmation helpers', () => {
  it('normalizes email addresses and rejects malformed or unbounded input', () => {
    expect(normalizeAuthEmail(' Owner@Example.Test ')).toBe('owner@example.test');
    expect(normalizeAuthEmail('not-an-email')).toBeNull();
    expect(normalizeAuthEmail(`a@${'x'.repeat(321)}.test`)).toBeNull();
  });

  it('builds a fixed same-origin signup callback and dashboard destination', () => {
    const value = signupConfirmationRedirectTo('https://autodine.example');
    expect(value).not.toBeNull();
    const callback = new URL(value!);
    expect(callback.origin).toBe('https://autodine.example');
    expect(callback.pathname).toBe('/auth/confirm');
    expect(callback.searchParams.get('flow')).toBe('signup');
    expect(callback.searchParams.get('next')).toBe('/dashboard');
  });

  it('allows only loopback HTTP for local development', () => {
    expect(signupConfirmationRedirectTo('http://localhost:3000')).toBe(
      'http://localhost:3000/auth/confirm?flow=signup&next=%2Fdashboard',
    );
    expect(signupConfirmationRedirectTo('http://autodine.example')).toBeNull();
  });

  it('rejects malformed, credentialed, path-bearing, or query-bearing origins', () => {
    expect(signupConfirmationRedirectTo('not a URL')).toBeNull();
    expect(signupConfirmationRedirectTo('https://user:pass@autodine.example')).toBeNull();
    expect(signupConfirmationRedirectTo('https://autodine.example/untrusted')).toBeNull();
    expect(signupConfirmationRedirectTo('https://autodine.example?next=https://evil.example')).toBeNull();
    expect(signupConfirmationRedirectTo(null)).toBeNull();
  });
});
