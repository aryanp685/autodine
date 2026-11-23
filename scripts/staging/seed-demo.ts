#!/usr/bin/env node
/**
 * Produce the demo seed — for an approved demo project, and only for one.
 *
 *   npm run staging:seed-demo
 *
 * WHAT IT DOES
 *
 * Runs the demo-seed guard first. If the target is refused, the reason is
 * printed and nothing else is: no SQL is produced, no connection is opened,
 * nothing is written anywhere. If the target is approved, the synthetic demo
 * SQL is printed to stdout for the owner to apply.
 *
 * NOTHING IS SEEDED BY THIS SCRIPT
 *
 * It prints SQL. It does not execute it. There is no database client in
 * this file and no connection string is used to open anything — the
 * connection string, when one is given, is read only to check that it names
 * the same project as the ref. Applying the seed is the owner's action, in
 * the Supabase SQL editor, against the project the guard approved.
 *
 * WHY THE AUTHORISATION IS PER RUN
 *
 * `AUTODINE_DEMO_SEED_AUTHORIZATION` must equal `seed-demo:<ref>`, naming
 * the target project. An authorisation copied from one project therefore
 * does not carry over to another, and no standing permission exists to
 * seed any project at any time.
 *
 * WHY THE DESIGNATED LIST COMES FROM THE ENVIRONMENT
 *
 * The list of projects the owner has designated to carry demo data is NOT
 * in this repository. An earlier revision hard-coded one candidate ref as
 * "the approved project"; that ref was never owner-designated, and leaving
 * it in the code meant a project nobody had approved could be seeded by
 * anyone who could set the phrase. The list is therefore supplied per run
 * through `AUTODINE_DEMO_SEED_APPROVED_REFS`, and the target must be an
 * exact member of it. The target ref never authorises itself.
 *
 * CONFIGURATION (environment only; no value is ever printed)
 *
 *   AUTODINE_DEMO_SEED_APPROVED_REFS   comma-separated list of the projects
 *                                       the owner has designated for demo
 *                                       data (required; the target must be
 *                                       an exact member)
 *   AUTODINE_DEMO_SEED_TARGET_REF      the project ref to seed (required)
 *   AUTODINE_DEMO_SEED_AUTHORIZATION   must be `seed-demo:<ref>` (required)
 *   AUTODINE_DEMO_SEED_TARGET_URL      optional connection string; when
 *                                       given it must name the same project
 *   AUTODINE_DEMO_SEED_SLUG            optional slug (default saffron-smoke)
 *
 * Exit codes: 0 = the approved seed was printed; 1 = refused (rule ids
 * only); 2 = usage error.
 */
import {
  DEMO_SEED_DEFAULT_SLUG,
  checkDemoSeedSqlScope,
  demoSeedAuthorizationPhrase,
  evaluateDemoSeed,
  parseDemoSeedApprovedRefs,
} from '../../lib/staging/demo-seed-isolation';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const targetRef = process.env.AUTODINE_DEMO_SEED_TARGET_REF ?? '';
  const authorization = process.env.AUTODINE_DEMO_SEED_AUTHORIZATION ?? '';
  const targetUrl = process.env.AUTODINE_DEMO_SEED_TARGET_URL ?? '';
  const slug = (process.env.AUTODINE_DEMO_SEED_SLUG ?? DEMO_SEED_DEFAULT_SLUG).trim().toLowerCase();
  const designated = parseDemoSeedApprovedRefs(process.env.AUTODINE_DEMO_SEED_APPROVED_REFS);

  // The guard runs FIRST, before anything that reads the environment for
  // anything else, and before the fixture module is loaded. A refusal must
  // be the only thing the operator sees.
  const decision = evaluateDemoSeed({ targetRef, authorization, targetUrl, slug, approvedRefs: designated.refs });
  if (!decision.allowed) {
    const reasons = [...decision.reasons];
    // A malformed entry in the designated list is the operator's typo, and
    // naming the offending shape (never a value) is enough to fix it.
    if (designated.malformed.length) reasons.push('malformed-designated-project-ref');
    fail(
      `Demo seed refused: ${[...new Set(reasons)].join(', ')}.\n` +
        '  The designated demo projects must be supplied by the owner in ' +
        'AUTODINE_DEMO_SEED_APPROVED_REFS (comma-separated); nothing is authorised by default.\n' +
        `  Authorise this target with AUTODINE_DEMO_SEED_AUTHORIZATION=${demoSeedAuthorizationPhrase(decision.ref || '<ref>')}\n` +
        '  (the phrase names the project, so an authorisation never carries over to another one).',
    );
  }

  // Loaded only after the guard has approved the target.
  const { DEMO_MENU_ID, DEMO_RESTAURANT_ID, demoMenu, demoSeedSql } = await import('../../lib/db/demo-menu');

  const menu = demoMenu(decision.slug);
  const allowedIds = new Set<string>([
    DEMO_RESTAURANT_ID,
    DEMO_MENU_ID,
    ...menu.categories.map((category) => category.id),
    ...menu.items.flatMap((item) => [item.id, ...(item.variants ?? []).map((variant) => variant.id)]),
  ]);

  const sql = demoSeedSql(decision.slug);
  const scope = checkDemoSeedSqlScope(sql, { allowedIds: [...allowedIds], restaurantId: DEMO_RESTAURANT_ID });
  if (!scope.ok) {
    fail(`Demo seed SQL refused: ${scope.problems.join(', ')}.`);
  }

  process.stdout.write(
    `-- Demo seed for project ${decision.ref} (slug '${decision.slug}').\n` +
      '-- Synthetic sample data only: a fictional restaurant, its menu, twelve tables and QR tokens.\n' +
      '-- NOTHING HAS BEEN WRITTEN BY THIS COMMAND. It printed SQL; applying it is the owner\'s action,\n' +
      '-- in the Supabase SQL editor, against the project named above.\n' +
      sql,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`seed-demo failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exit(1);
});
