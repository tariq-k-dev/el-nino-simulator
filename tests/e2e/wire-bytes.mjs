/**
 * Step 2 (2B-gate-close): MEASURED wire bytes at abort.
 *
 * Why this exists: the previous 1.58 MB figure was inferred by multiplying the
 * store's decoded byte count by a uniform 0.1976 brotli ratio. That is wrong for a
 * streaming download, because the ratio is not uniform across the file and the
 * abort happens mid-stream.
 *
 * Method: point the app at the LOCAL brotli server for the wasm via
 * VITE_DUCKDB_WASM_BASE, and have that server count bytes actually flushed to the
 * socket. A client abort tears the socket down, so the counter stops exactly where
 * the transfer stopped.
 *
 *   node tests/e2e/wire-bytes.mjs --mbps 0.4 --runs 3
 *   node tests/e2e/wire-bytes.mjs --mbps 0.4 --runs 3 --stub
 *
 * Requires `pnpm build:e2e` with VITE_DUCKDB_WASM_BASE=http://localhost:4199/duckdb
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 4199);
const BASE = `http://localhost:${PORT}/?debug`;

const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const has = (n) => process.argv.includes(`--${n}`);

const MBPS = Number(arg('mbps', '0.4'));
const RUNS = Number(arg('runs', '3'));
const STUB = has('stub');

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stat = (xs) =>
  xs.length ? { min: +Math.min(...xs).toFixed(2), median: +median(xs).toFixed(2), max: +Math.max(...xs).toFixed(2) } : null;

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function oneRun() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  if (STUB) {
    await ctx.route(/\/textures\/.*\.(jpg|jpeg|png)$/i, (r) =>
      r.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      }),
    );
  }

  const page = await ctx.newPage();
  await ctx.addInitScript(
    `Object.defineProperty(Navigator.prototype,'connection',{get:()=>undefined,configurable:true});`,
  );

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 300,
    downloadThroughput: (MBPS * 1024 * 1024) / 8,
    uploadThroughput: (MBPS * 1024 * 1024) / 16,
  });

  // Fresh server-side counter for this run.
  await page.request.get(`${BASE.split('?')[0]}_serverreset`).catch(() => {});

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'commit' });

  let terminal = null;
  let loadedAtAbort = 0;
  let firstEventAt = null;
  while (Date.now() - t0 < 400_000) {
    const s = await page
      .evaluate(() => {
        const st = window.__engineStore?.getSnapshot();
        return st
          ? {
              phase: st.phase,
              loaded: st.phase === 'booting' ? st.loaded : null,
              firstEventAt: st.phase === 'booting' ? st.firstEventAt : null,
              reason: st.phase === 'failed' ? st.reason : null,
            }
          : null;
      })
      .catch(() => null);

    if (s?.phase === 'booting') {
      loadedAtAbort = s.loaded ?? 0;
      firstEventAt = s.firstEventAt ?? firstEventAt;
    }
    if (s?.phase === 'failed' || s?.phase === 'ready') {
      terminal = { phase: s.phase, reason: s.reason, atMs: Date.now() - t0 };
      break;
    }
    await page.waitForTimeout(200);
  }

  const abortAtMs = Date.now() - t0;
  const abortAfterFirstEvent = firstEventAt ? abortAtMs - (firstEventAt - t0) : null;

  // Read the server's own byte counter for the wasm.
  const serverLog = await page
    .request
    .get(`http://localhost:${PORT}/_serverlog`)
    .then((r) => r.json())
    .catch(() => []);

  const wasmEntries = Array.isArray(serverLog) ? serverLog.filter((e) => /\.wasm$/.test(e.url ?? '')) : [];
  const wireBytes = wasmEntries.reduce((a, e) => a + (e.bytesSent ?? 0), 0);

  await ctx.close();

  return {
    phase: terminal?.phase ?? 'timeout',
    reason: terminal?.reason ?? null,
    abortAfterFirstEventMs: abortAfterFirstEvent === null ? null : Math.round(abortAfterFirstEvent),
    decodedAtAbortMB: +(loadedAtAbort / 1048576).toFixed(2),
    wireBytesSent: wireBytes,
    wireMB: +(wireBytes / 1048576).toFixed(2),
    ratio: loadedAtAbort > 0 ? +(wireBytes / loadedAtAbort).toFixed(4) : null,
    wasmEntries,
  };
}

const runs = [];
for (let i = 0; i < RUNS; i += 1) runs.push(await oneRun());

await browser.close();

const decoded = runs.map((r) => r.decodedAtAbortMB);
const wire = runs.map((r) => r.wireMB);
const ratios = runs.map((r) => r.ratio).filter((x) => x !== null);

const out = {
  profile: `${MBPS} Mbps`,
  stub: STUB,
  runs: RUNS,
  phases: runs.map((r) => r.phase),
  decodedAtAbortMB: stat(decoded),
  wireMB: stat(wire),
  ratio: stat(ratios),
  abortAfterFirstEventMs: stat(runs.map((r) => r.abortAfterFirstEventMs).filter((x) => x !== null)),
  raw: runs,
};

const cacheDir = path.resolve(HERE, '../../.cache');
mkdirSync(cacheDir, { recursive: true });
writeFileSync(
  path.join(cacheDir, `wire-${MBPS}-${STUB ? 'stub' : 'textured'}.json`),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
