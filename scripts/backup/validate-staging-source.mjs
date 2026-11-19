#!/usr/bin/env node
/** Fail closed before a staging-only hosted backup can connect or write. */
import { pathToFileURL } from 'node:url';
import { backupSourceDecision } from './lib-backup-source.mjs';
import { isLoopbackHost, projectRefOf, restoreTargetDecision } from './lib-restore-target.mjs';

export function stagingSourceDecision({ sourceUrl, expectedRef, bucket, expectedBucket }) {
  if (!/^[a-z0-9]{20}$/.test(expectedRef ?? '')) return { allowed: false, reason: 'designated staging project ref missing or malformed' };
  if (!bucket || !expectedBucket || bucket !== expectedBucket) return { allowed: false, reason: 'staging bucket must match the separately designated bucket' };
  let url;
  try { url = new URL(sourceUrl); } catch { return { allowed: false, reason: 'invalid source URL' }; }
  if (isLoopbackHost(url.hostname)) return { allowed: false, reason: 'hosted staging source must be a designated Supabase project' };
  const target = restoreTargetDecision({ targetUrl: sourceUrl, expectedRef, allowScratch: true });
  if (!target.allowed || projectRefOf(sourceUrl) !== expectedRef) return { allowed: false, reason: 'source must be the designated non-production project without target overrides' };
  const source = backupSourceDecision(sourceUrl);
  if (!source.allowed) return { allowed: false, reason: source.reason };
  return { allowed: true, reason: 'designated staging project and bucket matched' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = stagingSourceDecision({
    sourceUrl: process.env.AUTODINE_BACKUP_SOURCE_URL,
    expectedRef: process.env.AUTODINE_STAGING_PROJECT_REF,
    bucket: process.env.B2_BUCKET,
    expectedBucket: process.env.AUTODINE_STAGING_B2_BUCKET,
  });
  if (!result.allowed) { console.error(`staging backup: REFUSED: ${result.reason}`); process.exitCode = 1; }
  else console.log('staging backup: designated non-production source and staging bucket accepted');
}
