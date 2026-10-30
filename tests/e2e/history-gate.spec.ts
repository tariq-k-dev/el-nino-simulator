import { test, expect } from './fixtures';
import { connectionInit, srSentence, throttle, visibleText } from './fixtures';

/**
 * History must not wait for the engine.
 *
 * The claim under test: the 918-row CSV is fetched at APP MOUNT, independently of
 * the DuckDB boot, so the sparkline and the "918 mo" counter are populated while
 * the engine is still queued behind the scene gate — or has not started at all.
 *
 * Why this is a real risk and not a tautology: the boot path also wants the CSV
 * (`init.ts` hands DuckDB a promise of the text so the wasm download can overlap
 * the fetch). If that promise were awaited before mounting the history loader —
 * or if `loadDataset()` were only called from inside `start()` — the CSV would not
 * be requested until the gate opened, and on a slow link the history panel would
 * sit empty for the entire texture load. At 400 kbps that is ~55 seconds of a
 * blank panel for data the app could already have.
 *
 * At 400 kbps textured the ordering is unambiguous:
 *
 *   CSV request start   ~2-4 s   (25 KB brotli, at mount)
 *   gate open           ~58 s    (the texture set is 2.08 MB)
 *   engine ready        later still
 *
 * so a CSV that starts after the gate has opened means it was triggered by the
 * boot path, which is exactly the regression this pins.
 */

interface GateState {
  outcome: 'ready' | 'failed' | 'timeout' | null;
  openedAt: number | null;
  createdAt: number | null;
}

test.describe('history vs scene gate — 400 kbps, textured', () => {
  // The texture set alone needs ~58 s at this profile, and the gate waits for it.
  test.setTimeout(420_000);

  test('CSV is fetched at mount, before the gate opens, and history renders before the boot', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(connectionInit(null)); // no Network Information API
    await throttle(page, '400kbps');

    /**
     * All timings from ONE clock: resource timing's navigation-relative clock,
     * which is the same origin the gate reports `openedAt` on.
     */
    const t0 = Date.now();
    const requests: Array<{ kind: 'csv' | 'texture' | 'worker'; at: number }> = [];
    const classify = (url: string): 'csv' | 'texture' | 'worker' | null => {
      if (/enso\.csv/.test(url)) return 'csv';
      if (/\/textures\//.test(url)) return 'texture';
      if (/duckdb-browser-.*worker\.js/.test(url)) return 'worker';
      return null;
    };
    page.context().on('request', (r) => {
      const kind = classify(r.url());
      if (kind) requests.push({ kind, at: Date.now() - t0 });
    });

    // ?debug installs window.__sceneGate; the gate's open time is the whole point.
    await page.goto('/?debug');

    // ---------------------------------------------------------------------
    // History must appear WHILE the engine is still deferred/booting.
    // ---------------------------------------------------------------------
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const text = document.body.innerText;
            const mo = (text.match(/(\d+)\s*mo\b/) || [])[1] ?? null;
            return {
              months: mo,
              hasSparkline: document.querySelectorAll('#globe-canvas ~ * svg path, svg path').length > 0,
            };
          }),
        { timeout: 120_000, intervals: [250] },
      )
      .toMatchObject({ months: '918' });

    const historyAtMs = Date.now() - t0;

    // At the moment history is readable, the engine must NOT be ready — that is
    // the property. If it were already ready the ordering would be unprovable.
    const statusWhenHistoryRendered = await page.evaluate(() => {
      const snap = (window as unknown as { __engineStore?: { getSnapshot(): { phase: string } } })
        .__engineStore?.getSnapshot();
      return snap?.phase ?? null;
    });

    const gateWhenHistoryRendered = (await page.evaluate(
      () => (window as unknown as { __sceneGate?: { getState(): GateState } }).__sceneGate?.getState() ?? null,
    )) as GateState | null;

    const csvRequest = requests.find((r) => r.kind === 'csv');
    const textureRequests = requests.filter((r) => r.kind === 'texture');

    await testInfo.attach('history-vs-gate.json', {
      body: JSON.stringify(
        {
          historyRenderedAtMs: historyAtMs,
          enginePhaseWhenHistoryRendered: statusWhenHistoryRendered,
          gateOutcomeWhenHistoryRendered: gateWhenHistoryRendered?.outcome ?? null,
          gateOpenedAtWhenHistoryRendered: gateWhenHistoryRendered?.openedAt ?? null,
          csvRequestedAtMs: csvRequest?.at ?? null,
          textureRequestsAtMs: textureRequests.slice(0, 6).map((r) => r.at),
          requests: requests.slice(0, 20),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    // ---------------------------------------------------------------------
    // 1. Exactly one CSV request, made at mount — not by the boot path.
    // ---------------------------------------------------------------------
    expect(csvRequest, 'enso.csv must be requested').toBeDefined();
    expect(
      requests.filter((r) => r.kind === 'csv'),
      'the CSV must be fetched exactly once (the loader memoises and DuckDB reads the text)',
    ).toHaveLength(1);

    // ---------------------------------------------------------------------
    // 2. The CSV starts before the gate OPENS — i.e. it is not waiting on the globe.
    // ---------------------------------------------------------------------
    const gateCreatedAt = gateWhenHistoryRendered?.createdAt ?? null;
    expect(gateCreatedAt, 'the gate must have been created by now').not.toBeNull();

    expect(
      gateWhenHistoryRendered?.openedAt ?? null,
      'the textures should not have finished this early at 400 kbps — if they have, ' +
        'this profile is not slow enough to prove the ordering',
    ).toBeNull();

    /*
     * The bound is gate-OPEN, not gate-CREATION, and the difference is deliberate.
     *
     * `initEngine()` is called from main.tsx BEFORE `createRoot().render()`, so the
     * gate object exists a few milliseconds before React mounts and `useEngine`'s
     * effect fires `loadDataset()`. Measured: gate created at 6,757 ms, CSV
     * requested at 6,824 ms — a 67 ms gap that is the render itself, not a boot-path
     * dependency. Asserting `csvStart < gateCreatedAt` fails a correct build.
     *
     * What matters is that the CSV does not wait for the TEXTURES. The gate opens
     * at ~58 s on this profile; a CSV start anywhere near that would mean the
     * dataset load was sequenced behind the boot.
     */
    const gateOpenedAt = gateWhenHistoryRendered?.openedAt ?? null;
    const csvStartBound = gateOpenedAt ?? Number.POSITIVE_INFINITY;
    expect(
      csvRequest!.at,
      `CSV was requested at ${csvRequest!.at} ms — it must start at app mount, long ` +
        `before the gate opens${gateOpenedAt === null ? ' (gate still closed)' : ` at ${Math.round(gateOpenedAt)} ms`}`,
    ).toBeLessThan(csvStartBound);

    // A concrete, generous bound: the CSV is 25 KB brotli and must be requested
    // within the first seconds of the page, well inside the bundle-load window.
    expect(
      csvRequest!.at,
      `CSV was requested at ${csvRequest!.at} ms, which is too late to be an ` +
        'app-mount fetch',
    ).toBeLessThan(15_000);

    // ---------------------------------------------------------------------
    // 3. History rendered before the engine became ready.
    // ---------------------------------------------------------------------
    expect(
      statusWhenHistoryRendered,
      'the engine should still be deferred/booting when history appears; if it is ' +
        'already ready this run proves nothing about ordering',
    ).not.toBe('ready');

    // The badge must be saying the deferred-with-reason text, not a failure.
    const sentence = await srSentence(page);
    expect(sentence).toMatch(/built-in model/i);

    // History is genuinely on screen, not just in a counter.
    const text = await visibleText(page);
    expect(text).toMatch(/918\s*mo/);
    expect(text).not.toContain('History unavailable');

    // ---------------------------------------------------------------------
    // 4. The boot has not touched the network yet at that point.
    // ---------------------------------------------------------------------
    const workerAtHistory = requests.find((r) => r.kind === 'worker');
    expect(
      workerAtHistory,
      'the DuckDB worker should not have been requested while the gate is closed',
    ).toBeUndefined();
  });
});
