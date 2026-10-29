/// <reference types="vite/client" />

/**
 * Build-time DuckDB manifest, injected by `define` in vite.config.ts.
 *
 * These are replaced textually during the build, so they are compile-time
 * constants rather than runtime lookups.
 */
declare const __DUCKDB_DECODED_BYTES__: {
  /** Decoded size of duckdb-eh.wasm in bytes. */
  eh: number;
  /** Decoded size of duckdb-mvp.wasm in bytes. */
  mvp: number;
};

/** Version of @duckdb/duckdb-wasm that produced the sizes above. */
declare const __DUCKDB_VERSION__: string;

/**
 * E2E-only build flag.
 *
 * `true` only when the bundle is built with VITE_E2E=1 (see package.json
 * `build:e2e`). Every diagnostic/test hook in the app is wrapped in this check so
 * Rollup's dead-code elimination removes it from a production build.
 */
interface ImportMetaEnv {
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
