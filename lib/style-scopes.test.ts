import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Two stylesheets, two page families, one global namespace.
 *
 * The bug this file exists for shipped to production: the home page's "how it
 * works" section and the guest ordering flow both used `.flow`, `.flow__step`
 * and `.flow__steps`. guest.css is imported after premium.css, so the guest
 * shell won on the marketing page — the four steps were laid out as 16px
 * progress-bar segments and their headings and copy overflowed a 16px box on
 * top of each other. The whole section was unreadable, and nothing caught it:
 * every test asserted markup and copy, and CSS collisions are invisible to
 * both.
 *
 * The two files are the last word on their own screens, so a class name they
 * share is always a mistake — one of the two is silently overwritten. State
 * classes (`is-on`, `is-active`) and utilities (`tnum`) are exempt: sharing
 * those is the point.
 */

/** Every class name a stylesheet defines, ignoring anything inside a comment. */
function classesIn(path: string): Set<string> {
  const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const found = new Set<string>();

  // Selector blocks only: text between } (or the start) and the next {.
  for (const match of css.matchAll(/(?:^|\})\s*([^{}@]*)\{/g)) {
    for (const selector of match[1].split(',')) {
      for (const name of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) found.add(name[1]);
    }
  }

  return found;
}

/** State and utility classes that are meant to be shared. */
const SHARED = /^(is-|has-|tnum$|sr-only$|js-)/;

describe('style scopes', () => {
  const premium = classesIn('styles/premium.css');
  const guest = classesIn('styles/guest.css');

  it('reads both stylesheets', () => {
    // A regex that silently matched nothing would make the test below vacuous.
    expect(premium.size).toBeGreaterThan(50);
    expect(guest.size).toBeGreaterThan(50);
  });

  it('gives the marketing pages and the guest flow no class in common', () => {
    const shared = [...premium].filter((name) => guest.has(name) && !SHARED.test(name));

    expect(shared).toEqual([]);
  });

  it('keeps the marketing step layout under its own prefix', () => {
    // The specific pair from the bug, named so a regression reads clearly.
    for (const name of ['flow', 'flow__step', 'flow__steps', 'flow__body']) {
      expect(premium.has(name)).toBe(false);
    }
    expect(premium.has('pflow')).toBe(true);
    expect(premium.has('pflow__step')).toBe(true);
  });
});
