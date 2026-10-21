#!/usr/bin/env node
/**
 * Checks shared style rules and prevents hardcoded-color growth.
 *
 * Run: npm run design:check
 * Refresh the color baseline after a deliberate reduction:
 * node scripts/check-design-system.mjs --update-baseline
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
/* The design has no drop shadows. Two exceptions are legitimate and are
   allowed: `box-shadow: inset 0 -2px 0` is the hairline underline used for
   active tabs (not a shadow at all), and the token `var(--shadow)` which is
   set to `none` by the design system. */
const ALLOWED_SHADOW = /inset|var\(--shadow\)|^\s*none\s*;?$/i;
for (const file of cssFiles) {
  const src = readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    const m = line.match(/box-shadow\s*:\s*([^;]+)/i);
    if (!m) return;
    const value = m[1].trim();
    if (!ALLOWED_SHADOW.test(value)) {
      problems.push(`${rel(file)}:${i + 1} drop shadow "${value}" — use the existing border or token styling instead.`);
    }
  });
}

/* ---------------------------------------------------------------- rule 2 */
/* Keep prototype-comparison-only class names out of product components. */
for (const file of [...cssFiles, join(ROOT, 'app'), join(ROOT, 'components')]) {
  for (const f of walk(file)) {
    if (!/\.(tsx?|css)$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/[."']proto-/.test(line)) {
        problems.push(`${rel(f)}:${i + 1} prototype-only class name; use product component styles instead.`);
      }
    });
  }
}

/* ---------------------------------------------------------------- rule 3 */
/* Existing raw color values may decrease but should not grow; use design tokens for new styles. */
function countHexOutsideTokens(src) {
  // Skip the token declaration block, where hex is expected and correct.
  const withoutTokens = src.replace(/\[data-app\]\s*\{[\s\S]*?\n\}/, '');
  return (withoutTokens.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
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
