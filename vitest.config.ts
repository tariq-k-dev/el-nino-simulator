import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // scripts/**/*.test.mjs: build-time guards whose failure mode is silence — the
    // E2E stale-bundle hash lives there. tests/e2e/look/acquire.test.ts: the
    // acquisition ordering contract, which must run in the gate rather than only
    // inside a five-minute pixel suite. Everything under src/ is app code.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'scripts/**/*.test.mjs',
      'tests/e2e/**/*.test.ts',
    ],
    reporters: ['default'],
  },
});
