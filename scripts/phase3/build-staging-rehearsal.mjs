/** Generate local rehearsal SQL only. Never connects to or applies to a DB. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const files = [
  '20261109000400_order_write_boundary.sql', // Reassert hardened overload revoke.
  '20261110000100_counter_payment_lock_order.sql',
  '20261110000200_financial_session_serialization.sql',
  '20261110000300_shared_wifi_scan_limits.sql',
  '20261110000400_durable_order_attempt_budget.sql',
  '20261110000950_online_payment_attempt_uniqueness.sql',
  '20261110001210_checkout_outstanding_guard.sql',
];
export const expectedSignatures = [
  'begin_online_payment(text,text,text,uuid,uuid,bigint)',
  'cancel_order(uuid,uuid,text)',
  'close_order_session_and_issue_receipt(uuid)',
  'open_table_session(text,text)',
  'operational_schema_readiness()',
  'place_public_order(text,jsonb,text,text,uuid,text)',
  'record_counter_payment(text,uuid,text,bigint,uuid)',
  'set_order_line_quantities(uuid,jsonb,uuid)',
  'settle_online_payment(text,text,text,bigint)',
];
const names = expectedSignatures.map(signature => signature.slice(0, signature.indexOf('(')));
const literal = value => "'" + value.replaceAll("'", "''") + "'";
export async function build({ baseline, load = file => readFile(`supabase/migrations/${file}`, 'utf8') }) {
  const actualSignatures = baseline.functions?.map(row => row.signature);
  if (baseline.projectRef !== 'juwyhslzchjevqkdvwjm'
      || JSON.stringify(actualSignatures) !== JSON.stringify(expectedSignatures)) {
    throw new Error('Wrong staging baseline signatures');
  }
  const expected = literal(JSON.stringify(baseline.functions));
  let sql = `-- LOCAL REHEARSAL CANDIDATE ONLY; not a production/hosted rollout command.\n-- Project identity must be checked outside SQL. A GUC is a safety tripwire, not identity proof.\nbegin;\nset local lock_timeout = '5s';\nset local statement_timeout = '90s';\ndo $$\ndeclare observed jsonb;\nbegin\n if current_setting('autodine.rehearsal_project_ref',true) is distinct from 'juwyhslzchjevqkdvwjm' then\n   raise exception 'Explicit isolated staging rehearsal context required';\n end if;\n select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body_hash',md5(p.prosrc),'acl',p.proacl::text,'settings',p.proconfig) order by p.oid::regprocedure::text)\n into observed from pg_proc p join pg_namespace n on n.oid=p.pronamespace\n where n.nspname='public' and p.proname in (${names.map(literal).join(',')});\n if observed is distinct from ${expected}::jsonb then\n   raise exception 'Staging function/ACL/settings drift: re-review required';\n end if;\nend;\n$$;\n`;
  const manifest=[];
  for (const file of files) {
    const source=await load(file);
    const sha256=createHash('sha256').update(source).digest('hex');
    manifest.push({file,sha256});sql+=`\n-- SOURCE ${file} SHA256 ${sha256}\n${source}\n`;
  }
  sql+='\ncommit;\n';
  return {sql,manifest};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Provide a local output SQL path; no execution is supported');
  const baseline=JSON.parse(await readFile('scripts/phase3/staging-baseline.json','utf8'));
  const {sql,manifest}=await build({baseline});
  await writeFile(process.argv[2],sql,{mode:0o600});
  await writeFile(`${process.argv[2]}.manifest.json`,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(`Prepared ${manifest.length} source files for local rehearsal. No DB contacted.`);
}
