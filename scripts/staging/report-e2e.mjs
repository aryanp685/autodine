/** Expose actionable assertion diagnostics without uploading credentials,
 * cookies, traces, raw responses or guest-token URLs to public CI artifacts. */
import { readFileSync,existsSync } from 'node:fs';
const path='.staging-private/results.json';
if(!existsSync(path)){console.log('No completed browser report; setup, access or cancellation prevented completion.');process.exit(0);}
const result=JSON.parse(readFileSync(path,'utf8'));
const fixture=existsSync('.staging-private/fixture-env.json')?JSON.parse(readFileSync('.staging-private/fixture-env.json','utf8')):{};
const secrets=[...Object.values(fixture),process.env.STAGING_SHARE_URL,process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY].filter(x=>typeof x==='string'&&x.length>3);
const safe=input=>{
 let s=String(input||'').replace(/\u001b\[[0-9;]*m/g,'');
 for(const secret of secrets)s=s.split(secret).join('[redacted]');
 return s.replace(/https?:\/\/[^\s"'<>]+/g,'[URL redacted]').replace(/(?:access_token|refresh_token|_vercel_share|guest_token|password)[=:]\s*[^\s,;]+/gi,'[credential redacted]').slice(0,1500);
};
const escape=s=>safe(s).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
let failed=0;
function walk(suites){for(const suite of suites||[]){for(const spec of suite.specs||[])for(const test of spec.tests||[]){if(test.status==='unexpected'){failed++;if(failed<=5){const errors=(test.results||[]).flatMap(x=>x.errors||[]).map(x=>x.message||'Assertion failed').join('\n');console.log(`::error title=${escape(spec.title)}::${escape(errors)}`);}}}walk(suite.suites);}}
walk(result.suites);
for(const error of (result.errors||[]).slice(0,3))console.log(`::error title=Staging browser setup::${escape(error.message||'Global setup failed')}`);
console.log(`::notice title=Staging browser counts::${escape(JSON.stringify(result.stats))}`);
if(result.stats.expected===0) {console.error('No verified browser tests; refusing an all-skipped success.');process.exitCode=1;}
