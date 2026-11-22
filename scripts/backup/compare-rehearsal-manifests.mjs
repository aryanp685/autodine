#!/usr/bin/env node
/** Compare every JSON field against this run's locally created manifest.
 * This is a same-run staging check, not a signature or a long-term manifest
 * authentication scheme. Never print manifest contents or file paths.
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

try {
  if (process.argv.length !== 4) throw new Error('expected source and downloaded manifest');
  const [source, downloaded] = process.argv.slice(2).map((file) => JSON.parse(readFileSync(file, 'utf8')));
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !downloaded || typeof downloaded !== 'object' || Array.isArray(downloaded) ||
      !isDeepStrictEqual(source, downloaded)) throw new Error('manifest mismatch');
  console.log('rehearsal: downloaded manifest matches all source fields');
} catch {
  console.error('rehearsal: manifest missing, invalid, or differs from this run; refusing restore');
  process.exitCode = 1;
}
