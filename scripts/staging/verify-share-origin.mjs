/**
 * Zero-write pre-flight for the staging runner, executed BEFORE any step that
 * could reach the network or write anything.
 *
 * It enforces — by pure string comparison — the same approved-origin gate the
 * provision step enforces, and nothing more. No client is created, no request
 * is sent, no file is written. If the share secret does not match the pinned
 * approved base, this step fails the job before a single fixture exists.
 *
 * Prints rule ids only; never prints values.
 */
const APPROVED_REF = 'juwyhslzchjevqkdvwjm';
const APPROVED_ORIGIN = 'https://new-git-arena-9b120325-autodine-iamjarvis9896-3988s-projects.vercel.app';

const url = process.env.STAGING_SUPABASE_URL;
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
let base, share;
try {
  base = new URL(process.env.STAGING_BASE_URL || 'https://invalid.invalid');
  share = new URL(process.env.STAGING_SHARE_URL || 'https://invalid.invalid');
} catch {
  console.error('::error::Staging pre-flight refused: endpoint/share URL invalid. No fixtures will be written.');
  process.exit(1);
}

const problems = [];
if (url !== `https://${APPROVED_REF}.supabase.co`) problems.push('SUPABASE_URL_NOT_APPROVED_PROJECT');
if (!key) problems.push('SERVICE_ROLE_KEY_MISSING');
if (base.origin !== APPROVED_ORIGIN) problems.push('STAGING_BASE_URL_ORIGIN_MISMATCH');
if (share.origin !== base.origin) problems.push('SHARE_URL_ORIGIN_MISMATCH');
if (!share.searchParams.get('_vercel_share')) problems.push('SHARE_URL_MISSING_VERCEL_SHARE_TOKEN');

if (problems.length) {
  console.error(`::error::Staging pre-flight refused: ${problems.join(', ')}. No fixtures will be written.`);
  process.exit(1);
}
console.log('Staging pre-flight OK: approved project + approved origin + matching share origin. No writes performed.');
