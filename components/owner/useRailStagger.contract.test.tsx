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

const FILES = ['components/owner/useRailStagger.ts', 'components/owner/ChartMotion.tsx'];

const source = readFileSync(join(process.cwd(), 'components/owner/useRailStagger.ts'), 'utf8');

/** Comments discuss the ban by name; the checks run on the code. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

/**
 * Both GSAP surfaces, checked by the same four rules. A rule that is only
 * enforced in the file it was written for is a rule the next file breaks.
 */
describe.each(FILES)('%s', (relative) => {
  const file = readFileSync(join(process.cwd(), relative), 'utf8');
  const body = file
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  it('never animates from a computed value with gsap.from', () => {
    expect(body.match(/gsap\.from\(/g) ?? []).toHaveLength(0);
  });

  it('names both ends of every tween', () => {
    const fromTo = body.match(/gsap\.fromTo\(|fromTo\(/g) ?? [];
    expect(fromTo.length).toBeGreaterThan(0);
  });

  it('imports GSAP lazily', () => {
    expect(body).toContain("await import('gsap')");
    expect(/^import\s+.*from\s+'gsap'/m.test(body)).toBe(false);
  });

  it('scopes the timeline to a context and reverts it', () => {
    expect(body).toContain('gsap.context(');
    expect(body).toContain('.revert()');
  });

  it('asks about reduced motion before scheduling anything', () => {
    expect(body.indexOf('prefers-reduced-motion')).toBeGreaterThan(-1);
    expect(body.indexOf('prefers-reduced-motion')).toBeLessThan(body.indexOf("await import('gsap')"));
  });
});

describe('the rail stagger', () => {
  it('stages one heads-tailed timeline', () => {
    expect(code.match(/gsap\.fromTo\(/g) ?? []).toHaveLength(1);
  });

  it('returns the rows to the stylesheet when the tween lands', () => {
    // Without this the end state is an inline style, and the next open starts
    // from whatever the previous one left.
    expect(code).toContain('clearProps');
  });

  it('is scoped to the open drawer, not to the always-visible rail', () => {
    // On a laptop the rail never moves. An effect that runs regardless would
    // re-animate the navigation on every page load.
    expect(code).toMatch(/if\s*\(!root\s*\|\|\s*!open\)\s*return;/);
  });
});
