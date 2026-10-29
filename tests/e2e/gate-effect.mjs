/**
 * Gate effectiveness, reconciled on ONE clock.
 *
 *   node tests/e2e/gate-effect.mjs --mbps 1.6
 *   node tests/e2e/gate-effect.mjs --mbps 0.4
 *
 * Answers, with evidence rather than inference:
 *
 *   1. For every globe texture: requestStart, responseEnd, three's onLoad, and
 *      whether drei's `useProgress` counter saw it.
 *   2. Gate open, on the same `performance.now()` clock.
 *   3. `gate-open >= max(texture responseEnd)`.
 *   4. Zero non-boot bytes overlapping the boot window.
 *
 * The previous version compared two different clocks and printed "gate opened at
 * 11,721 ms, last texture responseEnd 12,783 ms" — a ~1 s gap that was entirely an
 * artifact. `settledInMs` was a Date.now() delta from gate creation (zero point:
 * `initEngine()`, well after navigation start) while responseEnd is milliseconds
 * from navigation start. Both sides are now performance.now(), so the subtraction
 * is meaningful.
 *
 * Requires an E2E build (`pnpm build:e2e`) because it reads the gate state, the
 * texture timeline and the engine store, all of which are stripped from a
 * production bundle.
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
const MBPS = Number(arg('mbps', '1.6'));
const GATE_TIMEOUT_MS = Number(arg('gate-timeout', '0')) || 0;

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// A 1.6 Mbps-and-up profile reports a fast connection so the policy picks eager.
// Below 1.5 Mbps `downlink` would route the policy to on-demand and the gate would
// never even be consulted.
await ctx.addInitScript(
  MBPS < 1
    ? `Object.defineProperty(Navigator.prototype,'connection',{get:()=>undefined,configurable:true});`
    : `Object.defineProperty(Navigator.prototype,'connection',{get:()=>({saveData:false,effectiveType:'4g',downlink:10}),configurable:true});`,
);

if (GATE_TIMEOUT_MS > 0) {
  await ctx.addInitScript(`window.__SCENE_GATE_TIMEOUT_OVERRIDE__ = ${GATE_TIMEOUT_MS};`);
}

const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: MBPS < 1 ? 300 : 150,
  downloadThroughput: (MBPS * 1024 * 1024) / 8,
  uploadThroughput: (MBPS * 1024 * 1024) / 16,
});

/**
 * Network events on the browser CONTEXT are all on the page's wall clock, which is
 * what makes cross-kind overlap meaningful. A Worker's own
 * PerformanceResourceTiming lives in the worker's timeline and mixes badly.
 */
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

// Poll store + gate state until the boot reaches a terminal phase.
let terminal = null;
let bootStartedAt = null;
while (Date.now() - t0 < 400_000) {
  const s = await page
    .evaluate(() => {
      const st = window.__engineStore?.getSnapshot();
      return st
        ? {
            phase: st.phase,
            startedAt: st.phase === 'booting' ? st.startedAt : null,
            reason: st.phase === 'failed' ? st.reason : null,
          }
        : null;
    })
    .catch(() => null);

  if (s?.phase === 'booting' && s.startedAt !== null && bootStartedAt === null) {
    bootStartedAt = s.startedAt;
  }
  if (s?.phase === 'failed' || s?.phase === 'ready') {
    terminal = { phase: s.phase, reason: s.reason, atMs: Date.now() - t0 };
    break;
  }
  await page.waitForTimeout(200);
}

/**
 * The reconciliation, all on performance.now():
 *
 *   gate      = window.__sceneGate.getState().openedAt   (performance.now())
 *   textures  = window.__textures.describe(gateOpen)     (resource timing)
 *   boot      = page resource timing, filtered to non-boot URLs
 */
const gateState = await page.evaluate(() => window.__sceneGate?.getState?.() ?? null).catch(() => null);
const textureReport = await page
  .evaluate(
    (gateOpenedAt) => (window.__textures?.describe ? window.__textures.describe(gateOpenedAt) : null),
    gateState?.openedAt ?? null,
  )
  .catch(() => null);

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
await ctx.close();
await browser.close();

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------
// `performance.now()` and `Date.now()` share no origin, so the network-event log
// (Date.now()-relative) is projected onto the navigation-relative performance
// timeline using one request both sides observed.
const rel = ev.map((e) => ({ ...e, ms: e.t - t0 }));
const first = (k) => rel.find((e) => e.k === k && e.type === 'req')?.ms ?? null;
const lastDone = (k) => [...rel].reverse().find((e) => e.k === k && e.type === 'done')?.ms ?? null;

const csvProbe = pageTiming.find((r) => r.name.includes('enso.csv'));
const csvNav = first('csv');
const perfToNav = csvProbe && csvNav !== null ? csvProbe.start - csvNav : null;
const toNav = (t0RelativeMs) =>
  perfToNav === null || t0RelativeMs === null ? null : Math.round(t0RelativeMs + perfToNav);

// Textures requested AFTER the worker started = post-gate texture loads, i.e. the
// gate opened while a texture had not yet been asked for.
const workerStartNav = first('worker');
const texAfterGate = rel.filter(
  (e) => e.k === 'texture' && e.type === 'req' && workerStartNav && e.ms > workerStartNav,
);

const bootStartNav = bootStartedAt === null ? null : toNav(bootStartedAt);
const bootEndNav = terminal?.atMs ?? null;

// Non-boot page traffic overlapping the boot window.
const nonBoot = (r) => !/duckdb-browser-.*worker\.js|enso\.csv|\.wasm/.test(r.name);
const overlapping = pageTiming.filter(
  (r) =>
    r.size > 0 &&
    nonBoot(r) &&
    bootStartNav !== null &&
    bootEndNav !== null &&
    r.start < bootEndNav &&
    r.end > bootStartNav,
);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
const failures = [];

const gateOpenedAt = gateState?.openedAt ?? null;
const lastTextureResponseEnd = textureReport?.lastResponseEnd ?? null;
const lastTextureOnLoad = textureReport?.lastLoadedAt ?? null;

/** (1) Gate-open must not precede the last texture's last byte. */
let gateAfterLastByte = null;
if (gateOpenedAt !== null && lastTextureResponseEnd !== null) {
  gateAfterLastByte = gateOpenedAt >= lastTextureResponseEnd;
  if (!gateAfterLastByte) {
    failures.push(
      `gate opened at ${Math.round(gateOpenedAt)} ms but a texture's last byte landed at ` +
        `${lastTextureResponseEnd} ms (${Math.round(lastTextureResponseEnd - gateOpenedAt)} ms late)`,
    );
  }
}

/** (2) Gate-open must also be at/after the last onLoad, since decode follows transfer. */
let gateAfterLastLoad = null;
if (gateOpenedAt !== null && lastTextureOnLoad !== null) {
  gateAfterLastLoad = gateOpenedAt >= lastTextureOnLoad;
  if (!gateAfterLastLoad) {
    failures.push(
      `gate opened at ${Math.round(gateOpenedAt)} ms, before three's last onLoad at ` +
        `${lastTextureOnLoad} ms — the gate counted a texture it had not finished loading`,
    );
  }
}

/** (3) Every texture must be accounted for by the tracked channel. */
const untracked = (textureReport?.rows ?? []).filter((r) => !r.trackedByProgress);
if (untracked.length > 0) {
  failures.push(
    `${untracked.length} texture(s) were not tracked by the loading manager, so the gate ` +
      `could not wait for them: ${untracked.map((r) => r.file).join(', ')}`,
  );
}

/** (4) Zero non-boot overlap while the engine boots. */
const nonBootOverlapBytes = overlapping.reduce((a, r) => a + r.size, 0);
if (nonBootOverlapBytes > 0) {
  failures.push(
    `${nonBootOverlapBytes} non-boot bytes overlapped the boot window: ` +
      overlapping
        .map((r) => `${r.name.split('/').pop()} ${r.size}B ${r.start}-${r.end}ms`)
        .join(', '),
  );
}

/** (5) No texture may be requested after the engine started. */
if (texAfterGate.length > 0) {
  failures.push(
    `${texAfterGate.length} texture request(s) started after the worker did: ` +
      texAfterGate.map((e) => `${e.url.split('/').pop()} @${e.ms}ms`).join(', '),
  );
}

const out = {
  profile: `${MBPS} Mbps`,
  clock: 'performance.now() for gate + textures; Date.now() only for the network event log',
  perfToNavOffsetMs: perfToNav,

  gate: {
    outcome: gateState?.outcome ?? null,
    reason: gateState?.reason ?? null,
    openedAt: gateOpenedAt === null ? null : Math.round(gateOpenedAt),
    createdAt:
      gateState?.createdAt === null || gateState?.createdAt === undefined
        ? null
        : Math.round(gateState.createdAt),
    settledInMs:
      gateState?.settledInMs === null || gateState?.settledInMs === undefined
        ? null
        : Math.round(gateState.settledInMs),
    texturesSource: gateState?.texturesSource ?? null,
    assetsStarted: gateState?.assetsStarted ?? null,
    /** Same instant, navigation-relative, so it lines up with the 2B-VERIFY tables. */
    openedAtNavMs:
      gateOpenedAt === null || perfToNav === null ? null : Math.round(gateOpenedAt + perfToNav),
  },

  textures: textureReport,

  reconciliation: {
    lastTextureResponseEnd,
    lastTextureOnLoad,
    gateMinusLastResponseEnd: textureReport?.gateMinusLastResponseEnd ?? null,
    gateMinusLastOnLoad: textureReport?.gateMinusLastLoad ?? null,
    decodeTailMs: textureReport?.decodeTailMs ?? null,
    gateAfterLastByte,
    gateAfterLastLoad,
    untrackedTextures: untracked.map((r) => r.file),
    progressCoversAll: textureReport?.progressCoversAll ?? null,
  },

  boot: {
    startedNavMs: bootStartNav,
    endedNavMs: bootEndNav,
    windowMs: bootStartNav !== null && bootEndNav !== null ? bootEndNav - bootStartNav : null,
    workerStartNavMs: workerStartNav,
    workerAfterLastTexture:
      workerStartNav !== null && lastDone('texture') !== null
        ? workerStartNav >= lastDone('texture')
        : null,
    terminal,
  },

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
  nonBootOverlapBytes,

  storeAfter,
  failures,
  pass: failures.length === 0,
};

const cacheDir = path.resolve(HERE, '../../.cache');
mkdirSync(cacheDir, { recursive: true });
writeFileSync(path.join(cacheDir, `gate-effect-${MBPS}.json`), JSON.stringify(out, null, 2));

// Human-readable table: the point of this script is to make the timeline legible,
// not to bury it in JSON.
console.log(`\n  Gate/texture reconciliation — ${out.profile}\n`);
console.log(
  `  ${'texture'.padEnd(22)} ${'reqStart'.padStart(9)} ${'respEnd'.padStart(9)} ` +
    `${'onLoad'.padStart(9)} ${'decode'.padStart(8)}  via`,
);
console.log(
  `  ${'-'.repeat(22)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(8)}  ---`,
);
for (const r of textureReport?.rows ?? []) {
  console.log(
    `  ${String(r.file).padEnd(22)} ${String(r.requestStart ?? '—').padStart(9)} ` +
      `${String(r.responseEnd ?? '—').padStart(9)} ${String(r.threeOnLoad ?? '—').padStart(9)} ` +
      `${String(r.decodeMs ?? '—').padStart(8)}  ${r.trackedByProgress ? 'progress' : 'NONE'}`,
  );
}
console.log(`\n  gate open (performance.now)     ${String(out.gate.openedAt ?? '—').padStart(10)}`);
console.log(`  gate open (nav-relative)        ${String(out.gate.openedAtNavMs ?? '—').padStart(10)}`);
console.log(`  last texture responseEnd        ${String(lastTextureResponseEnd ?? '—').padStart(10)}`);
console.log(`  last texture onLoad             ${String(lastTextureOnLoad ?? '—').padStart(10)}`);
console.log(
  `  gate - last responseEnd         ${String(out.reconciliation.gateMinusLastResponseEnd ?? '—').padStart(10)}`,
);
console.log(
  `  gate - last onLoad              ${String(out.reconciliation.gateMinusLastOnLoad ?? '—').padStart(10)}`,
);
console.log(`  non-boot overlap (bytes)        ${String(nonBootOverlapBytes).padStart(10)}`);
console.log(`\n  ${out.pass ? 'PASS' : 'FAIL'}`);
for (const f of failures) console.log(`    - ${f}`);
console.log('\n' + JSON.stringify(out, null, 2));
process.exitCode = out.pass ? 0 : 1;
