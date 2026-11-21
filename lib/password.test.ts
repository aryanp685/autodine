import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD, passwordProblem, passwordsMatch } from './password';

/**
 * The rules are the point, not the wording — but the wording is what an owner
 * reads at the worst moment, so it is checked too: it has to say what to do.
 */

describe('passwordProblem', () => {
  it('accepts a password with upper, lower, number and special', () => {
    expect(passwordProblem('Butter Chicken 26!')).toBeNull();
    expect(passwordProblem('correct Horse9#staple')).toBeNull();
    expect(passwordProblem('Tandoori!Chicken42')).toBeNull();
  });

  it('refuses an empty password', () => {
    expect(passwordProblem('')).toBe('Please choose a password.');
  });

  it('refuses one character short of the minimum', () => {
    expect(MIN_PASSWORD).toBe(10);
    expect(passwordProblem('Ab1!efghi')).toMatch(/at least 10 characters/);
    expect(passwordProblem('Ab1!efghij')).toBeNull();
  });

  it('refuses a password that spaces would make impossible to retype', () => {
    expect(passwordProblem(' correct Horse9')).toMatch(/space at the start or end/);
    expect(passwordProblem('correct Horse9 ')).toMatch(/space at the start or end/);
  });

  it('counts bytes, not characters, because bcrypt does', () => {
    // 30 emoji are 30 characters but 120 bytes: accepted by a length check,
    // silently truncated by the hash, and then the tail does not matter.
    expect(passwordProblem('🍛'.repeat(30))).toMatch(/too long/);

    // Devanagari is three bytes a letter, so 20 letters plus a short prefix is
    // inside the byte limit and must not be refused as if it were enormous.
    expect(new TextEncoder().encode('क'.repeat(20)).length).toBe(60);
    expect(passwordProblem('Ab1!' + 'क'.repeat(20))).toBeNull();

    // …but 30 letters plus the same prefix is over 72 bytes and must be
    // refused, because the hash would silently drop the tail.
    expect(passwordProblem('Ab1!' + 'क'.repeat(30))).toMatch(/too long/);
  });

  it('says how long the limit is', () => {
    expect(MAX_PASSWORD_BYTES).toBe(72);
    expect(passwordProblem('Ab1!' + 'a'.repeat(69))).toContain('72');
    expect(passwordProblem('Ab1!' + 'a'.repeat(68))).toBeNull();
  });

  it('requires an uppercase letter, a lowercase letter, a number and a special character', () => {
    // Each case is missing exactly one requirement.
    const missingUppercase = passwordProblem('ab1!efghij');
    const missingLowercase = passwordProblem('AB1!EFGHIJ');
    const missingNumber = passwordProblem('Abc!efghij');
    const missingSpecial = passwordProblem('Abc1efghij');

    for (const message of [missingUppercase, missingLowercase, missingNumber, missingSpecial]) {
      expect(message).toMatch(/uppercase/);
      expect(message).toMatch(/lowercase/);
      expect(message).toMatch(/number/);
      expect(message).toMatch(/special/);
    }
  });

  it('does not let a space or a non-Latin letter pretend to be a special character', () => {
    // Space is not special.
    expect(passwordProblem('Abc defgh1')).toMatch(/special/);
    // A Devanagari letter is a letter, not special.
    expect(passwordProblem('Abc1defghक')).toMatch(/special/);
  });
});

describe('passwordsMatch', () => {
  it('needs both fields to be the same, non-empty password', () => {
    expect(passwordsMatch('Ab1!efghij', 'Ab1!efghij')).toBe(true);
    expect(passwordsMatch('Ab1!efghij', 'Ab1!efghik')).toBe(false);
    expect(passwordsMatch('', '')).toBe(false);
  });
});
