#!/usr/bin/env node
/**
 * Design system guard.
 *
 * The Editorial Minimal design is LOCKED. Locks decay unless something checks
 * them on every commit, so this script fails the build when the CSS drifts.
 *
 * Run:  npm run design:check
 * Reset the ratchet (only after a deliberate, approved reduction):
 *        node scripts/check-design-system.mjs --update-baseline
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'design-baseline.json');

const cssFiles = [
  ...readdirSync(join(ROOT, 'styles'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => join(ROOT, 'styles', f)),
  join(ROOT, 'app', 'globals.css'),
].filter(existsSync);

const problems = [];

/* ---------------------------------------------------------------- rule 1 */
/* Elevation is a designed token, not a free-for-all.
 *
 * v1 of this system banned drop shadows outright. The premium pass (approved
 * 2026-10-22) allows depth, but only through the two elevation tokens --
 * --p-shadow-1 (contact) and --p-shadow-2 (lift) -- so every floating surface
 * in the product shares the same two shadows and none of them is invented
 * inline. `inset` remains allowed for hairline underlines, which are not
 * shadows at all, and the old `var(--shadow)` token is still recognised.
 *
 * A literal shadow written by hand is still an error: two hand-tuned shadows in
 * two files is how a system stops looking like a system. */
const ALLOWED_SHADOW = /inset|var\(--shadow\)|var\(--p-shadow-[12]\)|^\s*none\s*;?$/i;
for (const file of cssFiles) {
  const src = readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    const m = line.match(/box-shadow\s*:\s*([^;]+)/i);
    if (!m) return;
    const value = m[1].trim();
    if (!ALLOWED_SHADOW.test(value)) {
      problems.push(`${rel(file)}:${i + 1} hand-written shadow "${value}" — use var(--p-shadow-1) or var(--p-shadow-2), or inset for hairline underlines.`);
    }
  });
}

/* ---------------------------------------------------------------- rule 2 */
/* The A/B/C comparison harness was deleted. Its chrome must not creep back. */
for (const file of [...cssFiles, join(ROOT, 'app'), join(ROOT, 'components')]) {
  for (const f of walk(file)) {
    if (!/\.(tsx?|css)$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/[."']proto-/.test(line)) {
        problems.push(`${rel(f)}:${i + 1} prototype-harness reference — the A/B/C harness was deleted; do not reintroduce it.`);
      }
    });
  }
}

/* ---------------------------------------------------------------- rule 3 */
/* Hardcoded colours ratchet. The locked stylesheet predates this guard and
   contains raw hex values that will not be rewritten (rewriting risks changing
   the approved design). Instead of forbidding them, the count is frozen: it may
   go down, never up. New styles must use the tokens. */
function countHexOutsideTokens(src) {
  // A colour inside a custom property IS the token layer, wherever that block
  // happens to live: `--p-ink: #0c0b09;` is exactly the thing every other rule
  // is supposed to use. Stripping only the first [data-app] block counted the
  // second surface's palette as hardcoded, which is the opposite of the rule's
  // intent. What the ratchet is really about is a hex written into a property
  // that paints something -- `color: #333`, `background: #fff`.
  const withoutDeclarations = src.replace(/^\s*--[\w-]+\s*:\s*[^;]+;/gm, '');
  return (withoutDeclarations.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
}
const hexCount = cssFiles.reduce((n, f) => n + countHexOutsideTokens(readFileSync(f, 'utf8')), 0);

let baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).hexColours : null;

if (process.argv.includes('--update-baseline') || baseline === null) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ hexColours: hexCount, note: 'Hardcoded hex outside the token block. May decrease, never increase.' }, null, 2)}\n`);
  console.log(`Baseline recorded: ${hexCount} hardcoded hex values.`);
  if (baseline !== null && hexCount < baseline) console.log(`Ratchet tightened from ${baseline}.`);
  baseline = hexCount;
} else if (hexCount > baseline) {
  problems.push(
    `Hardcoded colours grew from ${baseline} to ${hexCount} (+${hexCount - baseline}). ` +
      `New styles must use the design tokens. If this is a deliberate reduction, ` +
      `re-run with --update-baseline.`,
  );
}

/* ---------------------------------------------------------------- rule 4 */
/* The product's visual language must stay declared in one place.
 *
 * This used to inspect styles/design-system.css for its 1100/760/420 media
 * queries -- a guard against a named container query leaving phones on the
 * desktop layout. That stylesheet is gone: every screen is Tailwind, whose
 * sm/md/lg/xl variants are viewport queries by construction. What can still go
 * wrong is the token layer: an owner screen with no palette of its own falls
 * back to the warm marketing values and reads as beige.
 */
const globals = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');
for (const token of [
  "--color-paper: var(--p-paper)",
  "--color-gink: var(--p-ink)",
  "--color-hair: var(--p-line)",
  "--color-accent: var(--p-accent)",
]) {
  if (!globals.includes(token)) {
    problems.push(`app/globals.css no longer maps the Tailwind utility ${token} — screens would drift back to raw colours.`);
  }
}
if (!/\[data-surface='owner'\]\s*\{[^}]*--p-paper:\s*#ffffff/.test(globals)) {
  problems.push("app/globals.css is missing the owner surface's white paper token; owner screens would inherit the warm palette.");
}

/* A container query with no container-type is inert, and an inert breakpoint
   looks exactly like a working one until somebody opens the page on a phone. */
for (const file of cssFiles) {
  const src = readFileSync(file, 'utf8');
  if (/@container\s+\w/.test(src) && !/container-type\s*:/.test(src)) {
    problems.push(`${rel(file)} uses @container without declaring a container-type.`);
  }
}

/* ---------------------------------------------------------------- rule 5 */
/*
 * TAILWIND'S LAYER ORDER MUST BE DECLARED.
 *
 * This project imports theme.css and utilities.css individually rather than
 * Tailwind's entry stylesheet, which means the `@layer theme, base, components,
 * utilities;` ordering statement does not come with them. Without it a layer's
 * priority is decided by where its first rule appears in the output -- and
 * `@layer base` sits further down globals.css than the imports, so base came
 * LAST and therefore WON.
 *
 * The bug that cost: `a { color: inherit }` in base beat `text-onink` in
 * utilities, so a solid button rendered its label in the colour of its own
 * background. It looked like a button with no text on it, and it was reported
 * from a phone and again from the owner dashboard before anybody found it,
 * because it is invisible in the markup and invisible in the CSS unless you
 * check the layer order.
 *
 * This is a build-time guard rather than a unit test because it is a fact about
 * the compiled stylesheet, and the compiled stylesheet is what ships.
 */
const ORDER = /@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities\s*;/;
if (!ORDER.test(globals)) {
  problems.push(
    'app/globals.css is missing `@layer theme, base, components, utilities;` before its imports. ' +
      'Without it, base lands after utilities and every element reset beats every utility class ' +
      '(this is what rendered a black button with a black label).',
  );
}
const orderAt = globals.search(ORDER);
const firstImport = globals.indexOf("@import 'tailwindcss/theme.css'");
if (orderAt !== -1 && firstImport !== -1 && orderAt > firstImport) {
  problems.push(
    'app/globals.css declares the Tailwind layer order after its imports; the statement has to ' +
      'come first, or the layers are ordered by first use instead.',
  );
}

/* --------------------------------------------------------------- report */
function rel(p) {
  return p.replace(`${ROOT}/`, '');
}
function walk(target) {
  const out = [];
  if (!existsSync(target)) return out;
  if (target.endsWith('.tsx') || target.endsWith('.ts') || target.endsWith('.css')) return [target];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    out.push(...walk(join(target, entry.name)));
  }
  return out;
}

if (problems.length) {
  console.error('\nDesign system check FAILED:\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`Design system check passed. (hex colours: ${hexCount} / budget ${baseline})`);
