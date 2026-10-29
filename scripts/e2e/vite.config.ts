import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Builds the live-DuckDB golden harness with the project's real module
// resolution. Paths are resolved from THIS file, not process.cwd(), so the build
// works no matter where the command is invoked from. Output goes under .cache/,
// never dist/.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export default defineConfig({
  root: here,
  base: '/e2e/',
  build: {
    outDir: resolve(repoRoot, '.cache/e2e-build'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(here, 'golden-harness.html'),
    },
  },
  resolve: {
    alias: { '@': resolve(repoRoot, 'src') },
  },
});
