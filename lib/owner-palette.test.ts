import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The owner surface's colour contract, read out of the stylesheet itself.
 *
 * Why a test on CSS text rather than a screenshot: there is no browser in CI,
 * and the failures this catches are not subjective ones. The palette has
 * already shipped two ways it can go wrong without anyone noticing --
 *
 *   1. a token that does not carry the contrast its own comment claims, and
 *   2. a colour left behind by an older palette in a rule nobody re-read (the
 *      ambient wash kept a blue corner for a whole accent change).
 *
 * Both are arithmetic on the source. The aesthetic judgement stays with the
 * person looking at the screen; what is checked here is that the numbers on the
 * screen are the numbers the system promises.
 */

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** The owner token block: `[data-app] [data-surface='owner']`. */
function ownerTokens(): Record<string, string> {
  const start = css.indexOf("[data-app] [data-surface='owner'] {");
  expect(start, 'the owner token block has moved or been renamed').toBeGreaterThan(-1);
  const end = css.indexOf('\n}', start);
  const block = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*--([\w-]+)\s*:\s*([^;]+);/gm)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

const tokens = ownerTokens();

function rgb(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = hex[1];
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b] = rgba[1].split(',').map((v) => Number(v.trim()));
    return [r, g, b];
  }
  throw new Error(`not a colour: ${value}`);
}

/** Flatten an alpha token onto an opaque background, the way the browser does. */
function over(alpha: string, base: string): [number, number, number] {
  const a = Number(alpha.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/)?.[1] ?? 1);
  const [fr, fg, fb] = rgb(alpha);
  const [br, bg, bb] = rgb(base);
  return [fr * a + br * (1 - a), fg * a + bg * (1 - a), fb * a + bb * (1 - a)];
}

function luminance(colour: [number, number, number]): number {
  const [r, g, b] = colour
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('owner palette tokens', () => {
  it('defines every token the surface paints with', () => {
    for (const name of [
      'p-paper',
      'p-card',
      'p-ink',
      'p-ink-46',
      'p-accent',
      'p-accent-strong',
      'p-accent-soft',
      'p-on-ink',
      'p-live',
      'p-due',
      'p-rail',
      'p-rail-ink',
    ]) {
      expect(tokens[name], `--${name} is missing`).toBeTruthy();
    }
  });

  it('can be read as text and as a fill with the same token', () => {
    // Anything on the surface may be set in the accent, and a filled action is
    // the accent behind its own label. Both have to clear 4.5:1.
    expect(contrast(rgb(tokens['p-accent']), rgb(tokens['p-card']))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens['p-on-ink']), rgb(tokens['p-accent']))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens['p-accent']), rgb(tokens['p-accent-soft']))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps body type and meta type readable on the field and on a card', () => {
    for (const base of ['p-paper', 'p-card', 'p-rail']) {
      const bg = rgb(tokens[base]);
      expect(contrast(over(tokens['p-ink'], tokens[base]), bg)).toBeGreaterThanOrEqual(7);
      // 0.62 alpha is the quiet end of the ramp; below 4.5 it reads as
      // switched off rather than as secondary.
      expect(contrast(over(tokens['p-ink-46'], tokens[base]), bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(rgb(tokens['p-rail-ink']), rgb(tokens['p-rail']))).toBeGreaterThanOrEqual(7);
  });

  it('keeps both status meanings readable on their own washes', () => {
    expect(contrast(rgb(tokens['p-live']), rgb(tokens['p-live-soft']))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(tokens['p-due']), rgb(tokens['p-due-soft']))).toBeGreaterThanOrEqual(4.5);
    expect(tokens['p-live']).not.toBe(tokens['p-due']);
  });
});

describe('no colour survives from a palette that has been replaced', () => {
  it('has no trace of the retired blue accent', () => {
    expect(css).not.toMatch(/rgba\(\s*0,\s*102,\s*204/);
    expect(css).not.toMatch(/#0066cc/i);
    expect(css).not.toMatch(/#0058b9/i);
  });

  it('derives the ambient wash from the accent token, not from a remembered hex', () => {
    const start = css.indexOf('/* The wash: barely there, on purpose.');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('\n}', start));
    expect(block).toContain('var(--p-accent)');
  });
});
