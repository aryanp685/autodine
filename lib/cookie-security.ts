/**
 * Keep bearer cookies Secure in production. The sole exception is the
 * explicitly marked GitHub Actions disposable-Supabase E2E target: its local
 * app is served over HTTP, and Chromium will not send Secure cookies there.
 * The override is inert unless CI is true AND Supabase is on the local stack.
 */
export function shouldUseSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return false;
  if (env.CI !== 'true' || env.SUPABASE_E2E_ALLOW_HTTP_COOKIES !== 'true') return true;

  try {
    const supabase = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? '');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(supabase.hostname);
    return !(supabase.protocol === 'http:' && supabase.port === '54321' && loopback);
  } catch {
    // An incomplete or malformed target must never weaken a production cookie.
    return true;
  }
}
