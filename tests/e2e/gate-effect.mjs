/**
 * Step 1 (2B-gate-close): gate effectiveness.
 *
 * Answers: does the engine really start only after the scene gate opens, and is
 * there any non-boot page traffic still overlapping the boot window?
 *
 *   node tests/e2e/gate-effect.mjs --mbps 0.4
 *   node tests/e2e/gate-effect.mjs --mbps 1.6
 *
 * Requires an E2E build (`pnpm build:e2e`) because it reads the scene gate state
 * and the engine store, which are stripped from production bundles.
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
const MBPS = Number(arg('mbps', '0.4'));

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

await ctx.addInitScript(
  MBPS < 1
    ? `Object.defineProperty(Navigator.prototype,'connection',{get:()=>undefined,configurable:true});`
    : `Object.defineProperty(Navigator.prototype,'connection',{get:()=>({saveData:false,effectiveType:'4g',downlink:10}),configurable:true});`,
);

// Instrument the gate directly: patch whenSceneSettled's resolved value into the
// milestone record as soon as it settles.
await ctx.addInitScript(`
  window.__GATE = { openedAt: null };
  // The gate module is a lazily-imported ESM chunk; poll for the signature on
  // window instead — sceneGate exposes nothing globally, so read the DOM signal
  // plus the resource timeline and cross-check in node.
`);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: MBPS < 1 ? 300 : 150,
  downloadThroughput: (MBPS * 1024 * 1024) / 8,
  uploadThroughput: (MBPS * 1024 * 1024) / 16,
});

const t0 = Date.now();
const ev = [];
const kind = (u) => {
  if (/enso\.csv/.test(u)) return 'csv';
  if (/duckdb-browser-.*worker\.js/.test(u)) return 'worker';
  if (/\.wasm/.test(u)) return 'wasm';
  if (/textures\//.test(u)) return 'texture';
  return 'other';
};
ctx.on('request', (r) => ev.push({ k: kind(r.url()), type: 'req', url: r.url(), t: Date.now() }));
ctx.on('requestfinished', (r) => ev.push({ k: kind(r.url()), type: 'done', url: r.url(), t: Date.now() }));
ctx.on('requestfailed', (r) => ev.push({ k: kind(r.url()), type: 'done', url: r.url(), t: Date.now() }));

await page.goto(BASE, { waitUntil: 'commit' });

// Poll store + gate state until ready/abort.
let terminal = null;
let gateState = null;
while (Date.now() - t0 < 400_000) {
  const s = await page
    .evaluate(() => {
      const st = window.__engineStore?.getSnapshot();
      return st
        ? {
            phase: st.phase,
            loaded: st.phase === 'booting' ? st.loaded : null,
            decoded: st.phase === 'booting' ? st.decoded : null,
            firstEventAt: st.phase === 'booting' ? st.firstEventAt : null,
            startedAt: st.phase === 'booting' ? st.startedAt : null,
            reason: st.phase === 'failed' ? st.reason : null,
          }
        : null;
    })
    .catch(() => null);

  if (s?.phase === 'booting' && s.startedAt !== null && !terminal) {
    gateState = { bootStartedAt: s.startedAt, firstEventAt: s.firstEventAt };
  }
  if (s?.phase === 'failed' || s?.phase === 'ready') {
    terminal = { phase: s.phase, reason: s.reason, atMs: Date.now() - t0 };
    break;
  }
  await page.waitForTimeout(200);
}

// Read both timelines: page resources and the gate's own recorded settle time.
const pageTiming = await page
  .evaluate(() =>
    performance.getEntriesByType('resource').map((r) => ({
      name: r.name.replace(location.origin, '').replace(/^https?:\/\/[^/]+/, ''),
      start: Math.round(r.startTime),
      end: Math.round(r.responseEnd),
      size: r.transferSize,
      initiator: r.initiatorType,
    })),
  )
  .catch(() => []);

const storeAfter = await page.evaluate(() => window.__engineStore?.getSnapshot()).catch(() => null);
const gateSnapshot = await page
  .evaluate(() => window.__sceneGate?.getState?.() ?? null)
  .catch(() => null);
await ctx.close();
await browser.close();

const rel = ev.map((e) => ({ ...e, ms: e.t - t0 }));
const first = (k) => rel.find((e) => e.k === k && e.type === 'req')?.ms ?? null;
const lastDone = (k) => [...rel].reverse().find((e) => e.k === k && e.type === 'done')?.ms ?? null;

// Textures that finished AFTER the worker started = post-gate texture loads.
const workerStart = first('worker');
const texAfterGate = rel.filter((e) => e.k === 'texture' && e.type === 'req' && workerStart && e.ms > workerStart);

// Boot window in page-clock terms.
const bootStartMs = gateState?.bootStartedAt ? gateState.bootStartedAt - t0 : null;
const bootEndMs = terminal?.atMs ?? null;

// Non-boot page traffic overlapping the boot window.
const overlapping = pageTiming.filter(
  (r) =>
    r.size > 0 &&
    !/duckdb-browser-.*worker\.js|enso\.csv|\.wasm/.test(r.name) &&
    bootStartMs !== null &&
    bootEndMs !== null &&
    r.start < bootEndMs &&
    r.end > bootStartMs,
);

const out = {
  profile: `${MBPS} Mbps`,
  terminal,
  lastTextureEndMs: lastDone('texture'),
  workerStartMs: workerStart,
  wasmStartMs: first('wasm'),
  csvStartMs: first('csv'),
  gateBootStartedMs: bootStartMs,
  bootWindowMs: bootStartMs !== null && bootEndMs !== null ? bootEndMs - bootStartMs : null,
  workerAfterLastTexture:
    lastDone('texture') !== null && workerStart !== null ? workerStart >= lastDone('texture') : null,
  texturesRequestedAfterWorkerStart: texAfterGate.map((e) => ({
    name: e.url.split('/').pop(),
    ms: e.ms,
  })),
  nonBootOverlapping: overlapping.map((r) => ({
    name: r.name.split('/').pop(),
    start: r.start,
    end: r.end,
    size: r.size,
  })),
  nonBootOverlapBytes: overlapping.reduce((a, r) => a + r.size, 0),
  storeAfter,
  gate: gateSnapshot,
  /** Gate-open time measured from navigation start. */
  gateOpenedAtMs:
    gateSnapshot?.settledInMs !== null && gateSnapshot?.settledInMs !== undefined
      ? Math.round(gateSnapshot.settledInMs)
      : null,
};

const cacheDir = path.resolve(HERE, '../../.cache');
mkdirSync(cacheDir, { recursive: true });
writeFileSync(path.join(cacheDir, `gate-effect-${MBPS}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
