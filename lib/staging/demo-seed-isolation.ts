/**
 * Demo-seed isolation: the fail-closed guard for the demo seed.
 *
 * WHY THIS EXISTS
 *
 * The demo seed writes a fictional restaurant ("Saffron & Smoke", with a
 * menu, twelve tables and QR tokens) into a Supabase project. On a demo or
 * staging project that is harmless and useful. On Production it puts sample
 * data beside real customers' restaurants, orders and money — and
 * `lib/db/demo-menu.ts` says so itself: "It is not a real restaurant and
 * must not be left in place for a live customer."
 *
 * So the seed is only ever PRODUCED for a project that is
 *
 *   1. not a Production project,
 *   2. named by an EXPLICIT, independently supplied list of projects the owner
 *      has designated to carry demo data, and
 *   3. authorised for THIS run, by a phrase that names the target.
 *
 * All three are checked here, before any SQL exists. The guard is pure and
 * dependency-free: it performs no I/O, opens no connection, reads no
 * environment and imports nothing that has side effects. The same decision
 * can therefore be unit-tested, asserted in CI and applied by the CLI with
 * no database anywhere in sight.
 *
 * A SECOND GUARD, ON THE SQL ITSELF
 *
 * Naming a designated project is not enough: the SQL must not be able to
 * reach anything else. `checkDemoSeedSqlScope` therefore re-reads the
 * generated seed and refuses it unless every row id it writes belongs to
 * the demo fixture, it touches only `public.` tables, it contains no
 * statement that removes or alters data, and it never mentions a Production
 * project. A change to the fixture that made it write a row it should not
 * write fails here rather than in a database.
 *
 * HONEST LIMITS
 *
 * The guard proves that the seed targets a project the owner designated for
 * demo data and that its SQL is confined to the demo fixture's own rows. It
 * cannot prove that a designated demo project contains no real customer — a
 * project becomes real long after it was designated, and only the owner can
 * see that. The per-run authorisation phrase is what makes that a human
 * decision each time rather than a standing permission.
 *
 * The slug is checked for shape only, because it cannot hurt: the seed
 * writes one fixed restaurant id, so a slug that already belongs to a
 * different restaurant fails on the unique constraint and writes nothing.
 *
 * Refusals name rule ids and project refs — identifiers, never credentials.
 * A refused connection string is never echoed back.
 */

import { PRODUCTION_SUPABASE_PROJECT_REFS } from '@/lib/supabase/deployment-isolation';

/** A Supabase project ref is 20 lowercase letters/digits. */
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

/** A demo slug: lowercase alphanumerics and single dashes, 3–50 characters. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** The demo restaurant's fixed id. Kept in step with lib/db/demo-menu.ts (asserted by a test). */
export const DEMO_SEED_RESTAURANT_ID = '00000000-0000-4000-8000-000000000001';

/** The slug the demo fixture uses by default. */
export const DEMO_SEED_DEFAULT_SLUG = 'saffron-smoke';

/**
 * The projects the demo seed may target.
 *
 * EMPTY ON PURPOSE.
 *
 * An earlier revision of this file hard-coded one project ref here and
 * called it "the approved demo project". That ref was only ever a
 * CANDIDATE — it was never designated by the owner as the Staging target,
 * and the designation decision (register O-B1) is still open. Hard-coding it
 * turned a historical candidate into standing authorisation: anyone who
 * could set the per-run phrase could seed a project nobody had approved.
 *
 * The designated list is therefore NOT in the code. It is supplied, per
 * run, from outside the repository, by whoever the owner has authorised to
 * run the seed — and the target must be an EXACT member of that list. The
 * target ref cannot authorise itself: the guard never derives the approved
 * set from the ref it is checking.
 *
 * A test asserts this list stays empty, so a careless edit that re-adds a
 * ref fails CI rather than silently re-authorising a project.
 */
export const DEMO_SEED_APPROVED_PROJECT_REFS: readonly string[] = [];

/**
 * Parses the owner-supplied list of designated demo projects.
 *
 * Accepts a comma-separated string (the environment form) or an array.
 * Entries are normalised to lower case; empty entries are dropped.
 *
 * Malformed entries are NOT dropped silently: they are returned so the
 * caller can refuse the whole list. A list that cannot be read exactly is a
 * list nobody can rely on, and "fail closed on an unreadable allowlist" is
 * the only safe reading of it.
 */
export function parseDemoSeedApprovedRefs(raw: string | readonly string[] | undefined): {
  refs: string[];
  malformed: string[];
} {
  const entries = Array.isArray(raw)
    ? raw.map((entry) => String(entry ?? ''))
    : String(raw ?? '').split(',').map((entry) => String(entry ?? ''));
  const refs: string[] = [];
  const malformed: string[] = [];
  for (const entry of entries) {
    const ref = entry.trim().toLowerCase();
    if (!ref) continue;
    if (!PROJECT_REF_RE.test(ref)) {
      malformed.push(ref);
      continue;
    }
    if (!refs.includes(ref)) refs.push(ref);
  }
  return { refs, malformed };
}

/**
 * The phrase an operator must present to authorise one specific target.
 *
 * Naming the ref means an authorisation copied from one project does not
 * carry over to another: `seed-demo:juwyhslzchjevqkdvwjm` authorises that
 * project and nothing else.
 */
export function demoSeedAuthorizationPhrase(targetRef: string): string {
  return `seed-demo:${String(targetRef ?? '').trim().toLowerCase()}`;
}

export type DemoSeedTarget = {
  /** The Supabase project ref the seed is for. */
  targetRef?: string;
  /** Optional connection string, cross-checked against the ref when present. */
  targetUrl?: string;
  /** The authorisation phrase. */
  authorization?: string;
  /** The demo slug to seed under. */
  slug?: string;
  /**
   * The projects the owner has designated to carry demo data. Supplied from
   * OUTSIDE the repository, per run. When absent, the (empty) default applies
   * and nothing is seedable.
   */
  approvedRefs?: readonly string[];
  /** Extra refs that must never be seeded. */
  productionRefs?: readonly string[];
};

export type DemoSeedDecision = {
  /** Whether the seed may be produced. */
  allowed: boolean;
  /** Rule ids explaining the decision. Empty when allowed. */
  reasons: string[];
  /** The normalised target ref. */
  ref: string;
  /** The normalised slug that would be used. */
  slug: string;
};

const normaliseRef = (value: string | undefined): string => String(value ?? '').trim().toLowerCase();

const productionRefsOf = (target: DemoSeedTarget): string[] => [
  ...PRODUCTION_SUPABASE_PROJECT_REFS.map((ref) => ref.toLowerCase()),
  ...(target.productionRefs ?? []).map((ref) => String(ref ?? '').trim().toLowerCase()).filter(Boolean),
];

const approvedRefsOf = (target: DemoSeedTarget): string[] =>
  (target.approvedRefs ?? DEMO_SEED_APPROVED_PROJECT_REFS).map((ref) => normaliseRef(ref)).filter(Boolean);

/** True when the URL names a Supabase host (direct or pooled). */
function isSupabaseHost(host: string): boolean {
  return host === 'supabase.co' || host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
}

/**
 * Decides whether the demo seed may be produced for a target.
 *
 * The order matters:
 *
 *   1. the target must be present and shaped like a project ref;
 *   2. Production is refused outright — before the designated list, before
 *      any opt-in, and before the URL is even looked at, because no later
 *      input may unlock it;
 *   3. the owner-supplied designated list must exist and must be readable
 *      exactly — an absent or malformed list refuses;
 *   4. the target must be an EXACT member of that list;
 *   5. only then is the caller asked for a per-run authorisation.
 *
 * A refusal never reveals a secret, and never echoes the connection string.
 */
export function evaluateDemoSeed(target: DemoSeedTarget): DemoSeedDecision {
  const ref = normaliseRef(target?.targetRef);
  const slug = String(target?.slug ?? DEMO_SEED_DEFAULT_SLUG).trim().toLowerCase();
  const refuse = (reason: string): DemoSeedDecision => ({ allowed: false, reasons: [reason], ref, slug });

  if (!ref) return refuse('missing-target-ref');
  if (!PROJECT_REF_RE.test(ref)) return refuse('malformed-target-ref');

  // Production first, and no option unlocks it.
  if (productionRefsOf(target ?? {}).includes(ref)) return refuse('production-project-ref');

  // The designated list must be supplied from outside the repository. With
  // no list, nothing is seedable — a historical candidate project is not
  // authorisation.
  const approved = approvedRefsOf(target ?? {});
  if (approved.length === 0) return refuse('no-designated-projects');
  // A list that cannot be read exactly is refused whole: a malformed entry
  // means the list the operator supplied is not the list they meant.
  if (approved.some((entry) => !PROJECT_REF_RE.test(entry))) return refuse('malformed-designated-project-ref');

  if (!approved.includes(ref)) return refuse('undesignated-project-ref');

  const url = String(target?.targetUrl ?? '').trim();
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return refuse('malformed-target-url');
    }
    const host = parsed.hostname.toLowerCase();
    if (!isSupabaseHost(host)) return refuse('not-a-supabase-target');
    // A connection string that names a Production project is refused even if
    // the ref it was given does not.
    if (productionRefsOf(target ?? {}).some((prod) => url.toLowerCase().includes(prod))) {
      return refuse('production-target-url');
    }
    if (!url.toLowerCase().includes(ref)) return refuse('target-url-ref-mismatch');
  }

  const authorization = String(target?.authorization ?? '').trim();
  if (!authorization) return refuse('missing-authorization');
  if (authorization !== demoSeedAuthorizationPhrase(ref)) return refuse('wrong-authorization');

  if (!SLUG_RE.test(slug)) return refuse('unsafe-slug');

  return { allowed: true, reasons: [], ref, slug };
}

/** Throws when the seed may not be produced. The message names rule ids only. */
export function assertDemoSeedAllowed(target: DemoSeedTarget): DemoSeedDecision {
  const decision = evaluateDemoSeed(target);
  if (!decision.allowed) {
    throw new Error(`Demo seed refused: ${decision.reasons.join(', ')}.`);
  }
  return decision;
}

/* -------------------------------------------------------------------------- */
/* The SQL scope guard                                                         */
/* -------------------------------------------------------------------------- */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Statements that remove, restructure or grant. A seed must contain none. */
const DESTRUCTIVE_RE = /\b(delete|truncate|drop|alter|grant|revoke)\b/i;
/** A bare `update <table> set` — as opposed to an `on conflict ... do update set` clause. */
const BARE_UPDATE_RE = /\bupdate\s+(?!set\b)([a-z_][a-z0-9_.]*)\s+set\b/i;
const INSERT_RE = /\binsert\s+into\s+([A-Za-z_"][A-Za-z0-9_."]*)/g;

export type DemoSeedSqlScopeOptions = {
  /** Every row id the demo fixture is allowed to write. */
  allowedIds?: readonly string[];
  /** The demo restaurant's id. Defaults to DEMO_SEED_RESTAURANT_ID. */
  restaurantId?: string;
  /** Refs that must never appear in the SQL. */
  productionRefs?: readonly string[];
};

export type DemoSeedSqlScope = {
  ok: boolean;
  /** Rule ids explaining the refusal. Empty when ok. */
  problems: string[];
};

/**
 * Re-reads a generated demo seed and refuses it unless it is confined to
 * the demo fixture.
 *
 * The rules, in order:
 *
 *   1. `empty-sql` — there is nothing to check.
 *   2. `destructive-statement` — no delete/truncate/drop/alter/grant/revoke.
 *      A seed adds sample data; it never removes or rewrites anything.
 *   3. `unscoped-update` — no bare `update <table> set`. The only update the
 *      fixture performs is `on conflict (id) do update set name = ...`, which
 *      is keyed on the row being inserted.
 *   4. `non-public-table` — every insert targets a `public.` table.
 *   5. `missing-demo-restaurant` — the demo restaurant's own id appears, so
 *      the seed is really the demo seed.
 *   6. `foreign-row-id` — every row id the seed writes belongs to the demo
 *      fixture. This is the cross-tenant rule: a row id that is not one of
 *      the fixture's own cannot be touched by this seed.
 *   7. `production-reference-in-sql` — the SQL names no Production project.
 */
export function checkDemoSeedSqlScope(sql: string, options: DemoSeedSqlScopeOptions = {}): DemoSeedSqlScope {
  const text = String(sql ?? '');
  const problems: string[] = [];
  const restaurantId = String(options.restaurantId ?? DEMO_SEED_RESTAURANT_ID).toLowerCase();
  const allowedIds = new Set((options.allowedIds ?? []).map((id) => String(id).toLowerCase()));
  const productionRefs = (options.productionRefs ?? PRODUCTION_SUPABASE_PROJECT_REFS).map((ref) =>
    String(ref ?? '').trim().toLowerCase(),
  );

  if (!text.trim()) return { ok: false, problems: ['empty-sql'] };

  if (DESTRUCTIVE_RE.test(text)) problems.push('destructive-statement');
  if (BARE_UPDATE_RE.test(text)) problems.push('unscoped-update');

  for (const match of text.matchAll(INSERT_RE)) {
    const table = match[1].replace(/"/g, '').toLowerCase();
    if (!table.startsWith('public.')) problems.push('non-public-table');
  }

  if (!text.toLowerCase().includes(restaurantId)) problems.push('missing-demo-restaurant');

  if (allowedIds.size > 0) {
    for (const match of text.matchAll(UUID_RE)) {
      const id = match[0].toLowerCase();
      if (!allowedIds.has(id)) {
        problems.push('foreign-row-id');
        break;
      }
    }
  }

  const lowered = text.toLowerCase();
  if (productionRefs.some((ref) => ref && lowered.includes(ref))) problems.push('production-reference-in-sql');

  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

/** Throws when the SQL is not confined to the demo fixture. */
export function assertDemoSeedSqlScope(sql: string, options: DemoSeedSqlScopeOptions = {}): DemoSeedSqlScope {
  const scope = checkDemoSeedSqlScope(sql, options);
  if (!scope.ok) {
    throw new Error(`Demo seed SQL refused: ${scope.problems.join(', ')}.`);
  }
  return scope;
}
