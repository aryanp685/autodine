#!/usr/bin/env node
/**
 * Print the tail of a captured CI log as GitHub Actions ::error:: annotations.
 *
 * Why: this repository's CI logs are not always reachable from the operator's
 * environment (the log CDN can drop the connection). Annotations are served
 * through the Checks API, which is small and reliable. Diagnostics that only
 * exist inside step stdout are effectively invisible when the log endpoint
 * flakes; this script makes the same bytes visible as annotations instead.
 *
 * The final lines are printed one per annotation: a single annotation's
 * message can be truncated by the API, and per-line annotations survive that.
 *
 * Usage:
 *   node scripts/ci/print-error-annotation.mjs <log-file> [max-chars] [line-count]
 *
 * Exits 0 whether or not the file exists; it is a diagnostics step and must
 * never mask the real failure.
 */
import { readFileSync, existsSync } from 'node:fs';

const file = process.argv[2];
const maxChars = Number(process.argv[3] ?? 3000);
const lineCount = Number(process.argv[4] ?? 12);

const escapeData = (s) => s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const oneLine = (s, n) => escapeData(s.replaceAll(/\s+/g, ' ').trim().slice(0, n));

if (!file || !existsSync(file)) {
  console.log(`::error::CI diagnostics: expected log file ${file ?? '<none>'} is missing (step produced no output)`);
  process.exit(0);
}

const raw = readFileSync(file, 'utf8');
console.log(`::error::CI diagnostics tail of ${file}: %0A${escapeData(raw.slice(-maxChars))}`);
for (const line of raw.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-lineCount)) {
  console.log(`::error::log| ${oneLine(line, 400)}`);
}
