/** Bounded baseline probe, NOT a capacity/ordering benchmark. */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
export function validateTarget(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error('Credentials/query/fragment are forbidden');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const staging = url.origin === 'https://juwyhslzchjevqkdvwjm.supabase.co' && url.pathname === '/rest/v1/';
  if ((!local || !['http:', 'https:'].includes(url.protocol)) && !staging) throw new Error('Only loopback or the exact approved staging REST root is allowed');
  return { url, staging };
}
// Read at most 4KiB on failures; return only a fixed category, never payload text.
export async function failureCategory(response) {
  if (!response.body) return 'unclassified';
  const reader=response.body.getReader();
  const chunks=[];let bytes=0;
  try {
    while(bytes<=4096){
      const {done,value}=await reader.read();
      if(done) break;
      bytes+=value.byteLength;
      if(bytes>4096) return 'unclassified';
      chunks.push(value);
    }
    const text=Buffer.concat(chunks).toString('utf8');
    let payload;
    try { payload=JSON.parse(text); } catch { payload={message:text}; }
    if (payload && typeof payload.error === 'object' && payload.error !== null) payload=payload.error;
    const message=typeof payload === 'string' ? payload : typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : '';
    if (/invalid api key/i.test(message)) return 'gateway_api_key_rejected';
    if (/invalid authentication credentials/i.test(message)) return 'gateway_credentials_rejected';
    if (/no api key found in request/i.test(message)) return 'gateway_api_key_missing';
    if (/invalid jwt/i.test(message)) return 'gateway_jwt_rejected';
    const categories={PGRST301:'postgrest_jwt_rejected',PGRST302:'postgrest_missing_auth',PGRST303:'postgrest_claims_rejected','42501':'database_permission_denied'};
    if(Object.hasOwn(categories,payload?.code)) return categories[payload.code];
    if(payload?.message==='Invalid API key') return 'gateway_api_key_rejected';
    if(payload?.message==='No API key found in request') return 'gateway_api_key_missing';
    return 'unclassified';
  } catch { return 'unclassified'; }
  finally { await reader.cancel().catch(()=>{}); }
}
export async function probe({ target, key, requests = 10, intervalMs = 1000, timeoutMs = 5000, fetchImpl = fetch, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
  const { url, staging } = validateTarget(target);
  if (!Number.isInteger(requests) || requests < 1 || requests > 30) throw new Error('Request budget must be 1..30');
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new Error('Minimum interval is 1000ms');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Timeout must be 1..5000ms');
  if (staging) {
    let publicKey = typeof key === 'string' && key.startsWith('sb_publishable_');
    if (!publicKey && typeof key === 'string') {
      try {
        const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
        publicKey = key.split('.').length === 3 && payload.role === 'anon' && payload.ref === 'juwyhslzchjevqkdvwjm';
      } catch { /* reject */ }
    }
    if (!publicKey) throw new Error('Only a staging publishable/anon key is permitted');
  }
  const times = []; let failure = null;
  for (let i = 0; i < requests; i++) {
    if (i) await pause(intervalMs);
    const start = performance.now();
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: staging ? { apikey: key, ...(key.startsWith('sb_publishable_') ? {} : { Authorization: `Bearer ${key}` }) } : {} });
      if (!response.ok) { failure = { kind: 'http', status: response.status, category: await failureCategory(response) }; break; }
      // Successful response timing remains headers-only; never log payloads.
      if (response.body) await response.body.cancel();
      times.push(performance.now() - start);
    } catch { failure = { kind: 'transport_or_timeout' }; break; }
  }
  times.sort((a, b) => a - b);
  const percentile = p => times.length ? Math.round(times[Math.ceil(times.length * p) - 1] * 100) / 100 : null;
  return { scope: 'GET response headers only; no order/RPC/DB capacity conclusion', requested: requests, successful: times.length, failure, latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) } };
}
/** Allowlisted annotation only: never interpolate errors, URLs, keys or payloads. */
export function resultAnnotation(result) {
  if (result.failure?.kind === 'http') {
    const status = result.failure.status;
    const allowed=['postgrest_jwt_rejected','postgrest_missing_auth','postgrest_claims_rejected','database_permission_denied','gateway_api_key_rejected','gateway_api_key_missing','gateway_credentials_rejected','gateway_jwt_rejected'];
    const category=allowed.includes(result.failure.category)?result.failure.category:'unclassified';
    return `::error::Phase3 baseline stopped: HTTP ${Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown'}, category=${category}. No further requests sent.`;
  }
  if (result.failure) return '::error::Phase3 baseline stopped: transport, timeout or redirect failure. No further requests sent.';
  const safe = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 'unavailable';
  return `::notice::Phase3 HTTP-root baseline completed: successful=${safe(result.successful)}, p50_ms=${safe(result.latencyMs?.p50)}, p95_ms=${safe(result.latencyMs?.p95)}, max_ms=${safe(result.latencyMs?.max)}. Not an ordering/capacity benchmark.`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await probe({ target: process.env.PHASE3_TARGET || '', key: process.env.PHASE3_STAGING_PUBLISHABLE_KEY, requests: Number(process.env.PHASE3_REQUESTS || 10) });
    console.log(JSON.stringify(result, null, 2));
    console.error(resultAnnotation(result));
    if (result.failure) process.exitCode = 1;
  } catch { console.error('::error::Phase3 probe configuration rejected before requests: check approved target, public staging key type/project and bounded settings. Credentials are not logged.'); process.exitCode = 1; }
}
