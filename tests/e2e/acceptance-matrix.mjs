/**
 * Step 4 acceptance matrix.
 *
 * Runs a given network profile N times and reports min/median/max for the metrics
 * the brief specifies. Each profile is one browser context, closed before the next.
 *
 *   node tests/e2e/acceptance-matrix.mjs --mbps 1.6 --runs 3
 *   node tests/e2e/acceptance-matrix.mjs --mbps 0.4 --runs 3 --stub
 *   node tests/e2e/acceptance-matrix.mjs --mbps 1.0 --runs 3
 *   node tests/e2e/acceptance-matrix.mjs --hanging-textures --gate-ms 4000
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 4199);
const BASE = `http://localhost:${PORT}/?debug`;

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const MBPS = Number(arg('mbps', '0.4'));
const RUNS = Number(arg('runs', '3'));
const STUB = has('stub');
const HANGING = has('hanging-textures');
const GATE_MS = arg('gate-ms') ? Number(arg('gate-ms')) : null;
const DISABLE_WEBGL = has('no-webgl');
const LABEL = arg('label', `${MBPS} Mbps${STUB ? ' stub' : ''}${HANGING ? ' hanging-textures' : ''}`);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stats = (xs) =>
  xs.length === 0
    ? null
    : { min: Math.round(Math.min(...xs)), median: Math.round(median(xs)), max: Math.round(Math.max(...xs)) };

const browser = await chromium.launch({
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    ...(DISABLE_WEBGL ? ['--disable-webgl', '--disable-3d-apis'] : []),
  ],
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

  if (HANGING) {
    // Never settle the texture requests: the scene gate must time out and let the
    // engine boot anyway.
    await ctx.route(/\/textures\/.*\.(jpg|jpeg|png)$/i, () => {
      /* deliberately never fulfill */
    });
  }

  const page = await ctx.newPage();

  // Optional gate-timeout override so the hanging case does not need 30 s.
  if (GATE_MS !== null) {
    await ctx.addInitScript(`
      window.__SCENE_GATE_TIMEOUT_OVERRIDE__ = ${GATE_MS};
    `);
  }

  await ctx.addInitScript(
    MBPS < 1
      ? `Object.defineProperty(Navigator.prototype,'connection',{get:()=>undefined,configurable:true});`
      : `Object.defineProperty(Navigator.prototype,'connection',{get:()=>({saveData:false,effectiveType:'4g',downlink:10}),configurable:true});`,
  );

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
  const track = (u) => {
    if (/enso\.csv/.test(u)) return 'csv';
    if (/duckdb-browser-.*worker\.js/.test(u)) return 'worker';
    if (/\.wasm/.test(u)) return 'wasm';
    if (/textures\//.test(u)) return 'texture';
    return null;
  };
  ctx.on('request', (r) => { const k = track(r.url()); if (k) ev.push({ k, type: 'req', t: Date.now(), url: r.url() }); });
  ctx.on('requestfinished', (r) => { const k = track(r.url()); if (k) ev.push({ k, type: 'done', t: Date.now(), url: r.url() }); });
  ctx.on('requestfailed', (r) => { const k = track(r.url()); if (k) ev.push({ k, type: 'done', t: Date.now(), url: r.url() }); });

  await page.goto(BASE, { waitUntil: 'commit' });

  // Poll the store for the real boot state.
  const series = [];
  let terminal = null;
  const deadline = Date.now() + 400_000;

  while (Date.now() < deadline) {
    const snap = await page
      .evaluate(() => {
        const s = window.__engineStore?.getSnapshot();
        if (!s) return null;
        return {
          phase: s.phase,
          loaded: s.phase === 'booting' ? s.loaded : null,
          decoded: s.phase === 'booting' ? s.decoded : null,
          firstEventAt: s.phase === 'booting' ? s.firstEventAt : null,
          reason: s.phase === 'failed' ? s.reason : null,
        };
      })
      .catch(() => null);

    if (snap?.phase === 'booting' && snap.firstEventAt !== null) {
      series.push({ t: Date.now(), firstEventAt: snap.firstEventAt, loaded: snap.loaded ?? 0 });
    }
    if (snap?.phase === 'failed' || snap?.phase === 'ready') {
      terminal = { phase: snap.phase, reason: snap.reason, atMs: Date.now() - t0 };
      break;
    }
    await page.waitForTimeout(250);
  }

  const rel = ev.map((e) => ({ ...e, ms: e.t - t0 }));
  const firstReq = (k) => rel.find((e) => e.k === k && e.type === 'req')?.ms ?? null;
  const lastDone = (k) => [...rel].reverse().find((e) => e.k === k && e.type === 'done')?.ms ?? null;

  // The WASM is fetched from INSIDE the worker, so it never appears in the page's
  // PerformanceResourceTiming — only the network events collected above see it.
  const wasmDone = rel.filter((e) => e.k === 'wasm' && e.type === 'done');
  const wasmReq = rel.filter((e) => e.k === 'wasm' && e.type === 'req');

  // Bytes are not attributable per-URL at the network-event level here, so report
  // the request count plus whether any completed before the terminal event. The
  // <1.5 MB assertion in the brief is about payload progress, which the store's
  // `loaded` counter reflects directly; capture that too.
  const loadedAtAbort = series.length > 0 ? series[series.length - 1].loaded : 0;

  const hosts = [...new Set(wasmReq.map((e) => e.url).filter(Boolean))];

  const firstEventAtMs = series[0]?.firstEventAt ?? null;
  const abortAfterFirstEvent =
    terminal && firstEventAtMs ? terminal.atMs - (firstEventAtMs - t0) : null;

  await ctx.close();

  return {
    phase: terminal?.phase ?? 'timeout',
    reason: terminal?.reason ?? null,
    terminalMs: terminal?.atMs ?? null,
    abortAfterFirstEventMs: abortAfterFirstEvent,
    firstEventAtMs,
    textureLastEndMs: lastDone('texture'),
    textureFirstStartMs: firstReq('texture'),
    workerStartMs: firstReq('worker'),
    wasmStartMs: firstReq('wasm'),
    csvStartMs: firstReq('csv'),
    wasmRequestCount: wasmReq.length,
    wasmCompleted: wasmDone.length,
    loadedAtAbortMB: +(loadedAtAbort / 1048576).toFixed(2),
    wasmHosts: hosts,
  };
}

const runs = [];
for (let i = 0; i < RUNS; i += 1) {
  runs.push(await oneRun());
}

await browser.close();

const phases = runs.map((r) => r.phase);
const summary = {
  label: LABEL,
  runs: RUNS,
  stub: STUB,
  hangingTextures: HANGING,
  webglDisabled: DISABLE_WEBGL,
  phases,
  allSameOutcome: phases.every((p) => p === phases[0]),
  terminalMs: stats(runs.map((r) => r.terminalMs).filter((x) => x !== null)),
  abortAfterFirstEventMs: stats(runs.map((r) => r.abortAfterFirstEventMs).filter((x) => x !== null)),
  textureLastEndMs: stats(runs.map((r) => r.textureLastEndMs).filter((x) => x !== null)),
  workerStartMs: stats(runs.map((r) => r.workerStartMs).filter((x) => x !== null)),
  wasmHosts: [...new Set(runs.flatMap((r) => r.wasmHosts.map((u) => { try { return new URL(u).host; } catch { return u; } })))],
  hostCount: Math.max(...runs.map((r) => new Set(r.wasmHosts.map((u) => { try { return new URL(u).host; } catch { return u; } })).size), 0),
  wasmRequestCount: stats(runs.map((r) => r.wasmRequestCount)),
  loadedAtAbortMB: stats(runs.map((r) => r.loadedAtAbortMB)),
  raw: runs,
};

mkdirSync(path.resolve(HERE, '../../.cache'), { recursive: true });
writeFileSync(
  path.resolve(HERE, '../../.cache', `acceptance-${MBPS}mbps-${STUB ? 'stub' : 'textured'}${HANGING ? '-hang' : ''}${DISABLE_WEBGL ? '-nowebgl' : ''}.json`),
  JSON.stringify(summary, null, 2),
);

console.log(JSON.stringify(summary, null, 2));
