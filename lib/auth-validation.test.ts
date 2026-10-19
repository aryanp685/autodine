import { describe, expect, it } from 'vitest';
import { getSignupValidationError, isValidSignInInput, type SignupCredentials } from './auth-validation';

const validSignup: SignupCredentials = {
  fullName: 'Aarav Patel',
  restaurantName: 'Saffron & Smoke',
  email: 'owner@restaurant.in',
  phone: '+91 90000 00000',
  password: 'a-long-preview-password',
  agreed: true,
};

describe('authentication form validation', () => {
  it('accepts valid signup details', () => {
    expect(getSignupValidationError(validSignup)).toBeNull();
  });

  it('enforces required consent and the password length range on the server', () => {
    expect(getSignupValidationError({ ...validSignup, agreed: false })).toMatch(/confirm/i);
    expect(getSignupValidationError({ ...validSignup, password: 'short' })).toMatch(/at least 10/i);
    expect(getSignupValidationError({ ...validSignup, password: 'x'.repeat(129) })).toMatch(/128 characters/i);
  });

  it('rejects invalid or oversized account details', () => {
    expect(getSignupValidationError({ ...validSignup, email: 'not-an-email' })).toMatch(/valid email/i);
    expect(getSignupValidationError({ ...validSignup, fullName: 'x'.repeat(121) })).toMatch(/120 characters/i);
    expect(getSignupValidationError({ ...validSignup, phone: 'x'.repeat(31) })).toMatch(/30 characters/i);
  });

  it('validates sign-in credentials without trimming or changing the password', () => {
    expect(isValidSignInInput('owner@restaurant.in', '  keep spaces  ')).toBe(true);
    expect(isValidSignInInput('bad-email', 'password')).toBe(false);
    expect(isValidSignInInput('owner@restaurant.in', '')).toBe(false);
    expect(isValidSignInInput('owner@restaurant.in', 'x'.repeat(1025))).toBe(false);
  });
});
