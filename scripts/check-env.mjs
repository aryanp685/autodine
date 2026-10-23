#!/usr/bin/env node
/**
 * Environment check — for people, before they open a browser.
 *
 * WHAT IT PRINTS
 *
 * Only whether a variable is set, and only the first few characters of a key.
 * Never a full value: this is run in terminals that get screen-shared over
 * calls and pasted into chat windows.
 *
 * WHAT IT CATCHES
 *
 * Four mistakes that otherwise surface as "the app shows sample data" or, much
 * worse, as a leaked key:
 *
 *   1. A missing value, named.
 *   2. A placeholder left in place ("your-key-here", "https://xxxx.supabase.co").
 *   3. A secret key (sb_secret_… / a service_role JWT) in a NEXT_PUBLIC_
 *      variable. That one would ship full database access to every visitor.
 *   4. A publishable key in the secret slot, which fails at the first write
 *      that needs the service role.
 *
 * Reads .env.local, then .env, then the real environment — the same order
 * Next.js uses, minus .env.development and .env.production, which this product
 * does not use.
 *
 * Exit code 1 when something must be fixed, so it can sit in a pre-demo script.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = ['.env.local', '.env'];

/** KEY=value, ignoring comments, blank lines and a leading `export`. */
function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    // Strip one layer of quotes, the way dotenv does.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const fromFiles = {};
const sources = [];
for (const file of FILES) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  Object.assign(fromFiles, parseEnv(readFileSync(path, 'utf8')));
  sources.push(file);
}

/** Real environment wins over a file, as it does in Next.js. */
const value = (name) => {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  return fromFiles[name] ?? '';
};

// Deliberately narrow. A real key is random, and a broad pattern such as
// /abcd/ would reject a legitimate one and send somebody chasing a ghost.
const PLACEHOLDERS = [
  /x{4,}/i,
  /your[-_]?project/i,
  /your[-_]?key/i,
  /your[-_]?url/i,
  /placeholder/i,
  /changeme/i,
  /example\.com/i,
  /^sb_(publishable|secret)_x+$/i,
];

const isPlaceholder = (v) => PLACEHOLDERS.some((re) => re.test(v));

/** Same logic as lib/supabase/env.ts — kept in step by lib/health.test.ts. */
function isSecretKey(key) {
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(b64)).role === 'service_role';
  } catch {
    return false;
  }
}

const isPublishableKey = (key) => key.startsWith('sb_publishable_') || (key.split('.').length === 3 && !isSecretKey(key));

const mask = (v) => (v.length <= 12 ? `${v.slice(0, 4)}…` : `${v.slice(0, 12)}… (${v.length} chars)`);

const REQUIRED = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', what: 'Supabase project URL' },
  { name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', what: 'publishable key', alt: 'NEXT_PUBLIC_SUPABASE_ANON_KEY' },
  { name: 'SUPABASE_SECRET_KEY', what: 'secret key', alt: 'SUPABASE_SERVICE_ROLE_KEY' },
];

const problems = [];
const notes = [];

console.log(`\nReading: ${sources.length ? sources.join(', ') : 'nothing — no .env.local found'}\n`);

function read(name, alt) {
  const direct = value(name);
  if (direct) return { name, value: direct };
  if (alt && value(alt)) return { name: alt, value: value(alt) };
  return { name, value: '' };
}

for (const item of REQUIRED) {
  const got = read(item.name, item.alt);

  if (!got.value) {
    console.log(`  MISSING  ${item.name}  (${item.what})`);
    problems.push(`${item.name} is empty — ${item.what}. See .env.local for where it comes from.`);
    continue;
  }

  if (isPlaceholder(got.value)) {
    console.log(`  PLACEHOLDER  ${got.name} = ${mask(got.value)}`);
    problems.push(`${got.name} still holds a placeholder, not a real value.`);
    continue;
  }

  // Label it honestly before the summary: a secret key sitting in a public
  // variable is present, so "ok" would be the wrong word for it.
  const isSecretSlot = got.name === 'SUPABASE_SECRET_KEY' || got.name === 'SUPABASE_SERVICE_ROLE_KEY';
  const wrongSlot =
    (!isSecretSlot && isSecretKey(got.value)) || (isSecretSlot && isPublishableKey(got.value));

  console.log(`  ${wrongSlot ? 'WRONG   ' : 'ok      '} ${got.name} = ${mask(got.value)}`);
}

// --- the two mistakes worth their own words --------------------------------
const url = value('NEXT_PUBLIC_SUPABASE_URL');
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url.replace(/\/+$/, ''))) {
  notes.push(`NEXT_PUBLIC_SUPABASE_URL does not look like https://<ref>.supabase.co — it may still work, but check it.`);
}

const publishable = value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || value('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const secret = value('SUPABASE_SECRET_KEY') || value('SUPABASE_SERVICE_ROLE_KEY');

if (publishable && isSecretKey(publishable)) {
  problems.push(
    'A SECRET key is in a NEXT_PUBLIC_ variable. Next.js copies those into the browser bundle, ' +
      'so every visitor would get full database access. Move it to SUPABASE_SECRET_KEY and rotate it in Supabase.'
  );
}

if (secret && isPublishableKey(secret)) {
  problems.push(
    'SUPABASE_SECRET_KEY holds a publishable key. Reads will work; the writes that bypass row level ' +
      'security (guest orders, payments, storage) will fail with a permission error.'
  );
}

const site = value('NEXT_PUBLIC_SITE_URL');
if (site) {
  console.log(`  info     NEXT_PUBLIC_SITE_URL = ${site}`);
  if (/localhost|127\.0\.0\.1/.test(site)) {
    notes.push('NEXT_PUBLIC_SITE_URL points at localhost. Correct locally; on Vercel it must be the real domain, or every printed QR will open something unreachable.');
  }
} else {
  notes.push('NEXT_PUBLIC_SITE_URL is empty — QR codes will fall back to the request origin. Fine locally, worth setting on Vercel.');
}

if (value('NEXT_PUBLIC_RAZORPAY_KEY_ID') || value('RAZORPAY_KEY_SECRET')) {
  notes.push('Razorpay keys are present. Guests still see a pay button only if a restaurant switches online payment on in Settings.');
} else {
  console.log('  info     no Razorpay keys — correct until KYC clears; guests pay at the counter or by the restaurant\'s UPI QR');
}

console.log('');

for (const note of notes) console.log(`  note: ${note}`);
if (notes.length) console.log('');

if (problems.length) {
  for (const problem of problems) console.error(`  FIX: ${problem}`);
  console.error('\nNot ready. Fix the above, restart `npm run dev`, then open http://localhost:3000/api/health\n');
  process.exit(1);
}

console.log('Environment looks right. Restart `npm run dev` if you just edited .env.local,');
console.log('then open http://localhost:3000/api/health — it says which migrations are applied.\n');
