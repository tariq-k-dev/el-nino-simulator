/**
 * Post-build asset guard.
 *
 * Cloudflare Pages hard-fails a deploy when any single file exceeds 25 MiB, and
 * the error surfaces at upload time with no useful pointer to the offender. This
 * runs after `vite build` and fails the build locally instead, naming the file.
 *
 * It also asserts the things the app needs at runtime are present, because a
 * missing DuckDB worker is a blank canvas, not a build error.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
const WARN_AT = 5 * 1024 * 1024;
const TOTAL_BUDGET = 30 * 1024 * 1024;

const REQUIRED = [
  'index.html',
  // The runtime dataset. read_csv() needs no DuckDB extension, so this is the one
  // and only data file the browser loads — it feeds both engines (TsEngine parses
  // the text, DuckEngine reads it via registerFileText).
  'data/enso.csv',
  'duckdb/duckdb-browser-eh.worker.js',
  'duckdb/duckdb-browser-mvp.worker.js',
];

/**
 * Files that must NOT appear in dist/.
 *
 * The parquet is now a repo-only source of truth in data/. Shipping it would
 * mean either a second fetch the app does not use, or a silent regression back
 * to the read_parquet path that needed the extensions.duckdb.org download.
 */
const FORBIDDEN = [
  {
    test: (rel) => rel.endsWith('.parquet'),
    why: 'the parquet is a repo-only source of truth in data/; the browser only loads enso.csv',
  },
];

const MB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function fail(message) {
  console.error(`\n  FAIL  ${message}`);
  process.exitCode = 1;
}

async function main() {
  const files = await walk(dist);
  const rows = await Promise.all(
    files.map(async (file) => ({
      rel: path.relative(dist, file).split(path.sep).join('/'),
      size: (await stat(file)).size,
    })),
  );
  rows.sort((a, b) => b.size - a.size);

  const total = rows.reduce((sum, r) => sum + r.size, 0);

  console.log('\n  Cloudflare Pages asset audit');
  console.log(`  ${'file'.padEnd(46)}      size`);
  console.log(`  ${'-'.repeat(46)} ${'-'.repeat(10)}`);
  for (const { rel, size } of rows.slice(0, 12)) {
    console.log(`  ${rel.padEnd(46)} ${MB(size).padStart(7)} MB`);
  }
  if (rows.length > 12) console.log(`  ... ${rows.length - 12} more files`);
  console.log(`  ${'-'.repeat(46)} ${'-'.repeat(10)}`);
  console.log(`  ${'TOTAL'.padEnd(46)} ${MB(total).padStart(7)} MB`);

  for (const rel of REQUIRED) {
    if (!rows.some((r) => r.rel === rel)) fail(`required asset missing from dist/: ${rel}`);
  }

  // 25 MiB single-file ceiling.
  const oversize = rows.filter((r) => r.size > PAGES_FILE_LIMIT);
  for (const { rel, size } of oversize) {
    fail(
      `${rel} is ${MB(size)} MB - Cloudflare Pages rejects single assets over 25 MiB. Serve it from a CDN (see BUNDLES in src/lib/duckdb.ts).`,
    );
  }

  const forbidden = rows.filter((r) => FORBIDDEN.some((f) => f.test(r.rel)));
  for (const { rel } of forbidden) {
    const rule = FORBIDDEN.find((f) => f.test(rel));
    fail(`forbidden file in dist/: ${rel} — ${rule?.why}`);
  }

  // A local .wasm in dist means the CDN split was reverted by accident.
  const strayWasm = rows.filter((r) => r.rel.endsWith('.wasm'));
  if (strayWasm.length > 0) {
    fail(
      `dist/ contains ${strayWasm.length} .wasm file(s) - DuckDB wasm must come from the CDN, not dist/. Found: ${strayWasm
        .map((w) => w.rel)
        .join(', ')}`,
    );
  }

  const heavy = rows.filter((r) => r.size > WARN_AT && r.size <= PAGES_FILE_LIMIT);
  if (heavy.length > 0) {
    console.log(`\n  note: ${heavy.length} file(s) over 5 MB (acceptable, slower first load)`);
    for (const { rel, size } of heavy) console.log(`        ${rel} - ${MB(size)} MB`);
  }

  if (total > TOTAL_BUDGET) {
    fail(`total dist/ is ${MB(total)} MB, over the ${MB(TOTAL_BUDGET)} MB budget`);
  }

  if (!process.exitCode) {
    console.log(`\n  OK  all ${rows.length} assets within Cloudflare Pages limits\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
