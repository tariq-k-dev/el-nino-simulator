import { test, expect } from './fixtures';
import { connectionInit } from './fixtures';

/**
 * Globe zoom acceptance.
 *
 * The defect these cases exist for: wheel and pinch did nothing. Root cause was
 * NOT a disabled control — `CameraRig` re-derived the camera distance from
 * `desiredDistance.current` on EVERY frame, and that ref only changes when the
 * active region changes, so it held `DEFAULT_POSITION.length()` permanently.
 * OrbitControls applied the wheel correctly and the next frame erased it.
 * Measured before the fix: 6 wheel notches moved 3.3534 -> 3.3235, 12 notches back
 * returned it to 3.3764 — both drifting toward 3.3534.
 *
 * So every assertion here reads `__globe.distance()`, which is
 * `camera.position.distanceTo(orbitTarget)` — the quantity a wheel notch is
 * supposed to change — rather than a DOM signal that could pass for the wrong
 * reason.
 *
 * Requires an E2E build (`pnpm build:e2e`): `window.__globe` is compile-time gated
 * on VITE_E2E and stripped from production by scripts/check-assets.mjs.
 */

interface GlobeProbe {
  project(point?: [number, number, number]): { x: number; y: number; behind: boolean };
  discRadiusPx(): number;
  distance(): number;
  insets(): { top: number; right: number; bottom: number; left: number };
}

declare global {
  interface Window {
    __globe?: GlobeProbe;
  }
}

const distance = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__globe!.distance());

/** Canvas rect, so gestures land on the globe rather than on a panel. */
async function canvasRect(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const c = document.querySelector('#globe-canvas canvas') as HTMLCanvasElement | null;
    if (!c) throw new Error('no canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
}

/** Wait until the scene has rendered and the probe exists. */
async function waitForGlobe(page: import('@playwright/test').Page) {
  await expect
    .poll(() => page.evaluate(() => (window.__globe ? window.__globe.distance() : null)), {
      timeout: 60_000,
      intervals: [250],
    })
    .not.toBeNull();
}

test.describe('globe zoom', () => {
  test.setTimeout(180_000);

  test('wheel at the globe centre moves the distance monotonically and clamps', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    // No Network Information API needed beyond policy; ?debug installs __globe.
    await page.goto('/?debug');
    await waitForGlobe(page);

    const rect = await canvasRect(page);
    await page.mouse.move(rect.cx, rect.cy);

    // ------------------------------------------------------------------
    // Zoom IN: every notch must move the camera closer, never further.
    // ------------------------------------------------------------------
    const inSeries: number[] = [await distance(page)];
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
      inSeries.push(await distance(page));
    }

    for (let i = 1; i < inSeries.length; i += 1) {
      expect(
        inSeries[i],
        `notch ${i} moved the distance ${inSeries[i - 1].toFixed(4)} -> ${inSeries[i].toFixed(4)}; ` +
          'zoom-in must be monotonic toward the globe',
      ).toBeLessThan(inSeries[i - 1]);
    }

    // ------------------------------------------------------------------
    // Clamp at minDistance = globeRadius * 1.25 = 1.25
    // ------------------------------------------------------------------
    for (let i = 0; i < 40; i += 1) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(600);
    const atMin = await distance(page);
    expect(atMin, 'wheel-in must clamp at minDistance').toBeGreaterThanOrEqual(1.25 - 0.02);
    expect(atMin, 'wheel-in must actually reach the lower clamp').toBeLessThan(1.35);

    // ------------------------------------------------------------------
    // Zoom OUT: monotonic the other way, and clamps at maxDistance = 5
    // ------------------------------------------------------------------
    const outSeries: number[] = [atMin];
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(80);
      outSeries.push(await distance(page));
    }
    for (let i = 1; i < outSeries.length; i += 1) {
      expect(
        outSeries[i],
        `notch ${i} moved the distance ${outSeries[i - 1].toFixed(4)} -> ${outSeries[i].toFixed(4)}; ` +
          'zoom-out must be monotonic away from the globe',
      ).toBeGreaterThan(outSeries[i - 1]);
    }

    for (let i = 0; i < 60; i += 1) await page.mouse.wheel(0, 120);
    await page.waitForTimeout(600);
    const atMax = await distance(page);
    expect(atMax, 'wheel-out must clamp at maxDistance').toBeLessThanOrEqual(5 + 0.02);
    expect(atMax, 'wheel-out must actually reach the upper clamp').toBeGreaterThan(4.9);
  });

  test('wheel over a pin label zooms the globe', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await page.goto('/?debug');
    await waitForGlobe(page);

    /*
     * A drei <Html> pin label is real DOM above the canvas. If its wrapper
     * swallowed the wheel, zooming while pointing at a hotspot would silently fail
     * — a much easier miss than a canvas-wide failure.
     *
     * The pin must be genuinely HIT-TESTABLE at its centre, not merely present:
     * the control deck covers the lower-left of the canvas, and a pin sitting under
     * it does not receive the wheel at all (verified — `elementFromPoint` at the
     * "Niño 3.4" label centre returned the panel div, so that pin is occluded and
     * testing it measures nothing). Pick the first pin whose centre actually
     * resolves to its own button or a descendant of its label wrapper.
     */
    const pin = await page.evaluate(() => {
      const NAME = /Niño 3\.4|California|Indonesia|Horn of Africa/;
      for (const btn of [...document.querySelectorAll('button')]) {
        if (!NAME.test(btn.textContent ?? '')) continue;
        const r = btn.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.x < 0 || r.y < 0 || r.x + r.width > innerWidth || r.y + r.height > innerHeight) {
          continue; // off-screen
        }
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        if (!hit) continue;
        // The pin must be the topmost element at its own centre.
        if (hit !== btn && !btn.contains(hit)) continue;
        return { x: cx, y: cy, text: (btn.textContent ?? '').trim() };
      }
      return null;
    });

    expect(
      pin,
      'no pin label was both on screen and unoccluded — the control deck covers the ' +
        'lower-left of the canvas, so this test needs a pin in open space',
    ).not.toBeNull();

    const before = await distance(page);
    await page.mouse.move(pin!.x, pin!.y);
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(400);
    const after = await distance(page);

    expect(
      after,
      `wheel over the "${pin!.text}" pin did not zoom (${before.toFixed(4)} -> ${after.toFixed(4)}). ` +
        'The label wrapper is swallowing the wheel event.',
    ).toBeLessThan(before - 0.02);
  });

  test('pinch at 375x667 changes the distance', async ({ browser }) => {
    /*
     * A dedicated TOUCH context.
     *
     * The default Playwright context is not touch-capable, so
     * `Input.dispatchTouchEvent` and `Input.synthesizePinchGesture` are accepted
     * and then silently discarded — the page never sees a touchstart, the distance
     * never moves, and the failure looks exactly like a broken gesture handler.
     * `hasTouch: true` is what makes the emulated touch input real.
     */
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
    });
    const page = await context.newPage();
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await page.goto('/?debug');
    await waitForGlobe(page);

    /*
     * Pinch in the UNOBSCURED part of the canvas.
     *
     * At 375x667 the control deck covers x 16-359 / y 131-651 (MOBILE_AUDIT §4),
     * so the canvas centre is BEHIND the panel: a gesture there goes to the panel,
     * the canvas receives no pointerdown at all, and the test measures nothing.
     * Verified — instrumenting the canvas showed zero pointerdown/touchstart
     * events for a centre pinch.
     *
     * The top band under the header is `pointer-events-none`, so it passes through
     * to the canvas. Find the largest open rectangle empirically rather than
     * hardcoding a coordinate that a layout tweak would invalidate.
     */
    const open = await page.evaluate(() => {
      const c = document.querySelector('#globe-canvas canvas') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const hits: Array<{ x: number; y: number }> = [];
      for (let y = Math.round(r.y) + 10; y < r.y + r.height - 10; y += 20) {
        for (let x = Math.round(r.x) + 10; x < r.x + r.width - 10; x += 20) {
          const el = document.elementFromPoint(x, y);
          if (el === c) hits.push({ x, y });
        }
      }
      if (hits.length === 0) return null;
      // The point furthest from the panel is the safest pinch origin; use the
      // topmost such row's horizontal midpoint.
      const minY = Math.min(...hits.map((h) => h.y));
      const row = hits.filter((h) => h.y === minY);
      const mid = row[Math.floor(row.length / 2)];
      return { x: mid.x, y: mid.y, openCells: hits.length };
    });

    expect(
      open,
      'no uncovered canvas pixel at 375x667 — a pinch cannot reach the globe at all',
    ).not.toBeNull();

    const rect = { cx: open!.x, cy: open!.y };
    const cdp = await page.context().newCDPSession(page);

    const before = await distance(page);

    // Primary path: Chromium's synthesised pinch, which is the closest thing to a
    // real two-finger gesture available without a device farm.
    await cdp.send('Input.synthesizePinchGesture', {
      x: Math.round(rect.cx),
      y: Math.round(rect.cy),
      scaleFactor: 2.2,
      relativeSpeed: 800,
      gestureSourceType: 'touch',
    });
    await page.waitForTimeout(700);

    let after = await distance(page);

    // Fallback: a manual two-point touch sequence. `synthesizePinchGesture` is not
    // available on every Chromium build, and a silent no-op there would look like a
    // product bug.
    if (Math.abs(after - before) < 0.02) {
      const spread = async (gap: number) => {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [
            { x: Math.round(rect.cx - 20), y: Math.round(rect.cy) },
            { x: Math.round(rect.cx + 20), y: Math.round(rect.cy) },
          ],
        });
        for (let step = 1; step <= 6; step += 1) {
          const g = 20 + (gap - 20) * (step / 6);
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              { x: Math.round(rect.cx - g), y: Math.round(rect.cy) },
              { x: Math.round(rect.cx + g), y: Math.round(rect.cy) },
            ],
          });
          await page.waitForTimeout(40);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await spread(90);
      await page.waitForTimeout(700);
      after = await distance(page);
    }

    expect(
      after,
      `pinch did not change the distance (${before.toFixed(4)} -> ${after.toFixed(4)}). ` +
        'touch-action on the canvas must be none, or the browser eats the gesture.',
    ).not.toBeCloseTo(before, 2);

    // touch-action is the mechanism; assert it directly so a regression names
    // itself instead of showing up as a mysterious gesture failure.
    const ta = await page.evaluate(() => {
      const c = document.querySelector('#globe-canvas canvas') as HTMLElement;
      return {
        canvas: getComputedStyle(c).touchAction,
        wrapper: getComputedStyle(document.querySelector('#globe-canvas') as HTMLElement)
          .touchAction,
      };
    });
    expect(ta.canvas, 'the canvas must claim touch gestures').toBe('none');
    expect(ta.wrapper, 'the canvas wrapper must claim touch gestures').toBe('none');

    await context.close();
  });

  test('zoom still works after a region fly-to', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await page.goto('/?debug');
    await waitForGlobe(page);

    // Select a region: the camera flies and the orbit target moves to the pin, so
    // the distance-from-target changes even though the eye may not. This is where a
    // stale fly-to distance or a re-broken per-frame writer would resurface.
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /Niño 3\.4|California|Indonesia|Horn of Africa/.test(b.textContent ?? ''),
      );
      if (!btn) return false;
      (btn as HTMLButtonElement).click();
      return true;
    });
    expect(clicked, 'a region pin must exist to fly to').toBe(true);

    // Let the fly-to settle, then close the drawer so the canvas is uncovered.
    await page.waitForTimeout(1800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);

    const rect = await canvasRect(page);
    await page.mouse.move(rect.cx, rect.cy);

    const before = await distance(page);
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(500);
    const after = await distance(page);

    expect(
      after,
      `wheel was ignored after a region fly-to (${before.toFixed(4)} -> ${after.toFixed(4)}). ` +
        'The fly-to must not leave a per-frame distance writer running.',
    ).toBeGreaterThan(before + 0.02);
  });

  test('wheel over the control deck does not zoom the globe', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await page.goto('/?debug');
    await waitForGlobe(page);

    // The scenario panel sits above the canvas. A wheel over it is the user trying
    // to scroll that panel, and must never dolly the camera.
    const panel = await page.evaluate(() => {
      const el = document.querySelector('.glass') as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(80, r.height / 2) };
    });
    expect(panel, 'the control deck must be present').not.toBeNull();

    const before = await distance(page);
    await page.mouse.move(panel!.x, panel!.y);
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(500);
    const after = await distance(page);

    expect(
      after,
      `wheel over the control deck moved the camera (${before.toFixed(4)} -> ${after.toFixed(4)})`,
    ).toBeCloseTo(before, 2);
  });
});
