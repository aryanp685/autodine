#!/usr/bin/env node
/** Fail closed before a staging-only hosted backup can connect or write. */
import { pathToFileURL } from 'node:url';
import { backupSourceDecision } from './lib-backup-source.mjs';
import { isLoopbackHost, projectRefOf, restoreTargetDecision } from './lib-restore-target.mjs';

export const STAGING_PROJECT_REF = 'juwyhslzchjevqkdvwjm';
export const STAGING_BUCKET_NAME = 'autodine-staging-db-backups';
export const STAGING_BUCKET_ID = 'd209a0cc2db8f17fac100514';

export function stagingSourceDecision({ sourceUrl, expectedRef, bucket, expectedBucket, productionBucketsJson }) {
  // Names/URLs are only preliminary checks. They do not prove bucket identity,
  // key scope, production-inventory completeness or source credential scope.
  if (expectedRef !== STAGING_PROJECT_REF) return { allowed: false, reason: 'designated staging project ref mismatch' };
  if (bucket !== STAGING_BUCKET_NAME || expectedBucket !== STAGING_BUCKET_NAME) return { allowed: false, reason: 'designated staging bucket mismatch' };
  // This list is an owner assertion, not an account discovery mechanism. An
  // explicit [] is required when no production bucket exists; never infer it.
  let productionBuckets;
  try { productionBuckets = JSON.parse(productionBucketsJson); } catch { return { allowed: false, reason: 'production bucket inventory missing or malformed' }; }
  const bucketName = /^[a-zA-Z0-9][a-zA-Z0-9.-]{5,49}$/;
  if (!bucketName.test(bucket) || !Array.isArray(productionBuckets) ||
      productionBuckets.some((name) => typeof name !== 'string' || !bucketName.test(name))) {
    return { allowed: false, reason: 'production bucket inventory or staging bucket is invalid' };
  }
  if (productionBuckets.some((name) => name.toLowerCase() === bucket.toLowerCase())) {
    return { allowed: false, reason: 'staging bucket matches a production bucket' };
  }
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
    productionBucketsJson: process.env.AUTODINE_PRODUCTION_B2_BUCKETS,
  });
  if (!result.allowed) { console.error(`staging backup: REFUSED: ${result.reason}`); process.exitCode = 1; }
  else console.log('staging backup: designated non-production source and staging bucket accepted');
}

/**
 * Pure checks for a future authenticated B2 v4 authorization response.
 * Caller-supplied data is not proof: a separately reviewed trusted collector
 * must bind the response to the actual key used for the transfer, and verify
 * inventory completeness before any hosted operation is enabled.
 */
export function stagingB2ScopeDecision({ storageApi, productionInventory, inventoryVerified }) {
  if (inventoryVerified !== true || !Array.isArray(productionInventory) || productionInventory.some((item) => !item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name)) return { allowed: false, reason: 'production inventory is not verified' };
  if (productionInventory.some((item) => item.id === STAGING_BUCKET_ID || item.name.toLowerCase() === STAGING_BUCKET_NAME)) return { allowed: false, reason: 'staging bucket overlaps production inventory' };
  const allowed = storageApi?.allowed;
  if (storageApi?.s3ApiUrl !== 'https://s3.eu-central-003.backblazeb2.com' || !Array.isArray(allowed?.buckets) || allowed.buckets.length !== 1 || allowed.buckets[0]?.id !== STAGING_BUCKET_ID || allowed.buckets[0]?.name !== STAGING_BUCKET_NAME) return { allowed: false, reason: 'provider bucket identity or region mismatch' };
  const capabilities = allowed.capabilities;
  const permitted = ['listFiles', 'readFiles', 'writeFiles'];
  if (!Array.isArray(capabilities) || capabilities.length !== permitted.length || new Set(capabilities).size !== permitted.length || capabilities.some((cap) => !permitted.includes(cap)) || allowed.namePrefix !== null) return { allowed: false, reason: 'key scope or permissions are unsafe or incomplete' };
  return { allowed: true, reason: 'candidate provider scope matches; trusted collection still required' };
}

/** Pure fixture check only; a trusted collector must establish these facts. */
export function stagingDisposableDecision(target) {
  if (!target || target.runner !== 'github-hosted-ephemeral' || target.host !== '127.0.0.1' || target.database !== 'drill' || target.serverMajor !== 17 || target.emptyPublicSchema !== true || target.service !== 'drilldb' || !/^[a-f0-9]{64}$/.test(target.containerId ?? '') || target.containerId !== target.inspectedContainerId || target.sameAsSource !== false) return { allowed: false, reason: 'target is not independently verified disposable PostgreSQL 17' };
  return { allowed: true, reason: 'candidate target matches; trusted collection still required' };
}
