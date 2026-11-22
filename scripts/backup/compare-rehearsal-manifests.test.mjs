import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.join(import.meta.dirname, 'compare-rehearsal-manifests.mjs');

test('same-run manifest comparison detects changed financial evidence and any added or missing fields', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'manifest-compare-'));
  try {
    const source = path.join(dir, 'source.json');
    const downloaded = path.join(dir, 'downloaded.json');
    const original = { file: 'backup.enc', sha256: 'a'.repeat(64), counts: { rows: 10 }, financialSpotChecks: { payments_amount_paise: 12345 }, extra: ['preserved'] };
    writeFileSync(source, JSON.stringify(original));
    const run = (value) => {
      writeFileSync(downloaded, JSON.stringify(value));
      return spawnSync(process.execPath, [script, source, downloaded], { encoding: 'utf8' });
    };
    assert.equal(run({ extra: ['preserved'], financialSpotChecks: { payments_amount_paise: 12345 }, counts: { rows: 10 }, sha256: 'a'.repeat(64), file: 'backup.enc' }).status, 0);
    for (const changed of [
      { ...original, counts: { rows: 11 } },
      { ...original, financialSpotChecks: { payments_amount_paise: 12346 } },
      { ...original, extra: [] },
      { ...original, added: true },
      { file: original.file, sha256: original.sha256 },
      null,
    ]) {
      const result = run(changed);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /refusing restore/);
      assert.doesNotMatch(result.stderr, /12345|12346|backup\.enc/);
    }
    writeFileSync(downloaded, '{');
    assert.equal(spawnSync(process.execPath, [script, source, downloaded]).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
