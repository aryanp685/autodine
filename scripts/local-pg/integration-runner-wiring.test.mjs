import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('shared-database integration runners serialize test files, not in-test concurrency', () => {
  for (const file of ['scripts/verify-database.mjs', 'scripts/local-pg/run-integration-tests.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /['"]run['"],\s*['"]--no-file-parallelism['"]/, `${file} must serialize files sharing its database`);
    assert.doesNotMatch(source, /--testNamePattern|--exclude/, `${file} must not filter cases to avoid concurrency`);
  }
  const readiness = readFileSync('lib/db/readiness.integration.test.ts', 'utf8');
  assert.match(readiness, /shares the voice quota atomically across separate database clients/);
  assert.match(readiness, /revokes every retired placement overload even when the four-argument signature is absent/);
});
