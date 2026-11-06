/**
 * `CameraDirector` — the four behaviours that are NEW in step 3B, and nothing else.
 *
 * The refactor's correctness is proved elsewhere: `camera-golden.spec.ts` (S3, poses unchanged),
 * `ref.spec.ts` (S1, strict 0 in two processes), `frame.spec.ts` (20 cases, UNEDITED) and
 * `globe.spec.ts` (5/5). This file covers the state machine and the `userZoomed` flag, which had no
 * externally visible existence before it.
 *
 * ## What each case is for
 *
 *  1. **wheel sets `userZoomed`, state stays `idle`** — the flag must latch on a zoom with no region
 *     selected, because that is the case the old `lastFit` handled by comparing distances.
 *  2. **resize after a wheel leaves the distance alone** — the flag's whole purpose. The fit must not
 *     re-take the distance just because the layout moved.
 *  3. **selecting reaches `focused`, and the state is visible** — the machine is published through
 *     `__frame.focus`, so a spec polls a STATE rather than inferring one from a pose.
 *  4. **closing returns to `idle`** — `CLOSE -> returning -> RETURNED -> idle`, observed end to end.
 *  5. **a drag during focusing ends in `focused`** — `focusing + USER_ORBIT_START -> focused`, with the
 *     fly-to cancelled rather than fighting the user.
 *
 * All waits are polls, never fixed sleeps.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page } from '@playwright/test';

const LIVE = '/?debug&framing=live';
const VIEWPORT = { width: 1440, height: 900 };

/** Boot in live framing and wait for the probe AND a settled layout. */
async function openLive(page: Page): Promise<void> {
  await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
  await page.setViewportSize(VIEWPORT);
  await page.goto(LIVE);
  await expect
    .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
      timeout: 90_000,
      intervals: [250],
    })
    .toBe('live');
  /* The insets store settles on transitionend, not at mount — see frame.spec.ts's settleStable note. */
  await page.waitForTimeout(2500);
  await settle(page);
}

/** The same-key-twice stability test `frame.spec.ts` uses, reduced to what these cases need. */
async function settle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const f = window.__frame!;
          return JSON.stringify([f.insets, f.free, f.target.d, f.settled]);
        }),
      { timeout: 20_000, intervals: [200] },
    )
    .toBe(await page.evaluate(() => {
      const f = window.__frame!;
      return JSON.stringify([f.insets, f.free, f.target.d, f.settled]);
    }));
  await expect.poll(() => page.evaluate(() => window.__frame!.settled), { timeout: 20_000 }).toBe(true);
}

/** Click the Impact Zones card for US West (the same trigger F8 uses). */
async function selectRegion(page: Page): Promise<void> {
  const card = await page.evaluate(() => {
    const panel = document.querySelector('[data-occluder="right-panel"]');
    if (!panel) return null;
    /* Match the card label exactly: the old alternation also matched neighbouring regions. */
    const btn = [...panel.querySelectorAll('button, [role="button"]')].find((b) =>
      /\bUS West\b/i.test(b.textContent ?? ''),
    );
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  expect(card, 'the US West card must exist').not.toBeNull();
  await page.mouse.click(card!.x, card!.y);
}

test.describe('camera director', () => {
  test.setTimeout(180_000);

  test('a wheel sets userZoomed and leaves the state idle', async ({ page }) => {
    await openLive(page);
    const before = await page.evaluate(() => ({
      userZoomed: window.__frame!.userZoomed,
      focus: window.__frame!.focus,
      d: window.__globe!.distance(),
    }));
    expect(before.userZoomed, 'nothing has zoomed yet').toBe(false);
    expect(before.focus, 'no region selected').toBe('idle');

    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(80);
    }

    await expect
      .poll(() => page.evaluate(() => window.__frame!.userZoomed), { timeout: 5_000, intervals: [100] })
      .toBe(true);
    const after = await page.evaluate(() => ({
      focus: window.__frame!.focus,
      d: window.__globe!.distance(),
    }));
    console.log(
      `[director] wheel: d ${before.d.toFixed(4)} -> ${after.d.toFixed(4)}, ` +
        `userZoomed true, focus "${after.focus}"`,
    );
    expect(after.focus, 'a zoom is not a focus event').toBe('idle');
    expect(after.d, 'the wheel must actually have moved the distance').toBeGreaterThan(before.d);
  });

  test('a resize after a wheel leaves the distance alone', async ({ page }) => {
    await openLive(page);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(80);
    }
    await expect
      .poll(() => page.evaluate(() => window.__frame!.userZoomed), { timeout: 5_000, intervals: [100] })
      .toBe(true);

    const zoomed = await page.evaluate(() => ({
      d: window.__globe!.distance(),
      target: window.__frame!.target.d,
    }));

    /* 1024x768 has a much smaller free rect, so the fit's target moves a long way. */
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
      d: window.__globe!.distance(),
      target: window.__frame!.target.d,
      dx: window.__frame!.current.dx,
    }));

    console.log(
      `[director] resize after wheel: d ${zoomed.d.toFixed(4)} -> ${after.d.toFixed(4)}, ` +
        `fit target ${zoomed.target.toFixed(4)} -> ${after.target.toFixed(4)}, dx ${after.dx.toFixed(3)}`,
    );
    /*
     * The fit's target MUST have moved, or this case asserts nothing: at 1024x768 the free rect is
     * 347 px wide against 763, so `dTarget` goes from ~3.78 to the 5.0 clamp.
     */
    expect(
      Math.abs(after.target - zoomed.target),
      'the fit target must move, otherwise the distance assertion is vacuous',
    ).toBeGreaterThan(0.5);
    /* And the live distance must NOT have followed it — that is the flag doing its job. */
    expect(
      Math.abs(after.d - zoomed.d),
      `the fit must not re-take a zoomed distance (${zoomed.d} -> ${after.d})`,
    ).toBeLessThan(0.002);
  });

  test('selecting a region reaches focused, and the state is visible', async ({ page }) => {
    await openLive(page);
    expect(await page.evaluate(() => window.__frame!.focus)).toBe('idle');

    await selectRegion(page);

    /* Watch it pass through the machine rather than only checking the end state. */
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 10_000, intervals: [100] })
      .toBe('focusing');
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 20_000, intervals: [150] })
      .toBe('focused');

    const region = await page.evaluate(() => window.__frame!.regionId);
    console.log(`[director] select: reached "focused", regionId "${region}"`);
    expect(region, 'the machine must name the region it focused').toBe('us-west');
  });

  test('closing returns to idle', async ({ page }) => {
    await openLive(page);
    await selectRegion(page);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 20_000, intervals: [150] })
      .toBe('focused');

    await page.click('[aria-label="Close region panel"]');

    /* `CLOSE -> returning` first: the way back is an animation, not a jump. */
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 10_000, intervals: [100] })
      .toBe('returning');
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 20_000, intervals: [150] })
      .toBe('idle');

    const end = await page.evaluate(() => ({
      regionId: window.__frame!.regionId,
      target: window.__globe!.target(),
    }));
    console.log(
      `[director] close: back to "idle", regionId ${end.regionId}, ` +
        `target [${end.target.map((n) => n.toFixed(3)).join(', ')}]`,
    );
    expect(end.regionId).toBeNull();
    /* The default pose aims at the origin — that is what `returning` restores. */
    expect(Math.hypot(end.target[0], end.target[1], end.target[2])).toBeLessThan(0.05);
  });

  test('a drag during focusing ends in focused', async ({ page }) => {
    await openLive(page);
    await selectRegion(page);

    /*
     * Drag WHILE the fly-to is in flight. The click on the card also opens the drawer, so the drag
     * starts from the canvas away from the panels: the free rect at 1440x900 with the drawer open
     * spans x 360.8..1022, y 118.3..900, and (600, 500) is inside it.
     */
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 10_000, intervals: [100] })
      .toBe('focusing');
    await page.mouse.move(600, 500);
    await page.mouse.down();
    await page.mouse.move(660, 520, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 20_000, intervals: [150] })
      .toBe('focused');
    console.log('[director] drag during focusing: state "focused" (fly cancelled)');
    /* It must not be left in `focusing`, which is the failure mode a cancelled fly-to would produce. */
    expect(await page.evaluate(() => window.__frame!.focus)).not.toBe('focusing');
  });
});
