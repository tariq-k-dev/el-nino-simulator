/**
 * IN-DRAWER REGION SWITCHER acceptance (step 3B2-FIX2 B).
 *
 * ## The defect this certifies
 *
 * The drawer is a 418 px `z-30` panel over the Impact Zones card list at `z-20`, so once it is open every
 * card centre resolves to a node INSIDE the drawer (`document.elementFromPoint`) and a real mouse click on a
 * card never reaches it. Measured again for this step at both spec viewports: all four card centres return
 * `topInDrawer: true, isCard: false`. The only ways to change region were: close the drawer first, click a
 * pin on the globe, or use the keyboard on a card the user cannot see. The switcher row inside the drawer is
 * the mouse path that was missing.
 *
 * ## Why every click here is a REAL `page.mouse` click guarded by `elementFromPoint`
 *
 * The defect is an occlusion defect. `locator.click()` would scroll and re-target and quietly pass on a
 * covered element, and a synthetic `.click()` in `evaluate` bypasses hit-testing entirely — so either would
 * certify a switcher that a user still cannot press. Each case first asserts the topmost element at the
 * chip's own centre is the chip or a descendant, then clicks those coordinates.
 *
 * ## What a retarget must AND must not do
 *
 * Must: switch the active region, fly the camera, leave the state `focusing` then `focused`, and leave the
 * drawer OPEN (its open/closed is a function of `activeRegion`, so "open" is the proof the retarget took the
 * selection path rather than a close-then-open).
 *
 * Must not: move the DRAWER's box (a `position: static` row cannot), change the right inset, change the
 * `d_fit` distance law (`U3b`: a select never re-takes a zoomed distance), dip the camera below its start
 * distance mid-flight (`AM2(c)`), move `controls.target` off the origin (face-pin is structural), or move
 * keyboard focus off the chip.
 *
 * ## 1024x768 is excluded
 *
 * It is excluded for the same reason `focus-ux.spec.ts` U2 excludes it: its free rect is 347 px wide and
 * `d_contain` 7.45 exceeds `dMax`, so the fit is clamped and "the distance is `d_fit`" is not a statement
 * that viewport can make. It is also a viewport where the drawer covers the whole screen width budget, and
 * the row is not the interesting part of that debt.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page } from '@playwright/test';

const LIVE = '/?debug&framing=live';

const REGIONS = [
  { id: 'pacific', card: /Pacific/i, chip: 'pacific' },
  { id: 'us-west', card: /California/i, chip: 'us-west' },
  { id: 'se-asia', card: /Indonesia|Asia/i, chip: 'se-asia' },
  { id: 'horn-africa', card: /Africa|Horn/i, chip: 'horn-africa' },
  { id: 'amazon-basin', card: /Amazon/i, chip: 'amazon-basin' },
  { id: 'gulf-coast', card: /Gulf/i, chip: 'gulf-coast' },
] as const;

const FOV = 42;
const RE = 1.10242;
const PADDING = 24;
const D_MAX = 5;
const D0 = Math.hypot(0, 1.15, 3.15);

const DRAWER = '[data-occluder="right-drawer"]';
const SWITCHER = '[data-testid="drawer-switcher"]';
const RESET = '[data-testid="reset-view"]';

/* ------------------------------------------------------------------ helpers */

async function openLive(page: Page, vp: { w: number; h: number }): Promise<void> {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
  await page.goto(LIVE);
  await expect
    .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
      timeout: 90_000,
      intervals: [250],
    })
    .toBe('live');
  await page.waitForTimeout(2500);
  await settleStable(page);
}

/** The same-key-twice rest test the other live specs use. */
async function settleStable(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__swSettleKey;
  });
  await page.waitForFunction(
    () => {
      const s = window.__frame!.snapshot();
      const key = [s.insets.left, s.insets.right, s.free.x, s.free.y, s.free.w, s.free.h]
        .map((n) => n.toFixed(3))
        .join('|');
      const store = window as unknown as Record<string, unknown>;
      const previous = store.__swSettleKey;
      store.__swSettleKey = key;
      return s.settled && previous === key;
    },
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

/**
 * `d_contain` and `rMax` from first principles — deliberately not imported from `src/`.
 *
 * An assertion that the product agrees with its own module proves self-consistency only. This is the same
 * independent restatement `focus-ux.spec.ts` uses in `fitMath`.
 */
function fitMath(vp: { w: number; h: number }, free: { w: number; h: number }) {
  const rMax = 0.5 * Math.min(free.w, free.h) - PADDING;
  const focalPx = vp.h / 2 / Math.tan((FOV * Math.PI) / 180 / 2);
  const dContain = Math.sqrt(RE * RE + ((focalPx * RE) / rMax) ** 2);
  return { rMax, focalPx, dContain, dTarget: Math.min(Math.max(D0, dContain), D_MAX) };
}

function angleDeg(a: readonly number[], b: readonly number[]): number {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(d) * 180) / Math.PI;
}

/**
 * Open a region through its Impact Zones card, by whichever path a mouse CAN take.
 *
 * The first selection happens with the drawer CLOSED, so the card is genuinely on top and a real mouse click
 * works. Every later retarget goes through the switcher, which is the whole point of this step.
 */
async function selectFromCard(page: Page, re: RegExp): Promise<void> {
  const info = await page.evaluate((source) => {
    const rx = new RegExp(source);
    const panel = document.querySelector('[data-occluder="right-panel"]');
    if (!panel) return null;
    const btn = [...panel.querySelectorAll('button')].find((b) => rx.test(b.textContent ?? ''));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return { x: cx, y: cy, clickable: top === btn || btn.contains(top) };
  }, re.source);
  expect(info, `the card matching ${re} must exist`).not.toBeNull();
  expect(info!.clickable, 'precondition: with the drawer closed the card must be clickable').toBe(true);
  await page.mouse.click(info!.x, info!.y);
  await expect
    .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
    .toBe('focused');
}

/**
 * The chip centre plus the hit-test proof, then the real click.
 *
 * Returns the coordinates and what was on top, so a failure names the occluder instead of saying "click did
 * not work".
 */
async function clickChip(page: Page, id: string) {
  const info = await page.evaluate(
    ({ sel, regionId }) => {
      const row = document.querySelector(sel);
      if (!row) return null;
      const btn = [...row.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.getAttribute('data-region-id') === regionId,
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return {
        x: cx,
        y: cy,
        w: r.width,
        h: r.height,
        topIsChip: top === btn || btn.contains(top),
        topTag: top ? top.tagName : null,
        topText: top ? (top.textContent ?? '').trim().slice(0, 24) : null,
        label: (btn.textContent ?? '').trim(),
        ariaCurrent: btn.getAttribute('aria-current'),
        tabIndex: btn.tabIndex,
      };
    },
    { sel: SWITCHER, regionId: id },
  );
  expect(info, `the switcher must have a chip for ${id}`).not.toBeNull();
  expect(
    info!.topIsChip,
    `the chip for ${id} is covered at its own centre (top is ${info!.topTag} "${info!.topText}")`,
  ).toBe(true);
  await page.mouse.click(info!.x, info!.y);
  return info!;
}

/** One coherent read of the state a retarget is judged on. */
async function readState(page: Page) {
  return page.evaluate((sel) => {
    const f = window.__frame!.snapshot();
    const g = window.__globe!;
    const t = g.target();
    const cam = window.__camera as { position: { x: number; y: number; z: number } };
    const p = cam.position;
    const len = Math.hypot(p.x, p.y, p.z) || 1;
    const drawer = document.querySelector(sel);
    const chips = drawer
      ? [...drawer.querySelectorAll<HTMLButtonElement>('[data-testid="drawer-switcher"] button')]
      : [];
    return {
      free: f.free,
      insets: f.insets,
      focus: f.focus,
      regionId: f.regionId,
      userZoomed: f.userZoomed,
      hasRegion: f.hasRegion,
      distance: g.distance(),
      fitTarget: f.target.d,
      targetRadius: Math.hypot(t[0], t[1], t[2]),
      direction: [p.x / len, p.y / len, p.z / len],
      drawerAriaHidden: drawer ? drawer.getAttribute('aria-hidden') : null,
      drawerRect: drawer ? drawer.getBoundingClientRect().toJSON() : null,
      panelRect: drawer && drawer.firstElementChild
        ? drawer.firstElementChild.getBoundingClientRect().toJSON()
        : null,
      drawerScrollW: drawer ? drawer.scrollWidth : null,
      drawerClientW: drawer ? drawer.clientWidth : null,
      bodyScrollH: (() => {
        const body = drawer ? drawer.querySelector('.scroll-thin') : null;
        return body ? body.scrollHeight : null;
      })(),
      bodyClientH: (() => {
        const body = drawer ? drawer.querySelector('.scroll-thin') : null;
        return body ? body.clientHeight : null;
      })(),
      switcherRowScrollW: (() => {
        const row = document.querySelector('[data-testid="drawer-switcher"]');
        return row ? row.scrollWidth : null;
      })(),
      switcherRowClientW: (() => {
        const row = document.querySelector('[data-testid="drawer-switcher"]');
        return row ? row.clientWidth : null;
      })(),
      chipAriaCurrent: chips
        .filter((c) => c.getAttribute('aria-current') === 'true')
        .map((c) => c.getAttribute('data-region-id')),
      chipTabIndexes: chips.map((c) => c.tabIndex),
      activeElementRegion: (() => {
        const active = document.activeElement as HTMLElement | null;
        return active ? active.getAttribute('data-region-id') : null;
      })(),
      focusInDrawer: Boolean(document.activeElement && document.activeElement.closest(sel)),
    };
  }, DRAWER);
}

/** The pin's world normal for one region, from the probe (already spun). */
async function pinNormal(page: Page, id: string) {
  return page.evaluate((regionId) => {
    const w = window.__look!.pinsWorld().find((p) => p.name === regionId);
    if (!w) return null;
    const l = Math.hypot(w.core[0], w.core[1], w.core[2]) || 1;
    return [w.core[0] / l, w.core[1] / l, w.core[2] / l] as [number, number, number];
  }, id);
}

/* ------------------------------------------------------------------ tests */

test.describe('drawer region switcher', () => {
  test.setTimeout(300_000);

  for (const vp of [
    { w: 1440, h: 900 },
    { w: 1280, h: 720 },
  ] as const) {
    /**
     * S1 — the retarget itself: real mouse click on each OTHER chip, judged on six independent facts.
     */
    test(`S1 retarget: every other chip switches region and keeps the drawer open at ${vp.w}x${vp.h}`, async ({
      page,
    }) => {
      await openLive(page, vp);
      await selectFromCard(page, REGIONS[0].card);
      await settleStable(page);

      const base = await readState(page);
      expect(base.regionId, 'precondition: the first region is open').toBe('pacific');
      expect(base.drawerAriaHidden, 'precondition: the drawer is open').toBe('false');

      /* The row must not create horizontal scroll — the prompt's "may wrap, must not add h-scroll". */
      expect(
        base.switcherRowScrollW!,
        'the switcher row must not overflow horizontally (it may wrap)',
      ).toBeLessThanOrEqual(base.switcherRowClientW! + 0);
      console.log(
        `[S1:${vp.w}x${vp.h}] switcher row scrollWidth ${base.switcherRowScrollW} <= clientWidth ` +
          `${base.switcherRowClientW}; drawer panel ${JSON.stringify(base.panelRect)}`,
      );

      for (const target of REGIONS.slice(1)) {
        const chip = await clickChip(page, target.id);

        /* (1) it reaches the FOCUSING state, i.e. a flight really started. */
        await expect
          .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 15_000, intervals: [80] })
          .not.toBe('idle');
        /* (2) and it lands. */
        await expect
          .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
          .toBe('focused');
        await settleStable(page);
        await page.waitForTimeout(700);
        await settleStable(page);

        const after = await readState(page);
        const math = fitMath(vp, after.free);
        const normal = await pinNormal(page, target.id);
        expect(normal, `the probe must report a normal for ${target.id}`).not.toBeNull();
        const errDeg = angleDeg(after.direction, normal!);

        console.log(
          `[S1:${vp.w}x${vp.h}] ${base.regionId} -> ${after.regionId}: chip "${chip.label}" ` +
            `pre-click aria-current "${chip.ariaCurrent}", tabIndex ${chip.tabIndex}; face-pin error ` +
            `${errDeg.toFixed(4)} deg; d ${after.distance.toFixed(4)} (d_fit ${math.dTarget.toFixed(4)}); ` +
            `|target| ${after.targetRadius.toExponential(1)}; drawer aria-hidden ${after.drawerAriaHidden}`,
        );

        expect(after.regionId, 'the clicked chip becomes the active region').toBe(target.id);
        expect(after.focus, 'the machine reaches focused').toBe('focused');
        /* (3) the drawer stayed OPEN — the proof this was a retarget, not a close-and-reopen. */
        expect(after.drawerAriaHidden, 'the drawer must stay open across a retarget').toBe('false');
        expect(after.hasRegion).toBe(true);
        /* (4) face-pin: the camera is on the new pin's own normal. */
        expect(errDeg, `the camera must face ${target.id} after the retarget`).toBeLessThanOrEqual(0.1);
        /* (5) the U3b law: the distance follows the fit, and no wheel was turned. */
        expect(after.userZoomed, 'no wheel was turned, so userZoomed must stay false').toBe(false);
        expect(
          Math.abs(after.distance - math.dTarget),
          'the distance must be d_fit of the CURRENT free rect',
        ).toBeLessThan(0.002);
        /* (6) face-pin keeps the orbit target at the origin. */
        expect(after.targetRadius, 'controls.target must remain the origin').toBeLessThanOrEqual(1e-6);
        /* The active chip follows the selection. */
        expect(after.chipAriaCurrent, 'exactly one chip is aria-current, and it is the new region').toEqual([
          target.id,
        ]);
        /* The drawer's own box did not move. */
        expect(after.panelRect, 'the drawer panel rect must not change across a retarget').toEqual(base.panelRect);
        expect(after.drawerRect, 'the drawer wrapper rect must not change').toEqual(base.drawerRect);
        expect(after.insets, 'the right inset must not change').toEqual(base.insets);
        /* Focus was NOT moved off the chip the user pressed. */
        expect(after.activeElementRegion, 'a retarget must not move focus').toBe(target.id);
      }
    });

    /**
     * S2 — the active chip is a no-op, measured with a positive control.
     *
     * `selectRegion` bumps `focusNonce` on a repeat click, which restarts the fly-to. A no-op therefore has
     * an OBSERVABLE signature: the camera does not move and the machine does not leave `focused`.
     *
     * ## Why this sampler is a 16 ms interval and not `requestAnimationFrame`
     *
     * Measured: R3F runs a demand frameloop, so a page where nothing changes paints only ~26 times in 1.2 s
     * (26 frames at 1440x900, 31 at 1280x720). A rAF sampler therefore collects a frame count that depends
     * on how busy the renderer happens to be, and "the sampler collected too few frames" is a property of the
     * DEFECT being absent — a threshold on it would be measuring the wrong thing. A timer samples the
     * director's published state on a fixed clock instead, so the count is stable whatever the renderer does.
     *
     * ## Why there is a positive control
     *
     * "Nothing moved" is the easiest assertion in the world to satisfy with a sampler that never ran. So the
     * same sampler, in the same page, is first pointed at a click on a DIFFERENT chip and must SEE the flight
     * (direction move > 1 deg). Only then does the no-op reading mean anything.
     */
    test(`S2 active chip is a no-op: no new flight at ${vp.w}x${vp.h}`, async ({ page }) => {
      await openLive(page, vp);
      await selectFromCard(page, REGIONS[1].card);
      await settleStable(page);
      await page.waitForTimeout(700);
      await settleStable(page);

      const before = await readState(page);
      expect(before.regionId).toBe('us-west');

      /**
       * Start a 16 ms sampler in the page and return a handle to drain it.
       *
       * Deliberately NOT `requestAnimationFrame`: measured, a settled page with a demand frameloop paints only
       * ~26 times in 1.2 s, so a rAF sampler's frame count is a property of the renderer's idleness rather
       * than of the click. A fixed clock samples the director's published state regardless of whether a frame
       * was drawn, which is what makes the count stable across runs.
       */
      const startSampler = async () => {
        await page.evaluate(() => {
          const store = window as unknown as Record<string, unknown>;
          store.__swTrace = [] as Array<{ focus: string; region: string | null; d: number; dir: number[] }>;
          store.__swTimer = setInterval(() => {
            const g = window.__globe!;
            const cam = window.__camera as { position: { x: number; y: number; z: number } };
            const p = cam.position;
            const l = Math.hypot(p.x, p.y, p.z) || 1;
            (store.__swTrace as Array<{ focus: string; region: string | null; d: number; dir: number[] }>).push({
              focus: window.__frame!.focus,
              region: window.__frame!.regionId,
              d: g.distance(),
              dir: [p.x / l, p.y / l, p.z / l],
            });
          }, 16);
        });
      };

      const stopSampler = async () => {
        return page.evaluate(
          () =>
            (window as unknown as Record<string, Array<{ focus: string; region: string | null; d: number; dir: number[] }>>)
              .__swTrace ?? [],
        );
      };

      /** Summarise a trace against its first sample. */
      const summarise = (trace: Array<{ focus: string; region: string | null; d: number; dir: number[] }>) => {
        let maxDirMove = 0;
        let maxDistanceMove = 0;
        let leftFocused = 0;
        const first = trace[0];
        for (const s of trace) {
          maxDirMove = Math.max(maxDirMove, angleDeg(s.dir, first.dir));
          maxDistanceMove = Math.max(maxDistanceMove, Math.abs(s.d - first.d));
          if (s.focus !== 'focused') leftFocused += 1;
        }
        return { maxDirMove, maxDistanceMove, leftFocused, from: first.region, to: trace[trace.length - 1].region };
      };

      /* ---------------------------------------------------------------- positive control */
      /*
       * The same sampler, pointed at a DIFFERENT chip, must SEE a flight. Without this, "the camera did not
       * move" is satisfied by a sampler that never sampled, and the no-op case would certify nothing.
       */
      await startSampler();
      await clickChip(page, 'horn-africa');
      await expect
        .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
        .toBe('focused');
      const control = summarise(await stopSampler());
      console.log(
        `[S2:${vp.w}x${vp.h}] POSITIVE CONTROL (us-west -> horn-africa): ${control.maxDirMove.toFixed(3)} deg ` +
          `direction move, ${control.maxDistanceMove.toFixed(4)} distance move, focused ${control.leftFocused} left`,
      );
      expect(
        control.maxDirMove,
        'positive control: the sampler must SEE a real retarget, or the no-op case below proves nothing',
      ).toBeGreaterThan(1);

      /* Back to us-west so the active chip is the one we are about to click. */
      await settleStable(page);
      await page.waitForTimeout(700);
      await settleStable(page);
      await clickChip(page, 'us-west');
      await expect
        .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
        .toBe('focused');
      await settleStable(page);
      await page.waitForTimeout(700);
      await settleStable(page);

      const atRest = await readState(page);
      expect(atRest.regionId, 'precondition: us-west is active again').toBe('us-west');

      /* ---------------------------------------------------------------- the no-op */
      await startSampler();
      await clickChip(page, 'us-west');
      await page.waitForTimeout(1200);
      const trace = await stopSampler();
      expect(trace.length, 'the sampler must have collected a trace').toBeGreaterThan(30);

      const noop = summarise(trace);
      console.log(
        `[S2:${vp.w}x${vp.h}] NO-OP (active chip): over ${trace.length} samples, max direction move ` +
          `${noop.maxDirMove.toFixed(4)} deg, max distance move ${noop.maxDistanceMove.toExponential(2)}, ` +
          `samples not "focused" ${noop.leftFocused}, region ${noop.from} -> ${noop.to}`,
      );

      expect(noop.maxDirMove, 'a no-op click must not start a flight').toBeLessThan(0.05);
      expect(noop.maxDistanceMove, 'a no-op click must not move the distance').toBeLessThan(1e-3);
      expect(noop.leftFocused, 'the machine must not leave "focused" on the active chip').toBe(0);
      expect(noop.to, 'the region must not change').toBe('us-west');

      const after = await readState(page);
      expect(after.chipAriaCurrent).toEqual(['us-west']);
    });

  }

  /**
   * S3 — keyboard: Tab reaches the chips, Enter and Space both retarget.
   *
   * A real `keyboard.press`, not `fireEvent`. The row is inserted after the close button in DOM order, so
   * Tab from the close button must land on the first chip — that is the tab-order claim, and it is asserted
   * rather than assumed.
   */
  test('S3 keyboard: Tab, Enter and Space retarget from inside the drawer', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);
    await selectFromCard(page, REGIONS[0].card);
    await settleStable(page);

    /* Start from the drawer's own close button, the way a tabbing user arrives. */
    await page.locator('[aria-label="Close region panel"]').focus();
    await page.keyboard.press('Tab');

    const landed = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        region: el ? el.getAttribute('data-region-id') : null,
        inSwitcher: Boolean(el && el.closest('[data-testid="drawer-switcher"]')),
        tag: el ? el.tagName : null,
      };
    });
    console.log(`[S3] after Tab from the close button: ${landed.tag} region "${landed.region}"`);
    expect(landed.inSwitcher, 'Tab from the close button must reach the switcher row').toBe(true);
    /* The first chip in DOM order is pacific, and it is the ACTIVE one here. */
    expect(landed.region).toBe('pacific');

    /* One more Tab: us-west. Enter must retarget. */
    await page.keyboard.press('Tab');
    const second = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? el.getAttribute('data-region-id') : null;
    });
    expect(second).toBe('us-west');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);
    let st = await readState(page);
    console.log(`[S3] Enter on the us-west chip -> region ${st.regionId}, focus in drawer ${st.focusInDrawer}`);
    expect(st.regionId, 'Enter must retarget').toBe('us-west');
    expect(st.drawerAriaHidden).toBe('false');

    /* Tab to the next chip and use Space. */
    await page.keyboard.press('Tab');
    const third = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? el.getAttribute('data-region-id') : null;
    });
    expect(third).toBe('se-asia');
    await page.keyboard.press('Space');
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);
    st = await readState(page);
    console.log(`[S3] Space on the se-asia chip -> region ${st.regionId}`);
    expect(st.regionId, 'Space must retarget').toBe('se-asia');
    expect(st.chipAriaCurrent).toEqual(['se-asia']);
  });

  /**
   * S4 — every existing close path still closes, and after closing Tab never lands on a hidden chip.
   *
   * The switcher adds four focusable nodes inside a panel that is never unmounted, so the failure this guards
   * is specific: closed and `aria-hidden`, the chips must remove themselves from the tab order or a keyboard
   * user walks into an off-canvas panel.
   */
  test('S4 close paths still work, and closed chips are out of the tab order', async ({ page }) => {
    const vp = { w: 1440, h: 900 };

    for (const path of ['escape', 'button', 'pointer-miss', 'reset'] as const) {
      await openLive(page, vp);
      await selectFromCard(page, REGIONS[1].card);
      await settleStable(page);

      /* While open, the chips ARE tabbable. */
      const openState = await readState(page);
      expect(openState.chipTabIndexes.every((t) => t === 0), 'open: chips are tabbable').toBe(true);

      if (path === 'escape') {
        await page.keyboard.press('Escape');
      } else if (path === 'button') {
        await page.click('[aria-label="Close region panel"]');
      } else if (path === 'pointer-miss') {
        /* Empty sky inside the free rect, away from the disc's upper limb (the U5 coordinates). */
        await page.mouse.click(560, 250);
      } else {
        await page.click(RESET);
      }

      await expect
        .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
        .toBe('idle');
      await settleStable(page);

      const closed = await readState(page);
      console.log(
        `[S4:${path}] focus "${closed.focus}", region ${closed.regionId}, drawer aria-hidden ` +
          `"${closed.drawerAriaHidden}", chip tabIndexes ${JSON.stringify(closed.chipTabIndexes)}`,
      );
      expect(closed.regionId, `${path} must clear the selection`).toBeNull();
      expect(closed.drawerAriaHidden, `${path} must close the drawer`).toBe('true');
      expect(
        closed.chipTabIndexes.every((t) => t === -1),
        'closed: no chip may be in the tab order',
      ).toBe(true);

      /* And a full lap of the tab order never lands on a hidden CHIP. */
      /*
       * Scoped to the chips deliberately. MEASURED (`.cache/fix2/tab-probe.mjs`, 28 Tab stops from a blurred
       * page at 1440x900): the chips are correctly out of the tab order (`tabIndex -1`, zero landings), and
       * ONE landing inside the closed drawer remains — the pre-existing close button, which has always been a
       * live tab stop in an `aria-hidden` panel. That is a real accessibility debt, but it predates this step,
       * the prompt says the drawer's X is untouched, and asserting on it here would make this step's spec the
       * first place it is reported — as a failure of a switcher that did not cause it. The narrower assertion
       * is the one this step actually earns.
       */
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      let landedOnChip = 0;
      let landedInDrawer = 0;
      for (let i = 0; i < 32; i += 1) {
        await page.keyboard.press('Tab');
        const hit = await page.evaluate((sel) => {
          const el = document.activeElement;
          return {
            inDrawer: Boolean(el && el.closest(sel)),
            onChip: Boolean(el && el.closest('[data-testid="drawer-switcher"]')),
          };
        }, DRAWER);
        if (hit.inDrawer) landedInDrawer += 1;
        if (hit.onChip) landedOnChip += 1;
      }
      console.log(
        `[S4:${path}] 28 Tab stops: ${landedOnChip} landed on a closed chip, ${landedInDrawer} landed inside ` +
          `the closed drawer (the pre-existing close button)`,
      );
      expect(landedOnChip, 'Tab must never land on a closed (aria-hidden) chip').toBe(0);
    }
  });

  /**
   * S5 — the drawer's rects and the 418 px inset are untouched, and the body absorbs the new row.
   *
   * The row is a `shrink-0` sibling of the scrolling body, so the panel's box cannot grow. This asserts that
   * from geometry at both viewports, and asserts the body really does scroll (so the row is being absorbed
   * rather than pushing the footer off the panel).
   */
  for (const vp of [
    { w: 1440, h: 900 },
    { w: 1280, h: 720 },
  ] as const) {
    test(`S5 drawer geometry unchanged and body scrolls at ${vp.w}x${vp.h}`, async ({ page }) => {
      await openLive(page, vp);
      const closed = await readState(page);
      await selectFromCard(page, REGIONS[2].card);
      await settleStable(page);
      await page.waitForTimeout(500);
      const open = await readState(page);

      console.log(
        `[S5:${vp.w}x${vp.h}] closed wrapper ${JSON.stringify(closed.drawerRect)}; open wrapper ` +
          `${JSON.stringify(open.drawerRect)}; open panel ${JSON.stringify(open.panelRect)}; ` +
          `insets.right ${open.insets.right}; body ${open.bodyScrollH} in ${open.bodyClientH}`,
      );

      /* The wrapper is the 418 px panel that sets the inset. */
      expect(open.drawerRect!.width, 'the drawer wrapper must stay 418 px wide').toBeCloseTo(418, 1);
      expect(open.insets.right, 'the right inset must still be 418').toBe(418);
      /* The panel: 386 wide (418 - 2 x 16 padding), and its top/bottom come from the wrapper's padding. */
      expect(open.panelRect!.width, 'the drawer panel must stay 386 px wide').toBeCloseTo(386, 1);
      expect(open.panelRect!.x, 'the panel must not move').toBeCloseTo(open.drawerRect!.x + 16, 1);
      /* The body scrolls, which is what absorbs the row. */
      expect(
        open.bodyScrollH!,
        'the body must have content taller than its box (the row is absorbed by the scroll, not the panel)',
      ).toBeGreaterThan(open.bodyClientH!);
      /* No horizontal scroll anywhere in the drawer. */
      expect(open.drawerScrollW, 'the drawer must not scroll horizontally').toBeLessThanOrEqual(
        open.drawerClientW! + 1,
      );
      expect(
        open.switcherRowScrollW!,
        'the switcher row must not scroll horizontally',
      ).toBeLessThanOrEqual(open.switcherRowClientW! + 1);
    });
  }
});
