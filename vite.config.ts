import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Decoded .wasm sizes, read from disk at build time.
 *
 * Why this exists: `InstantiationProgress.bytesTotal` is the *brotli-encoded*
 * transfer size, while `bytesLoaded` counts *decoded* bytes. Dividing one by the
 * other reports ~500% and never reaches 100% (measured in ENGINE_BOOT_SPIKE.md).
 * To show honest progress we need the decoded size as a constant. Reading it
 * from node_modules at build time keeps it exact and avoids shipping a big wasm
 * just to stat it in the browser.
 *
 * Only file sizes are read — no module is imported, so this costs a stat() pair
 * per build and nothing at runtime.
 */
function duckdbManifest() {
  // Resolve via an exported entry, not `./package.json`: duckdb-wasm's `exports`
  // map does not expose its package.json, so require.resolve of that path throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED. This walks two levels up from dist/.
  const entry = require.resolve('@duckdb/duckdb-wasm/dist/duckdb-browser.mjs');
  const distDir = dirname(entry);

  const pkg = JSON.parse(readFileSync(resolve(distDir, '..', 'package.json'), 'utf8')) as {
    version: string;
  };

  const decoded = {
    eh: statSync(resolve(distDir, 'duckdb-eh.wasm')).size,
    mvp: statSync(resolve(distDir, 'duckdb-mvp.wasm')).size,
  };

  return { version: pkg.version, decoded };
}

const manifest = duckdbManifest();

export default defineConfig({
  plugins: [react()],
  define: {
    // Replaced textually at build. Declared in src/vite-env.d.ts.
    __DUCKDB_DECODED_BYTES__: JSON.stringify(manifest.decoded),
    __DUCKDB_VERSION__: JSON.stringify(manifest.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // DuckDB-WASM ships prebuilt workers; keeping them as external assets avoids
  // Vite trying to re-bundle the Emscripten glue.
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
