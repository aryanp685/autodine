/** Print sample seed SQL for local development. */
import { demoSeedSql } from '../lib/db/demo-menu';

const slug = process.argv[2] ?? 'saffron-smoke';
process.stdout.write(demoSeedSql(slug));
