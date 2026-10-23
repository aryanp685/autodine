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
/* Full-screen layouts must keep explicit viewport breakpoints. This catches a
   regression to an inert named container query (the product root is not a CSS
   container), which previously left phones using desktop layouts. */
const designSystemPath = join(ROOT, 'styles', 'design-system.css');
const designSystem = readFileSync(designSystemPath, 'utf8');
for (const breakpoint of ['1100px', '760px', '420px']) {
  if (!designSystem.includes(`@media (max-width: ${breakpoint})`)) {
    problems.push(`styles/design-system.css is missing the ${breakpoint} responsive breakpoint.`);
  }
}
if (/@container\s+frame/.test(designSystem) && !/container-type\s*:/.test(designSystem)) {
  problems.push('styles/design-system.css uses @container frame without declaring a container-type.');
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
