#!/usr/bin/env node
/**
 * Print the FAILING tests from a captured `node --test` TAP log as
 * GitHub Actions ::error:: annotations.
 *
 * Why: this repository's CI logs are not always reachable from the
 * operator's environment (the log CDN drops the connection), and a test
 * suite writes the reason it failed into stdout — nowhere else. The
 * existing `print-error-annotation.mjs` republishes the *tail* of a log,
 * which is right for a crash but wrong for a test suite: the tail is the
 * run's summary, and the failing assertion can be hundreds of lines
 * earlier in the file.
 *
 * So this script reads the TAP stream and pulls out the failing blocks:
 * a failing test is announced by `not ok <n> - <title>`, and its
 * diagnostic follows, indented, until the next top-level entry.
 *
 * Usage:
 *   node scripts/ci/print-test-failure-annotation.mjs <log-file> [max-blocks]
 *
 * Exits 0 whether or not the file exists, and whether or not it found a
 * failure: this is a diagnostics step and must never mask the real
 * failure, nor report success of its own.
 */
import { readFileSync, existsSync } from 'node:fs';

const file = process.argv[2];
const maxBlocks = Number(process.argv[3] ?? 10);

const escapeData = (s) =>
  s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

if (!file || !existsSync(file)) {
  console.log(`::error::CI diagnostics: expected log file ${file ?? '<none>'} is missing (step produced no output)`);
  process.exit(0);
}

const lines = readFileSync(file, 'utf8').split(/\r?\n/);

const failures = [];
for (let index = 0; index < lines.length && failures.length < maxBlocks; index += 1) {
  const announced = /^not ok \d+ - (.*)$/.exec(lines[index]);
  if (!announced) continue;

  // The diagnostic block runs until the next top-level `ok`/`not ok`
  // entry or the end of the plan. Skip the YAML separators, which carry
  // no information.
  const block = [lines[index]];
  for (let next = index + 1; next < lines.length && next < index + 60; next += 1) {
    const line = lines[next];
    if (/^(not ok|ok) \d+ - /.test(line) || /^1\.\.\d+$/.test(line)) break;
    if (/^\s*---$/.test(line) || /^\s*\.\.\.$/.test(line)) continue;
    block.push(line);
  }
  failures.push(block.join('\n'));
}

if (failures.length === 0) {
  console.log(`::error::CI diagnostics: no failing test was found in ${file}`);
  process.exit(0);
}

for (const failure of failures) {
  console.log(`::error::CI diagnostics — failing test from ${file}: %0A${escapeData(failure)}`);
}
