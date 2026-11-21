import { expect,it } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
it('publishes useful failures without fixture credentials or share URLs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'autodine-report-test-'));
 try{
  mkdirSync(join(dir,'.staging-private'));
  writeFileSync(join(dir,'.staging-private/fixture-env.json'),JSON.stringify({E2E_OWNER_PASSWORD:'fake-test-secret',E2E_OWNER_EMAIL:'fake@example.invalid'}));
  writeFileSync(join(dir,'.staging-private/results.json'),JSON.stringify({stats:{expected:0,unexpected:1},errors:[{message:'Global navigation to https://example.invalid/?_vercel_share=private-token failed'}],suites:[{specs:[{title:'sign in',tests:[{status:'unexpected',results:[{errors:[{message:'Expected visible button; fake-test-secret fake@example.invalid https://example.invalid/?t=guest-token password=do-not-print'}]}]}]}]}]}));
  const run=spawnSync(process.execPath,[resolve('scripts/staging/report-e2e.mjs')],{cwd:dir,encoding:'utf8'});
  expect(run.status).toBe(1);
  expect(run.stdout).toContain('Expected visible button');
  for(const secret of ['fake-test-secret','fake@example.invalid','private-token','guest-token','do-not-print'])expect(run.stdout).not.toContain(secret);
  expect(run.stdout).toContain('Staging browser setup');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
