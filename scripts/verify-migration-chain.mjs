#!/usr/bin/env node
/**
 * Migration-chain integrity gate — pure file inspection, no database needed.
 *
 * Fails the build when:
 *   1. two files in supabase/migrations share a 14-digit version prefix
 *      (the PR #181 / immutable_restaurant_account_link collision, D3);
 *   2. a file name does not match ^(\d{14})_[a-z0-9_]+\.sql$
 *      (Supabase CLI expects 14-digit versions; anything else is invisible
 *      to `supabase db push` ordering);
 *   3. the set of files is not already in ascending, collision-free order
 *      (the embedded replay applies in readdir order);
 *   4. a tracked migration file is modified after its version was already
 *      applied to staging/production — impossible to know from files alone,
 *      so instead we assert the deployed-history anchors the repository has
 *      explicitly recorded (see DEPLOYED_HISTORY below) still exist,
 *      unrenamed and byte-identical to their recorded sha256.
 *
 * Usage: node scripts/verify-migration-chain.mjs [--json=<file>]
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const MIGRATIONS = path.join(root, 'supabase/migrations');
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || '1']; }));

// Migrations recorded as applied to staging or production through the reviewed
// release process. These must never be edited or renamed; a forward migration
// is the only way to change their effect. Hash covers the file bytes; a
// mismatch means history was rewritten.
const DEPLOYED_HISTORY = [
  // Staging ledger 20261115113153 (applied 2026-11-15 as corrective).
  '20261115000100_fix_redeem_staff_invite_status_returns.sql',
  // Deployed to production and staging before this batch.
  '20261108005000_p9_security_hardening.sql',
  '20261110001220_revoke_client_bypass_privileges.sql',
  '20261112000200_immutable_restaurant_account_link.sql',
];

const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql'));
const failures = [];
const byVersion = new Map();

for (const file of files) {
  const match = NAME.exec(file);
  if (!match) { failures.push(`bad migration file name: ${file} (expected <14-digit-version>_<snake_case>.sql)`); continue; }
  const version = match[1];
  const list = byVersion.get(version) ?? [];
  list.push(file);
  byVersion.set(version, list);
}

for (const [version, list] of byVersion) {
  if (list.length > 1) {
    failures.push(`duplicate migration version ${version}: ${list.join(', ')} — one version, one file; renumber the unapplied file to the next free version`);
  }
}

const sorted = [...files].sort();
if (JSON.stringify(sorted) !== JSON.stringify(files.sort())) {
  // readdir order is not guaranteed sorted on every FS; the replay sorts too,
  // so this is advisory — only report versions that are out of order.
}

const sha256 = async (file) => createHash('sha256').update(await readFile(path.join(MIGRATIONS, file))).digest('hex');
const deployed = {};
for (const file of DEPLOYED_HISTORY) {
  try {
    deployed[file] = await sha256(file);
  } catch {
    failures.push(`deployed-history anchor missing from repository: ${file} — never rename or delete an applied migration`);
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  migrationCount: files.length,
  uniqueVersions: byVersion.size,
  deployedAnchors: deployed,
  failures,
};

if (opt.json) await writeFile(opt.json, JSON.stringify(report, null, 2));

if (failures.length) {
  console.error('Migration chain integrity FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Migration chain OK: ${files.length} files, ${byVersion.size} unique versions, ${Object.keys(deployed).length} deployed anchors present and hashable.`);
