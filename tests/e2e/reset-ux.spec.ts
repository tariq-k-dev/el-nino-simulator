/**
 * RESET UX acceptance — Reset View returns the app to its exact load state (step 3B2-FIX1 B, cases R1-R4).
 *
 * ## The defect this certifies
 *
 * `Reset View` used to raise only the camera's RESET intent. The camera returned to the framed default pose
 * and the spin resumed, but `activeRegion` was never cleared, so the region card and the drawer stayed open
 * over a default-pose globe — a state the app never loads into, reachable only from Reset. B2 routes Reset
 * through `scene/resetView.ts`, which drives BOTH channels: the camera intent and `selectRegion(null)`, the
 * same path the drawer's X and Escape take.
 *
 * ## What is asserted, and why each item is separate
 *
 * "Back to the load state" is six independent facts, and the bug satisfied five of them. Each is asserted on
 * its own so a regression names the fact that broke:
 *
 *   1. `activeRegion` is null (the drawer's `aria-hidden` and the probe's `regionId`);
 *   2. the drawer is CLOSED — the same selector U5 uses, `[data-occluder="right-drawer"]`;
 *   3. the machine is `idle`;
 *   4. the pose is the framed default — direction against the pre-selection pose, distance at `d_fit`;
 *   5. `controls.target` is the origin, `userZoomed` false, spin true, `viewIsDefault` true;
 *   6. the Reset control is `aria-disabled` again.
 *
 * ## The baseline, and why it is sampled in the same test
 *
 * Every case compares against a pose sampled right after a FRESH LOAD of the same viewport, rather than
 * against a hardcoded vector. The load pose is the product's own definition of "the load state", and it is
 * the only oracle that cannot drift when the fit, the insets or the default camera change.
 *
 * ## Reset in mid-flight
 *
 * R3 clicks Reset while the machine is still `focusing`. The assertion is not "the flight stops" — it is
 * that the final state is the SAME load state, which is what makes Reset an unconditional exit rather than
 * a queue position.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page } from '@playwright/test';

const LIVE = '/?debug&framing=live';

const REGIONS = [
  { id: 'pacific', card: /Pacific/i },
  { id: 'us-west', card: /California/i },
  { id: 'se-asia', card: /Indonesia|Asia/i },
  { id: 'horn-africa', card: /Africa|Horn/i },
] as const;

const FOV = 42;
const RE = 1.10242;
const PADDING = 24;
const D_MAX = 5;
const D0 = Math.hypot(0, 1.15, 3.15);
const RESET = '[data-testid="reset-view"]';
const DRAWER = '[data-occluder="right-drawer"]';

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

/** The same-key-twice rest test `focus-ux.spec.ts` and `frame.spec.ts` use. */
async function settleStable(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__resetSettleKey;
  });
  await page.waitForFunction(
    () => {
      const s = window.__frame!.snapshot();
      const key = [s.insets.left, s.insets.right, s.free.x, s.free.y, s.free.w, s.free.h]
        .map((n) => n.toFixed(3))
        .join('|');
      const store = window as unknown as Record<string, unknown>;
      const previous = store.__resetSettleKey;
      store.__resetSettleKey = key;
      return s.settled && previous === key;
    },
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

/** The fit's analytic target distance, from `src/layout/frame.ts`'s own formula. */
function fitMath(vp: { w: number; h: number }, free: { w: number; h: number }) {
  const rMax = 0.5 * Math.min(free.w, free.h) - PADDING;
  const focalPx = vp.h / 2 / Math.tan((FOV * Math.PI) / 180 / 2);
  const dContain = Math.sqrt(RE * RE + ((focalPx * RE) / rMax) ** 2);
  return { rMax, focalPx, dContain, dTarget: Math.min(Math.max(D0, dContain), D_MAX) };
}

/** Angle between two unit vectors, in degrees. */
function angleDeg(a: number[], b: number[]): number {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(d) * 180) / Math.PI;
}

/** One coherent read of everything the load state is made of. */
async function readState(page: Page) {
  return page.evaluate(
    (selectors) => {
      const f = window.__frame!.snapshot();
      const g = window.__globe!;
      const t = g.target();
      const cam = window.__camera as { position: { x: number; y: number; z: number } };
      const p = cam.position;
      const len = Math.hypot(p.x, p.y, p.z) || 1;
      const drawerEl = document.querySelector(selectors.drawer);
      const resetEl = document.querySelector(selectors.reset) as HTMLButtonElement | null;
      return {
        free: f.free,
        insets: f.insets,
        targetRadius: Math.hypot(t[0], t[1], t[2]),
        direction: [p.x / len, p.y / len, p.z / len],
        distance: g.distance(),
        focus: f.focus,
        userZoomed: f.userZoomed,
        regionId: f.regionId,
        viewIsDefault: f.viewIsDefault,
        spinning: f.spinning,
        hasRegion: f.hasRegion,
        fitTarget: f.target.d,
        /* The drawer's own attributes: the selector U5 uses for "closed". */
        drawerAriaHidden: drawerEl ? drawerEl.getAttribute('aria-hidden') : null,
        drawerRect: drawerEl ? drawerEl.getBoundingClientRect().toJSON() : null,
        resetAriaDisabled: resetEl ? resetEl.getAttribute('aria-disabled') : null,
        resetDisabled: resetEl ? resetEl.disabled : null,
      };
    },
    { drawer: DRAWER, reset: RESET },
  );
}

/** Select a region by whichever path a user can actually take (the cards are occluded once open). */
async function selectRegion(page: Page, re: RegExp): Promise<'mouse' | 'keyboard'> {
  const info = await page.evaluate((source) => {
    const rx = new RegExp(source);
    const panel = document.querySelector('[data-occluder="right-panel"]');
    if (!panel) return null;
    const btn = [...panel.querySelectorAll('button, [role="button"]')].find((b) =>
      rx.test(b.textContent ?? ''),
    );
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return { x: cx, y: cy, clickable: top === btn || btn.contains(top) };
  }, re.source);
  expect(info, `the card matching ${re} must exist`).not.toBeNull();

  if (info!.clickable) {
    await page.mouse.click(info!.x, info!.y);
    return 'mouse';
  }
  const card = page.locator('[data-occluder="right-panel"] button', { hasText: re });
  await card.focus();
  await page.keyboard.press('Enter');
  return 'keyboard';
}

/**
 * Assert the whole load state, and print every measured number.
 *
 * `baseline` is the pose sampled right after a fresh load of this viewport; `label` names the case so a red
 * says which one.
 */
async function expectLoadState(
  page: Page,
  vp: { w: number; h: number },
  baseline: Awaited<ReturnType<typeof readState>>,
  label: string,
): Promise<void> {
  const r = await readState(page);
  const fit = fitMath(vp, r.free);
  const dirErr = angleDeg(r.direction, baseline.direction);
  const baseFit = fitMath(vp, baseline.free);

  console.log(
    `[${label}] focus "${r.focus}", regionId ${r.regionId}, hasRegion ${r.hasRegion}, ` +
      `drawer aria-hidden "${r.drawerAriaHidden}", Reset aria-disabled "${r.resetAriaDisabled}"; ` +
      `direction error vs the fresh-load pose ${dirErr.toFixed(5)} deg; ` +
      `d ${r.distance.toFixed(6)} (d_fit ${fit.dTarget.toFixed(6)}, load ${baseline.distance.toFixed(6)}); ` +
      `|target| ${r.targetRadius.toExponential(2)}; userZoomed ${r.userZoomed}; ` +
      `spinning ${r.spinning}; viewIsDefault ${r.viewIsDefault}`,
  );

  /* 1. The selection is gone, from the machine AND from the app. */
  expect(r.regionId, 'the machine must have no region').toBeNull();
  expect(r.hasRegion, 'the app must report no open region').toBe(false);

  /* 2. The drawer is closed — the same selector U5 uses. */
  expect(r.drawerAriaHidden, 'the drawer must be aria-hidden again').toBe('true');

  /* 3. The machine is idle. */
  expect(r.focus, 'Reset ends in idle, not returning').toBe('idle');

  /*
   * 4. The pose is the framed default, measured against the FRESH LOAD of this viewport rather than
   *    against a hardcoded vector: the load pose is the product's own definition of the load state.
   */
  expect(dirErr, 'direction must match the fresh-load pose').toBeLessThanOrEqual(0.1);
  expect(Math.abs(r.distance - fit.dTarget), 'distance must be d_fit of the current free rect').toBeLessThanOrEqual(
    2e-3,
  );
  expect(
    Math.abs(r.distance - baseline.distance),
    'and it must agree with the pose sampled at load',
  ).toBeLessThanOrEqual(2e-3);
  /* The load's own fit target, so a changed free rect between the two reads is visible. */
  expect(Math.abs(fit.dTarget - baseFit.dTarget), 'the free rect must be the same at load and after Reset')
    .toBeLessThanOrEqual(0.05);

  /* 5. Origin target, no user zoom, spin running, Reset disabled. */
  expect(r.targetRadius, 'controls.target must be back at the origin').toBeLessThanOrEqual(1e-6);
  expect(r.userZoomed, 'RESET clears the flag').toBe(false);
  expect(r.spinning, 'Reset resumes the spin').toBe(true);
  expect(r.viewIsDefault, 'the pose is the default again').toBe(true);

  /* 6. And the control says so. */
  expect(r.resetAriaDisabled, 'Reset must read aria-disabled again').toBe('true');
  expect(r.resetDisabled, 'and be actually disabled').toBe(true);
}

/* ------------------------------------------------------------------ R1, R2 */

test.describe('reset ux — back to the load state', () => {
  test.setTimeout(300_000);

  /*
   * R1: every region, both spec viewports. Four regions x two viewports = 8 cases, which is the prompt's
   * "for each of the 4 regions at 1440x900 and 1280x720" with no sharing of state between them.
   */
  for (const vp of [
    { w: 1440, h: 900 },
    { w: 1280, h: 720 },
  ] as const) {
    for (const region of REGIONS) {
      test(`R1 reset from ${region.id} at ${vp.w}x${vp.h} restores the load state`, async ({ page }) => {
        await openLive(page, vp);
        /* The baseline: a fresh load of THIS viewport, before any interaction. */
        const baseline = await readState(page);
        expect(baseline.focus, 'precondition: the page loads idle').toBe('idle');
        expect(baseline.hasRegion, 'precondition: nothing is selected at load').toBe(false);

        await selectRegion(page, region.card);
        await expect
          .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
          .toBe('focused');
        await settleStable(page);

        const open = await readState(page);
        console.log(`[R1:${region.id}] opened: regionId ${open.regionId}, drawer aria-hidden "${open.drawerAriaHidden}", Reset aria-disabled "${open.resetAriaDisabled}"`);
        expect(open.regionId, 'precondition: the region opened').toBe(region.id);
        expect(open.drawerAriaHidden, 'precondition: the drawer is open').toBe('false');
        /* B2's enable rule: an open region is on its own a reason to be able to Reset. */
        expect(open.resetAriaDisabled, 'Reset must be enabled while a region is open').toBe('false');

        await page.click(RESET);

        await expect
          .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
          .toBe('idle');
        await page.waitForTimeout(700);
        await settleStable(page);

        await expectLoadState(page, vp, baseline, `R1:${region.id}@${vp.w}x${vp.h}`);
      });
    }
  }

  /**
   * R2: Reset while ZOOMED with no region.
   *
   * The other half of the rule. There is no selection to clear here, so the camera intent alone has to do
   * the work — and it must also put the distance back at `d_fit`, which a plain CLOSE deliberately does not
   * (closing a region you had zoomed keeps your distance).
   */
  test('R2 reset while zoomed with no region restores d_fit and clears userZoomed', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);
    const baseline = await readState(page);

    await page.mouse.move(vp.w / 2, vp.h / 2);
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
    }
    await expect
      .poll(() => page.evaluate(() => window.__frame!.userZoomed), { timeout: 10_000, intervals: [150] })
      .toBe(true);
    await settleStable(page);

    const zoomed = await readState(page);
    console.log(
      `[R2] zoomed with no region: d ${zoomed.distance.toFixed(5)} vs d_fit ${fitMath(vp, zoomed.free).dTarget.toFixed(5)}, ` +
        `userZoomed ${zoomed.userZoomed}, Reset aria-disabled "${zoomed.resetAriaDisabled}"`,
    );
    expect(zoomed.userZoomed, 'precondition: the user zoomed').toBe(true);
    expect(zoomed.regionId, 'precondition: nothing is selected').toBeNull();
    expect(zoomed.resetAriaDisabled, 'a zoomed view must enable Reset').toBe('false');

    await page.click(RESET);
    await page.waitForTimeout(800);
    await settleStable(page);

    await expectLoadState(page, vp, baseline, 'R2:zoomed');
  });

  /**
   * R3: Reset in MID-FLIGHT.
   *
   * Clicked while the machine is still `focusing`. Reset is an unconditional exit, so the end state is the
   * same load state — not "the flight finished first" and not a stranded `returning`.
   */
  test('R3 reset in mid-flight ends in the same load state', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);
    const baseline = await readState(page);

    /* Highest angular separation available, so the flight is long enough to catch mid-air. */
    await selectRegion(page, REGIONS[0].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focusing');
    const midFlight = await page.evaluate(() => window.__frame!.focus);
    console.log(`[R3] Reset clicked while the machine was "${midFlight}"`);

    await page.click(RESET);

    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('idle');
    await page.waitForTimeout(700);
    await settleStable(page);

    await expectLoadState(page, vp, baseline, 'R3:mid-flight');
  });

  /**
   * R4: keyboard focus is never left on a removed/hidden element.
   *
   * A keyboard user can tab into the drawer and then reach Reset; after Reset the drawer is off-canvas and
   * `aria-hidden`, so focus inside it is focus on an imperceptible node. The assertion is that
   * `document.activeElement` is NOT inside the drawer once it is closed, for both entry paths.
   */
  test('R4 keyboard focus does not stay inside the closed drawer', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);

    await selectRegion(page, REGIONS[1].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');

    /* Put focus inside the drawer explicitly, the way a tabbing user would arrive. */
    await page.locator('[aria-label="Close region panel"]').focus();
    const inside = await page.evaluate(
      (sel) => Boolean(document.activeElement?.closest(sel)),
      DRAWER,
    );
    expect(inside, 'precondition: focus is inside the drawer').toBe(true);

    await page.click(RESET);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('idle');

    const after = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const active = document.activeElement;
      return {
        drawerHidden: el?.getAttribute('aria-hidden'),
        focusInDrawer: Boolean(active && active.closest(sel)),
        activeTag: active ? active.tagName : null,
        activeLabel: active ? active.getAttribute('aria-label') : null,
      };
    }, DRAWER);

    console.log(
      `[R4] after Reset: drawer aria-hidden "${after.drawerHidden}", focus inside drawer ${after.focusInDrawer}, ` +
        `active ${after.activeTag} "${after.activeLabel}"`,
    );
    expect(after.drawerHidden).toBe('true');
    expect(after.focusInDrawer, 'focus must not be left on a hidden element').toBe(false);
  });
});
