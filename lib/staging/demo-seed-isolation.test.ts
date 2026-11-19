import { describe, expect, it } from 'vitest';
import {
  DEMO_SEED_APPROVED_PROJECT_REFS,
  DEMO_SEED_DEFAULT_SLUG,
  DEMO_SEED_RESTAURANT_ID,
  assertDemoSeedAllowed,
  checkDemoSeedSqlScope,
  demoSeedAuthorizationPhrase,
  evaluateDemoSeed,
} from './demo-seed-isolation';
import { PRODUCTION_SUPABASE_PROJECT_REFS } from '@/lib/supabase/deployment-isolation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APPROVED = DEMO_SEED_APPROVED_PROJECT_REFS[0];
const PRODUCTION = PRODUCTION_SUPABASE_PROJECT_REFS[0];
const PHRASE = demoSeedAuthorizationPhrase(APPROVED);

const approved = (overrides: Record<string, unknown> = {}) =>
  evaluateDemoSeed({ targetRef: APPROVED, authorization: PHRASE, ...overrides });

describe('demo seed target guard', () => {
  it('allows the approved project with its own authorisation phrase', () => {
    const decision = approved();
    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual([]);
    expect(decision.ref).toBe(APPROVED);
    expect(decision.slug).toBe(DEMO_SEED_DEFAULT_SLUG);
  });

  it('normalises the ref and the slug', () => {
    const decision = approved({ targetRef: ` ${APPROVED.toUpperCase()} `, slug: 'Saffron-Smoke' });
    expect(decision.allowed).toBe(true);
    expect(decision.ref).toBe(APPROVED);
    expect(decision.slug).toBe('saffron-smoke');
  });

  it('refuses Production, and no allowlist may unlock it', () => {
    const decision = evaluateDemoSeed({
      targetRef: PRODUCTION,
      authorization: demoSeedAuthorizationPhrase(PRODUCTION),
      approvedRefs: [APPROVED, PRODUCTION],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(['production-project-ref']);
  });

  it('refuses an unknown project', () => {
    const decision = evaluateDemoSeed({
      targetRef: 'aaaaaaaaaaaaaaaaaaaa',
      authorization: demoSeedAuthorizationPhrase('aaaaaaaaaaaaaaaaaaaa'),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(['unapproved-project-ref']);
  });

  it('refuses a missing or malformed project ref', () => {
    expect(evaluateDemoSeed({ authorization: PHRASE }).reasons).toEqual(['missing-target-ref']);
    expect(evaluateDemoSeed({ targetRef: 'not-a-ref', authorization: PHRASE }).reasons).toEqual(['malformed-target-ref']);
    expect(evaluateDemoSeed({ targetRef: 'SHORT', authorization: PHRASE }).reasons).toEqual(['malformed-target-ref']);
  });

  it('refuses without an authorisation, and with the wrong one', () => {
    expect(evaluateDemoSeed({ targetRef: APPROVED }).reasons).toEqual(['missing-authorization']);
    expect(approved({ authorization: 'yes' }).reasons).toEqual(['wrong-authorization']);
  });

  it('refuses an authorisation issued for another project', () => {
    const decision = approved({ authorization: demoSeedAuthorizationPhrase('aaaaaaaaaaaaaaaaaaaa') });
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
      `https://${APPROVED}.supabase.co`,
      `https://db.${APPROVED}.supabase.co`,
      `postgresql://postgres.${APPROVED}:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
    ]) {
      expect(approved({ targetUrl: url }).allowed).toBe(true);
    }
  });

  it('refuses a target URL that names another project or Production', () => {
    expect(approved({ targetUrl: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' }).reasons).toEqual(['target-url-ref-mismatch']);
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
    expect(() => assertDemoSeedAllowed({ targetRef: APPROVED, targetUrl: `postgresql://u:${secret}@db.example.com/x` })).toThrow(
      /not-a-supabase-target/,
    );
    try {
      assertDemoSeedAllowed({ targetRef: APPROVED, targetUrl: `postgresql://u:${secret}@db.example.com/x` });
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

  it('targets the same project the acceptance environment approves', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/staging/verify-acceptance-env.mjs'), 'utf8');
    const approved = source.match(/APPROVED_REF\s*=\s*'([a-z0-9]{20})'/)?.[1];
    expect(approved).toBe(DEMO_SEED_APPROVED_PROJECT_REFS[0]);
  });

  it('does not weaken the Production project list', () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), 'lib/supabase/production-projects.json'), 'utf8'));
    expect(file.productionProjectRefs).toEqual([...PRODUCTION_SUPABASE_PROJECT_REFS]);
    // No approved demo project may ever be a Production project: the
    // allowlist is code, and a careless edit to it must not be able to
    // make Production seedable.
    for (const ref of DEMO_SEED_APPROVED_PROJECT_REFS) {
      expect(PRODUCTION_SUPABASE_PROJECT_REFS).not.toContain(ref);
    }
  });
});
