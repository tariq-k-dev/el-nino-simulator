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

// `window.__globe` is declared once, in ./globals.d.ts, as GlobeProbeHandle.

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
     * WAIVER GLOBE175 — the touch points are DERIVED from the rendered globe.
     *
     * The previous version scanned for the topmost row of canvas pixels and took its
     * midpoint, then dispatched at `cx ± 20`. That is a layout heuristic, and it broke
     * silently when the floating HUD island arrived (f5b9a48): the open row collapsed
     * from 18 cells to 2, then to 1 at HEAD, so `cx - 20` fell off-screen and `cx + 20`
     * landed on the compact header's icon button. The pinch never reached the canvas and
     * the test reported a product defect that did not exist.
     *
     * This version starts at the globe's PROJECTED CENTRE and, if that point's ±20 px
     * pair does not reach the canvas, walks outward to the nearest point whose pair does.
     * Be exact about what that bound buys: at 375x667 the disc radius is 271 px against a
     * half-width of 187.5 px, so the disc bound excludes little — it is not a guarantee
     * the pair is over the globe. The only guarantee is the one asserted below: both points
     * are on the canvas and unoccluded, and when that fails the test FAILS naming the
     * occluder at each point and the element at the projected centre. It never skips and
     * never silently measures nothing.
     */
    const aim = await page.evaluate(() => {
      const c = document.querySelector('#globe-canvas canvas') as HTMLCanvasElement;
      const w = document.querySelector('#globe-canvas') as HTMLElement;
      const r = c.getBoundingClientRect();
      const p = window.__globe!.project([0, 0, 0]);
      const radius = window.__globe!.discRadiusPx();
      const reaches = (x: number, y: number): boolean => {
        if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) return false;
        const el = document.elementFromPoint(x, y);
        return !!el && (el === c || w.contains(el));
      };
      /* Geometry only: every candidate is inside the canvas with 21 px of margin. */
      const candidates: Array<{ x: number; y: number; dist: number }> = [];
      const step = 4;
      for (let y = Math.round(r.y) + 21; y <= r.y + r.height - 21; y += step) {
        for (let x = Math.round(r.x) + 21; x <= r.x + r.width - 21; x += step) {
          const dist = Math.hypot(x - p.x, y - p.y);
          if (dist <= radius) candidates.push({ x, y, dist });
        }
      }
      candidates.sort((a, b) => a.dist - b.dist);
      const open = candidates.find((q) => reaches(q.x - 20, q.y) && reaches(q.x + 20, q.y));
      const centre = {
        x: Math.min(Math.max(Math.round(p.x), Math.round(r.x) + 21), Math.round(r.x + r.width) - 21),
        y: Math.min(Math.max(Math.round(p.y), Math.round(r.y) + 21), Math.round(r.y + r.height) - 21),
      };
      const chosen = open ?? { x: centre.x, y: centre.y, dist: 0 };
      /*
       * What is AT the projected centre, in words. `centreOpen` alone answers a yes/no the
       * next reader cannot act on; the point of pinning it to an element description is
       * that a red then says "the projected centre was covered by div#… .glass inside
       * [data-occluder="globe-controls"]" instead of only that the pair missed.
       */
      const describe = (x: number, y: number): string => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'nothing (outside the viewport)';
        const oc = el.closest('[data-occluder]');
        const cls = String(el.className || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join('.');
        return (
          `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}` +
          (oc ? ` inside [data-occluder="${oc.getAttribute('data-occluder')}"]` : '')
        );
      };
      return {
        cx: chosen.x,
        cy: chosen.y,
        distFromCentre: Math.round(chosen.dist),
        overDisc: chosen.dist <= radius,
        centreOpen: reaches(centre.x, centre.y),
        centreWho: describe(centre.x, centre.y),
        candidates: candidates.length,
        foundOpenPair: open !== undefined,
        discRadiusPx: radius,
      };
    });

    /*
     * THE HIT TEST. Both touch points must reach the canvas (or its wrapper, which is
     * where R3F attaches its listeners). A failure names what is actually there, so the
     * next reader sees "the compact header covers the pinch" instead of "the pinch did
     * not change the distance".
     */
    const hits = await page.evaluate(({ cx, cy }) => {
      const c = document.querySelector('#globe-canvas canvas') as HTMLCanvasElement;
      const w = document.querySelector('#globe-canvas') as HTMLElement;
      const at = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        if (!el) {
          return { x, y, ok: false, who: 'nothing (outside the viewport)', occluder: null as string | null };
        }
        const oc = el.closest('[data-occluder]');
        const cls = String(el.className || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join('.');
        return {
          x,
          y,
          ok: el === c || w.contains(el),
          who: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`,
          occluder: oc ? oc.getAttribute('data-occluder') : null,
        };
      };
      return { left: at(cx - 20, cy), right: at(cx + 20, cy) };
    }, aim);

    for (const [side, h] of [
      ['left', hits.left],
      ['right', hits.right],
    ] as const) {
      expect(
        h.ok,
        `the ${side} touch point (${h.x}, ${h.y}) does not reach the canvas: ` +
          `it lands on ${h.who}` +
          (h.occluder ? ` inside [data-occluder="${h.occluder}"]` : '') +
          `. ` +
          `The pair is aimed at (${aim.cx}, ${aim.cy}), ${aim.distFromCentre} px from the projected centre, ` +
          `and the search found ${aim.foundOpenPair ? 'an open pair' : 'NO open pair'} ` +
          `among ${aim.candidates} candidates. ` +
          `At the projected centre itself elementFromPoint returns ${aim.centreWho} ` +
          `(centreOpen=${aim.centreOpen}).`,
      ).toBe(true);
    }

    /*
     * The aim, on the record. `test.info().annotations` survives into the report and the
     * JSON reporter, so the chosen pair and the centre reading are visible for a GREEN run
     * too — a passing pinch test otherwise leaves no trace of where it pointed.
     */
    test.info().annotations.push({
      type: 'globe175-aim',
      description: JSON.stringify({
        cx: aim.cx,
        cy: aim.cy,
        distFromCentre: aim.distFromCentre,
        centreOpen: aim.centreOpen,
        foundOpenPair: aim.foundOpenPair,
        candidates: aim.candidates,
      }),
    });

    /*
     * CLAMP AWARENESS. A spread must be able to DECREASE d, so d has to start strictly
     * inside (minDistance, maxDistance) with real headroom. Without this, a camera
     * already parked at minDistance produces zero motion — indistinguishable from a
     * broken gesture. If d is at or near the floor, wheel out to mid-range first and
     * assert the recovery, so the only way this test reports zero motion is a real
     * failure.
     *
     * The two clamps are the JSX literals: `<OrbitControls minDistance={EARTH_RADIUS *
     * 1.25} maxDistance={EARTH_RADIUS * 5}>` (GlobeScene.tsx:726-727, EARTH_RADIUS = 1).
     * `__frame.snapshot().dMax` is read when the probe publishes it (MOBILE2 onwards) and
     * falls back to the literal, because the field does not exist at 90b7932.
     */
    const MIN_D = 1.25;
    const MAX_D = 5;
    const readD = () =>
      page.evaluate(() => {
        /* `dMax` is published from MOBILE2 onwards and absent at 90b7932, so the snapshot is
         * read through an optional-field cast rather than the ambient type. */
        const snap = window.__frame!.snapshot() as unknown as { dMax?: number };
        return { d: window.__globe!.distance(), dMax: snap.dMax };
      });

    let start = await readD();
    let ceiling = typeof start.dMax === 'number' ? start.dMax : MAX_D;
    if (start.d <= MIN_D + 0.05) {
      await page.mouse.move(aim.cx, aim.cy);
      for (let i = 0; i < 8 && start.d <= MIN_D + 0.5; i += 1) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(80);
        start = await readD();
        ceiling = typeof start.dMax === 'number' ? start.dMax : MAX_D;
      }
      expect(
        start.d,
        `d started at the ${MIN_D} floor and the wheel guard could not move it off it ` +
          `(still ${start.d.toFixed(4)}) — the pinch would measure a clamp, not a gesture`,
      ).toBeGreaterThan(MIN_D + 0.5);
    }
    expect(
      start.d,
      `d must start strictly inside (${MIN_D}, ${ceiling}) for a spread to be measurable; ` +
        `it was ${start.d.toFixed(4)}`,
    ).toBeGreaterThan(MIN_D + 0.05);
    expect(
      start.d,
      `d must start strictly inside (${MIN_D}, ${ceiling}) for a spread to be measurable; ` +
        `it was ${start.d.toFixed(4)}`,
    ).toBeLessThan(ceiling - 0.05);

    /*
     * THE GESTURE: a real two-finger spread, dispatched as CDP touch events.
     *
     * The manual CDP two-finger events are the single gesture path because they land
     * deterministically at the chosen point. From the default start the 20 to 90 px spread
     * overshoots the 1.25 floor (3.3534 to 1.25, delta minus 2.1034 at HEAD, measured in
     * GLOBE175-DIFF), so the assertion below checks direction and reach, not gain.
     */
    const cdp = await page.context().newCDPSession(page);
    const before = await page.evaluate(() => window.__globe!.distance());

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: aim.cx - 20, y: aim.cy },
        { x: aim.cx + 20, y: aim.cy },
      ],
    });
    for (let step = 1; step <= 6; step += 1) {
      const g = 20 + (90 - 20) * (step / 6);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: Math.round(aim.cx - g), y: aim.cy },
          { x: Math.round(aim.cx + g), y: aim.cy },
        ],
      });
      await page.waitForTimeout(40);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);

    const after = await page.evaluate(() => window.__globe!.distance());

    /*
     * SIGNED, and stricter than the old assertion. The old form was
     * `not.toBeCloseTo(before, 2)`, i.e. |delta| > ~0.005 in EITHER direction. A spread
     * must move the camera CLOSER, so this asserts a decrease of at least 0.02 — four
     * times the old magnitude and with the sign pinned.
     */
    expect(
      after,
      `a two-finger spread at (${aim.cx}, ${aim.cy}) did not zoom in ` +
        `(${before.toFixed(4)} -> ${after.toFixed(4)}). touch-action on the canvas must be ` +
        'none, or the browser eats the gesture.',
    ).toBeLessThan(before - 0.02);

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
