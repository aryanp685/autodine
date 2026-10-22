import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A source-level guard, not a rendering test.
 *
 * The home page shipped blank once, and every check in the repository passed
 * while it did: the component rendered, the types were sound, the tests were
 * green, the build compiled. The defect was that `gsap.from()` reads its END
 * value from the computed style, and the stylesheet had already set that style
 * to `opacity: 0` -- so the animation ran from nothing to nothing and left the
 * page invisible.
 *
 * jsdom cannot prove this, because jsdom does not apply the stylesheet the way
 * a browser does and the failure depends on that. What a test *can* do is
 * refuse the construct. `from()` on a CSS-hidden element is always the bug, so
 * the file is read and searched for it.
 */

const source = readFileSync(join(process.cwd(), 'components/HomeMotion.tsx'), 'utf8');

/**
 * The file's own comments discuss the bug by name -- "every tween here used
 * gsap.from()" -- so the search runs on the code with its comments removed.
 * A guard that fires on the explanation of the thing it guards is a guard
 * someone deletes.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

describe('HomeMotion', () => {
  it('never animates from a computed value with gsap.from', () => {
    // `gsap.from(` and `gsap.fromTo(` are different calls; match the former
    // exactly so the correct one does not trip the check.
    const calls = code.match(/gsap\.from\(/g) ?? [];
    expect(calls).toHaveLength(0);
  });

  it('stages every tween with an explicit end state', () => {
    const fromTo = code.match(/gsap\.fromTo\(/g) ?? [];
    // hero steps, opening image, section rules, reveals, groups -- more would
    // be fine, fewer means a tween was converted back.
    expect(fromTo.length).toBeGreaterThanOrEqual(5);
  });

  it('marks the motion layer alive, so the fail-open timer does not fire', () => {
    expect(source).toContain("setAttribute('data-motion-ready'");
  });

  it('keeps a watchdog that reveals the page without GSAP', () => {
    expect(source).toMatch(/const WATCHDOG_MS = \d+/);
    expect(source).toMatch(/const SAFETY_MS = \d+/);
  });
});
