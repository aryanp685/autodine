#!/usr/bin/env node
/**
 * Migration syntax check.
 *
 * IMPORTANT — READ THIS BEFORE TRUSTING A PASS:
 * This is a PARTIAL check, because the sandbox has no Postgres and
 * pgsql-ast-parser cannot parse CREATE FUNCTION or CREATE POLICY. So:
 *
 *   CHECKED:     CREATE TABLE / INDEX / TYPE, COMMENT. That is all.
 *   NOT CHECKED: everything that makes a Supabase schema safe.
 *                CREATE FUNCTION bodies, CREATE POLICY, DROP POLICY, GRANT,
 *                ALTER TABLE ... ADD/DROP CONSTRAINT, and
 *                ALTER TABLE ... ENABLE ROW LEVEL SECURITY are all stripped
 *                out before parsing, because the parser cannot read them.
 *
 *                That list grew as migrations started using drop-then-create
 *                for re-runnability and explicit GRANTs. Bear in mind that a
 *                migration consisting only of those constructs reports
 *                "nothing checkable" and proves nothing either way.
 *
 * In other words this catches a typo in a column definition and nothing
 * else. It says nothing about whether your tenant isolation works.
 *
 * A pass here means "the DDL parses", not "the migration is correct".
 * Every migration still needs one real run against a throwaway database
 * before it touches anything a customer depends on.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'pgsql-ast-parser';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

if (!existsSync(MIGRATIONS)) {
  console.log('No supabase/migrations directory yet.');
  process.exit(0);
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (!files.length) {
  console.log('No migrations yet.');
  process.exit(0);
}

/** Remove the constructs the parser cannot handle, so the rest can be checked. */
function stripUnsupported(sql) {
  let out = sql;
  // create or replace function ... $$ body $$  ... ;
  out = out.replace(/create\s+or\s+replace\s+function[\s\S]*?\$\$[\s\S]*?\$\s*;/gi, '');
  // create policy ... ;
  out = out.replace(/^\s*create\s+policy[\s\S]*?;\s*$/gim, '');
  // drop policy ... ;  (added: migration 0002 uses drop-then-create to be
  // re-runnable, and the parser rejects DROP POLICY outright)
  out = out.replace(/^\s*drop\s+policy[\s\S]*?;\s*$/gim, '');
  // grant ... ;
  out = out.replace(/^\s*grant\s[\s\S]*?;\s*$/gim, '');
  // revoke ... ;  (parser has no REVOKE; added with migration 0003, which
  // revokes the default PUBLIC execute on a SECURITY DEFINER function)
  out = out.replace(/^\s*revoke\s[\s\S]*?;\s*$/gim, '');
  // comment on function ... ;  (COMMENT ON TABLE/COLUMN parses fine; the
  // FUNCTION form does not, so only that form is stripped)
  out = out.replace(/^\s*comment\s+on\s+function[\s\S]*?;\s*$/gim, '');
  // alter table ... enable/disable row level security;
  out = out.replace(/^\s*alter\s+table[\s\S]*?row\s+level\s+security\s*;\s*$/gim, '');
  // alter table ... add/drop constraint ...;
  out = out.replace(/^\s*alter\s+table[\s\S]*?(add|drop)\s+constraint[\s\S]*?;\s*$/gim, '');
  // create trigger ... ;  (the parser has no CREATE TRIGGER. Trigger bodies
  // are function calls, so there is little to check anyway -- but they must
  // be removed or they break the parse of everything around them.)
  out = out.replace(/^\s*create\s+(or\s+replace\s+)?trigger[\s\S]*?;\s*$/gim, '');
  // drop trigger ... ;
  out = out.replace(/^\s*drop\s+trigger[\s\S]*?;\s*$/gim, '');
  // do $$ ... $$;  (migration 0010 uses a DO block to make an ALTER
  // PUBLICATION idempotent. The parser has no plpgsql, so the whole block
  // goes. It is reported as unverified like the functions above.)
  out = out.replace(/^\s*do\s+\$\$[\s\S]*?\$\$\s*;\s*$/gim, '');
  // alter publication ... ;  (no such statement in the parser)
  out = out.replace(/^\s*alter\s+publication[\s\S]*?;\s*$/gim, '');
  // alter table ... replica identity ... ;  (not in the parser either)
  out = out.replace(/^\s*alter\s+table[\s\S]*?replica\s+identity[\s\S]*?;\s*$/gim, '');
  return out;
}

let failed = 0;

for (const file of files) {
  const full = join(MIGRATIONS, file);
  const sql = readFileSync(full, 'utf8');

  const stripped = stripUnsupported(sql);
  const removedFns = (sql.match(/create\s+or\s+replace\s+function/gi) || []).length;
  const removedPolicies = (sql.match(/create\s+policy/gi) || []).length;
  const removedDrops = (sql.match(/drop\s+policy/gi) || []).length;
  const removedGrants = (sql.match(/^\s*grant\s/gim) || []).length;
  const removedRevokes = (sql.match(/^\s*revoke\s/gim) || []).length;
  const removedComments =
    (sql.match(/^\s*comment\s+on\s+function/gim) || []).length;
  const removedRls = (sql.match(/row\s+level\s+security/gi) || []).length;
  const removedTriggers = (sql.match(/^\s*create\s+(?:or\s+replace\s+)?trigger/gim) || []).length;
  const removedTriggerDrops = (sql.match(/^\s*drop\s+trigger/gim) || []).length;
  const removedDoBlocks = (sql.match(/^\s*do\s+\$\$/gim) || []).length;
  const removedPublications = (sql.match(/^\s*alter\s+publication/gim) || []).length;
  const removedReplicaIdentity = (sql.match(/replica\s+identity/gi) || []).length;

  // Comments are not statements. Strip them so a file that is nothing but
  // functions, policies and grants reports "nothing checkable" instead of
  // tripping the parser's "unexpected end of input" on empty input.
  const checkable = stripped.replace(/--[^\n]*/g, '').trim();

  if (!checkable) {
    console.log(
      `${file}: nothing checkable (only functions/policies/grants) — ` +
        `UNVERIFIED: ${removedFns} function(s), ${removedPolicies} policy/policies, ` +
        `${removedDrops} policy drop(s), ${removedGrants} grant(s), ` +
        `${removedRevokes} revoke(s), ${removedComments} function comment(s)`,
        `${removedTriggers} trigger(s), ${removedTriggerDrops} trigger drop(s), ` +
        `${removedDoBlocks} do block(s), ${removedPublications} publication change(s), ` +
        `${removedReplicaIdentity} replica identity statement(s)`,
    );
    continue;
  }

  try {
    const ast = parse(checkable);
    const unverified = [
      `${removedFns} function(s)`,
      `${removedPolicies} policy/policies`,
      `${removedDrops} policy drop(s)`,
      `${removedGrants} grant(s)`,
      `${removedRevokes} revoke(s)`,
      `${removedComments} function comment(s)`,
      `${removedRls} RLS statement(s)`,
      `${removedTriggers} trigger(s), ${removedTriggerDrops} trigger drop(s)`,
      `${removedDoBlocks} do block(s), ${removedPublications} publication change(s), ` +
        `${removedReplicaIdentity} replica identity statement(s)`,
    ].join(', ');
    console.log(
      `${file}: DDL parses (${ast.length} statements)` +
        ` — DDL ONLY. UNVERIFIED: ${unverified}`,
    );
  } catch (e) {
    failed += 1;
    console.error(`${file}: PARSE FAILED — ${e.message.split('\n')[0]}`);
  }
}

if (failed) {
  console.error(`\n${failed} migration(s) failed the syntax check.`);
  process.exit(1);
}

console.log('\nReminder: this checked DDL syntax only. Function bodies, RLS policies and');
console.log('ENABLE ROW LEVEL SECURITY were stripped and NOT validated. The migration');
console.log('still needs one real run against a throwaway database.');
