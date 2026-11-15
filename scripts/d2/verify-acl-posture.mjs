#!/usr/bin/env node
/**
 * D2 post-apply verification — read-only catalog probes. Never writes.
 *
 *   node scripts/d2/verify-acl-posture.mjs --print-sql        # print the probe SQL (paste into the SQL editor)
 *   AUTODINE_D2_VERIFY_URL=postgresql://... node scripts/d2/verify-acl-posture.mjs [--json]
 *
 * Run AFTER the reviewed release applies 20261110001220_revoke_client_bypass_privileges.sql
 * and AFTER the owner runs supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql.
 * See docs/d2-postgres-acl-remediation-2026-11-15.md §4.4 and §6.
 *
 * Exit 0 = clean: zero client-grantee maintenance/bypass privileges on public
 *           tables/sequences and zero client-grantee default-ACL rows for the
 *           two known grantors.
 * Exit 1 = findings remain (each is listed with its grantor; the fix for a
 *           non-postgres/non-supabase_admin grantor is THAT role's revoke —
 *           never a blanket PUBLIC re-grant, never a role drop).
 * Exit 2 = usage or connection error.
 *
 * The script only SELECTs pg_catalog and pg_policies-free views; it changes
 * nothing. Do not run it as a superuser thinking that makes it safer — it
 * reads the same catalog as any role with CONNECT.
 */
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const printSql = args.includes('--print-sql');
const asJson = args.includes('--json');

const PROBE_TABLES = `select n.nspname as schema, c.relname as table_name, owner.rolname as owner,
       coalesce(nullif(acl.grantee::regrole::text, '0'), 'PUBLIC') as grantee,
       acl.grantor::regrole::text as grantor, acl.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles owner on owner.oid = c.relowner
  cross join lateral aclexplode(coalesce(c.relacl, '{}')) as acl
 where n.nspname = 'public' and c.relkind in ('r','p')
   and acl.privilege_type in ('MAINTAIN','TRUNCATE','REFERENCES','TRIGGER')
 order by 1,2,4,5`;

const PROBE_SEQUENCES = `select n.nspname as schema, c.relname as sequence_name, owner.rolname as owner,
       coalesce(nullif(acl.grantee::regrole::text, '0'), 'PUBLIC') as grantee,
       acl.grantor::regrole::text as grantor, acl.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles owner on owner.oid = c.relowner
  cross join lateral aclexplode(coalesce(c.relacl, '{}')) as acl
 where n.nspname = 'public' and c.relkind = 'S'
   and acl.privilege_type in ('USAGE','SELECT','UPDATE')
 order by 1,2,4,5`;

const PROBE_DEFAULT_ACLS = `select r.rolname as grantor, d.defaclobjtype,
       coalesce(nullif(acl.grantee::regrole::text, '0'), 'PUBLIC') as grantee,
       acl.privilege_type
  from pg_default_acl d
  join pg_class c on c.oid = d.defaclnamespace
  join pg_namespace n on n.oid = c.oid and n.nspname = 'public'
  join pg_roles r on r.oid = d.defaclrole
  cross join lateral aclexplode(d.defaclacl) as acl
 where acl.privilege_type in ('MAINTAIN','TRUNCATE','REFERENCES','TRIGGER','USAGE','SELECT','UPDATE')
 order by 1,2,3,4`;

if (printSql) {
  process.stdout.write([
    '-- §3a tables:', PROBE_TABLES + ';',
    '-- §3b sequences:', PROBE_SEQUENCES + ';',
    '-- §3c default ACLs (run as postgres, and separately as supabase_admin):', PROBE_DEFAULT_ACLS + ';',
    '',
  ].join('\n\n'));
  process.exit(0);
}

const CLIENT_GRANTEES = new Set(['anon', 'authenticated', 'PUBLIC']);
const KNOWN_GRANTORS = new Set(['postgres', 'supabase_admin']);

const url = process.env.AUTODINE_D2_VERIFY_URL?.trim();
if (!url) {
  process.stderr.write('d2-verify: set AUTODINE_D2_VERIFY_URL (read-only catalog connection). For the SQL-editor path use --print-sql.\n');
  process.exit(2);
}

let Client;
try {
  ({ default: { Client } } = await import('pg'));
} catch {
  ({ Client } = await import('pg'));
}

const client = new Client({ connectionString: url, statement_timeout: 15000, query_timeout: 15000 });
const findings = [];
const warnings = [];
try {
  await client.connect();
  const [tables, sequences, defaults] = await Promise.all([
    client.query(PROBE_TABLES),
    client.query(PROBE_SEQUENCES),
    client.query(PROBE_DEFAULT_ACLS),
  ]);

  for (const row of tables.rows) {
    if (CLIENT_GRANTEES.has(row.grantee)) findings.push({ probe: 'table', ...row });
    else warnings.push({ probe: 'table', ...row });
  }
  for (const row of sequences.rows) {
    if (CLIENT_GRANTEES.has(row.grantee)) findings.push({ probe: 'sequence', ...row });
    else warnings.push({ probe: 'sequence', ...row });
  }
  for (const row of defaults.rows) {
    if (CLIENT_GRANTEES.has(row.grantee) && KNOWN_GRANTORS.has(row.grantor)) findings.push({ probe: 'default_acl', ...row });
    else warnings.push({ probe: 'default_acl', ...row });
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ tables: tables.rows, sequences: sequences.rows, defaults: defaults.rows }))
    .digest('hex');

  const report = {
    checkedAt: new Date().toISOString(),
    fingerprint,
    counts: { tables: tables.rows.length, sequences: sequences.rows.length, defaultAcls: defaults.rows.length },
    clean: findings.length === 0,
    findings,
    warnings,
    productionClaim: false,
  };
  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(`d2-verify: catalog fingerprint ${fingerprint}\n`);
    process.stdout.write(`d2-verify: rows — tables ${report.counts.tables}, sequences ${report.counts.sequences}, default ACLs ${report.counts.defaultAcls}\n`);
    for (const f of findings) {
      process.stdout.write(`d2-verify: FINDING ${f.probe} ${f.schema}.${f.table_name ?? f.sequence_name ?? '(default acl)'} grantee=${f.grantee} grantor=${f.grantor} privilege=${f.privilege_type}\n`);
    }
    for (const w of warnings) {
      process.stdout.write(`d2-verify: note ${w.probe} ${w.schema}.${w.table_name ?? w.sequence_name ?? '(default acl)'} grantee=${w.grantee} grantor=${w.grantor} privilege=${w.privilege_type} (not a client grantee — report, do not improvise)\n`);
    }
    process.stdout.write(report.clean ? 'd2-verify: CLEAN — zero client-grantee maintenance/bypass privileges remain\n' : `d2-verify: ${findings.length} finding(s) remain\n`);
  }
  process.exit(findings.length === 0 ? 0 : 1);
} catch (error) {
  process.stderr.write(`d2-verify: connection or query failed: ${error?.message ?? error}\n`);
  process.exit(2);
} finally {
  await client.end().catch(() => {});
}
