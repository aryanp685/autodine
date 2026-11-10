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
export async function probe({ target, key, requests = 10, intervalMs = 1000, timeoutMs = 5000, fetchImpl = fetch, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
  const { url, staging } = validateTarget(target);
  if (!Number.isInteger(requests) || requests < 1 || requests > 30) throw new Error('Request budget must be 1..30');
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new Error('Minimum interval is 1000ms');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Timeout must be 1..5000ms');
  if (staging) {
    let publicKey = typeof key === 'string' && key.startsWith('sb_publishable_');
    if (!publicKey && typeof key === 'string') {
      try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* reject */ }
    }
    if (!publicKey) throw new Error('Only a staging publishable/anon key is permitted');
  }
  const times = []; let failure = null;
  for (let i = 0; i < requests; i++) {
    if (i) await pause(intervalMs);
    const start = performance.now();
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: staging ? { apikey: key } : {} });
      // Never retain/print payloads. Abort body consumption after response headers.
      if (response.body) await response.body.cancel();
      if (!response.ok) { failure = { kind: 'http', status: response.status }; break; }
      times.push(performance.now() - start);
    } catch { failure = { kind: 'transport_or_timeout' }; break; }
  }
  times.sort((a, b) => a - b);
  const percentile = p => times.length ? Math.round(times[Math.ceil(times.length * p) - 1] * 100) / 100 : null;
  return { scope: 'GET response headers only; no order/RPC/DB capacity conclusion', requested: requests, successful: times.length, failure, latencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await probe({ target: process.env.PHASE3_TARGET || '', key: process.env.PHASE3_STAGING_PUBLISHABLE_KEY, requests: Number(process.env.PHASE3_REQUESTS || 10) });
    console.log(JSON.stringify(result, null, 2));
    if (result.failure) process.exitCode = 1;
  } catch { console.error('Probe refused or failed. Check approved target, key and bounded request settings; credentials are not logged.'); process.exitCode = 1; }
}
