import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // lib/ is the original set: pure logic, no rendering. components/ was
    // added for screens rendered through react-dom/server, which is the only
    // way here to check the markup a signed-in owner sees -- that branch
    // needs a session a plain HTTP request cannot produce.
    include: ['lib/**/*.test.ts', 'components/**/*.test.tsx'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
});
