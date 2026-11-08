import { readFile } from 'node:fs/promises';

const [reportPath, expectedCountRaw] = process.argv.slice(2);
const expectedCount = Number.parseInt(expectedCountRaw ?? '', 10);
if (!reportPath || !Number.isInteger(expectedCount) || expectedCount < 1) {
  throw new Error('Usage: node scripts/e2e/assert-playwright-results.mjs <json-report> <expected-count>');
}

let report;
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch (error) {
  throw new Error(`Cannot read Playwright JSON evidence at ${reportPath}: ${error.message}`, { cause: error });
}
const stats = report.stats;
if (!stats || !Number.isInteger(stats.expected)) throw new Error('Playwright JSON report has no valid stats.expected field.');
const passed = stats.expected - stats.skipped - stats.unexpected;
console.log(`Playwright evidence: ${passed}/${stats.expected} passed, ${stats.skipped} skipped, ${stats.unexpected} unexpected, ${stats.flaky} flaky.`);

const problems = [];
if (stats.expected !== expectedCount) problems.push(`expected ${expectedCount} discovered tests, got ${stats.expected}`);
if (stats.skipped !== 0) problems.push(`${stats.skipped} skipped tests are not verified`);
if (stats.unexpected !== 0) problems.push(`${stats.unexpected} unexpected failures`);
if (stats.flaky !== 0) problems.push(`${stats.flaky} flaky tests`);
if (problems.length) throw new Error(problems.join('; '));
