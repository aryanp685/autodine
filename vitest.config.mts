import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // lib/ is the original set: pure logic, no rendering. components/ was
    // added for screens rendered through react-dom/server, which is the only
    // way here to check the markup a signed-in owner sees -- that branch
    // needs a session a plain HTTP request cannot produce. app/ is here for
    // route handlers: the table-card scan is a redirect plus a cookie, and the
    // difference between "browse pass" and "session" is invisible from a unit
    // test of anything else.
    include: ['lib/**/*.test.ts', 'components/**/*.test.tsx', 'app/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // Next aliases this marker itself at build time; Vitest has to be told.
      // See the stub for why this beats mocking the server action per test.
      'server-only': fileURLToPath(new URL('./test-vitest-stubs/server-only.ts', import.meta.url)),
    },
  },
});
