/**
 * Boot-time decomposition for cases c (1.6 Mbps) and d (400 kbps).
 *
 * REPORT ONLY — this script changes nothing. It answers: during the boot window,
 * what else is the browser fetching, how many bytes is that, and how much of the
 * wall clock does it explain?
 *
 *   node tests/e2e/boot-timeline.mjs            # both cases, with textures
 *   node tests/e2e/boot-timeline.mjs --stub     # textures replaced with 1x1
 *
 * Method
 * ------
 * All timings come from ONE clock domain: network events on the browser context
 * (a Worker's PerformanceResourceTiming lives in the worker's own timeline and is
 * not comparable). Boot milestones are read from the app's own DOM/state:
 *   nav start, window load, status->booting, worker response end, first progress
 *   event, 50% progress, last event, ready/abort, CSV response end.
 *
 * "Non-boot traffic" = page resources whose lifetime overlaps the boot window and
 * which are not the worker, the wasm, or the CSV. Textures dominate this.
 */
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_PORT || 4199);
const BASE = `http://localhost:${PORT}/`;
const STUB = process.argv.includes('--stub');

/**
 * `--case c` / `--case d` runs a single profile. Running both in one process
 * crashed the second page under SwiftShader; one case per process is stable and
 * keeps the two measurements independent.
 */
const onlyArg = process.argv.indexOf('--case');
const ONLY = onlyArg >= 0 ? process.argv[onlyArg + 1] : null;

const PROFILES = {
  c: { latency: 150, down: (1.6 * 1024 * 1024) / 8, connection: { saveData: false, effectiveType: '4g', downlink: 10 } },
  d: { latency: 300, down: (400 * 1024) / 8, connection: null },
};

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const classify = (url) => {
  if (/enso\.csv/.test(url)) return 'csv';
  if (/duckdb-browser-.*worker\.js/.test(url)) return 'worker';
  if (/\.wasm/.test(url)) return 'wasm';
  if (/\.(jpg|jpeg|png|webp)$/i.test(url)) return 'texture';
  if (/\.(js|mjs)$/.test(url)) return 'js';
  if (/\.css$/.test(url)) return 'css';
  if (/woff2?$/.test(url)) return 'font';
  return 'other';
};

async function runCase(name, profile) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  if (STUB) {
    // Replace every texture with a 1x1 transparent PNG, so the globe still gets
    // something to sample but transfers ~70 bytes instead of 2.6 MB.
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

  // Apply the network profile — without this the run is unthrottled and the
  // "boot window" is a few seconds regardless of the intended profile.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: profile.down,
    uploadThroughput: profile.down / 2,
  });

  const conn = profile.connection;
  await ctx.addInitScript(
    conn === null
      ? `Object.defineProperty(Navigator.prototype,'connection',{get:()=>undefined,configurable:true});`
      : `Object.defineProperty(Navigator.prototype,'connection',{get:()=>(${JSON.stringify(conn)}),configurable:true});`,
  );

  // Instrument boot milestones from inside the page, before any app code runs.
  await ctx.addInitScript(`
    window.__MILESTONES = {};
    window.addEventListener('load', () => { window.__MILESTONES.load = performance.now(); });
    // Watch the badge for phase text changes.
    const note = () => {
      const el = document.querySelector('[aria-live="polite"].sr-only');
      const t = el ? (el.textContent || '').trim() : '';
      const M = window.__MILESTONES;
      if (/Preparing to download/.test(t) && M.booting === undefined) M.booting = performance.now();
      if (/Loading the DuckDB analytics engine, \\d+ percent/.test(t)) {
        const pct = Number(t.match(/(\\d+) percent/)[1]);
        if (M.firstProgress === undefined) M.firstProgress = performance.now();
        if (pct >= 50 && M.half === undefined) M.half = performance.now();
        M.lastEvent = performance.now();
      }
      if (/engine ready/.test(t) && M.ready === undefined) M.ready = performance.now();
      if (/too slow|could not be reached/.test(t) && M.abort === undefined) M.abort = performance.now();
    };
    const obs = new MutationObserver(note);
    window.addEventListener('DOMContentLoaded', () => {
      obs.observe(document.body, { subtree: true, childList: true, characterData: true });
      setInterval(note, 100);
    });
  `);

  const t0 = Date.now();
  const events = [];
  // Declared before `push` uses it: `const` is hoisted but in the temporal dead
  // zone, so referencing it earlier throws ReferenceError.
  const push = (kind, type, url = '') =>
    events.push({ kind, type, url: url.replace(/^https?:\/\/[^/]+/, ''), t: Date.now() });

  ctx.on('request', (r) => push(classify(r.url()), 'req', r.url()));
  ctx.on('requestfinished', (r) => push(classify(r.url()), 'done', r.url()));
  ctx.on('requestfailed', (r) => push(classify(r.url()), 'done', r.url()));

  await page.goto(BASE, { waitUntil: 'commit' });

  // Wait for a terminal state.
  const deadline = Date.now() + 400_000;
  while (Date.now() < deadline) {
    const m = await page.evaluate(() => window.__MILESTONES).catch(() => ({}));
    if (m.ready !== undefined || m.abort !== undefined) break;
    await page.waitForTimeout(200);
  }

  const milestones = await page.evaluate(() => window.__MILESTONES).catch(() => ({}));
  const rel = events.map((e) => ({ ...e, ms: e.t - t0 }));

  const first = (k) => rel.find((e) => e.kind === k && e.type === 'req');
  const done = (k) => [...rel].reverse().find((e) => e.kind === k && e.type === 'done');

  // Boot window: from booting to ready/abort.
  const bootStart = milestones.booting ?? 0;
  const bootEnd = milestones.ready ?? milestones.abort ?? 0;

  // Page resources overlapping the boot window.
  const pageResources = await page
    .evaluate(() =>
      performance.getEntriesByType('resource').map((r) => ({
        name: r.name.replace(location.origin, '').replace(/^https?:\/\/[^/]+/, ''),
        start: Math.round(r.startTime),
        end: Math.round(r.responseEnd),
        transferSize: r.transferSize,
        decodedBodySize: r.decodedBodySize,
        initiatorType: r.initiatorType,
      })),
    )
    .catch(() => []);

  await ctx.close();

  const overlapping = pageResources.filter(
    (r) => r.transferSize > 0 && r.start < bootEnd && r.end > bootStart,
  );
  // Exclude the boot's own payload.
  const nonBoot = overlapping.filter((r) => !/duckdb-browser-.*worker\.js|enso\.csv/.test(r.name));
  const nonBootBytes = nonBoot.reduce((a, r) => a + r.transferSize, 0);
  const textureBytes = nonBoot
    .filter((r) => /\.(jpg|jpeg|png|webp)$/i.test(r.name))
    .reduce((a, r) => a + r.transferSize, 0);

  return {
    case: name,
    stub: STUB,
    ready: milestones.ready !== undefined,
    milestones: {
      navStart: 0,
      windowLoad: milestones.load ?? null,
      booting: milestones.booting ?? null,
      workerResponseEnd: done('worker')?.ms ?? null,
      firstProgress: milestones.firstProgress ?? null,
      halfProgress: milestones.half ?? null,
      lastEvent: milestones.lastEvent ?? null,
      terminal: milestones.ready ?? milestones.abort ?? null,
      csvResponseEnd: done('csv')?.ms ?? null,
    },
    bootWindowMs: bootEnd - bootStart,
    nonBootBytes,
    textureBytes,
    nonBootCount: nonBoot.length,
    nonBootResources: nonBoot
      .sort((a, b) => b.transferSize - a.transferSize)
      .map((r) => ({
        name: r.name.split('/').pop(),
        transferSize: r.transferSize,
        start: r.start,
        end: r.end,
        flag: /\.(jpg|jpeg|png|webp)$/i.test(r.name) ? 'TEXTURE' : '',
      })),
  };
}

const cases = [
  ['c', 'c 1.6 Mbps', PROFILES.c],
  ['d', 'd 400 kbps', PROFILES.d],
].filter(([key]) => !ONLY || key === ONLY);

const out = [];
for (const [, label, profile] of cases) {
  // Sequential, one browser context at a time; each is closed inside runCase.
  out.push(await runCase(label, profile));
}

console.log(JSON.stringify(out, null, 2));
await browser.close();
