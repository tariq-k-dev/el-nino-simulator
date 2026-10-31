/**
 * Write `dist-e2e/build-stamp.json` after a successful `build:e2e`.
 *
 * The stamp is the contract between "the bundle in dist/ was just built from this
 * tree" and "the spec run is allowed to measure it". `tests/e2e/global-setup.ts`
 * recomputes `srcHash` and refuses to run when the two disagree — see
 * scripts/e2e/srcHash.mjs for why the stale-dist trap needed a hard failure.
 *
 * Run as the last link of the `build:e2e` chain, so a failed build never leaves a
 * stamp claiming success.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAMP_DIR, STAMP_FILE, makeStamp } from './e2e/srcHash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** HEAD is informational — it tells a reader which commit produced the bundle. */
function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const stamp = await makeStamp(root, gitHead());
const dir = path.join(root, STAMP_DIR);
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');

console.log(
  `[build-stamp] ${STAMP_DIR}/${STAMP_FILE} srcHash=${stamp.srcHash.slice(0, 12)} head=${stamp.gitHead.slice(0, 7)}`,
);
