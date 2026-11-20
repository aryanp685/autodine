/** Renders the per-migration authorization register from the committed manifest.
 *
 * It never applies anything and never reads a hosted project. It only checks
 * that the repository inventory is complete and ordered, then records each
 * file's classification and authorization state exactly as the manifest
 * states them. Destructive statements are counted so a reviewer can see them
 * without reading every migration file.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dir = path.join(root, 'supabase/migrations');
const manifestPath = path.join(root, 'docs/migration-manifest-2026-11-14.md');
const outPath = path.join(root, 'docs/migration-authorization-register-2026-11-19.md');

const files = (await readdir(dir)).filter(name => name.endsWith('.sql')).sort();
const manifest = await readFile(manifestPath, 'utf8');
const rows = [...manifest.matchAll(/^\| `(\d{14})` \| `([^`]+)` \| ([^|]*)\| ?([^|]*)\|$/gm)]
  .map(([, version, name, classification, note]) => ({ version, name, classification: classification.trim(), note: note.trim() }));

const problems = [];
const byVersion = new Map();
for (const file of files) {
  const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(file);
  if (!match) { problems.push(`Unrecognised migration filename: ${file}`); continue; }
  if (byVersion.has(match[1])) problems.push(`Duplicate version ${match[1]}: ${file}`);
  byVersion.set(match[1], file);
}
const ordered = [...byVersion.keys()].sort();
if (ordered.join() !== files.map(file => file.slice(0, 14)).join()) problems.push('Versions are not in sorted order.');
for (const { version } of rows) if (!byVersion.has(version)) problems.push(`Manifest row ${version} has no file.`);
const manifestVersions = new Set(rows.map(row => row.version));
for (const version of ordered) if (!manifestVersions.has(version)) problems.push(`File ${version} is missing from the manifest.`);

const destructive = [];
for (const file of files) {
  const sql = await readFile(path.join(dir, file), 'utf8');
  const found = [
    ...sql.matchAll(/\bdrop\s+(table|column|function|policy|trigger|index|constraint|role|schema|type)\b[^;]*/gi),
    ...sql.matchAll(/\btruncate\b[^;]*/gi),
    ...sql.matchAll(/\bdelete\s+from\s+public\.[a-z_]+\b[^;]*/gi),
  ].map(match => match[0].replace(/\s+/g, ' ').trim());
  if (found.length) destructive.push({ file, statements: found });
}

const esc = value => value.replaceAll('|', '\\|');
const lines = [];
lines.push(`# Migration authorization register — ${files.length} files, 2026-11-19`);
lines.push('');
lines.push('**Generated file — do not edit by hand.** `npm run register:migrations`');
lines.push('rewrites it from `docs/migration-manifest-2026-11-14.md` and the files on');
lines.push('disk. A row here is repository evidence, never authorization: nothing is');
lines.push('applied by generating or reading it, and `NOT AUTHORIZED` means exactly that.');
lines.push('');
lines.push(`- Files on disk: **${files.length}**`);
lines.push(`- Manifest rows: **${rows.length}**`);
lines.push(`- Ordering / uniqueness / coverage problems: **${problems.length}**`);
lines.push(`- Files containing DROP/TRUNCATE/DELETE statements: **${destructive.length}** (inventory below)`);
lines.push('');
if (problems.length) {
  lines.push('## Problems');
  for (const problem of problems) lines.push(`- ${problem}`);
  lines.push('');
}
lines.push('## Per-file register');
lines.push('');
lines.push('| # | Version | File | Classification | Authorization | Note |');
lines.push('|---|---|---|---|---|---|');
rows.forEach((row, index) => {
  const authorized = /NOT AUTHORIZED/.test(row.classification) ? 'NOT AUTHORIZED'
    : /Legacy rollout scope/.test(row.classification) ? 'Reported applied historically; re-probe required (no new authorization)'
      : 'Per manifest — no new authorization in P6';
  lines.push(`| ${index + 1} | \`${row.version}\` | \`${esc(byVersion.get(row.version) ?? '')}\` | ${esc(row.classification)} | ${authorized} | ${esc(row.note)} |`);
});
lines.push('');
lines.push('## Destructive or broad statements (review list, not authorization)');
lines.push('');
lines.push('Every `DROP` below is either a forward replacement of a function, policy,');
lines.push('trigger or constraint the same file recreates, or a drop guarded by');
lines.push('`if exists`; the reviewer still needs to read each one for the target.');
lines.push('`TRUNCATE` appears only on session temporary `tt_*` tables inside trigger');
lines.push('helpers, and each `delete from public.<table>` is scoped by a predicate');
lines.push('(one order, one membership, expired rate-limit windows, one QR attempt key,');
lines.push('or one menu snapshot); the deletion lines are listed so a reviewer can');
lines.push('confirm that rather than trust it.');
lines.push('');
if (!destructive.length) lines.push('None.');
for (const entry of destructive) {
  lines.push(`### \`${entry.file}\``);
  for (const statement of entry.statements.slice(0, 40)) lines.push(`- \`${statement.slice(0, 240)}\``);
  if (entry.statements.length > 40) lines.push(`- … ${entry.statements.length - 40} more`);
  lines.push('');
}
lines.push('## Authorization rules');
lines.push('');
lines.push('- The 26 GST/IRP files, `20261118002000` and `20261118002100` each need a');
lines.push('  separate written decision naming the file and the exact target.');
lines.push('- `20261118002100` additionally changes the `supabase_realtime` publication');
lines.push('  and refuses to run if that publication carries other tables.');
lines.push('- No hosted migration has been applied from this branch, and this register');
lines.push('  does not authorize one.');
lines.push('');
await writeFile(outPath, lines.join('\n'), 'utf8');
console.log(`register: ${files.length} files, ${rows.length} manifest rows, ${problems.length} problems, ${destructive.length} files with destructive statements -> ${path.relative(root, outPath)}`);
if (problems.length) { for (const problem of problems) console.error(`  ${problem}`); process.exitCode = 1; }
