/**
 * TABLET-PORTRAIT — the shell decision at a tablet held upright.
 *
 * ## The defect this file is the acceptance case for
 *
 * Before this rule, `resolveLayoutMode` sent every viewport 1024 px wide or wider to the desktop shell
 * regardless of shape, so an iPad Pro (1032x1376 upright, 1024x1366 upright) got the whole desktop overlay
 * stack: a 361 px control panel down the left, a 316 px card column down the right, and the globe squeezed into
 * whatever band survived. The rule adds a second width threshold, `TABLET_PORTRAIT_MAX_W` (1280), bounding only
 * the ASPECT half of the portrait clause. Nothing else moves: `DESKTOP_MIN_W` still bounds the landscape phone
 * clause, 1280 wide is still desktop, and a square viewport is still desktop.
 *
 * ## What is asserted, and why each assertion is the honest one
 *
 * Every case reads the fact from two independent places: `data-layout-mode` (what the shell mounted) and
 * `__frame.layoutMode` (what the camera director published). Those are separate readers of one store, so a case
 * that saw them disagree would be reporting a real bug rather than a stale DOM read.
 *
 * The plainest statement of "the desktop shell is gone" is the pair of occluders that only exist in it:
 * `[data-occluder="compact-header"]` present, `[data-occluder="left-panel"]` absent-or-not-displayed. The
 * inverse rows assert the occluders that only exist in desktop mode.
 *
 * The globe assertion is geometric rather than stylistic: the projected centre must land inside the free
 * rectangle the director published. That is the property the squished layout broke — the globe was still
 * rendered, it was just no longer where the framing arithmetic thought it was.
 *
 * ## Not a locked spec
 *
 * This file is new and is not in the 15-file locked set, so it may be edited as the rule evolves. It edits no
 * locked spec and replaces no assertion in one.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page } from '@playwright/test';

const LIVE = '/?debug&framing=live';

/** Upright tablets: the rows the rule exists for. */
const PORTRAIT_TABLETS = [
  { width: 1032, height: 1376, label: 'iPad Pro 13 upright' },
  { width: 1024, height: 1366, label: 'iPad Pro 11 upright' },
] as const;

/** Landscape tablets and the desktop band: these must NOT move. */
const DESKTOPS = [
  { width: 1376, height: 1032, label: 'iPad Pro 13 landscape' },
  { width: 1194, height: 834, label: 'iPad Pro 13 landscape (other reported size)' },
  { width: 1280, height: 1400, label: 'upright at exactly the threshold: strict, so desktop' },
] as const;

/**
 * Open at a viewport and wait for a settled live frame.
 *
 * Reads `framing=live` rather than the locked default because the free rectangle and the view offset only exist
 * on the live path — an unlocked frame reports its defaults and every geometric assertion below would be
 * vacuous.
 */
async function open(page: Page, vp: { width: number; height: number }): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
  await page.goto(LIVE);
  await expect
    .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
      timeout: 90_000,
      intervals: [250],
    })
    .toBe('live');
  /* One frame after the mode has been published is enough for the shell and the occluders to be in the DOM. */
  await page.waitForTimeout(1500);
}

/** The mode as both readers see it. */
async function modes(page: Page): Promise<{ dom: string | null; frame: string }> {
  return page.evaluate(() => ({
    dom: document.querySelector('[data-layout-mode]')?.getAttribute('data-layout-mode') ?? null,
    frame: window.__frame!.layoutMode,
  }));
}

test.describe('TABLET-PORTRAIT: an upright tablet gets the mobile shell', () => {
  for (const vp of PORTRAIT_TABLETS) {
    test(`${vp.width}x${vp.height} is portrait with the mobile shell (${vp.label})`, async ({ page }) => {
      await open(page, vp);

      /*
       * The mode, from both readers. `data-layout-mode` is the shell's own attribute; `__frame.layoutMode` is
       * the director's two-way read. Both must say portrait, or the DOM and the camera disagree about which
       * layout is mounted.
       */
      const m = await modes(page);
      expect(m.dom, 'data-layout-mode').toBe('portrait');
      expect(m.frame, '__frame.layoutMode').toBe('portrait');

      /* The compact header is the mobile shell's own top bar. It must exist. */
      await expect(page.locator('[data-occluder="compact-header"]')).toHaveCount(1);

      /*
       * The desktop left panel must be either absent or not displayed. Asserting `toHaveCount(0)` OR
       * not-visible is deliberately loose on the mechanism and strict on the observation: the element is mounted
       * unconditionally and hidden by the mode class, so "count 0" would be asserting an implementation detail.
       */
      const left = page.locator('[data-occluder="left-panel"]');
      const leftCount = await left.count();
      if (leftCount > 0) {
        await expect(left, 'left-panel must not be displayed in portrait mode').not.toBeVisible();
      }

      /* The desktop-only furniture must be gone with it: the mouse hint and the region card column. */
      await expect(page.locator('[data-occluder="right-panel"]')).toHaveCount(0);
      await expect(page.locator('[data-occluder="top-panel"]')).toHaveCount(0);
      /*
       * The mouse hint names a mouse. There is no data attribute on it, so it is found by its own content — the
       * three keycap labels — which is what a reader would look for too. Outside the MobileShell is the point:
       * the sheet may legitimately render the words, the desktop overlay may not.
       */
      const hintOutsideShell = await page.evaluate(() => {
        const shell = document.querySelector('[data-mobile-sheet]');
        const all = Array.from(document.querySelectorAll('div'));
        const hint = all.find(
          (d) =>
            d.querySelector('kbd') !== null &&
            d.textContent !== null &&
            d.textContent.includes('Drag') &&
            d.textContent.includes('orbit') &&
            d.textContent.includes('Click pin'),
        );
        if (!hint) return { found: false, outsideShell: false, shown: false };
        const cs = getComputedStyle(hint);
        const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && hint.getBoundingClientRect().width > 0;
        return { found: true, outsideShell: shell ? !shell.contains(hint) : true, shown };
      });
      expect(
        hintOutsideShell.shown && hintOutsideShell.outsideShell,
        `the desktop mouse hint must not be shown outside the MobileShell (found=${hintOutsideShell.found}, outside=${hintOutsideShell.outsideShell}, shown=${hintOutsideShell.shown})`,
      ).toBe(false);

      /* The region cards column: gone, because its parent is not mounted at all in mobile mode. */
      await expect(page.getByText('Impact Zones', { exact: false }).filter({ has: page.locator('button') })).toHaveCount(0);

      /* No horizontal overflow. */
      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(widths.scrollWidth, `scrollWidth ${widths.scrollWidth} vs clientWidth ${widths.clientWidth}`).toBe(
        widths.clientWidth,
      );

      /*
       * The globe must sit where the framing arithmetic says. `__globe.project` returns the orbit target's pixel
       * position; the free rect is what the director fitted the disc into. A centre outside it is the squished
       * layout in one number.
       */
      const geo = await page.evaluate(() => {
        const c = window.__globe!.project();
        const f = window.__frame!.free;
        const r = window.__globe!.discRadiusPx();
        return { cx: c.x, cy: c.y, behind: c.behind, free: f, radius: r };
      });
      expect(geo.behind, 'the globe centre must not be behind the camera').toBe(false);
      expect(geo.free.w, 'the free rect must have area').toBeGreaterThan(0);
      expect(geo.free.h, 'the free rect must have area').toBeGreaterThan(0);
      const inside =
        geo.cx >= geo.free.x &&
        geo.cx <= geo.free.x + geo.free.w &&
        geo.cy >= geo.free.y &&
        geo.cy <= geo.free.y + geo.free.h;
      expect(
        inside,
        `projected centre (${geo.cx.toFixed(1)}, ${geo.cy.toFixed(1)}) must lie inside the free rect ` +
          `x ${geo.free.x.toFixed(1)}..${(geo.free.x + geo.free.w).toFixed(1)}, ` +
          `y ${geo.free.y.toFixed(1)}..${(geo.free.y + geo.free.h).toFixed(1)}; disc radius ${geo.radius.toFixed(1)}`,
      ).toBe(true);
    });
  }

  for (const vp of DESKTOPS) {
    test(`${vp.width}x${vp.height} is desktop and keeps the desktop shell (${vp.label})`, async ({ page }) => {
      await open(page, vp);

      const m = await modes(page);
      expect(m.dom, 'data-layout-mode').toBe('desktop');
      expect(m.frame, '__frame.layoutMode').toBe('desktop');

      /* The desktop furniture is present and displayed. */
      await expect(page.locator('[data-occluder="top-panel"]')).toHaveCount(1);
      await expect(page.locator('[data-occluder="right-panel"]')).toHaveCount(1);
      await expect(page.locator('[data-occluder="left-panel"]')).toBeVisible();
      /* And the mobile shell is not. */
      await expect(page.locator('[data-occluder="compact-header"]')).toHaveCount(0);
      await expect(page.locator('[data-mobile-sheet]')).toHaveCount(0);
    });
  }
});

test.describe('TABLET-PORTRAIT: rotation', () => {
  /**
   * Rotate the device and require the mode to follow, with no console errors.
   *
   * The view-offset assertion is the one that would catch a half-applied transition: the offset is a MOBILE-only
   * transform, and returning to desktop must clear it, or the desktop picture stays shifted by a lens that no
   * longer has a reason to exist. `viewOffsetX` and `viewOffsetY` are the probe's own fields, defaulted to 0 in
   * desktop mode.
   */
  test('1032x1376 -> 1376x1032 -> 1032x1376 follows the mode, clears the offset, and logs nothing', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    /* Portrait first. */
    await open(page, { width: 1032, height: 1376 });
    await expect.poll(() => modes(page).then((m) => m.dom), { timeout: 30_000, intervals: [200] }).toBe('portrait');
    await expect(page.locator('[data-occluder="compact-header"]')).toHaveCount(1);

    /* Rotate to landscape: the mode must follow the aspect, not the height. */
    await page.setViewportSize({ width: 1376, height: 1032 });
    await expect.poll(() => modes(page).then((m) => m.dom), { timeout: 30_000, intervals: [200] }).toBe('desktop');
    await expect.poll(() => modes(page).then((m) => m.frame), { timeout: 30_000, intervals: [200] }).toBe('desktop');
    await expect(page.locator('[data-occluder="compact-header"]')).toHaveCount(0);
    await expect(page.locator('[data-occluder="top-panel"]')).toHaveCount(1);

    /*
     * The desktop transition cleared the mobile lens. Polled rather than read once: the director applies the
     * change on its next frame after the resize, and the resize event itself is asynchronous.
     */
    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            x: window.__frame!.viewOffsetX,
            y: window.__frame!.viewOffsetY,
          })),
        { timeout: 30_000, intervals: [200] },
      )
      .toEqual({ x: 0, y: 0 });

    /* And back to portrait: the mobile shell returns, and the lens is allowed to be non-zero again. */
    await page.setViewportSize({ width: 1032, height: 1376 });
    await expect.poll(() => modes(page).then((m) => m.dom), { timeout: 30_000, intervals: [200] }).toBe('portrait');
    await expect(page.locator('[data-occluder="compact-header"]')).toHaveCount(1);
    await expect(page.locator('[data-occluder="top-panel"]')).toHaveCount(0);

    /*
     * No console errors across the whole rotation. Filtered for the one class of message this app emits on a
     * benign path: a network 404 for an absent optional asset. Everything else is a failure.
     */
    const real = errors.filter((e) => !/favicon|404 \(Not Found\)|Failed to load resource/i.test(e));
    expect(real, `console errors during rotation:\n  ${real.join('\n  ')}`).toEqual([]);
  });
});
