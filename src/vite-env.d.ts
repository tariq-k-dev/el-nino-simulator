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
