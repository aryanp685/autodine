import { appendFile, readFile } from 'node:fs/promises';

const [reportPath, expectedCountRaw] = process.argv.slice(2);
const expectedCount = Number.parseInt(expectedCountRaw ?? '', 10);
if (!reportPath || !Number.isInteger(expectedCount) || expectedCount < 1) {
  throw new Error('Usage: node scripts/e2e/assert-playwright-results.mjs <json-report> <expected-count>');
}

function safeDetail(value) {
  return String(value ?? 'No error detail recorded.')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/https?:\/\/[^\s)]+/gi, '[local URL]')
    .replace(/[A-Fa-f0-9]{40,}/g, '[redacted-token]')
    .replace(/\r?\n/g, ' | ')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .slice(0, 1500);
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

let report;
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch (error) {
  const message = safeDetail(`Cannot read Playwright JSON evidence at ${reportPath}: ${error.message}`);
  console.log(`::error title=Playwright evidence missing::${message}`);
  throw new Error(message, { cause: error });
}
const stats = report.stats;
if (!stats || !Number.isInteger(stats.expected)) throw new Error('Playwright JSON report has no valid stats.expected field.');
const passed = stats.expected - stats.skipped - stats.unexpected;
console.log(`Playwright evidence: ${passed}/${stats.expected} passed, ${stats.skipped} skipped, ${stats.unexpected} unexpected, ${stats.flaky} flaky.`);

const failedTests = [];
const skippedTests = [];
const flakyTests = [];
function walk(suites, parent = []) {
  for (const suite of suites ?? []) {
    const suitePath = [...parent, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const name = [...suitePath, spec.title].filter(Boolean).join(' › ');
        const results = test.results ?? [];
        const last = results.at(-1);
        if (!results.length || results.every((result) => result.status === 'skipped')) {
          skippedTests.push(name);
        } else if (last?.status !== 'passed') {
          const detail = last?.errors?.map((item) => item.message).filter(Boolean).join(' | ') ?? `final status ${last?.status ?? 'missing'}`;
          failedTests.push({ name, detail });
        }
        if (results.some((result) => result.retry > 0) || (results.length > 1 && results.some((result) => result.status !== 'passed'))) {
          flakyTests.push(name);
        }
      }
    }
    walk(suite.suites, suitePath);
  }
}
walk(report.suites);

for (const failure of failedTests.slice(0, 20)) {
  console.log(`::error title=Playwright failure::${safeDetail(`${failure.name}: ${failure.detail}`)}`);
}
for (const name of skippedTests.slice(0, 20)) {
  console.log(`::warning title=Playwright skipped::${safeDetail(name)}`);
}
for (const name of flakyTests.slice(0, 20)) {
  console.log(`::warning title=Playwright retry or flake::${safeDetail(name)}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '## Playwright evidence',
    '',
    `- Expected: ${stats.expected}; passed: ${passed}; skipped: ${stats.skipped}; unexpected: ${stats.unexpected}; flaky: ${stats.flaky}.`,
  ];
  if (failedTests.length) lines.push('', '### Failed tests', ...failedTests.map((test) => `- ${escapeMarkdown(test.name)} — ${escapeMarkdown(safeDetail(test.detail))}`));
  if (skippedTests.length) lines.push('', '### Skipped tests', ...skippedTests.map((name) => `- ${escapeMarkdown(name)}`));
  if (flakyTests.length) lines.push('', '### Retried or flaky tests', ...flakyTests.map((name) => `- ${escapeMarkdown(name)}`));
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

const problems = [];
if (stats.expected !== expectedCount) problems.push(`expected ${expectedCount} discovered tests, got ${stats.expected}`);
if (stats.skipped !== 0) problems.push(`${stats.skipped} skipped tests are not verified`);
if (stats.unexpected !== 0) problems.push(`${stats.unexpected} unexpected failures`);
if (stats.flaky !== 0) problems.push(`${stats.flaky} flaky tests`);
if (problems.length) throw new Error(problems.join('; '));
