import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe, validateTarget, resultAnnotation, failureCategory } from './read-only-probe.mjs';
test('rejects production, external hosts, alternate staging paths and embedded credentials', () => {
  for (const target of ['https://bdbaqpevwmgdvghszjno.supabase.co/rest/v1/', 'https://example.com/', 'https://juwyhslzchjevqkdvwjm.supabase.co/rest/v1/orders', 'http://user:pass@localhost/', 'http://localhost/?key=secret', 'ftp://localhost/']) assert.throws(() => validateTarget(target));
});
test('accepts exact staging root and loopback', () => {
  assert.equal(validateTarget('https://juwyhslzchjevqkdvwjm.supabase.co/rest/v1/').staging, true);
  assert.equal(validateTarget('http://127.0.0.1:3000/').staging, false);
});
test('enforces request bounds before fetching', async () => {
  for (const requests of [0, 31, 1.5]) await assert.rejects(probe({target:'http://localhost/',requests}));
  await assert.rejects(probe({target:'http://localhost/',intervalMs:1}));
  await assert.rejects(probe({target:'https://juwyhslzchjevqkdvwjm.supabase.co/rest/v1/'}));
});
test('uses GET, forbids redirect following, spaces requests and emits no payload', async () => {
  let fetched=0, waited=0;
  const result=await probe({target:'http://localhost/',requests:3,pause:async()=>{waited++;},fetchImpl:async(_url,options)=>{
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');fetched++;return new Response('private payload');
  }});
  assert.equal(fetched,3);assert.equal(waited,2);assert.equal(result.successful,3);assert.equal(result.failure,null);
  assert.ok(!JSON.stringify(result).includes('private payload'));
});
test('stops on first HTTP or transport failure without logging details', async () => {
  let fetched=0;
  const result=await probe({target:'http://localhost/',fetchImpl:async()=>{fetched++;return new Response('',{status:429});}});
  assert.equal(fetched,1);assert.equal(result.failure.status,429);
  const failed=await probe({target:'http://localhost/',fetchImpl:async()=>{throw new Error('secret');}});
  assert.equal(failed.failure.kind,'transport_or_timeout');assert.ok(!JSON.stringify(failed).includes('secret'));
});

test('rejects privileged staging credentials before sending any request', async () => {
  for (const key of ['sb_secret_not-allowed', `a.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.b`]) {
    await assert.rejects(probe({target:'https://juwyhslzchjevqkdvwjm.supabase.co/rest/v1/',key,fetchImpl:()=>{throw new Error('must not fetch');}}), /publishable\/anon/);
  }
});

test('real loopback redirect is not followed', async () => {
  const { createServer } = await import('node:http');
  let reachedDestination=false;
  const server=createServer((req,res)=>{
    if(req.url==='/destination'){reachedDestination=true;res.end('private');}
    else {res.writeHead(302,{Location:'/destination'});res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await probe({target:`http://127.0.0.1:${server.address().port}/`,requests:1});
    assert.equal(result.failure.kind,'transport_or_timeout');
    assert.equal(reachedDestination,false);
  } finally { await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}); }
});

test('real loopback timeout aborts a stalled response', async () => {
  const { createServer } = await import('node:http');
  const server=createServer(()=>{});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await probe({target:`http://127.0.0.1:${server.address().port}/`,requests:1,timeoutMs:50});
    assert.equal(result.successful,0);
    assert.equal(result.failure.kind,'transport_or_timeout');
  } finally { await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}); }
});


test('staging JWT from another project is refused before network access', async () => {
  const key=`a.${Buffer.from(JSON.stringify({role:'anon',ref:'bdbaqpevwmgdvghszjno'})).toString('base64url')}.b`;
  await assert.rejects(probe({target:'https://juwyhslzchjevqkdvwjm.supabase.co/rest/v1/',key,fetchImpl:()=>{throw new Error('must not fetch');}}), /publishable\/anon/);
});


test('failure annotations allowlist HTTP status/category and never interpolate untrusted data', () => {
  const secret='SECRET\n::notice::injected';
  assert.equal(resultAnnotation({failure:{kind:'http',status:401,body:secret}}),'::error::Phase3 baseline stopped: HTTP 401, category=unclassified. No further requests sent.');
  assert.ok(!resultAnnotation({failure:{kind:'http',status:secret}}).includes('SECRET'));
  assert.ok(!resultAnnotation({failure:{kind:secret,message:secret}}).includes('SECRET'));
});
test('success annotation contains finite metrics only, not payloads or URLs', () => {
  const result={successful:10,latencyMs:{p50:12,p95:34,max:34},payload:'SECRET'};
  assert.match(resultAnnotation(result),/successful=10, p50_ms=12, p95_ms=34/);
  assert.ok(!resultAnnotation({...result,latencyMs:{p50:'SECRET',p95:Infinity,max:NaN}}).includes('SECRET'));
});

test('legacy staging anon JWT uses matching bearer header; short publishable key does not', async () => {
  const jwt=`a.${Buffer.from(JSON.stringify({role:'anon',ref:'juwyhslzchjevqkdvwjm'})).toString('base64url')}.b`;
  for(const key of [jwt,'sb_publishable_test']) {
    let sent;
    const result=await probe({target:'https://juwyhslzchjevqkdvwjm.supabase.co/rest/v1/',key,requests:1,fetchImpl:async(_url,options)=>{
      sent=options.headers;
      return new Response('');
    }});
    assert.equal(result.failure,null);
    assert.equal(sent.apikey,key);
    assert.equal(sent.Authorization,key===jwt?`Bearer ${jwt}`:undefined);
  }
});


test('failure body classification retains no raw message, hint, token or oversized payload', async () => {
  assert.equal(await failureCategory(new Response(JSON.stringify({code:'PGRST301',message:'PRIVATE TOKEN'}))),'postgrest_jwt_rejected');
  assert.equal(await failureCategory(new Response(JSON.stringify({message:'Invalid API key'}))),'gateway_api_key_rejected');
  assert.equal(await failureCategory(new Response(JSON.stringify({message:'PRIVATE TOKEN',code:'PRIVATE'}))),'unclassified');
  assert.equal(await failureCategory(new Response('x'.repeat(5000))),'unclassified');
  assert.equal(await failureCategory(new Response('not json')),'unclassified');
});
