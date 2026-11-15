#!/usr/bin/env node
/**
 * Print the tail of a captured CI log as a GitHub Actions ::error:: annotation.
 *
 * Why: this repository's CI logs are not always reachable from the operator's
 * environment (the log CDN can drop the connection). Annotations are served
 * through the Checks API, which is small and reliable. Diagnostics that only
 * exist inside step stdout are effectively invisible when the log endpoint
 * flakes; this script makes the same bytes visible as an annotation instead.
 *
 * Usage:
 *   node scripts/ci/print-error-annotation.mjs <log-file> [max-chars]
 *
 * Exits 0 whether or not the file exists; it is a diagnostics step and must
 * never mask the real failure.
 */
import { readFileSync, existsSync } from 'node:fs';

const file = process.argv[2];
const maxChars = Number(process.argv[3] ?? 3500);

const escapeData = (s) => s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

if (!file || !existsSync(file)) {
  console.log(`::error::CI diagnostics: expected log file ${file ?? '<none>'} is missing (step produced no output)`);
  process.exit(0);
}

const raw = readFileSync(file, 'utf8');
const tail = raw.slice(-maxChars);
console.log(`::error::CI diagnostics tail of ${file}:\n${escapeData(tail)}`);
