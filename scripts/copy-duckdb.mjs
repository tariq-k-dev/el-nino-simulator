/**
 * Stage the DuckDB-WASM *workers* into public/duckdb as static assets.
 *
 * Why not the .wasm files too?
 * ----------------------------
 * Cloudflare Pages rejects any single asset over 25 MiB. DuckDB's WASM binary
 * is 33 MB (eh) / 38 MB (mvp), so shipping it from dist/ fails the deploy
 * outright. The workers are ~800 KB each and must be same-origin (they are
 * instantiated with `new Worker(...)`), so they stay local. The WASM is fetched
 * from a CDN instead - see WASM_BASES / bundlesFor() in src/lib/duckdb.ts.
 *
 * Only single-threaded bundles are staged. COI (threads) needs COOP/COEP
 * response headers that Pages does not send, so selectBundle() would never
 * choose it and it would be 35 MB of dead weight.
 */
import { mkdir, copyFile, readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const dest = path.join(root, 'public', 'duckdb');

const WORKERS = /^duckdb-browser-(mvp|eh)\.worker\.js$/;

async function main() {
  if (!existsSync(src)) {
    console.warn(`[copy-duckdb] skipped: ${src} not found. Run pnpm install first.`);
    return;
  }

  await mkdir(dest, { recursive: true });
  const files = (await readdir(src)).filter((f) => WORKERS.test(f));

  if (files.length === 0) {
    console.warn('[copy-duckdb] no worker assets found - check the package version.');
    return;
  }

  let bytes = 0;
  for (const file of files) {
    await copyFile(path.join(src, file), path.join(dest, file));
    bytes += (await stat(path.join(src, file))).size;
  }

  // Remove stale wasm left behind by an older build of this script, so the
  // 25 MiB Pages guard cannot trip on a file nothing references any more.
  for (const stale of (await readdir(dest)).filter((f) => f.endsWith('.wasm'))) {
    await unlink(path.join(dest, stale));
    console.log(`[copy-duckdb] removed stale ${stale} (wasm is served from the CDN)`);
  }

  console.log(
    `[copy-duckdb] staged ${files.length} workers (${(bytes / 1024).toFixed(0)} KB) -> public/duckdb/`,
  );
}

await main();
