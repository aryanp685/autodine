import { readFile } from 'node:fs/promises';

const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: node scripts/e2e/assert-throttle-results.mjs <playwright-json-report>');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const tests = [];

function walk(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      tests.push({ title: spec.title, results: test.results ?? [] });
    }
  }
  for (const child of suite.suites ?? []) walk(child);
}

for (const suite of report.suites ?? []) walk(suite);
const skipped = tests.filter(({ results }) => results.length === 0 || results.every((result) => result.status === 'skipped'));
const passed = tests.filter(({ results }) => results.length > 0 && results.every((result) => result.status === 'passed'));
const failed = tests.filter(({ results }) => results.some((result) => result.status !== 'passed' && result.status !== 'skipped'));

console.log(`Throttle browser E2E: ${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed; ${tests.length} total.`);
for (const { title } of passed) console.log(`PASS ${title}`);
for (const { title } of skipped) console.error(`SKIP ${title}`);
for (const { title, results } of failed) {
  const failure = results.find((result) => result.status !== 'passed' && result.status !== 'skipped');
  const detail = (failure?.error?.message ?? failure?.status ?? 'unknown error')
    .split('\n')
    .slice(0, 5)
    .join(' | ');
  console.error(`FAIL ${title}: ${detail}`);
}

if (tests.length !== 2 || passed.length !== 2 || skipped.length !== 0 || failed.length !== 0) {
  process.exitCode = 1;
}
