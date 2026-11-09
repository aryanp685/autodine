import type { Instrumentation } from 'next';

/** Logs route templates and error identifiers only. Never log a request URL,
 * cookies, authorization headers, order tokens, or user-submitted text. Route
 * handlers with handled failures remain responsible for their own safe logs. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const failure = error instanceof Error ? error as Error & { digest?: string } : null;
  console.error(JSON.stringify({
    event: 'autodine.request_error',
    at: new Date().toISOString(),
    method: request.method,
    route: context.routePath,
    router: context.routerKind,
    digest: failure?.digest || null,
    errorType: failure?.name || 'Error',
  }));
};
