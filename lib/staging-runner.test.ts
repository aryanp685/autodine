import { describe,it,expect } from 'vitest';
import { spawnSync } from 'node:child_process';
const base='https://new-git-arena-3711df6a-autodine-iamjarvis9896-3988s-projects.vercel.app';
describe('staging fixture production/write guards',()=>{
 it.each([
  {STAGING_SUPABASE_URL:'',STAGING_SUPABASE_SERVICE_ROLE_KEY:''},
  {STAGING_SUPABASE_URL:'https://production.supabase.co'},
  {STAGING_BASE_URL:'https://production.example'},
  {STAGING_SHARE_URL:'https://production.example/?_vercel_share=placeholder'},
  {STAGING_SHARE_URL:base},
 ])('rejects unsafe setup before fixture provisioning: %j',override=>{
  const result=spawnSync(process.execPath,['scripts/staging/provision-e2e.mjs'],{env:{...process.env,STAGING_SUPABASE_URL:'https://juwyhslzchjevqkdvwjm.supabase.co',STAGING_SUPABASE_SERVICE_ROLE_KEY:'unit-test-placeholder',STAGING_BASE_URL:base,STAGING_SHARE_URL:base+'/?_vercel_share=placeholder',...override},encoding:'utf8',timeout:10_000});
  expect(result.status).toBe(1);expect(result.stderr).toContain('refusing fixture writes');
  expect(result.stdout).not.toContain('fixture provisioned');
 });
});
