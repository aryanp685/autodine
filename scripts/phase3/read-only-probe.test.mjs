import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe, validateTarget } from './read-only-probe.mjs';
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
