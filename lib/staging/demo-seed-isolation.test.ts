import { describe, expect, it } from 'vitest';
import {
  DEMO_SEED_APPROVED_PROJECT_REFS,
  DEMO_SEED_DEFAULT_SLUG,
  DEMO_SEED_RESTAURANT_ID,
  assertDemoSeedAllowed,
  checkDemoSeedSqlScope,
  demoSeedAuthorizationPhrase,
  evaluateDemoSeed,
  parseDemoSeedApprovedRefs,
} from './demo-seed-isolation';
import { PRODUCTION_SUPABASE_PROJECT_REFS } from '@/lib/supabase/deployment-isolation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A project the owner has designated for demo data, supplied the way the
 * CLI supplies it: from outside the repository, per run.
 */
const DESIGNATED = 'aaaaaaaaaaaaaaaaaaaa';
/**
 * The historical candidate project. It was never owner-designated — the
 * designation decision (register O-B1) is still open — so it must not be
 * authorisable by default.
 */
const HISTORICAL_CANDIDATE = 'juwyhslzchjevqkdvwjm';
const PRODUCTION = PRODUCTION_SUPABASE_PROJECT_REFS[0];
const PHRASE = demoSeedAuthorizationPhrase(DESIGNATED);

const approved = (overrides: Record<string, unknown> = {}) =>
  evaluateDemoSeed({ targetRef: DESIGNATED, authorization: PHRASE, approvedRefs: [DESIGNATED], ...overrides });

describe('demo seed target guard', () => {
  it('allows a designated project with its own authorisation phrase', () => {
    const decision = approved();
    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual([]);
    expect(decision.ref).toBe(DESIGNATED);
    expect(decision.slug).toBe(DEMO_SEED_DEFAULT_SLUG);
  });

  it('normalises the ref and the slug', () => {
    const decision = approved({ targetRef: ` ${DESIGNATED.toUpperCase()} `, slug: 'Saffron-Smoke' });
    expect(decision.allowed).toBe(true);
    expect(decision.ref).toBe(DESIGNATED);
    expect(decision.slug).toBe('saffron-smoke');
  });

  it('refuses Production, and no allowlist may unlock it', () => {
    const decision = evaluateDemoSeed({
      targetRef: PRODUCTION,
      authorization: demoSeedAuthorizationPhrase(PRODUCTION),
      approvedRefs: [DESIGNATED, PRODUCTION],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(['production-project-ref']);
  });

  it('refuses Production before it even looks at the designated list', () => {
    // Production is refused unconditionally: an empty list, a malformed
    // list and a list that names Production all produce the same refusal.
    for (const approvedRefs of [[], [PRODUCTION], ['not-a-ref']]) {
      const decision = evaluateDemoSeed({
        targetRef: PRODUCTION,
        authorization: demoSeedAuthorizationPhrase(PRODUCTION),
        approvedRefs,
      });
      expect(decision.reasons).toEqual(['production-project-ref']);
    }
  });

  it('refuses an unknown project', () => {
    const decision = evaluateDemoSeed({
      targetRef: 'bbbbbbbbbbbbbbbbbbbb',
      authorization: demoSeedAuthorizationPhrase('bbbbbbbbbbbbbbbbbbbb'),
      approvedRefs: [DESIGNATED],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(['undesignated-project-ref']);
  });

  it('refuses when no designated list was supplied at all', () => {
    const decision = evaluateDemoSeed({ targetRef: DESIGNATED, authorization: PHRASE });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(['no-designated-projects']);
  });

  it('refuses a designated list that cannot be read exactly', () => {
    const decision = evaluateDemoSeed({
      targetRef: DESIGNATED,
      authorization: PHRASE,
      approvedRefs: [DESIGNATED, 'not-a-project-ref'],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(['malformed-designated-project-ref']);
  });

  it('refuses a missing or malformed project ref', () => {
    expect(evaluateDemoSeed({ authorization: PHRASE, approvedRefs: [DESIGNATED] }).reasons).toEqual([
      'missing-target-ref',
    ]);
    expect(evaluateDemoSeed({ targetRef: 'not-a-ref', authorization: PHRASE, approvedRefs: [DESIGNATED] }).reasons).toEqual(
      ['malformed-target-ref'],
    );
    expect(evaluateDemoSeed({ targetRef: 'SHORT', authorization: PHRASE, approvedRefs: [DESIGNATED] }).reasons).toEqual([
      'malformed-target-ref',
    ]);
  });

  it('refuses without an authorisation, and with the wrong one', () => {
    expect(evaluateDemoSeed({ targetRef: DESIGNATED, approvedRefs: [DESIGNATED] }).reasons).toEqual([
      'missing-authorization',
    ]);
    expect(approved({ authorization: 'yes' }).reasons).toEqual(['wrong-authorization']);
  });

  it('refuses an authorisation issued for another project', () => {
    const decision = approved({ authorization: demoSeedAuthorizationPhrase('bbbbbbbbbbbbbbbbbbbb') });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(['wrong-authorization']);
  });

  it('refuses an unsafe slug', () => {
    for (const slug of ['Real Customer; DROP TABLE', '-leading', 'trailing-', 'a'.repeat(60), 'has space', 'a']) {
      expect(approved({ slug }).reasons).toEqual(['unsafe-slug']);
    }
  });

  it('accepts a target URL that names the approved project', () => {
    for (const url of [
      `https://${DESIGNATED}.supabase.co`,
      `https://db.${DESIGNATED}.supabase.co`,
      `postgresql://postgres.${DESIGNATED}:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
    ]) {
      expect(approved({ targetUrl: url }).allowed).toBe(true);
    }
  });

  it('refuses a target URL that names another project or Production', () => {
    expect(approved({ targetUrl: 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co' }).reasons).toEqual(['target-url-ref-mismatch']);
    expect(approved({ targetUrl: `https://${PRODUCTION}.supabase.co` }).reasons).toEqual(['production-target-url']);
    expect(
      approved({ targetUrl: `postgresql://postgres.${PRODUCTION}:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres` })
        .reasons,
    ).toEqual(['production-target-url']);
  });

  it('refuses a malformed or non-Supabase target URL', () => {
    expect(approved({ targetUrl: 'not a url' }).reasons).toEqual(['malformed-target-url']);
    expect(approved({ targetUrl: 'postgresql://someone:password@db.example.com:5432/postgres' }).reasons).toEqual([
      'not-a-supabase-target',
    ]);
  });

  it('never echoes a refused connection string', () => {
    const secret = 'hunter2-not-a-real-password';
    const decision = approved({ targetUrl: `postgresql://postgres:${secret}@db.example.com:5432/postgres` });
    const rendered = JSON.stringify(decision);
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain('hunter2');
    expect(() => assertDemoSeedAllowed({ targetRef: DESIGNATED, approvedRefs: [DESIGNATED], targetUrl: `postgresql://u:${secret}@db.example.com/x` })).toThrow(
      /not-a-supabase-target/,
    );
    try {
      assertDemoSeedAllowed({ targetRef: DESIGNATED, approvedRefs: [DESIGNATED], targetUrl: `postgresql://u:${secret}@db.example.com/x` });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('throws with the rule id when it refuses', () => {
    expect(() => assertDemoSeedAllowed({ targetRef: PRODUCTION })).toThrow(/production-project-ref/);
  });
});

describe('demo seed SQL scope guard', () => {
  /** Every row id the demo fixture owns, exactly as the CLI computes it. */
  const fixtureIds = async (): Promise<string[]> => {
    const { DEMO_MENU_ID, DEMO_RESTAURANT_ID, demoMenu } = await import('@/lib/db/demo-menu');
    const menu = demoMenu('saffron-smoke');
    return [
      DEMO_RESTAURANT_ID,
      DEMO_MENU_ID,
      ...menu.categories.map((category) => category.id),
      ...menu.items.flatMap((item) => [item.id, ...(item.variants ?? []).map((variant) => variant.id)]),
    ];
  };
  const scope = (sql: string, allowedIds: string[] = []) =>
    checkDemoSeedSqlScope(sql, { allowedIds, restaurantId: DEMO_SEED_RESTAURANT_ID });

  it('accepts the real demo seed', async () => {
    const { demoSeedSql } = await import('@/lib/db/demo-menu');
    const result = scope(demoSeedSql('saffron-smoke'), await fixtureIds());
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('refuses a row id that is not the demo fixture\'s', async () => {
    const foreign = DEMO_SEED_RESTAURANT_ID.replace('00000000-0000-4000-8000', '11111111-2222-3333-4444');
    const result = scope(
      `insert into public.items (id, restaurant_id) values ('${foreign}', '${DEMO_SEED_RESTAURANT_ID}');`,
      await fixtureIds(),
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('foreign-row-id');
  });

  it('refuses a statement that removes or restructures data', () => {
    for (const sql of [
      `delete from public.items where restaurant_id = '${DEMO_SEED_RESTAURANT_ID}';`,
      `truncate public.items;`,
      `drop table public.items;`,
      `alter table public.items disable row level security;`,
      `grant all on public.items to anon;`,
      `revoke all on public.items from anon;`,
    ]) {
      expect(scope(sql).problems).toContain('destructive-statement');
    }
  });

  it('refuses a bare update of a table', () => {
    const result = scope(`update public.restaurants set name = 'x' where id = '${DEMO_SEED_RESTAURANT_ID}';`);
    expect(result.problems).toContain('unscoped-update');
  });

  it('allows the fixture\'s own on-conflict update', () => {
    const result = scope(
      `insert into public.restaurants (id) values ('${DEMO_SEED_RESTAURANT_ID}') on conflict (id) do update set name = excluded.name;`,
    );
    expect(result.problems).toEqual([]);
  });

  it('refuses a table outside the public schema', async () => {
    expect(scope(`insert into auth.users (id) values ('${DEMO_SEED_RESTAURANT_ID}');`, await fixtureIds()).problems).toContain(
      'non-public-table',
    );
  });

  it('refuses SQL that names a Production project', async () => {
    expect(scope(`insert into public.items (id) values ('${PRODUCTION}');`, await fixtureIds()).problems).toContain(
      'production-reference-in-sql',
    );
  });

  it('refuses empty SQL and SQL without the demo restaurant', async () => {
    expect(checkDemoSeedSqlScope('   ').problems).toEqual(['empty-sql']);
    expect(
      scope(`insert into public.items (id) values ('5e0a1b3c-6944-4674-b68b-4b305e4480f0');`, await fixtureIds()).problems,
    ).toContain('missing-demo-restaurant');
  });
});

describe('the demo seed guard stays in step with the rest of the repository', () => {
  it('uses the same demo restaurant id as the fixture', async () => {
    const { DEMO_RESTAURANT_ID } = await import('@/lib/db/demo-menu');
    expect(DEMO_SEED_RESTAURANT_ID).toBe(DEMO_RESTAURANT_ID);
  });

  it('authorises NO project from the code alone', () => {
    // The designated list is supplied per run, from outside the repository.
    // If a ref ever reappears here, a historical candidate would become
    // standing authorisation again — so the constant must stay empty.
    expect(DEMO_SEED_APPROVED_PROJECT_REFS).toEqual([]);
  });

  it('cannot authorise the historical candidate project by default', () => {
    // The regression this guards: the acceptance environment's candidate
    // ref is NOT an owner-designated Staging target (register O-B1 is still
    // open), so the seed must refuse it unless the owner separately
    // designates it for this run.
    const source = readFileSync(join(process.cwd(), 'scripts/staging/verify-acceptance-env.mjs'), 'utf8');
    const candidate = source.match(/APPROVED_REF\s*=\s*'([a-z0-9]{20})'/)?.[1];
    expect(candidate).toBeTruthy();
    if (!candidate) throw new Error('the acceptance environment must declare an approved ref');

    // 1. The candidate is not in the code's allowlist.
    expect(DEMO_SEED_APPROVED_PROJECT_REFS).not.toContain(candidate);

    // 2. Naming it as the target and presenting the matching phrase is
    //    still refused, because no designated list was supplied.
    const decision = evaluateDemoSeed({
      targetRef: candidate,
      authorization: demoSeedAuthorizationPhrase(candidate),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(['no-designated-projects']);

    // 3. It is refused even when the phrase is right and a designated list
    //    exists that does not name it.
    const listed = evaluateDemoSeed({
      targetRef: candidate,
      authorization: demoSeedAuthorizationPhrase(candidate),
      approvedRefs: [DESIGNATED],
    });
    expect(listed.allowed).toBe(false);
    expect(listed.reasons).toEqual(['undesignated-project-ref']);

    // 4. The guard source contains no project ref at all.
    const guard = readFileSync(join(process.cwd(), 'lib/staging/demo-seed-isolation.ts'), 'utf8');
    expect(guard).not.toMatch(/['"][a-z0-9]{20}['"]/);
  });

  it('does not weaken the Production project list', () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), 'lib/supabase/production-projects.json'), 'utf8'));
    expect(file.productionProjectRefs).toEqual([...PRODUCTION_SUPABASE_PROJECT_REFS]);
    // No designated demo project may ever be a Production project: a
    // careless edit to the designated list must not be able to make
    // Production seedable. The Production refusal happens first and
    // unconditionally, so this holds whatever the list contains.
    for (const ref of DEMO_SEED_APPROVED_PROJECT_REFS) {
      expect(PRODUCTION_SUPABASE_PROJECT_REFS).not.toContain(ref);
    }
    const productionDecision = evaluateDemoSeed({
      targetRef: PRODUCTION,
      authorization: demoSeedAuthorizationPhrase(PRODUCTION),
      approvedRefs: [PRODUCTION],
    });
    expect(productionDecision.reasons).toEqual(['production-project-ref']);
  });
});

describe('parseDemoSeedApprovedRefs', () => {
  it('parses a comma-separated list, lower-cased and de-duplicated', () => {
    const parsed = parseDemoSeedApprovedRefs(` ${DESIGNATED.toUpperCase()} ,${HISTORICAL_CANDIDATE},${DESIGNATED} `);
    expect(parsed.refs).toEqual([DESIGNATED, HISTORICAL_CANDIDATE]);
    expect(parsed.malformed).toEqual([]);
  });

  it('accepts an array as well as a string', () => {
    expect(parseDemoSeedApprovedRefs([DESIGNATED, ' ']).refs).toEqual([DESIGNATED]);
  });

  it('reports malformed entries instead of dropping them silently', () => {
    const parsed = parseDemoSeedApprovedRefs(`${DESIGNATED},not-a-ref,SHORT`);
    expect(parsed.refs).toEqual([DESIGNATED]);
    expect(parsed.malformed).toEqual(['not-a-ref', 'short']);
  });

  it('treats an absent list as an empty list', () => {
    expect(parseDemoSeedApprovedRefs(undefined)).toEqual({ refs: [], malformed: [] });
    expect(parseDemoSeedApprovedRefs('')).toEqual({ refs: [], malformed: [] });
  });
});
