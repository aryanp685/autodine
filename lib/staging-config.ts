/** Optional deployment invariant: a staging preview must never silently inherit
 * production's project URL or legacy service-role JWT. No credential logging. */
export function assertExpectedProject(url: string, secret: string, expected: string | undefined) {
  if (!expected) return;
  let host: string;
  try { const parsed=new URL(url); if(parsed.protocol!=='https:') throw new Error(); host=parsed.hostname; }
  catch { throw new Error('Staging Supabase project URL is invalid.'); }
  if (!/^[a-z0-9]{20}$/.test(expected) || host!==`${expected}.supabase.co`) throw new Error('Staging Supabase project mismatch; refusing to start.');
  if(secret.split('.').length===3){
    try { const payload=JSON.parse(atob(secret.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if(payload.ref!==expected) throw new Error(); }
    catch { throw new Error('Staging Supabase server credential project mismatch.'); }
  }
}
