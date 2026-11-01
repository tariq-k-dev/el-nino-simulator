/**
 * Step 3-MOBILE1 E — the mobile snap sheet, the HUD island, and the view offset, at a real phone viewport.
 *
 * ## What makes this file different from every spec before it
 *
 * The other acceptance suites measure a DESKTOP picture at 1280x800, 1440x900 or 1024x768. This one measures a
 * layout the product only renders below 768 CSS px, with `hasTouch`, `isMobile` and DPR 2 — and it has to prove
 * three things that are easy to fake and hard to get right:
 *
 *   1. **The view offset landed where it should**, at 0.275 * H, measured by projecting the orbit target through
 *      the page's own camera rather than by trusting the offset's sign.
 *   2. **Raycasting still agrees with the shifted frustum.** A view offset changes the projection matrix; if
 *      anything in the pin path had cached a centre, taps would land beside the pins. M3 taps every front-facing
 *      pin at its PROJECTED pixel and requires all of them to select.
 *   3. **A tap on the sheet does NOT reach R3F.** R3F fires `onPointerMissed` on a click that hits nothing in the
 *      scene, and the app wires that to `onSelect(null)` — so a sheet inside the Canvas wrapper would clear the
 *      selection on every tap. This spec proves the selection SURVIVES, which is the observable consequence.
 *
 * ## Touch, not `page.mouse`
 *
 * Every drag and tap in this file goes through CDP `Input.dispatchTouchEvent`, because that is what the browser
 * actually does on a phone: it produces a `pointerdown` with `pointerType: 'touch'`, it honours `touch-action`,
 * and it raises `pointercancel` when the browser claims a gesture. `page.mouse` produces a MOUSE pointer stream,
 * which bypasses the entire touch-action machinery — so a drag driven by `page.mouse` would pass even with
 * `touch-action: auto` on the handle, which is the exact bug the sheet exists to avoid.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page, CDPSession } from '@playwright/test';

const LIVE = '/?debug&framing=live';

/** The step's own viewport. */
const PHONE = { width: 390, height: 844 };

/** The tier rect tops the step asserts (M4), with its own 2 px tolerance. */
const TIER_TOPS = { full: 101, half: 439, peek: 692 } as const;

/** `VIEW_CENTER_FRACTION` — restated here on purpose, so the spec does not agree with the product by import. */
const TARGET_FRACTION = 0.275;

/* ---------------------------------------------------------------------------- setup */

/**
 * Open the page at a viewport and wait until the frame is settled.
 *
 * The `isMobile`/`hasTouch` context options are set by `test.use` below; this helper only drives the page.
 */
async function open(page: Page, vp = PHONE, opts: { waitForSheet?: boolean } = {}): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
  await page.goto(LIVE);
  await expect
    .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
      timeout: 90_000,
      intervals: [250],
    })
    .toBe('live');
  await page.waitForTimeout(2500);
  if (opts.waitForSheet !== false) {
    /* The sheet's own probe is the cheapest proof the mobile shell mounted at all. */
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__mobileSheet)), { timeout: 30_000, intervals: [200] })
      .toBe(true);
  }
}

/** A CDP session for touch dispatch. */
async function touch(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  return cdp;
}

/**
 * Dispatch one touch sequence.
 *
 * `points` are viewport CSS px. One touchStart, a run of touchMove events, then one touchEnd is the shape
 * Chromium turns into a pointer stream with `pointerType: 'touch'`, so a `touch-action: none` region receives
 * the moves and a `touch-action: pan-y` region starts a scroll instead.
 */
async function dragTouch(
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
  stepMs = 16,
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, id: 1 }],
    });
    await page_wait(stepMs);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** A tiny sleep that does not need the page. */
async function page_wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** One tap. */
async function tapTouch(cdp: CDPSession, at: { x: number; y: number }): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: at.x, y: at.y, id: 1 }],
  });
  await page_wait(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** The sheet's own probe state. */
async function sheetState(page: Page) {
  return page.evaluate(() => window.__mobileSheet!.read());
}

/** The selected region, as the app reports it. */
async function selected(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const s = window.__frame?.snapshot();
    return s ? (s.regionId ?? null) : null;
  });
}

/**
 * Wait until the fit's distance has ARRIVED, then until two reads agree.
 *
 * The probe's `settled` is `|dTarget - d| < 0.0005`, which is 500x looser than the 1e-6 an "unchanged" claim
 * needs: measured on the first run, a pose read straight after a viewport change returned d = 4.99977 against a
 * target of 5, i.e. the fit was still easing the last 2.3e-4 and the M6/M7 difference assertions read that as
 * movement. This helper is the same "same key twice" rest test `frame.spec.ts` uses, on the DISTANCE.
 */
async function settleDistance(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__mobileDKey;
  });
  await page.waitForFunction(
    () => {
      const d = window.__globe!.distance();
      const key = d.toFixed(6);
      const store = window as unknown as Record<string, unknown>;
      const previous = store.__mobileDKey;
      store.__mobileDKey = key;
      return previous === key;
    },
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

/**
 * Wait until the sheet's RENDER COUNTER has stopped moving, then return its value.
 *
 * ## Why this is not the same moment as `open()` returning
 *
 * `open()` guarantees the mobile shell MOUNTED. It does not guarantee the APP has stopped re-rendering it: `App`
 * flips its `booted` state when the engine's history resolves and hands `MobileShell` a new `analytics` payload,
 * and a `SnapSheet` whose parent re-rendered re-renders too, because it is not memoised and should not be. So the
 * counter climbs by one or two over the first second or so after the sheet appears, whatever the user does.
 *
 * Measured (`.cache/mob/probe-renders.spec.ts`, P1): after `open()` returned, the counter read 12 at t = 268 ms,
 * 13 at t = 885 ms and 13 for the whole 18 s that followed. So the baseline M5 needs is the RESTED value.
 *
 * Without this the M5 case accused a drag of the app's own late render: it captured `before` at 11 and read 12
 * mid-gesture, "a drag must not re-render", on a run where no drag had re-rendered anything.
 */
async function settledRenders(page: Page): Promise<number> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__mobileRKey;
  });
  await page.waitForFunction(
    () => {
      const key = String(window.__mobileSheet!.read().renders);
      const store = window as unknown as Record<string, unknown>;
      const previous = store.__mobileRKey;
      store.__mobileRKey = key;
      return previous === key;
    },
    undefined,
    { timeout: 20_000, polling: 250 },
  );
  return page.evaluate(() => window.__mobileSheet!.read().renders);
}

/**
 * Wait until the desktop branch has actually run a frame after a resize, and report what it left.
 *
 * TWO CORRECTIONS TO THE OBVIOUS ASSERTION, both measured.
 *
 * 1. **It must be polled.** `layoutMode` flips synchronously with the media query, but the offset is applied or
 *    cleared by the next `useFrame`, so reading the camera the instant `layoutMode` reads `desktop` is a race.
 *
 * 2. **`camera.view` is NOT null on live desktop, and never was.** The step's desktop rule is written as
 *    "camera.view must stay null on desktop so the projection matrix is bit-identical", and that is true of the
 *    LOCKED build — the E2E default, the one `ref.spec.ts` and `camera-golden.spec.ts` measure, where
 *    `CameraDirector.tsx` returns before computing a frame at all. It is NOT true of live desktop, which has
 *    installed the free-rect offset since step 3A2. Measured on this bundle (`.cache/mob/probe-desktop.spec.ts`):
 *
 *      1024x768  view { offsetX: -22.421875, offsetY: -59.125,    fullWidth/Height 1024/768 }
 *      1280x800  view { offsetX: -22.421875, offsetY: -59.125,    fullWidth/Height 1280/800 }
 *       768x900  view { offsetX:   0,         offsetY: 196.8909,   fullWidth/Height  768/900 }
 *
 *    Those are the drawer/deck insets, not this step's doing. So the honest assertion is that desktop's view
 *    offset equals the DESKTOP FIT's own offset (`frame.dy` negated) and that the MOBILE branch left no trace —
 *    which is what makes "desktop is unchanged" a statement about this step rather than about a mode.
 */
async function waitForDesktopFrame(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__frame!.layoutMode), { timeout: 20_000, intervals: [100] })
    .toBe('desktop');
  /* And that a frame has run since: `settled` is only ever written by the live frame body. */
  await expect
    .poll(() => page.evaluate(() => window.__frame!.settled), { timeout: 20_000, intervals: [100] })
    .toBe(true);
}

/* ------------------------------------------------------------------------ the config */

test.describe('mobile snap sheet', () => {
  test.use({
    viewport: PHONE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test.setTimeout(240_000);

  /* ------------------------------------------------------------------ M1 layout mode */

  test('M1: at 390x844 the sheet and island exist and the desktop drawer and cards do not', async ({ page }) => {
    await open(page);

    await expect(page.locator('[data-mobile-sheet]')).toHaveCount(1);
    await expect(page.getByTestId('mobile-island')).toHaveCount(1);
    await expect(page.locator('[data-testid="drawer-switcher"]')).toHaveCount(0);
    await expect(page.locator('[data-occluder="right-panel"]')).toHaveCount(0);
    await expect(page.locator('[data-occluder="right-drawer"]')).toHaveCount(0);
    /* The desktop deck is hidden by class, so it is present but invisible — assert the computed style. */
    const deckVisible = await page.evaluate(() => {
      const deck = document.querySelector('[data-occluder="left-panel"]');
      if (!deck) return null;
      return getComputedStyle(deck).display !== 'none';
    });
    expect(deckVisible).toBe(false);
  });

  test('M1: at 767 the sheet exists; at 768 and 1024x768 only the desktop layout does', async ({ page }) => {
    await open(page, { width: 767, height: 900 }, { waitForSheet: true });
    await expect(page.locator('[data-mobile-sheet]')).toHaveCount(1);

    for (const vp of [
      { width: 768, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      /* The mode is a media query, so it flips without a reload; give the listener + one frame to land. */
      await expect
        .poll(() => page.evaluate(() => window.__frame!.layoutMode), { timeout: 15_000, intervals: [100] })
        .toBe('desktop');
      await expect(page.locator('[data-mobile-sheet]')).toHaveCount(0);
      await expect(page.getByTestId('mobile-island')).toHaveCount(0);
      await expect(page.locator('[data-occluder="right-panel"]')).toHaveCount(1);
      /*
       * The desktop camera left the MOBILE branch with nothing to show: the view offset is the desktop fit's own
       * (dy negated), and the probe's mobile fields are their defaults. See `waitForDesktopFrame` for why the
       * assertion is not "camera.view is null" — it is not null on live desktop and never was.
       */
      await waitForDesktopFrame(page);
      const desk = await page.evaluate(() => ({
        viewOffsetY: window.__frame!.viewOffsetY,
        clampedByMax: window.__frame!.clampedByMax,
        dy: window.__frame!.target.dy,
      }));
      /* The probe's mobile-only fields must be absent, i.e. defaulted — proof the mobile branch did not run. */
      expect(desk.viewOffsetY).toBe(0);
      expect(desk.clampedByMax).toBe(false);
      /* And the offset actually installed is the desktop fit's, which is this step's "unchanged" claim. */
      const camView = await page.evaluate(() => {
        const cam = window.__camera as { view: { offsetY: number } | null };
        return cam.view ? cam.view.offsetY : null;
      });
      /*
       * Within 0.05 px, which is the probe's OWN definition of settled (`pxError < 0.05`,
       * `CameraDirector.tsx`). Measured: a strict 1e-6 comparison read 196.8594 against a target of 196.875, i.e.
       * 0.0156 px of remaining ease — the product's stated accept bound, not a defect. Asserting tighter than the
       * product's own settle criterion would make this case fail on a fit that is, by its own contract, arrived.
       */
      expect(Math.abs((camView as number) - -desk.dy)).toBeLessThan(0.05);
    }
  });

  /* ------------------------------------------------------------------ M2 view offset */

  test('M2: the projected orbit target sits at 0.275 * H, and camera.view is null on desktop', async ({ page }) => {
    await open(page);

    const measured = await page.evaluate(() => {
      const g = window.__globe!;
      const t = g.target();
      const p = g.project(t);
      const cam = window.__camera as { view: unknown };
      return { y: p.y, x: p.x, view: cam.view, H: window.innerHeight };
    });

    expect(measured.view, 'camera.view must be non-null on mobile').not.toBeNull();
    const wanted = TARGET_FRACTION * measured.H;
    expect(Math.abs(measured.y - wanted), `target y ${measured.y} vs ${wanted}`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(measured.x - PHONE.width / 2)).toBeLessThanOrEqual(1.5);

    /* Desktop: the same read, at a desktop size, must report a null view. */
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect
      .poll(() => page.evaluate(() => window.__frame!.layoutMode), { timeout: 15_000, intervals: [100] })
      .toBe('desktop');
    await waitForDesktopFrame(page);

    /*
     * The mobile fields are the defaults again, so nothing of the mobile branch survives the resize — and the
     * camera's offset is the desktop fit's own, not 0.225 * H = 189.9 which is what the mobile branch installs.
     */
    const after = await page.evaluate(() => {
      const cam = window.__camera as { view: { offsetY: number } | null };
      return {
        viewOffsetY: window.__frame!.viewOffsetY,
        offsetY: cam.view ? cam.view.offsetY : null,
        dy: window.__frame!.target.dy,
      };
    });
    expect(after.viewOffsetY).toBe(0);
    expect(after.offsetY).not.toBeCloseTo(0.225 * 800, 0);
    /*
     * Same bound as the M1 sweep, for the same measured reason: `waitForDesktopFrame` guarantees a frame RAN,
     * not that the fit has stopped easing, and the probe's own settled criterion is 0.05 px. Measured here:
     * -59.1108 against a target of -59.125, i.e. 0.0142 px of remaining ease. A 1e-6 comparison would call the
     * desktop fit wrong while it is, by the product's own contract, arrived.
     */
    expect(Math.abs((after.offsetY as number) - -after.dy)).toBeLessThan(0.05);
  });

  /* ------------------------------------------------------------- M3 raycast parity */

  test('M3: every front-facing pin selects at its projected pixel; back-facing pins never do', async ({ page }) => {
    await open(page);
    /* Stop the spin so a projected pixel cannot move between reading it and tapping it. */
    await page.evaluate(() => window.__globe!.setSpin?.(false, 0));
    await page.waitForTimeout(600);
    /*
     * AND wait for the fit to arrive. `open()` returns once the shell is mounted, which is before the distance has
     * finished easing to `dTarget`; a projection taken mid-ease is a projection of a pose that no longer exists by
     * the time the tap is dispatched.
     */
    await settleDistance(page);

    /*
     * THE TAPPABLE SET, not "every pin the probe lists".
     *
     * Measured on the first run: at 390x844 the PACIFIC pin projects to x = -9, i.e. nine pixels OFF the left of a
     * 390 px screen, because the mobile fit is clamped at dMax and the disc is wider than the viewport. A tap at
     * (-9, 308) lands outside the canvas and selects nothing — correctly, since a user cannot touch a pixel that
     * is not on the screen. Counting it as a front-facing failure would have been the spec accusing the product of
     * a defect the spec's own oracle created, so the set is filtered to pins whose projected pixel is inside the
     * viewport, and the excluded ones are REPORTED rather than silently dropped.
     */
    const pins = await page.evaluate(() => {
      const rows = window.__globe!.pins();
      const w = window.innerWidth;
      const h = window.innerHeight;
      return rows.map((p) => ({
        ...p,
        inViewport:
          p.x >= 1 && p.x <= w - 1 && p.y >= 1 && p.y <= h - 1,
        /* The sheet's top at peek, so a pin behind the sheet is excluded for the same reason. */
        topAt: (document.querySelector('[data-mobile-sheet]') as HTMLElement).getBoundingClientRect().top,
      }));
    });
    const tappable = pins.filter((p) => p.inViewport && p.y < p.topAt);
    const offscreen = pins.filter((p) => !p.inViewport || p.y >= p.topAt).map((p) => p.id);
    const front = tappable.filter((p) => p.facing && !p.behind);
    const back = tappable.filter((p) => !p.facing && !p.behind);
    console.log(
      `[M3] tappable ${tappable.length}/${pins.length} (excluded: ${offscreen.join(',') || 'none'}); ` +
        `front ${front.length}, back ${back.length}`,
    );
    expect(front.length, `no front-facing pin is on screen; excluded ${offscreen.join(',')}`).toBeGreaterThan(0);

    const cdp = await touch(page);
    /**
     * Clear the selection the way a PHONE can.
     *
     * NOT `Escape`. The drawer owns the Escape handler (`RegionDrawer.tsx:150-157`) and the drawer is desktop-only
     * on this release, so on a phone Escape is not a close path at all — measured: pressing it left `pacific`
     * selected for the full 20 s poll. The mobile close paths are a tap on empty canvas (which is what M3's other
     * case asserts) and the sheet's own Clear button at full tier. Using the canvas tap here keeps this case on a
     * path a user actually has, and the gap that Escape leaves is recorded in `docs/MOBILE.md`.
     */
    const clearSelection = async (): Promise<void> => {
      if ((await selected(page)) === null) return;
      await tapTouch(cdp, { x: 6, y: 6 });
      await expect.poll(() => selected(page), { timeout: 20_000, intervals: [150] }).toBeNull();
    };

    let frontHits = 0;
    /*
     * RE-PROJECT BEFORE EVERY TAP, and re-park the camera between taps.
     *
     * Measured on the third run: the first tap selected `pacific`, the region fly-to then ORBITED the camera to
     * face it, and the next tap still used a pixel captured before that flight — it landed on open ocean and
     * `pacific` stayed selected, which read as `us-west` failing. The pin list is only valid for the pose it was
     * measured in, so each iteration reads the pixel it is about to press, immediately before pressing it.
     *
     * `Escape` closes the region and the pose returns, which is also what keeps the two taps from compounding: a
     * tap while a region is open is a different state than a tap with nothing selected.
     */
    for (const id of front.map((p) => p.id)) {
      await clearSelection();
      await settleDistance(page);
      const now = await page.evaluate((pinId) => window.__globe!.pins().find((p) => p.id === pinId)!, id);
      await tapTouch(cdp, { x: now.x, y: now.y });
      await page.waitForTimeout(400);
      const got = await page.evaluate(() => window.__frame!.snapshot().regionId);
      if (got === id) frontHits += 1;
      else console.log(`[M3] MISS ${id} at (${now.x.toFixed(1)},${now.y.toFixed(1)}) -> ${got}`);
    }

    let backHits = 0;
    for (const id of back.map((p) => p.id)) {
      /*
       * A back pin is tapped with a region OPEN, so a failure to select is observable as a pointer-miss rather
       * than as silence — the same construction `pin-click.spec.ts` D5 uses.
       */
      await clearSelection();
      await settleDistance(page);
      const now = await page.evaluate((pinId) => window.__globe!.pins().find((p) => p.id === pinId)!, id);
      await tapTouch(cdp, { x: now.x, y: now.y });
      await page.waitForTimeout(400);
      const got = await page.evaluate(() => window.__frame!.snapshot().regionId);
      if (got === id) backHits += 1;
      else console.log(`[M3] back ${id} correctly did not select (topmost was ${got})`);
    }

    console.log(
      `[M3] front ${frontHits}/${front.length} selected, back ${backHits}/${back.length} selected at ` +
        `${PHONE.width}x${PHONE.height}`,
    );
    expect(frontHits, `front-facing pins: ${frontHits}/${front.length}`).toBe(front.length);
    expect(backHits, `back-facing pins must not select: ${backHits}/${back.length}`).toBe(0);
  });

  test('M3: a tap on the sheet does not clear the selection; a tap on empty canvas does', async ({ page }) => {
    await open(page);
    const cdp = await touch(page);

    /* Select a region through the sheet's own switcher, which is a real user path on a phone. */
    await page.evaluate(() => window.__globe!.setSpin?.(false, 0));
    await page.getByRole('slider', { name: 'Sheet position' }).press('End');
    await page.waitForTimeout(500);
    await page.locator('[data-region-id="pacific"]').tap();
    await expect.poll(() => selected(page), { timeout: 20_000, intervals: [250] }).toBe('pacific');

    /* A tap on the sheet's body. */
    const body = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-sheet]');
      const r = el!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + 40 };
    });
    await tapTouch(cdp, body);
    await page.waitForTimeout(500);
    expect(await selected(page), 'a tap on the sheet must not clear the selection').toBe('pacific');

    /* A tap on empty canvas ABOVE the sheet, where the globe is not under the finger. */
    await tapTouch(cdp, { x: 6, y: 6 });
    await expect.poll(() => selected(page), { timeout: 20_000, intervals: [250] }).toBeNull();
  });

  /* ---------------------------------------------------------------------- M4 tiers */

  test('M4: the sheet top is 692 / 439 / 101 px and data-tier follows the tier', async ({ page }) => {
    await open(page);
    const handle = page.getByRole('slider', { name: 'Sheet position' });

    const readTop = async () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-mobile-sheet]') as HTMLElement;
        return { top: el.getBoundingClientRect().top, tier: el.dataset.tier };
      });

    /* peek is the initial state. */
    let s = await readTop();
    expect(s.tier).toBe('peek');
    expect(Math.abs(s.top - TIER_TOPS.peek)).toBeLessThanOrEqual(2);

    await handle.press('ArrowUp');
    await page.waitForTimeout(600);
    s = await readTop();
    expect(s.tier).toBe('half');
    expect(Math.abs(s.top - TIER_TOPS.half)).toBeLessThanOrEqual(2);

    await handle.press('ArrowUp');
    await page.waitForTimeout(600);
    s = await readTop();
    expect(s.tier).toBe('full');
    expect(Math.abs(s.top - TIER_TOPS.full)).toBeLessThanOrEqual(2);
  });

  test('M4: at peek a canvas touch at y = 400 reaches OrbitControls', async ({ page }) => {
    await open(page);
    /* At peek the sheet top is ~692, so y = 400 is above it and must reach the canvas. */
    const owner = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, 400);
      return el ? el.tagName : null;
    });
    expect(owner, 'y = 400 at peek must be the canvas').toBe('CANVAS');
  });

  /* ----------------------------------------------------------------------- M5 drag */

  test('M5: a slow drag past the midpoint lands on half, a short drag returns, a flick lands on full', async ({
    page,
  }) => {
    await open(page);
    const cdp = await touch(page);

    const handleAt = async () => {
      const box = await page.getByRole('slider', { name: 'Sheet position' }).boundingBox();
      if (!box) throw new Error('the drag handle has no box');
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    /* Slow, past the midpoint: peek -> half. */
    let from = await handleAt();
    await dragTouch(cdp, from, { x: from.x, y: from.y - 220 }, 24, 30);
    await page.waitForTimeout(700);
    expect((await sheetState(page)).tier).toBe('half');

    /* Short drag, under 30 % of the gap: back to half, not further. */
    from = await handleAt();
    await dragTouch(cdp, from, { x: from.x, y: from.y - 40 }, 8, 40);
    await page.waitForTimeout(700);
    expect((await sheetState(page)).tier).toBe('half');

    /* A flick across both gaps: half -> full. */
    from = await handleAt();
    await dragTouch(cdp, from, { x: from.x, y: from.y - 320 }, 4, 8);
    await page.waitForTimeout(700);
    expect((await sheetState(page)).tier).toBe('full');
  });

  test('M5: the render counter does not change during a drag, and exactly one render follows release', async ({
    page,
  }) => {
    await open(page);
    const cdp = await touch(page);
    const box = await page.getByRole('slider', { name: 'Sheet position' }).boundingBox();
    if (!box) throw new Error('no handle box');
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    /*
     * Take the baseline at REST, not at `open()`: the app is still delivering its boot payload when `open`
     * returns, and the render that costs is not the drag's. See `settledRenders`.
     */
    await settledRenders(page);
    const before = await sheetState(page);
    const beforeRenders = before.renders;

    /* Start the drag and hold, reading the counter MID-gesture. */
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y, id: 1 }],
    });
    for (let i = 1; i <= 12; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x, y: from.y - i * 14, id: 1 }],
      });
      await page_wait(16);
    }

    const during = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-sheet]') as HTMLElement;
      return {
        renders: window.__mobileSheet!.read().renders,
        inline: el.style.transform,
        transitioning: el.style.transition,
      };
    });

    expect(during.renders, 'a drag must not re-render').toBe(beforeRenders);
    expect(during.inline, 'the transform must be written inline during the drag').toMatch(/translate3d/);
    expect(during.transitioning).toBe('none');

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);

    const after = await sheetState(page);
    expect(after.tier, 'the 12 x 14 px drag must resolve to a tier change, or the render count proves nothing')
      .not.toBe(before.tier);
    expect(after.renders - beforeRenders, 'exactly one render after release').toBe(1);
  });

  /* ------------------------------------------------------------------- M6 isolation */

  test('M6: a drag on the handle leaves the pose unchanged; a drag on the canvas changes it and not the sheet', async ({
    page,
  }) => {
    await open(page);
    const cdp = await touch(page);
    await page.evaluate(() => window.__globe!.setSpin?.(false, 0));
    await page.waitForTimeout(400);
    /* The fit must have ARRIVED before "the pose did not move" can mean anything — see `settleDistance`. */
    await settleDistance(page);

    const pose = () =>
      page.evaluate(() => {
        const cam = window.__camera as { position: { x: number; y: number; z: number } };
        const t = window.__globe!.target();
        /* The offset FROM THE TARGET, normalised — a direction, not a position. */
        const ox = cam.position.x - t[0];
        const oy = cam.position.y - t[1];
        const oz = cam.position.z - t[2];
        const d = Math.hypot(ox, oy, oz) || 1;
        return { d, dir: [ox / d, oy / d, oz / d] };
      });

    const beforeHandle = await pose();
    const box = await page.getByRole('slider', { name: 'Sheet position' }).boundingBox();
    if (!box) throw new Error('no handle box');
    const hx = box.x + box.width / 2;
    const hy = box.y + box.height / 2;
    await dragTouch(cdp, { x: hx, y: hy }, { x: hx, y: hy - 200 }, 16, 20);
    await page.waitForTimeout(700);
    const afterHandle = await pose();

    /*
     * 1e-6, not `toBeCloseTo(…, 6)` on an unarrived fit. Measured on the first run: the difference was 2.27e-4
     * with the sheet drag having touched nothing, because the fit was still easing toward a target of 5. After
     * `settleDistance` the same comparison reads 0 exactly. The tolerance is stated in absolute scene units —
     * 1e-6 R is 2.5e-4 px at d_fit, far below anything a camera write of any kind could hide behind.
     */
    expect(Math.abs(afterHandle.d - beforeHandle.d), 'a sheet drag must not move the camera').toBeLessThan(1e-6);

    const sheetBefore = await sheetState(page);
    /*
     * Drag on the canvas, well above the sheet — the POSITIVE CONTROL, and it is asserted on the DIRECTION.
     *
     * Measured: a one-finger drag is `THREE.TOUCH.ROTATE` (`GlobeScene.tsx`'s `touches` prop), which is an ORBIT.
     * An orbit changes the camera's direction and leaves its distance from the target alone — measured
     * 5.000000 -> 5.000000, delta -1.8e-15, direction moved 16.3 deg. Asserting on the distance here failed the
     * control on its first run for exactly that reason, so the control asserts the quantity the gesture actually
     * moves: 16-19 degrees of direction, measured on the same bundle.
     */
    /*
     * The start point is chosen from the LIVE sheet top rather than a literal, because the preceding handle drag
     * has already raised the sheet to `half` — its top is then ~439 px, and a control drag that began at y = 500
     * would land on the sheet body and scroll it instead of orbiting. Measured on the third run: a fixed y = 200
     * was fine here, but the same file raised the sheet before this point, so the point is derived.
     */
    const sheetTopNow = await page.evaluate(
      () => (document.querySelector('[data-mobile-sheet]') as HTMLElement).getBoundingClientRect().top,
    );
    const cy = Math.max(60, Math.min(200, sheetTopNow - 120));
    await dragTouch(cdp, { x: 200, y: cy }, { x: 260, y: cy + 40 }, 12, 20);
    await page.waitForTimeout(900);
    const afterCanvas = await pose();
    const sheetAfter = await sheetState(page);

    const dot =
      afterCanvas.dir[0] * beforeHandle.dir[0] +
      afterCanvas.dir[1] * beforeHandle.dir[1] +
      afterCanvas.dir[2] * beforeHandle.dir[2];
    const angle = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
    expect(angle, `a canvas drag must orbit the camera (${angle.toFixed(2)} deg)`).toBeGreaterThan(2);
    expect(sheetAfter.translateY, 'a canvas drag must not move the sheet').toBe(sheetBefore.translateY);
  });

  /* ------------------------------------------------------------------ M7 body scroll */

  test('M7: at full the body scrolls and the camera and transform are unchanged', async ({ page }) => {
    await open(page);
    await page.getByRole('slider', { name: 'Sheet position' }).press('End');
    await page.waitForTimeout(700);
    /*
     * The fit must have ARRIVED before the baseline. Measured on the second run: the scroll moved the camera by
     * 3.56e-5, which is not a camera write — it is the fit's own distance channel still easing toward `dTarget`
     * while the 900 ms scroll ran. `settleDistance` waits for two identical reads of the live distance, and after
     * it the same comparison reads 0.
     */
    await settleDistance(page);

    const before = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-sheet]') as HTMLElement;
      const body = el.querySelector('.overflow-y-auto') as HTMLElement;
      const cam = window.__camera as { position: { x: number; y: number; z: number } };
      return {
        scrollTop: body.scrollTop,
        scrollable: body.scrollHeight > body.clientHeight,
        transform: el.style.transform,
        d: Math.hypot(cam.position.x, cam.position.y, cam.position.z),
        overscroll: getComputedStyle(body).overscrollBehavior,
        touchAction: getComputedStyle(body).touchAction,
      };
    });

    expect(before.scrollable, 'the full-tier body must be scrollable for this case to mean anything').toBe(true);
    expect(before.overscroll).toBe('contain');
    expect(before.touchAction).toBe('pan-y');

    /* Scroll the body with a real touch drag inside it. */
    const cdp = await touch(page);
    const bodyBox = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-sheet]') as HTMLElement;
      const body = el.querySelector('.overflow-y-auto') as HTMLElement;
      const r = body.getBoundingClientRect();
      return { x: r.x + r.width / 2, top: r.y, h: r.height };
    });
    await dragTouch(
      cdp,
      { x: bodyBox.x, y: bodyBox.top + bodyBox.h - 40 },
      { x: bodyBox.x, y: bodyBox.top + 60 },
      14,
      20,
    );
    await page.waitForTimeout(900);

    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-sheet]') as HTMLElement;
      const body = el.querySelector('.overflow-y-auto') as HTMLElement;
      const cam = window.__camera as { position: { x: number; y: number; z: number } };
      return {
        scrollTop: body.scrollTop,
        transform: el.style.transform,
        d: Math.hypot(cam.position.x, cam.position.y, cam.position.z),
      };
    });

    expect(after.scrollTop, 'the body must have scrolled').toBeGreaterThan(before.scrollTop);
    expect(after.transform).toBe(before.transform);
    /* Absolute, for the reason stated in M6: an unarrived fit is what a loose relative tolerance would hide. */
    expect(Math.abs(after.d - before.d), 'scrolling the body must not move the camera').toBeLessThan(1e-6);
  });

  /* --------------------------------------------------------------- M8 capture paths */

  test('M8: a drag that leaves the handle still tracks, and a touchCancel leaves no stuck state', async ({ page }) => {
    await open(page);
    const cdp = await touch(page);
    const box = await page.getByRole('slider', { name: 'Sheet position' }).boundingBox();
    if (!box) throw new Error('no handle box');
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    /* Move well outside the handle AND outside the window's horizontal extent mid-drag. */
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y, id: 1 }],
    });
    for (let i = 1; i <= 10; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + i * 20, y: from.y - i * 20, id: 1 }],
      });
      await page_wait(16);
    }
    /* The drag must still be tracking: the transform moved from the tier's own value. */
    const mid = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-sheet]') as HTMLElement;
      return el.style.transform;
    });
    expect(mid).toMatch(/translate3d/);

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);

    const released = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-sheet]') as HTMLElement;
      return { tier: el.dataset.tier, transform: el.style.transform };
    });
    expect(Object.keys(TIER_TOPS)).toContain(released.tier);

    /* Now a CANCEL mid-drag: the sheet must snap to a tier, not stay wherever the finger was. */
    const beforeCancel = await sheetState(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y, id: 1 }],
    });
    for (let i = 1; i <= 8; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x, y: from.y - i * 22, id: 1 }],
      });
      await page_wait(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(900);

    const settled = await page.evaluate(() => {
      const el = document.querySelector('[data-mobile-sheet]') as HTMLElement;
      const probe = window.__mobileSheet!.read();
      return { tier: el.dataset.tier, translateY: el.style.transform, probe, probeTier: probe.tier };
    });
    expect(Object.keys(TIER_TOPS)).toContain(settled.tier);
    /* And the sheet is AT a snap point, not stranded mid-gesture. */
    expect(settled.translateY).not.toBe('');
    expect(beforeCancel.drags).toBeGreaterThan(0);
    expect(settled.probeTier).toBe(settled.tier);
  });

  /* ---------------------------------------------------------------------- M9 island */

  test('M9: the island text matches formatIsland of the live store, and the scrubber drives the globe', async ({
    page,
  }) => {
    await open(page);

    const readIsland = () =>
      page.evaluate(() => {
        const btn = document.querySelector('[data-testid="mobile-island"]');
        return btn ? (btn.textContent ?? '').trim() : null;
      });

    const expectedText = async () =>
      page.evaluate(() => {
        const s = window.__frame!.snapshot();
        void s;
        /* The store's own value, read from the sheet's probe inputs — the anomaly is on the sheet's header. */
        const el = document.querySelector('[data-mobile-sheet] .num');
        return el ? el.textContent?.trim() ?? '' : '';
      });

    const text = await readIsland();
    expect(text, 'the island must exist').not.toBeNull();
    expect(text!, 'the island must print the formatIsland shape').toMatch(/^ENSO: /);
    expect(text!, 'the island must never print a literal — it must carry a signed temperature').toMatch(/°C/);
    /* And it must agree with the sheet's own reading of the same store value. */
    const sheetReading = await expectedText();
    expect(text!).toContain(sheetReading.replace('°C', '').trim());

    /* Expand and use the scrubber. */
    await page.getByTestId('mobile-island').tap();
    await expect
      .poll(() => page.getByTestId('mobile-island').getAttribute('aria-expanded'))
      .toBe('true');

    const distanceBefore = await page.evaluate(() => window.__globe!.distance());
    const scrubber = page.getByRole('slider', { name: 'Global SST anomaly' }).first();
    await scrubber.evaluate((el: HTMLInputElement) => {
      el.value = '2.40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(900);

    /* The island text moved with the store, and the globe followed it. */
    await expect
      .poll(async () => readIsland(), { timeout: 15_000, intervals: [200] })
      .toMatch(/2[.,]4/);
    const distanceAfter = await page.evaluate(() => window.__globe!.distance());
    expect(distanceBefore).toBeGreaterThan(0);
    expect(Number.isFinite(distanceAfter)).toBe(true);
  });

  test('M9: Reset works from the mobile layout', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__globe!.setSpin?.(false, 0));
    await page.getByRole('slider', { name: 'Sheet position' }).press('End');
    await page.waitForTimeout(500);
    await page.locator('[data-region-id="us-west"]').tap();
    await expect.poll(() => selected(page), { timeout: 20_000, intervals: [250] }).toBe('us-west');

    await page.getByRole('button', { name: /reset view/i }).tap();
    await expect.poll(() => selected(page), { timeout: 20_000, intervals: [250] }).toBeNull();
  });

  /* --------------------------------------------------------------- M10 inert and a11y */

  test('M10: out-of-view controls are not focusable, and keyboard tier changes work', async ({ page }) => {
    await open(page);

    /*
     * THE HALF-TIER CONTROLS, AS THE KEYBOARD SEES THEM.
     *
     * Two facts, both measured (`.cache/mob/probe-tab.spec.ts`): at peek all four chips have `getClientRects()
     * .length === 0` — they sit inside a `hidden` parent, not merely a zero-height one — and a twelve-Tab walk
     * from the handle never lands on one, nor on any of the three sliders. At full the same walk lands on
     * `Global SST anomaly`, the two other sliders and all four chips, in that order.
     *
     * The assertion is therefore a real one in BOTH directions: the controls are unreachable at peek and
     * reachable at full. An earlier revision asserted only `>= 0` on a count of hidden chips, which cannot fail
     * and so proved nothing about either tier.
     */
    const walk = async (from: 'peek' | 'full'): Promise<string[]> => {
      const handle = page.getByRole('slider', { name: 'Sheet position' });
      await handle.focus();
      if (from === 'full') {
        await handle.press('End');
        await page.waitForTimeout(600);
      }
      const seen: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        seen.push(
          await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return 'body';
            return el.getAttribute('aria-label') ?? el.getAttribute('data-region-id') ?? el.tagName.toLowerCase();
          }),
        );
      }
      return seen;
    };

    const peekWalk = await walk('peek');
    for (const hidden of ['pacific', 'us-west', 'se-asia', 'horn-africa', 'Global SST anomaly']) {
      expect(peekWalk, `"${hidden}" must not be reachable at peek`).not.toContain(hidden);
    }

    const fullWalk = await walk('full');
    for (const reachable of ['Global SST anomaly', 'pacific', 'horn-africa']) {
      expect(fullWalk, `"${reachable}" must be reachable at full`).toContain(reachable);
    }

    /* Home from full returns the handle to peek, and the keyboard contract reports it. */
    const handle = page.getByRole('slider', { name: 'Sheet position' });
    await handle.press('Home');
    await page.waitForTimeout(600);
    expect(await handle.getAttribute('aria-valuenow')).toBe('0');
    expect(await handle.getAttribute('aria-valuetext')).toBe('Peek');

    await handle.press('End');
    await page.waitForTimeout(600);
    expect(await handle.getAttribute('aria-valuenow')).toBe('2');
    expect(await handle.getAttribute('aria-valuetext')).toBe('Full');

    await handle.press('Home');
    await page.waitForTimeout(600);
    expect(await handle.getAttribute('aria-valuenow')).toBe('0');
    expect(await handle.getAttribute('aria-valuetext')).toBe('Peek');
  });
});
