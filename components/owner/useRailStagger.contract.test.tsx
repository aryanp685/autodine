import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The second GSAP surface in the product, guarded the same way as the first.
 *
 * `components/SiteMotion.contract.test.tsx` exists because a `gsap.from()`
 * reading its end value from the computed style shipped a blank home page.
 * This file adds GSAP to the owner shell, which is the surface with more
 * people in front of it, so the four rules that made the first one safe are
 * asserted here rather than remembered:
 *
 *   1. `fromTo`, never `from` -- both ends named.
 *   2. lazily imported, so the drawer is usable before (and without) GSAP.
 *   3. `gsap.context()` with a revert, so an interrupted stagger cannot leave
 *      inline styles behind.
 *   4. reduced motion checked BEFORE any frame is scheduled.
 *
 * A source-level test, deliberately: jsdom cannot prove any of this, and the
 * markup would look identical either way.
 */

const source = readFileSync(join(process.cwd(), 'components/owner/useRailStagger.ts'), 'utf8');

/** Comments discuss the ban by name; the checks run on the code. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

describe('the rail stagger', () => {
  it('never animates from a computed value with gsap.from', () => {
    expect(code.match(/gsap\.from\(/g) ?? []).toHaveLength(0);
    expect(code.match(/gsap\.fromTo\(/g) ?? []).toHaveLength(1);
  });

  it('imports GSAP lazily, so the drawer works before the chunk arrives', () => {
    expect(code).toContain("await import('gsap')");
    // A static import would put GSAP in the shell's first payload.
    expect(/^import\s+.*from\s+'gsap'/m.test(code)).toBe(false);
  });

  it('scopes the timeline to a context and reverts it', () => {
    expect(code).toContain('gsap.context(');
    expect(code).toContain('context.revert()');
  });

  it('asks about reduced motion before scheduling anything', () => {
    const reducedAt = code.indexOf('prefers-reduced-motion');
    const importAt = code.indexOf("await import('gsap')");
    expect(reducedAt).toBeGreaterThan(-1);
    // The check has to come first: a guard after the import still animates.
    expect(reducedAt).toBeLessThan(importAt);
  });

  it('returns the rows to the stylesheet when the tween lands', () => {
    // Without this the end state is an inline style, and the next open starts
    // from whatever the previous one left.
    expect(code).toContain('clearProps');
  });
});
