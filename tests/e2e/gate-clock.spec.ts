import { test, expect } from './fixtures';
import { badgeLabel, connectionInit, errorCollector, throttle } from './fixtures';

/**
 * Step 2 gate-vs-textures acceptance, at 1.6 Mbps.
 *
 * The claim under test is ordering, and ordering claims are only meaningful if
 * all timestamps come from one clock. Earlier evidence was not:
 *
 *   gate opened at 11,721 ms   ← Date.now() delta from gate creation
 *   last texture responseEnd  12,783 ms   ← ms from navigation start
 *
 * ...which reads as "the gate opened ~1 s before the textures finished". It
 * wasn't: the gate's reported number simply had a different zero point, because
 * `initEngine()` runs well after navigation start. Both sides are now
 * `performance.now()`, which shares its time origin with
 * `PerformanceResourceTiming`, so the comparison is a subtraction.
 *
 * What this spec asserts
 * ----------------------
 *  1. Every texture is tracked by the same channel the gate reads (no asset can
 *     load outside the gate's view, e.g. a texture loaded by a raw THREE
 *     TextureLoader in a component instead of through drei).
 *  2. `gate-open >= max(texture responseEnd)`.
 *  3. `gate-open >= max(texture onLoad)` — decode finishes after the transfer,
 *     so the byte comparison alone would allow a gate that opened mid-decode.
 *  4. Zero non-boot bytes overlap the boot window.
 *
 * It also requires an E2E build: `window.__sceneGate` / `window.__textures` are
 * dead-code-eliminated from production.
 */

/** What `window.__textures.describe()` returns. */
interface TextureReport {
  gateOpenedAt: number | null;
  lastResponseEnd: number | null;
  lastLoadedAt: number | null;
  gateMinusLastResponseEnd: number | null;
  gateMinusLastLoad: number | null;
  decodeTailMs: number | null;
  progressCoversAll: boolean | null;
  rows: Array<{
    file: string;
    requestStart: number | null;
    responseEnd: number | null;
    threeOnLoad: number | null;
    decodeMs: number | null;
    trackedByProgress: boolean;
    status: string;
  }>;
}

interface GateState {
  outcome: 'ready' | 'failed' | 'timeout' | null;
  openedAt: number | null;
  createdAt: number | null;
  settledInMs: number | null;
  texturesSource: 'timeline' | 'progress' | null;
  assetsStarted: number | null;
}

test.describe('gate vs textures — one clock at 1.6 Mbps', () => {
  // 6.45 MiB of wasm plus 2.08 MiB of texture at 1.6 Mbps is ~50 s by design.
  test.setTimeout(360_000);

  test('gate opens at or after the last texture, and nothing else overlaps the boot', async ({
    page,
  }, testInfo) => {
    const errors = errorCollector(page);
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await throttle(page, '1.6mbps');

    // Network events on the CONTEXT are all on one wall clock. Per-asset byte and
    // timing detail for the assertion comes from resource timing instead, which is
    // navigation-relative — the same origin the gate now reports in.
    const t0 = Date.now();
    const events: Array<{ kind: 'worker' | 'csv' | 'texture'; type: 'req' | 'done'; ms: number }> =
      [];
    const classify = (url: string): 'worker' | 'csv' | 'texture' | null => {
      if (/duckdb-browser-.*worker\.js/.test(url)) return 'worker';
      if (/enso\.csv/.test(url)) return 'csv';
      if (/\/textures\//.test(url)) return 'texture';
      return null;
    };
    page.context().on('request', (r) => {
      const kind = classify(r.url());
      if (kind) events.push({ kind, type: 'req', ms: Date.now() - t0 });
    });
    const done = (url: string) => {
      const kind = classify(url);
      if (kind) events.push({ kind, type: 'done', ms: Date.now() - t0 });
    };
    page.context().on('requestfinished', (r) => done(r.url()));
    page.context().on('requestfailed', (r) => done(r.url()));

    await page.goto('/');

    // Wait for the gate to settle. It resolves at ready / failed / timeout and
    // none of those rejects, so poll rather than race.
    await expect
      .poll(
        () => page.evaluate(() => window.__sceneGate?.getState?.()?.outcome ?? null),
        { timeout: 300_000, intervals: [500] },
      )
      .not.toBeNull();

    const gate = (await page.evaluate(() => window.__sceneGate?.getState?.() ?? null)) as
      | GateState
      | null;
    expect(gate, 'the E2E gate hook must exist (build with VITE_E2E=1)').not.toBeNull();
    expect(gate!.openedAt, 'the gate must record openedAt').not.toBeNull();

    // Wait for the boot to reach a terminal phase.
    //
    // Polled through the BADGE, not `window.__engineStore`: the store hook is only
    // installed when the page is loaded with `?debug` (main.tsx), and this spec
    // navigates to `/`. Polling an absent hook returned null forever and burned
    // the full 300 s timeout — a 5.5-minute non-failure.
    await expect
      .poll(async () => badgeLabel(page), { timeout: 300_000, intervals: [500] })
      .toMatch(/^DuckDB-WASM|too slow|unavailable|could not be reached/i);

    const report = (await page.evaluate(
      (openedAt) => window.__textures?.describe?.(openedAt) ?? null,
      gate!.openedAt,
    )) as TextureReport | null;
    expect(report, 'the E2E texture hook must exist').not.toBeNull();

    // The boot window, from network evidence rather than a debug hook: it starts at
    // the worker request and ends when the badge reached a terminal phase.
    //
    // The gate's own `createdAt` is NOT the boot start — it is when the gate was
    // created, and the boot deliberately begins after the gate opens. Using it
    // would count the entire texture load as "boot" and flag every texture as
    // overlapping it.
    const workerStartMs = events.find((e) => e.kind === 'worker' && e.type === 'req')?.ms ?? null;
    const bootStartMs = workerStartMs;
    const bootEndMs = Date.now() - t0;

    const pageTiming = await page.evaluate(() =>
      (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => ({
        name: r.name.replace(location.origin, ''),
        start: Math.round(r.startTime),
        end: Math.round(r.responseEnd),
        size: r.transferSize,
      })),
    );

    // ---------------------------------------------------------------------
    // Report-only context, attached so a failure is diagnosable without a rerun
    // ---------------------------------------------------------------------
    await testInfo.attach('gate-clock.json', {
      body: JSON.stringify(
        {
          gate: {
            outcome: gate!.outcome,
            openedAt: gate!.openedAt,
            createdAt: gate!.createdAt,
            settledInMs: gate!.settledInMs,
            texturesSource: gate!.texturesSource,
            assetsStarted: gate!.assetsStarted,
          },
          textures: report,
          boot: { startedAt: bootStartMs, endedAt: bootEndMs },
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    // ---------------------------------------------------------------------
    // 1. No untracked texture
    // ---------------------------------------------------------------------
    expect(report!.rows.length, 'the globe must have loaded its textures').toBeGreaterThan(0);
    const untracked = report!.rows.filter((r) => !r.trackedByProgress);
    expect(
      untracked.map((r) => r.file),
      'a texture loaded outside the tracked channel cannot be waited on by the gate',
    ).toEqual([]);

    // Every asset must have resolved; a pending one means the gate opened with a
    // texture still in flight, which is the defect this spec exists to catch.
    expect(
      report!.rows.filter((r) => r.status === 'pending').map((r) => r.file),
      'no texture may still be loading when the gate has opened',
    ).toEqual([]);

    // ---------------------------------------------------------------------
    // 2. gate-open >= max(texture responseEnd)
    // ---------------------------------------------------------------------
    expect(report!.lastResponseEnd, 'resource timing must have a responseEnd').not.toBeNull();
    expect(
      gate!.openedAt!,
      `gate opened at ${gate!.openedAt?.toFixed(0)} ms, before the last texture's ` +
        `responseEnd at ${report!.lastResponseEnd} ms`,
    ).toBeGreaterThanOrEqual(report!.lastResponseEnd!);

    // ---------------------------------------------------------------------
    // 3. gate-open >= max(texture onLoad) — decode happens after the transfer
    // ---------------------------------------------------------------------
    expect(report!.lastLoadedAt, "three's onLoad must have fired for every texture").not.toBeNull();
    expect(
      gate!.openedAt!,
      `gate opened at ${gate!.openedAt?.toFixed(0)} ms, before three's last onLoad at ` +
        `${report!.lastLoadedAt} ms — the gate opened mid-decode`,
    ).toBeGreaterThanOrEqual(report!.lastLoadedAt!);

    // ---------------------------------------------------------------------
    // 4. Zero non-boot bytes overlap the boot window
    // ---------------------------------------------------------------------
    const isBoot = (name: string) =>
      /duckdb-browser-.*worker\.js|enso\.csv|\.wasm/.test(name);
    const overlapping = pageTiming.filter(
      (r) =>
        r.size > 0 &&
        !isBoot(r.name) &&
        bootStartMs !== null &&
        r.start < bootEndMs &&
        r.end > bootStartMs,
    );
    const overlapBytes = overlapping.reduce((sum, r) => sum + r.size, 0);

    expect(
      overlapBytes,
      `non-boot traffic overlapped the boot window: ${overlapping
        .map((r) => `${r.name.split('/').pop()} ${r.size}B ${r.start}-${r.end}ms`)
        .join(', ')}`,
    ).toBe(0);

    // No texture may be requested after the engine started fetching its worker.
    const lateTextures =
      workerStartMs === null
        ? []
        : events.filter((e) => e.kind === 'texture' && e.type === 'req' && e.ms > workerStartMs);
    expect(
      lateTextures.length,
      'no texture should be requested after the worker started',
    ).toBe(0);

    expect(errors.filter((e) => /pageerror/.test(e))).toHaveLength(0);
  });
});
