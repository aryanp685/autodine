#!/usr/bin/env node
/**
 * Offline shape-check for external-service configuration — NO network, NO sends.
 *
 * This is the "would this config even parse on the dashboard" gate to run
 * BEFORE the owner enables custom SMTP / points the backup alert webhook at a
 * human endpoint. It reads only the environment of the invoking shell; it
 * never opens a connection, never sends a message, and never prints a value —
 * only PASS / UNSET / INVALID per key.
 *
 *   RESEND_API_KEY        expect a Resend key prefix (re_)
 *   SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM SMTP_SECURE
 *                        custom-SMTP block as expected by Supabase Auth settings
 *   BACKUP_ALERT_WEBHOOK  https URL for the backup-failure alert POST
 *   B2_REGION / B2_BUCKET / B2_ACCESS_KEY_ID / B2_SECRET_ACCESS_KEY
 *                        Backblaze B2 backup destination (scripts/backup/upload-b2.mjs)
 *
 * Exit codes: 0 = everything set is well-formed (unset keys are reported, not
 * failures — activation is an owner decision); 1 = at least one set key is
 * malformed (this IS a failure; fix it before activating); 2 = bad usage.
 *
 * A PASS here proves nothing about deliverability. The delivery test is a
 * real mail to a real authorized mailbox — see docs/email-monitoring-readiness-2026-11-15.md.
 */
const checks = [
  { key: 'RESEND_API_KEY', group: 'resend', test: (v) => /^re_[A-Za-z0-9_-]{8,}$/.test(v), expect: 'starts with "re_"' },
  { key: 'SMTP_HOST', group: 'smtp', test: (v) => /^(?!.*\s)[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) && !v.includes('..'), expect: 'a hostname, e.g. smtp.resend.com' },
  { key: 'SMTP_PORT', group: 'smtp', test: (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= 65535; }, expect: 'an integer 1–65535 (465 or 587 typical)' },
  { key: 'SMTP_USER', group: 'smtp', test: (v) => v.trim().length > 0 && !/\s/.test(v), expect: 'non-empty, no whitespace (Resend uses literal "resend")' },
  { key: 'SMTP_PASS', group: 'smtp', test: (v) => v.trim().length >= 8, expect: 'at least 8 characters' },
  { key: 'SMTP_FROM', group: 'smtp', test: (v) => /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]{2,}$/.test(v) || /^[^<>]{1,80}<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]{2,}>$/.test(v), expect: 'an address, or "Display Name <addr@domain>"' },
  { key: 'SMTP_SECURE', group: 'smtp', test: (v) => ['true', 'false'].includes(v.toLowerCase()), expect: '"true" (465) or "false" (587 + STARTTLS)' },
  { key: 'BACKUP_ALERT_WEBHOOK', group: 'backup', test: (v) => /^https:\/\/[^\s/$.?#].[^\s]*$/.test(v), expect: 'an https URL' },
  { key: 'B2_REGION', group: 'b2', test: (v) => /^[a-z]{2}-[a-z]+-\d{3}$/.test(v.trim()), expect: 'a B2 region, e.g. us-west-004 (or set B2_ENDPOINT instead)' },
  { key: 'B2_ENDPOINT', group: 'b2', test: (v) => /^https:\/\/[^\s/$.?#].[^\s]*$/.test(v.trim()), expect: 'an https S3 endpoint (optional when B2_REGION is set)' },
  { key: 'B2_BUCKET', group: 'b2', test: (v) => /^[a-zA-Z0-9][a-zA-Z0-9.-]{5,49}$/.test(v.trim()), expect: 'a valid B2 bucket name (6-50 chars)' },
  { key: 'B2_ACCESS_KEY_ID', group: 'b2', test: (v) => v.trim().length > 0 && !/\s/.test(v), expect: 'the B2 application keyID, no whitespace' },
  { key: 'B2_SECRET_ACCESS_KEY', group: 'b2', test: (v) => v.trim().length >= 16, expect: 'the B2 application key (at least 16 characters)' },
];

const results = [];
let invalid = 0;
for (const check of checks) {
  const raw = process.env[check.key];
  if (raw === undefined || raw === '') {
    results.push({ ...check, status: 'UNSET' });
    continue;
  }
  const okFlag = check.test(raw);
  if (!okFlag) invalid += 1;
  results.push({ ...check, status: okFlag ? 'PASS' : 'INVALID' });
}

const width = Math.max(...checks.map((c) => c.key.length));
for (const row of results) {
  const label = row.key.padEnd(width);
  if (row.status === 'PASS') console.log(`  PASS    ${label}`);
  else if (row.status === 'UNSET') console.log(`  UNSET   ${label}  (not an error until you choose to activate)`);
  else console.log(`  INVALID ${label}  — expected ${row.expect}`);
}

const setCount = results.filter((r) => r.status !== 'UNSET').length;
console.log(`\n${setCount}/${checks.length} keys set. ${invalid === 0 ? 'No malformed values.' : `${invalid} MALFORMED — fix before activating.`}`);
console.log('This check never sends anything. Deliverability is proven only by the owner delivery test: one real mail, one real mailbox, evidence filed.');
process.exit(invalid === 0 ? 0 : 1);
