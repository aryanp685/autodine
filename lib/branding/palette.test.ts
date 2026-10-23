import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  ACCENT_KEYS,
  DEFAULT_ACCENT,
  PAPER,
  accentFrom,
  accentStyle,
  contrast,
} from './palette';

/**
 * The palette is a security-shaped thing wearing a design hat: an owner's
 * colour choice is stored in a column with a CHECK constraint, rendered as an
 * inline CSS variable, and read by every guest screen. These tests pin the
 * three ways that can go wrong.
 */

describe('accent palette', () => {
  it('keeps every accent readable on paper and under white text', () => {
    for (const { key, accent } of ACCENTS) {
      // Used as text (a price, a link) on the paper background.
      expect(contrast(accent, PAPER), `${key} on paper`).toBeGreaterThanOrEqual(4.5);
      // Used as a button fill with white label text, which is how the add
      // control and the sticky dock actually render.
      expect(contrast(accent, '#ffffff'), `${key} under white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps soft washes light enough to sit behind dark text', () => {
    for (const { key, soft } of ACCENTS) {
      // A soft wash is a background; text on it is ink, not white.
      expect(contrast(soft, '#0c0b09'), `${key} soft under ink`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has no duplicate keys or colours', () => {
    expect(new Set(ACCENT_KEYS).size).toBe(ACCENTS.length);
    expect(new Set(ACCENTS.map((a) => a.accent)).size).toBe(ACCENTS.length);
  });

  it('falls back to the default instead of throwing on junk', () => {
    // The guest menu must never fail to render because a row carries a value
    // this build does not know about.
    for (const junk of [null, undefined, '', 'neon', 42, {}, 'GREY']) {
      expect(accentFrom(junk).key).toBe(DEFAULT_ACCENT);
    }
    // Case and surrounding space are folded, so a stored row written by hand
    // still resolves to the colour it names -- and the default is no longer
    // the same key as the one this line checks, so a fallback cannot pass it.
    expect(accentFrom(' MAROON ').key).toBe('maroon');
    expect(accentFrom('terracotta').key).toBe('terracotta');
  });

  it('emits exactly the two variables the stylesheets consume', () => {
    expect(Object.keys(accentStyle('indigo')).sort()).toEqual(['--p-accent', '--p-accent-soft']);
    expect(accentStyle('indigo')['--p-accent']).toBe('#37456B');
  });

  /**
   * The database has its own copy of this list inside a CHECK constraint, and
   * the two must agree. Drift in either direction is a real bug: a key the
   * database refuses means an owner presses Save and is told nothing was
   * saved; a key the app does not know means a stored branding silently
   * reverts to forest on every render.
   */
  it('matches the accent CHECK constraint in the migration', () => {
    const sql = readFileSync(
      new URL('../../supabase/migrations/20261025001000_restaurant_branding.sql', import.meta.url),
      'utf8',
    );
    const match = sql.match(/check\s*\(\s*accent\s+in\s*\(([^)]*)\)/i);
    expect(match, 'accent CHECK constraint not found in the migration').toBeTruthy();

    const inSql = match![1]
      .split(',')
      .map((part) => part.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
      .sort();

    expect(inSql).toEqual([...ACCENT_KEYS].sort());
  });
});
