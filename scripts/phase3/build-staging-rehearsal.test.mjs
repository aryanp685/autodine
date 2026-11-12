import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, expectedSignatures, files } from './build-staging-rehearsal.mjs';
const baseline=JSON.parse(await readFile(new URL('./staging-baseline.json',import.meta.url),'utf8'));
test('refuses wrong project/incomplete baseline before reading sources',async()=>{
  const wrongSignature={...baseline,functions:baseline.functions.map((row,index)=>
    index===0?{...row,signature:'place_public_order_attempt(text,jsonb,text,text,uuid,text)'}:row)};
  for(const value of [{...baseline,projectRef:'bdbaqpevwmgdvghszjno'},{...baseline,functions:[]},wrongSignature]) {
    await assert.rejects(build({baseline:value,load:()=>{throw Error('must not read');}}),/baseline/);
  }
});
test('binds exact catalog state before source SQL and preserves reviewed source order',async()=>{
  const result=await build({baseline,load:async file=>`-- sentinel ${file}`});
  assert.equal(result.manifest.length,7);
  assert.deepEqual(baseline.functions.map(row=>row.signature),expectedSignatures);
  assert.ok(result.sql.indexOf('Staging function/ACL/settings drift') < result.sql.indexOf('-- sentinel'));
  assert.ok(result.sql.includes('p.proacl::text'));assert.ok(result.sql.includes('p.proconfig'));
  assert.ok(result.sql.includes("'begin_online_payment'"));
  assert.ok(result.sql.includes("'close_order_session_and_issue_receipt'"));
  assert.ok(!result.sql.includes("'place_public_order_attempt'"));
  let last=-1;
  for(const file of files){const pos=result.sql.indexOf(`-- sentinel ${file}`);assert.ok(pos>last);last=pos;}
  assert.ok(result.sql.endsWith('commit;\n'));
});
test('real candidate includes hardened revoke, both phases and no full-history replay',async()=>{
  const result=await build({baseline});
  assert.ok(result.sql.includes("p.proname = 'place_order'"));
  assert.ok(result.sql.includes('create or replace function public.place_public_order_attempt'));
  assert.equal(result.manifest.filter(row=>row.file.startsWith('20261110')).length,6);
  assert.ok(result.manifest.every(row=>/^[a-f0-9]{64}$/.test(row.sha256)));
});
