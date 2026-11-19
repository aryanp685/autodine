/**
 * Restore-target guard: decides, BEFORE any connection is made, whether a
 * restore may proceed against a given target.
 *
 * The hosted restore drill restores into a disposable PostgreSQL container on
 * the runner's loopback. That must stay the only thing a drill can reach:
 * a restore replays a dump into whatever it is pointed at, and the
 * production Supabase project is a database full of real restaurants' data.
 *
 * Rules, in order:
 *
 *   1. Loopback only, by default. 127.0.0.1 / localhost / ::1 may be
 *      restored into with no extra ceremony — that is the disposable drill.
 *   2. A hosted target needs an explicit scratch opt-in AND an approved
 *      project ref: the opt-in alone is not enough, and the ref the target
 *      actually points at must equal the approved one.
 *   3. A Production project is refused outright. There is no flag that
 *      unlocks it: restoring into Production needs its own explicit design,
 *      not a drill that happens to be pointed there.
 *   4. Fail closed. A hosted target whose project ref cannot be determined
 *      is refused, not assumed safe.
 *
 * Pure and dependency-free on purpose: the guard must be able to run in a
 * bare environment (no npm install), because the guard is the thing that
 * decides whether installing/connecting is safe at all.
 *
 * Errors never carry the target URL, the user name or the password. A
 * refusal names the host and the project ref, which are identifiers, not
 * credentials.
 */
import { readFileSync } from 'node:fs';

/** Hosts that are unambiguously this machine. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** A Supabase project ref is 20 lowercase letters/digits. */
const REF_RE = /^[a-z0-9]{20}$/;

/**
 * The Production project ref, hard-coded so the refusal survives even if the
 * JSON file cannot be read. Kept in step with
 * lib/supabase/production-projects.json (asserted by a test).
 */
const FALLBACK_PRODUCTION_REFS = ['bdbaqpevwmgdvghszjno'];

/**
 * The Production project refs, read from the repository's source of truth.
 * The hard-coded fallback is unioned in, so a missing or unreadable file
 * can never make the guard less strict than it is here.
 */
export function knownProductionRefs() {
  let refs = [...FALLBACK_PRODUCTION_REFS];
  try {
    const raw = readFileSync(new URL('../../lib/supabase/production-projects.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.productionProjectRefs)) {
      refs = [...new Set([...refs, ...parsed.productionProjectRefs.map((ref) => String(ref).trim().toLowerCase())])];
    }
  } catch {
    // Fall back to the hard-coded list above.
  }
  return refs;
}

/**
 * Direct Supabase hosts: `<ref>.supabase.co` and `db.<ref>.supabase.co`.
 * The pooler host is shared by every project, so a pooled target's ref can
 * only come from the user name.
 */
const DIRECT_HOST_RE = /^(?:db\.)?([a-z0-9]{20})\.supabase\.co$/;
const POOLER_HOST_RE = /^(?:[a-z0-9-]+\.)*pooler\.supabase\.com$/;
/** Pooled user names: `postgres.<ref>` (transaction mode) or `<ref>.postgres`. */
const POOLED_USER_RE = /^(?:postgres\.([a-z0-9]{20})|([a-z0-9]{20})\.postgres)$/;

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host ?? '').toLowerCase());
}

/** The project ref a target points at, or '' when it cannot be determined. */
export function projectRefOf(targetUrl) {
  let parsed;
  try {
    parsed = new URL(String(targetUrl ?? ''));
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase();
  const direct = DIRECT_HOST_RE.exec(host);
  if (direct) return direct[1];
  if (POOLER_HOST_RE.test(host)) {
    let user = '';
    try {
      user = decodeURIComponent(parsed.username || '');
    } catch {
      user = parsed.username || '';
    }
    const pooled = POOLED_USER_RE.exec(user.toLowerCase());
    if (pooled) return pooled[1] || pooled[2] || '';
  }
  return '';
}

/** How the target's project ref was determined: 'direct', 'pooled' or ''. */
export function projectRefKind(targetUrl) {
  let parsed;
  try {
    parsed = new URL(String(targetUrl ?? ''));
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase();
  if (DIRECT_HOST_RE.test(host)) return 'direct';
  if (POOLER_HOST_RE.test(host)) {
    let user = '';
    try {
      user = decodeURIComponent(parsed.username || '');
    } catch {
      user = parsed.username || '';
    }
    if (POOLED_USER_RE.test(user.toLowerCase())) return 'pooled';
  }
  return '';
}

/** True when the ref names a Production project. */
export function isProductionRef(ref, productionRefs = []) {
  const wanted = String(ref ?? '').toLowerCase();
  if (!wanted) return false;
  return productionRefs
    .map((entry) => String(entry ?? '').trim().toLowerCase())
    .filter(Boolean)
    .includes(wanted);
}

/**
 * Decides whether a restore may proceed.
 *
 * @param {object} input
 * @param {string} input.targetUrl         the connection string (never echoed).
 * @param {string} [input.expectedRef]     the approved project ref.
 * @param {boolean} [input.allowScratch]   explicit opt-in for a hosted scratch project.
 * @param {string[]} [input.productionRefs] extra refs that must never be restored into.
 * @returns {{allowed: boolean, reason: string, host: string, ref: string}}
 */
export function restoreTargetDecision(input) {
  const targetUrl = String(input?.targetUrl ?? '');
  const expectedRef = String(input?.expectedRef ?? '').trim().toLowerCase();
  const allowScratch = input?.allowScratch === true || input?.allowScratch === '1';
  const productionRefs = [...knownProductionRefs(), ...(input?.productionRefs ?? [])];

  let host = '';
  try {
    host = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return {
      allowed: false,
      reason: 'the restore target is not a valid connection string',
      host: '',
      ref: '',
    };
  }

  if (!host) {
    return {
      allowed: false,
      reason: 'the restore target has no host',
      host: '',
      ref: '',
    };
  }

  if (isLoopbackHost(host)) {
    // The disposable drill target. Nothing hosted is involved.
    return { allowed: true, reason: 'loopback disposable target', host, ref: '' };
  }

  const ref = projectRefOf(targetUrl);
  const kind = projectRefKind(targetUrl);

  // Production first: no opt-in may unlock it.
  if (isProductionRef(ref, productionRefs)) {
    return {
      allowed: false,
      reason:
        `refusing to restore into the PRODUCTION project ${ref} (${kind} connection) — ` +
        'Production restore needs its own explicit design and approval, not a drill',
      host,
      ref,
    };
  }

  if (!allowScratch) {
    return {
      allowed: false,
      reason:
        `refusing the hosted restore target ${host} — a hosted target is only allowed with an ` +
        'explicit scratch opt-in, and Production is never allowed',
      host,
      ref,
    };
  }

  if (!expectedRef) {
    return {
      allowed: false,
      reason:
        `refusing the hosted restore target ${host} — a scratch restore needs the approved project ` +
        'ref (AUTODINE_RESTORE_EXPECTED_REF) so the target can be checked',
      host,
      ref,
    };
  }

  if (!REF_RE.test(expectedRef)) {
    return {
      allowed: false,
      reason: 'the approved project ref is not a valid Supabase project ref',
      host,
      ref,
    };
  }

  if (!ref) {
    return {
      allowed: false,
      reason:
        `refusing the hosted restore target ${host} — the project ref could not be determined, ` +
        'so the target cannot be proven to be the approved scratch project',
      host,
      ref: '',
    };
  }

  if (ref !== expectedRef) {
    return {
      allowed: false,
      reason:
        `refusing the hosted restore target ${host} — it points at project ${ref}, not the approved ` +
        `project ${expectedRef}`,
      host,
      ref,
    };
  }

  return {
    allowed: true,
    reason: `approved scratch project ${ref} (${kind} connection)`,
    host,
    ref,
  };
}
