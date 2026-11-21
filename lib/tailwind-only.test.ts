import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The product is Tailwind. This test is the proof, and the guard.
 *
 * WHAT USED TO BE HERE
 *
 * Four stylesheets -- design-system, app, guest, owner -- about nine thousand
 * lines between them, defining `.kb__ticket`, `.dash__stat`, `.cart__bar`,
 * `.bill__sheet`, `.authCard`, `.ui-table` and several hundred others. Every
 * screen depended on them, and they drifted: a screen could be restyled in CSS
 * and read completely differently from the one beside it.
 *
 * Converting screen by screen left them as a second, invisible design system
 * that no longer matched any markup. They are deleted, and this file exists so
 * they cannot quietly come back: a new `.kb__something` in a component is a
 * component that has left the system.
 *
 * The one stylesheet that stays is premium.css, which belongs to the public
 * marketing pages and carries the default token values.
 */

/** Class prefixes and names the deleted product stylesheets owned. */
const LEGACY = [
  /^(pg__|pg--)/,
  /^(dash__|kb__|rep__|cash__|bill__|brand__|photoImport__|auth[A-Z])/,
  /^(ui-(input|select|label|field|hint|check|table|badge|avatar|veg|button))/,
  /^(cart__|co__|menu__|sheet__|placed__|qrProblem|codeInput)/,
  /^(shell__|siteNav|topnav)/,
];

const SOURCE_DIRS = ['app', 'components'];

function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...componentFiles(path));
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) out.push(path);
  }
  return out;
}

describe('the product is Tailwind only', () => {
  it('keeps no product stylesheet beside the marketing layer', () => {
    for (const gone of ['design-system.css', 'app.css', 'guest.css', 'owner.css']) {
      expect(existsSync(join('styles', gone)), `${gone} was deleted in the Tailwind conversion`).toBe(
        false,
      );
    }
    expect(existsSync(join('styles', 'premium.css'))).toBe(true);
  });

  it('has no component asking for a class the product stylesheets used to define', () => {
    const offenders: string[] = [];

    for (const file of SOURCE_DIRS.flatMap(componentFiles)) {
      const source = readFileSync(file, 'utf8');
      // Comments talk about the old classes on purpose -- the history is worth
      // keeping. Only look at className strings.
      for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const raw = (match[1] ?? match[2] ?? '').replace(/\$\{[^}]*\}/g, ' ');
        for (const token of raw.split(/\s+/)) {
          if (token && LEGACY.some((pattern) => pattern.test(token))) {
            offenders.push(`${file}: ${token}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
