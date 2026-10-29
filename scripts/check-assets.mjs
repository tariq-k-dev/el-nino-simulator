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
import { readFile, readdir, stat } from 'node:fs/promises';
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
 * Diagnostic/test hook names that must NEVER appear in a production bundle.
 *
 * These are gated behind `import.meta.env.VITE_E2E === '1'` in the source, so
 * Rollup's dead-code elimination removes them. If one reappears it means either
 * the gate was dropped or Vite stopped folding the literal — both are silent in
 * the browser and only visible here.
 *
 * `--allow-e2e` skips this check, because a `build:e2e` bundle legitimately
 * contains them.
 */
const FORBIDDEN_HOOKS = [
  '__SCENE_GATE_TIMEOUT_OVERRIDE__',
  '__sceneGate',
  // Per-texture timeline: {requestStart, responseEnd, onLoad} per asset, plus the
  // gate-open reconciliation. Diagnostic only — a visitor has no use for it.
  '__textures',
  '__engineStore',
  '__bootErrors',
  '__camera',
  '__globe',
];

/**
 * Which bundles are ours.
 *
 * The check is scoped to assets/ because the DuckDB worker scripts in
 * duckdb/ are third-party minified Emscripten output: a bare `__gl` appears
 * inside them as part of unrelated internal identifiers, so scanning them
 * produces false positives that would block every build.
 */
const isAppBundle = (rel) => rel.startsWith('assets/') && /\.(js|mjs)$/.test(rel);

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
  const allowE2E = process.argv.includes('--allow-e2e');
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

  // --- test hooks must not ship -------------------------------------------------
  if (!allowE2E) {
    const jsFiles = rows.filter((r) => isAppBundle(r.rel));
    const leaks = [];
    for (const { rel } of jsFiles) {
      const source = await readFile(path.join(dist, rel), 'utf8');
      for (const hook of FORBIDDEN_HOOKS) {
        // Word-boundary match: minified code concatenates many identifiers, so a
        // bare substring test would flag `__gl` inside `__globalX`.
        if (new RegExp(`\\b${hook}\\b`).test(source)) leaks.push({ rel, hook });
      }
    }
    for (const { rel, hook } of leaks) {
      fail(
        `test-only hook "${hook}" is present in ${rel} — it must be behind ` +
          `import.meta.env.VITE_E2E and dead-code-eliminated. Use "pnpm build" ` +
          `(not build:e2e) for a production bundle.`,
      );
    }
    if (leaks.length === 0) {
      console.log(`\n  OK  no test hooks in ${jsFiles.length} production JS assets`);
    }
  } else {
    console.log('\n  note: --allow-e2e, skipping the test-hook check');
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
