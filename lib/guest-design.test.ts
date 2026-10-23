import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The guest flow's design decisions, pinned.
 *
 * These are not style preferences. Each one below is a decision that was made
 * for a reason and would silently come back if nobody watched it -- and every
 * one of them was, at some point, reported by somebody looking at a phone:
 *
 *   "black everywhere"
 *   "the green does not look good"
 *   "the button has no text on it"
 *   "the cart bar is on top of the tabs"
 *
 * A screenshot catches those once. A test catches the next time.
 */

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** The guest section of the stylesheet, so an owner-screen rule cannot pass these. */
const guest = css.slice(css.indexOf('[data-flow-root]'));

describe('guest flow design system', () => {
  it('paints one wash, and does not rely on a flat page colour', () => {
    expect(guest).toMatch(/\[data-flow-root\]\s*\{[\s\S]*?background:\s*\n?\s*radial-gradient/);
    // The wash has to be fixed: a background that scrolls with the content
    // stops reading as a surface and starts reading as a slow animation.
    expect(guest).toContain('background-attachment: fixed');
  });

  it('keeps the accent out of the page background at full strength', () => {
    // Only BACKGROUND declarations are checked: a tinted border or a shadow
    // under the primary button is the opposite of a colour field, it is what
    // gives an edge its definition. The rule is about fills.
    const backgrounds = [...guest.matchAll(/background(?:-color)?:\s*([\s\S]*?);/g)].map(
      (m) => m[1],
    );
    expect(backgrounds.length).toBeGreaterThan(0);

    for (const declaration of backgrounds) {
      for (const entry of declaration.match(/color-mix\(in oklab, var\(--p-accent\) (\d+)%/g) ?? []) {
        const percent = Number(entry.match(/(\d+)%/)?.[1] ?? 0);
        // Above ~30% behind twenty dish cards the accent stops being a tint.
        expect(percent, entry).toBeLessThanOrEqual(30);
      }
    }
  });

  it('has no ink-filled primary button in the flow', () => {
    // The primary action is the restaurant's accent. An `bg-gink` fill with
    // white type was the old button, and it was reported as "black everywhere".
    const offenders = [
      ...guest.matchAll(/\.g-primary\s*\{([\s\S]*?)\}/g),
      ...css.matchAll(/\.g-primary\s*\{([\s\S]*?)\}/g),
    ].map((m) => m[1]);
    expect(offenders.length).toBeGreaterThan(0);
    for (const body of offenders) expect(body).toContain('var(--p-accent)');
  });

  it('does not put a backdrop-filter on every card', () => {
    // A blur pass per dish is a real GPU cost on a phone for no visible gain:
    // the cards sit on a smooth gradient with nothing moving behind them. The
    // blur belongs to the three chrome surfaces that have content scrolling
    // underneath -- and to nothing else.
    const cardRule = css.match(/\[data-flow-root\] \.bg-card\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(cardRule).not.toContain('backdrop-filter');

    const chrome = css.match(/\[data-flow-root\] \[data-flow-chrome\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(chrome).toContain('backdrop-filter');
  });

  it('keeps element resets in a layer, so a utility can beat them', () => {
    // `a { color: inherit }` unlayered beat `text-onink` -- an unlayered rule
    // outranks every layered one regardless of specificity -- and rendered a
    // black button with black text on it. It looked like a button with no label.
    expect(css).toContain('@layer base {');
    const unlayeredLinkReset = /^a\s*\{[^}]*color:\s*inherit/m;
    expect(css).not.toMatch(unlayeredLinkReset);
  });

  it('gives every customer the same UI, whichever restaurant they are in', () => {
    // The flow used to be painted with the restaurant's stored accent, so two
    // restaurants rendered two different products. Nothing in the guest flow
    // may read that column again: the colour comes from guestAccentStyle(),
    // which takes no input.
    const screens = readdirSync(new URL('../components/screens/', import.meta.url))
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
      .map((f) => [
        f,
        readFileSync(new URL(`../components/screens/${f}`, import.meta.url), 'utf8'),
      ] as const);

    expect(screens.length).toBeGreaterThan(5);
    for (const [file, source] of screens) {
      expect(source, `${file} reads a per-restaurant accent`).not.toMatch(
        /restaurant\.accent|accentFrom\(|\.accent\)/,
      );
      expect(source, `${file} imports the old accentStyle`).not.toContain('accentStyle(');
    }

    // And the shared header/branding components, same rule.
    for (const file of ['MenuIdentity.tsx', 'GuestFlow.tsx', 'GuestTabs.tsx']) {
      const source = readFileSync(new URL(`../components/${file}`, import.meta.url), 'utf8');
      expect(source, `${file} reads a per-restaurant accent`).not.toMatch(/restaurant\.accent/);
    }
  });

  it('scopes every guest rule, so owner screens keep their white surface', () => {
    // A selector for .g-card or [data-flow-chrome] without the scope would
    // restyle the dashboard, whose palette the design guard pins to opaque
    // white. Checked by shape rather than by listing every rule.
    for (const block of guest.matchAll(/^\.g-[a-z-]+(\.[a-z-]+)?\s*\{/gm)) {
      expect(block[0], 'unscoped guest component').toBeUndefined();
    }
  });
});
