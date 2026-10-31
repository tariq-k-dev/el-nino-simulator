/**
 * Types for scripts/e2e/srcHash.mjs.
 *
 * The implementation is plain ESM so the build stamp can be written by a bare
 * `node` process and recomputed by Playwright's global setup without a TS
 * loader; this declaration is what lets `tests/e2e/global-setup.ts` import it
 * with types intact. Keep the two in step — the unit test
 * (`scripts/e2e/srcHash.test.mjs`) covers the runtime behaviour.
 */

export declare const STAMP_DIR: string;
export declare const STAMP_FILE: string;
export declare const STALE_BUNDLE_MESSAGE: string;

export interface BuildStamp {
  gitHead: string;
  /** sha256 over src/**. Catches "src changed, dist was not rebuilt". */
  srcHash: string;
  /** sha256 over dist/assets/**.js. Catches "a production build replaced dist". */
  distHash: string;
  builtAt: string;
}

export type StampVerdict = { ok: true } | { ok: false; reason: string };

export declare function listFiles(dir: string, root?: string): Promise<string[]>;
export declare function hashSrcTree(repoRoot: string): Promise<string>;
export declare function hashDistAssets(repoRoot: string): Promise<string>;
export declare function makeStamp(repoRoot: string, gitHead: string): Promise<BuildStamp>;
export declare function checkStamp(
  stamp: unknown,
  current: { srcHash: string; distHash: string },
): StampVerdict;
export declare function readStamp(repoRoot: string): Promise<unknown | null>;
