/**
 * Access to the build-time DuckDB manifest, with a staleness guard.
 *
 * The decoded wasm sizes are baked in at build time (see vite.config.ts). If the
 * installed duckdb-wasm version ever differs from the one the build measured —
 * which happens when node_modules is updated without a rebuild — the sizes are
 * wrong and progress percentages would silently drift. Rather than throwing (a
 * broken boot is far worse than a vague progress bar), this reports the manifest
 * as unavailable so the caller can fall back to indeterminate progress.
 */

import * as duckdb from "@duckdb/duckdb-wasm";

export type BundleKind = "eh" | "mvp";

export interface DuckdbManifest {
    /** Decoded size in bytes for the selected bundle, or null if unknown/stale. */
    decodedBytes: number | null;
    /** Version string the sizes were measured against, or null if none. */
    manifestVersion: string | null;
    /** Runtime package version actually in use. */
    runtimeVersion: string;
    /** True when sizes are usable; false when stale or missing. */
    usable: boolean;
}

let cached: DuckdbManifest | null = null;

/**
 * Resolve the decoded byte count for a bundle kind.
 *
 * Returns `usable: false` rather than throwing when the manifest is stale or the
 * bundle kind is unknown, so callers degrade to an indeterminate bar.
 */
export function getDecodedBytes(kind: BundleKind): DuckdbManifest {
    if (cached) return cached;

    const runtimeVersion = duckdb.PACKAGE_VERSION;

    // `typeof` guards because these are compile-time defines: in a context where
    // vite's define step did not run (e.g. a bare vitest import), the identifier
    // is simply absent rather than throwing a ReferenceError.
    const manifestVersion =
        typeof __DUCKDB_VERSION__ === "string" ? __DUCKDB_VERSION__ : null;
    const sizes =
        typeof __DUCKDB_DECODED_BYTES__ === "object"
            ? __DUCKDB_DECODED_BYTES__
            : null;

    if (manifestVersion && manifestVersion !== runtimeVersion) {
        console.warn(
            `[duckdb] build manifest is stale: measured v${manifestVersion}, runtime is v${runtimeVersion}. ` +
                "Rebuild to restore accurate progress. Falling back to indeterminate progress.",
        );
        cached = {
            decodedBytes: null,
            manifestVersion,
            runtimeVersion,
            usable: false,
        };
        return cached;
    }

    const decodedBytes =
        sizes && typeof sizes[kind] === "number" && sizes[kind] > 0
            ? sizes[kind]
            : null;

    if (decodedBytes === null) {
        console.warn(
            `[duckdb] no decoded size for bundle "${kind}"; using indeterminate progress.`,
        );
    }

    cached = {
        decodedBytes,
        manifestVersion,
        runtimeVersion,
        usable: decodedBytes !== null,
    };
    return cached;
}

/** Test seam: clears the memoised manifest. */
export function __resetManifestCache(): void {
    cached = null;
}
