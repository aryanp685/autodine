import http from 'node:http';

const host = process.env.LOCAL_POSTGREST_PROXY_HOST ?? '127.0.0.1';
const port = Number(process.env.LOCAL_POSTGREST_PROXY_PORT ?? 3001);
const upstreamHost = process.env.LOCAL_POSTGREST_UPSTREAM_HOST ?? '127.0.0.1';
const upstreamPort = Number(process.env.LOCAL_POSTGREST_UPSTREAM_PORT ?? 3002);
const allowedOrigin = process.env.LOCAL_POSTGREST_APP_ORIGIN ?? 'http://127.0.0.1:3100';
const prefix = '/rest/v1';

const server = http.createServer((request, response) => {
  const origin = request.headers.origin;
  const originAllowed = origin === allowedOrigin;

  if (request.method === 'OPTIONS') {
    if (origin && !originAllowed) {
      response.writeHead(403).end();
      return;
    }
    if (originAllowed) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Accept, Accept-Language, Accept-Profile, apikey, Authorization, Content-Profile, Content-Type, Prefer, Range, Range-Unit, X-Client-Info, X-Supabase-Api-Version',
    );
    response.setHeader('Access-Control-Expose-Headers', 'Content-Range, Location, Preference-Applied, Content-Profile');
    response.setHeader('Access-Control-Max-Age', '600');
    response.writeHead(204).end();
    return;
  }

  const requestUrl = request.url ?? '/';
  if (
    !requestUrl.startsWith(prefix)
    || (requestUrl.length > prefix.length && !['/', '?'].includes(requestUrl[prefix.length]))
  ) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'Not found' }));
    return;
  }

  const suffix = requestUrl.slice(prefix.length);
  const upstreamPath = suffix === '' || suffix.startsWith('?') ? `/${suffix}` : suffix;
  const headers = { ...request.headers, host: `${upstreamHost}:${upstreamPort}` };
  const upstream = http.request(
    { hostname: upstreamHost, port: upstreamPort, method: request.method, path: upstreamPath, headers },
    (upstreamResponse) => {
      const responseHeaders = { ...upstreamResponse.headers };
      if (originAllowed) {
        responseHeaders['access-control-allow-origin'] = origin;
        responseHeaders['access-control-allow-credentials'] = 'true';
        responseHeaders['access-control-expose-headers'] = 'Content-Range, Location, Preference-Applied, Content-Profile';
        responseHeaders.vary = responseHeaders.vary ? `${responseHeaders.vary}, Origin` : 'Origin';
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (originAllowed) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'Local PostgREST is unavailable.' }));
  });

  request.pipe(upstream);
});

server.listen(port, host, () => {
  console.log(`Local PostgREST path proxy listening on http://${host}:${port}${prefix} → http://${upstreamHost}:${upstreamPort}/`);
});
