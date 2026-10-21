import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD, passwordProblem, passwordsMatch } from './password';

/**
 * The rules are the point, not the wording — but the wording is what an owner
 * reads at the worst moment, so it is checked too: it has to say what to do.
 */

describe('passwordProblem', () => {
  it('accepts a long passphrase', () => {
    expect(passwordProblem('butter chicken 26')).toBeNull();
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });

  it('refuses an empty password', () => {
    expect(passwordProblem('')).toBe('Please choose a password.');
  });

  it('refuses one character short of the minimum', () => {
    expect(MIN_PASSWORD).toBe(10);
    expect(passwordProblem('abcdefghi')).toMatch(/at least 10 characters/);
    expect(passwordProblem('abcdefghij')).toBeNull();
  });

  it('refuses a password that spaces would make impossible to retype', () => {
    expect(passwordProblem(' correct horse')).toMatch(/space at the start or end/);
    expect(passwordProblem('correct horse ')).toMatch(/space at the start or end/);
  });

  it('counts bytes, not characters, because bcrypt does', () => {
    // 30 emoji are 30 characters but 120 bytes: accepted by a length check,
    // silently truncated by the hash, and then the tail does not matter.
    expect(passwordProblem('🍛'.repeat(30))).toMatch(/too long/);

    // Devanagari is three bytes a letter, so 30 letters is still inside the
    // limit and must not be refused as if it were enormous.
    expect(new TextEncoder().encode('क'.repeat(30)).length).toBe(90);
    expect(passwordProblem('क'.repeat(20))).toBeNull();
  });

  it('says how long the limit is', () => {
    expect(MAX_PASSWORD_BYTES).toBe(72);
    expect(passwordProblem('a'.repeat(73))).toContain('72');
    expect(passwordProblem('a'.repeat(72))).toBeNull();
  });
});

describe('passwordsMatch', () => {
  it('needs both fields to be the same, non-empty password', () => {
    expect(passwordsMatch('abcdefghij', 'abcdefghij')).toBe(true);
    expect(passwordsMatch('abcdefghij', 'abcdefghik')).toBe(false);
    expect(passwordsMatch('', '')).toBe(false);
  });
});
