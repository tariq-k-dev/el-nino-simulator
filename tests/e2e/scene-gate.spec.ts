import { test, expect } from './fixtures';
import { connectionInit, errorCollector, srSentence, visibleText, waitForHistory, waitForReady } from './fixtures';

/**
 * Step 4 edge cases: the scene gate must never become a trap.
 *
 * Two ways the globe can fail to settle:
 *   1. textures hang forever (a route that never fulfills)
 *   2. WebGL is unavailable entirely
 *
 * In both, the engine must still boot. The gate's whole purpose is to *sequence*
 * the boot behind the scene, never to block it permanently.
 */

test.describe('scene gate — hanging textures', () => {
  test.setTimeout(180_000);

  test('engine still boots after the safety timeout', async ({ page }) => {
    const errors = errorCollector(page);

    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    // Shorten the gate so the test does not wait the production 30 s.
    await page.addInitScript(`window.__SCENE_GATE_TIMEOUT_OVERRIDE__ = 3_000;`);

    // A route that never settles IS a hanging texture: the request stays pending,
    // drei's progress never reaches 100, and only the timeout can unblock the boot.
    await page.route(/\/textures\/.*\.(jpg|jpeg|png)$/i, () => {
      /* deliberately never fulfill */
    });

    const t0 = Date.now();
    await page.goto('/');

    // The boot must happen despite the scene never settling.
    const ready = await waitForReady(page, 150_000);
    expect(ready, 'engine must boot after the gate times out').not.toBeNull();

    // And it must have taken at least the override, proving the gate was waited on
    // rather than skipped.
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThan(3_000);

    // History is independent of the scene, so it must be present too.
    expect(await waitForHistory(page, 30_000)).not.toBeNull();

    // Textures hanging must not produce uncaught errors.
    expect(errors.filter((e) => /pageerror/.test(e))).toHaveLength(0);
  });
});

test.describe('scene gate — WebGL unavailable', () => {
  test.setTimeout(180_000);

  test('engine boots immediately and the badge reports ready', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    // Remove WebGL before any app code runs. `getContext` on a 2d canvas returning
    // null for webgl is what the gate probes.
    await page.addInitScript(`
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
        return orig.call(this, type, ...rest);
      };
    `);

    await page.goto('/');

    // The gate should fail fast on WebGL absence, so the engine boots without
    // waiting for any texture or frame.
    const ready = await waitForReady(page, 150_000);
    expect(ready, 'engine must boot when WebGL is unavailable').not.toBeNull();

    const sentence = await srSentence(page);
    expect(sentence).toMatch(/DuckDB engine ready/);

    // History must work: it is dataset-only.
    expect(await waitForHistory(page, 30_000)).not.toBeNull();

    // The scenario controls must still be usable.
    const text = await visibleText(page);
    expect(text).toMatch(/Impact Index/i);
    expect(text).not.toContain('Starting DuckDB');
    expect(text).not.toContain('Loading DuckDB');
  });
});
