/**
 * Source-tree hashing for the E2E stale-bundle guard.
 *
 * Why this exists: `pnpm lint` or `pnpm tsc -b` failing mid-chain leaves the
 * previous `dist/` in place, and `playwright.config.ts` serves whatever is in
 * `dist/` on port 4197. A rerun then measures the *previous* build and reports
 * "no change" — which is exactly how N1/N3/N4 were written off as undeliverable
 * defects when the delivery was fine and the bundle was stale. A stamp written at
 * build time and recomputed at run time turns that silent trap into a hard error.
 *
 * The hash covers only the sources that can change rendered pixels or hook shape:
 * every file under `src/` (path + bytes, order-independent via sorting). It
 * deliberately excludes timestamps so a checkout or a copy does not invalidate a
 * bundle, and it is computed identically by the writer (node) and the checker
 * (Playwright's global setup), so the two can never drift.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Written by scripts/write-build-stamp.mjs next to the E2E bundle. */
export const STAMP_DIR = 'dist-e2e';
export const STAMP_FILE = 'build-stamp.json';

/** Guard message the global setup throws. Asserted verbatim by the unit test. */
export const STALE_BUNDLE_MESSAGE = 'STALE E2E BUNDLE';

/**
 * Every file under `dir`, as sorted repo-relative POSIX paths.
 *
 * Sorted so the hash does not depend on readdir order, which differs between
 * filesystems and would make the stamp fail to reproduce on another machine.
 *
 * @param {string} dir absolute directory to walk
 * @param {string} [root] absolute path the returned paths are relative to
 * @returns {Promise<string[]>}
 */
export async function listFiles(dir, root = dir) {
  const out = [];
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  await walk(dir);
  return out.sort();
}

/**
 * sha256 over `src/**`: for each sorted file, its relative path, a NUL, and its
 * bytes. The path is included so a rename changes the hash even when the byte
 * multiset is identical.
 *
 * @param {string} repoRoot absolute repo root
 * @returns {Promise<string>} hex digest
 */
export async function hashSrcTree(repoRoot) {
  const srcDir = path.join(repoRoot, 'src');
  const files = await listFiles(srcDir, srcDir);
  const hash = createHash('sha256');
  for (const rel of files) {
    const bytes = await readFile(path.join(srcDir, rel));
    hash.update(rel);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Build the stamp object a fresh E2E build writes.
 *
 * @param {string} repoRoot
 * @param {string} gitHead commit the tree was built from, or 'unknown'
 * @returns {Promise<{gitHead: string, srcHash: string, builtAt: string}>}
 */
export async function makeStamp(repoRoot, gitHead) {
  return {
    gitHead,
    srcHash: await hashSrcTree(repoRoot),
    builtAt: new Date().toISOString(),
  };
}

/**
 * Compare a stamp against the tree on disk.
 *
 * Returns a verdict rather than throwing, so the unit test can assert on the
 * exact reason and the global setup can decide how loud to be. A missing or
 * unparseable stamp is *not* a pass: "I could not tell" and "it is fresh" must
 * not be the same answer, because the failure this guards is a silent one.
 *
 * @param {{stamp: unknown}} input
 * @param {string} currentSrcHash
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkStamp(stamp, currentSrcHash) {
  if (stamp === null || stamp === undefined) {
    return { ok: false, reason: `no ${STAMP_FILE} — run \`pnpm build:e2e\` first` };
  }
  if (typeof stamp !== 'object') {
    return { ok: false, reason: `${STAMP_FILE} is not an object` };
  }
  const recorded = /** @type {{srcHash?: unknown}} */ (stamp).srcHash;
  if (typeof recorded !== 'string' || recorded.length === 0) {
    return { ok: false, reason: `${STAMP_FILE} has no srcHash` };
  }
  if (recorded !== currentSrcHash) {
    return {
      ok: false,
      reason: `srcHash ${recorded.slice(0, 12)} != tree ${currentSrcHash.slice(0, 12)}`,
    };
  }
  return { ok: true };
}

/**
 * Read and parse the stamp, returning null when it is absent or malformed.
 *
 * @param {string} repoRoot
 * @returns {Promise<unknown | null>}
 */
export async function readStamp(repoRoot) {
  try {
    const text = await readFile(path.join(repoRoot, STAMP_DIR, STAMP_FILE), 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}
