/**
 * Print the demo seed SQL for the pilot restaurant.
 *   npm run seed:sql            -> uses slug 'saffron-smoke'
 *   npm run seed:sql -- my-slug -> uses your slug
 *
 * Paste the output into the Supabase SQL editor AFTER running migration 0001.
 */
import { demoSeedSql } from '../lib/db/demo-menu';

const slug = process.argv[2] ?? 'saffron-smoke';
process.stdout.write(demoSeedSql(slug));
