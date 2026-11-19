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
 * CONFIGURATION (environment only; no value is ever printed)
 *
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
  DEMO_SEED_APPROVED_PROJECT_REFS,
  DEMO_SEED_DEFAULT_SLUG,
  checkDemoSeedSqlScope,
  demoSeedAuthorizationPhrase,
  evaluateDemoSeed,
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

  // The guard runs FIRST, before anything that reads the environment for
  // anything else, and before the fixture module is loaded. A refusal must
  // be the only thing the operator sees.
  const decision = evaluateDemoSeed({ targetRef, authorization, targetUrl, slug });
  if (!decision.allowed) {
    fail(
      `Demo seed refused: ${decision.reasons.join(', ')}.\n` +
        `  The approved demo projects are: ${DEMO_SEED_APPROVED_PROJECT_REFS.join(', ')}.\n` +
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
