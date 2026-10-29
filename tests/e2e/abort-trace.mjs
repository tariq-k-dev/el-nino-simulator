/**
 * Diagnostic (report only): log the early-abort evaluation for case d, once per
 * second, for a textured and a stubbed run.
 *
 * Reads the app's real state via `window.__engineStore` (exposed under ?debug) so
 * `loaded`, `firstEventAt` and `decoded` are exact rather than inferred from the
 * rendered percentage.
 *
 *   node tests/e2e/abort-trace.mjs            # textured + stubbed, both cases
 *   node tests/e2e/abort-trace.mjs --stub
 *   node tests/e2e/abort-trace.mjs --mbps 1.6
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 4199);
const BASE = `http://localhost:${PORT}/?debug`;

const STUB = process.argv.includes('--stub');
const mbpsArg = process.argv.indexOf('--mbps');
const MBPS = mbpsArg >= 0 ? Number(process.argv[mbpsArg + 1]) : 0.4;

// The watchdog's current rule, mirrored so the trace can show what it *would*
// decide. Values must match src/lib/engine/watchdog.ts.
const AUTO_CAP_MS = 90_000;
const EARLY_ABORT_FACTOR = 1.25;
const EARLY_EVAL_START_MS = 8_000;
const CONSECUTIVE = 3;

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

if (STUB) {
  // 1x1 transparent PNG so the globe still samples something.
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

// No Network Information API, so the policy defaults to eager (case d's shape).
await ctx.addInitScript(
  `Object.defineProperty(Navigator.prototype,'connection',{get:()=>undefined,configurable:true});`,
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
await page.goto(BASE, { waitUntil: 'commit' });

const series = [];
let terminal = null;

for (let i = 0; i < 400; i += 1) {
  const snap = await page
    .evaluate(() => {
      const store = window.__engineStore;
      if (!store) return { missing: true };
      const s = store.getSnapshot();
      return {
        phase: s.phase,
        loaded: s.phase === 'booting' ? s.loaded : null,
        decoded: s.phase === 'booting' ? s.decoded : null,
        firstEventAt: s.phase === 'booting' ? s.firstEventAt : null,
        startedAt: s.phase === 'booting' ? s.startedAt : null,
        reason: s.phase === 'failed' ? s.reason : null,
      };
    })
    .catch(() => ({ missing: true }));

  const now = Date.now();

  if (snap.phase === 'booting' && snap.firstEventAt !== null) {
    const elapsedSinceFirst = now - snap.firstEventAt;
    const rate = elapsedSinceFirst > 0 ? snap.loaded / elapsedSinceFirst : 0; // bytes/ms
    const remaining = (snap.decoded ?? 0) - snap.loaded;
    const projected = rate > 0 ? elapsedSinceFirst + remaining / rate : null;
    const over = projected !== null && projected > AUTO_CAP_MS * EARLY_ABORT_FACTOR;

    series.push({
      tMs: now - t0,
      elapsedSinceFirst: Math.round(elapsedSinceFirst),
      loadedMB: +((snap.loaded ?? 0) / 1048576).toFixed(2),
      decodedMB: +((snap.decoded ?? 0) / 1048576).toFixed(2),
      rateKBps: Math.round(rate * 1000),
      projectedMs: projected === null ? null : Math.round(projected),
      over,
      armed: elapsedSinceFirst >= EARLY_EVAL_START_MS,
    });
  }

  if (snap.phase === 'failed' || snap.phase === 'ready') {
    terminal = { phase: snap.phase, reason: snap.reason, atMs: now - t0 };
    break;
  }

  await page.waitForTimeout(1000);
}

// Network-level truth for the abort.
const net = await page
  .evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((r) => /duckdb.*wasm|worker\.js|enso\.csv|textures/.test(r.name))
      .map((r) => ({
        what: r.name.split('/').pop(),
        start: Math.round(r.startTime),
        end: Math.round(r.responseEnd),
        bytes: r.transferSize,
      })),
  )
  .catch(() => []);

await ctx.close();
await browser.close();

const out = {
  profile: `${MBPS} Mbps`,
  stub: STUB,
  terminal,
  firstEventAtMs: series[0]?.tMs ?? null,
  abortAfterFirstEventMs:
    terminal && series.length > 0 ? terminal.atMs - (series[0].tMs - series[0].elapsedSinceFirst) : null,
  samples: series.length,
  series,
  network: net,
};

const cacheDir = path.resolve(HERE, '../../.cache');
mkdirSync(cacheDir, { recursive: true });
writeFileSync(
  path.join(cacheDir, `abort-trace-${MBPS}mbps-${STUB ? 'stub' : 'textured'}.json`),
  JSON.stringify(out, null, 2),
);

console.log(
  JSON.stringify(
    { profile: out.profile, stub: out.stub, terminal: out.terminal, samples: out.samples,
      abortAfterFirstEventMs: out.abortAfterFirstEventMs },
    null,
    2,
  ),
);
// Full series is printed so the run is self-describing.
console.log('t_ms  elapsed  loadedMB  rateKB/s  projected_ms  over  armed');
for (const s of series) {
  console.log(
    `${String(s.tMs).padStart(5)} ${String(s.elapsedSinceFirst).padStart(8)} ${String(s.loadedMB).padStart(9)} ` +
      `${String(s.rateKBps).padStart(9)} ${String(s.projectedMs ?? '-').padStart(13)} ` +
      `${(s.over ? 'YES' : 'no ').padStart(4)} ${s.armed ? 'y' : 'n'}`,
  );
}
