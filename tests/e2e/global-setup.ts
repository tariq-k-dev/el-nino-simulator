/**
 * Playwright global setup: refuse to run against a stale bundle.
 *
 * The trap this closes: `playwright.config.ts` serves whatever sits in `dist/` on
 * port 4197. `pnpm build:e2e` chains through `pnpm tsc -b`, so when typecheck or
 * lint fails the chain stops and `dist/` keeps the previous build — and the spec
 * run then measures the *previous* source tree and reports "no change". That is
 * how N1/N3/N4 were recorded as undeliverable defects when the delivery was fine
 * and the bundle was old. A stamp written at build time and recomputed here turns
 * the silent case into a named failure.
 *
 * The check runs before any worker starts, so a stale bundle costs ~1 s instead
 * of a five-minute pixel run that measures the wrong code.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STALE_BUNDLE_MESSAGE, STAMP_DIR, STAMP_FILE, checkStamp, hashSrcTree } from '../../scripts/e2e/srcHash.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function globalSetup(): Promise<void> {
  const stampPath = path.join(repoRoot, STAMP_DIR, STAMP_FILE);
  const currentSrcHash = await hashSrcTree(repoRoot);

  let raw: string;
  try {
    raw = await readFile(stampPath, 'utf8');
  } catch {
    throw new Error(
      `${STALE_BUNDLE_MESSAGE}: ${STAMP_DIR}/${STAMP_FILE} is missing. ` +
        `Run \`pnpm build:e2e\` (not \`pnpm build\`, which strips the VITE_E2E hooks) ` +
        `and then \`pnpm e2e:look\`.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${STALE_BUNDLE_MESSAGE}: ${STAMP_DIR}/${STAMP_FILE} is not valid JSON.`);
  }

  const verdict = checkStamp(parsed, currentSrcHash);
  if (!verdict.ok) {
    throw new Error(
      `${STALE_BUNDLE_MESSAGE}: ${verdict.reason}. The bundle in dist/ does not match the ` +
        `current src/ tree, so any pixel measurement from it is untrusted. Re-run \`pnpm build:e2e\`.`,
    );
  }

  const stamp = parsed as { gitHead?: string; srcHash?: string };
  console.log(
    `[e2e] bundle stamp OK — srcHash ${String(stamp.srcHash).slice(0, 12)} ` +
      `(built from ${String(stamp.gitHead).slice(0, 7)})`,
  );
}
