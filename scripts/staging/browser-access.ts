import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
export default async function globalSetup() {
  let base: URL, share: URL;
  try {base=new URL(process.env.E2E_BASE_URL||'https://invalid.invalid');share=new URL(process.env.STAGING_SHARE_URL||'https://invalid.invalid');}
  catch {throw new Error('Staging endpoint/share URL is invalid.');}
  if(base.origin!=='https://new-git-arena-3711df6a-autodine-iamjarvis9896-3988s-projects.vercel.app'||share.origin!==base.origin||!share.searchParams.get('_vercel_share'))throw new Error('Approved staging share access is required.');
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext();
    const page=await context.newPage();
    // No traces/screenshots while establishing access: share credentials must
    // never enter public CI artifacts or error URLs.
    try {await page.goto(share.href,{waitUntil:'domcontentloaded',timeout:60_000});}
    catch {throw new Error('Staging share access navigation failed.');}
    if(new URL(page.url()).origin!==base.origin)throw new Error('Staging access redirected outside the approved origin.');
    const health=await context.request.get(`${base.origin}/api/health`);
    if(health.status()!==200 || !(await health.json()).ok)throw new Error('Staging health is not ready; refusing browser writes.');
    await mkdir('.staging-private',{recursive:true});
    await context.storageState({path:'.staging-private/browser-access.json'});
    await context.close();
  }finally{await browser.close();}
}
