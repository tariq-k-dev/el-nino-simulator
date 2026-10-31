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
    // E2E stale-bundle hash lives there. Everything under src/ is app code.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
    reporters: ['default'],
  },
});
