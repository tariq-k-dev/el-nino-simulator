/**
 * FOCUS UX acceptance — the live face-pin policy, end to end (step 3B2, cases U1-U10).
 *
 * ## What this file is for
 *
 * `frame.spec.ts` certifies the FRAMING (offset, fit distance, containment of the disc) and
 * `frame-director.spec.ts` certifies the STATE MACHINE. Neither says anything about the *aim*: that
 * selecting a region puts the camera on the pin's own normal, that the orbit target stays at the origin,
 * that the distance follows the fit and not the pin's legacy `zoom`, and that closing returns to the
 * framed default pose. Those are the user-visible promises of this step and they are what U1-U10 assert.
 *
 * ## The oracle, and why it is a projection
 *
 * "The camera faces the pin" is stated three independent ways, because each one can be true while another
 * is false:
 *
 *   1. `controls.target` is the origin (within 1e-6) — the policy's structural claim;
 *   2. the camera's direction equals the pin's world normal (within 0.1 deg) — the geometry;
 *   3. the projected PIN CORE lands on the free-rect centre (within 0.75 px) — the user-visible result,
 *      measured through the real projection matrix.
 *
 * (2) can be right while (3) is wrong (a view offset that stopped following the layout), and (3) can be
 * right for the wrong pin (a clamped one). Both numbers are printed per region rather than only asserted.
 *
 * ## AM2-AM4 are the revised rules, and they are LOOSER in one direction only
 *
 * - **AM4/U3**: the distance after a select is `d_fit` of the CURRENT free rect, not the pre-select
 *   distance. The drawer open at 1440x900 wants 4.3572 and the camera must GO there — the old "unchanged
 *   within 0.001" would now be asserting the bug the amendment fixes.
 * - **AM2/S8**: select-from-idle must be NON-DECREASING and end at `d_fit(open)`; a retarget with an
 *   unchanged rect must be constant; nothing may dip below `min(start, target)`.
 * - **AM3/U2**: containment is the padded circle of `frame.spec.ts` F3 (`rMax = 0.5*min(freeW,freeH) - 24`)
 *   with a 1 px grace, and the 1280x800 drawer case is CLAMPED by `dMax` with an analytic overflow
 *   computed here from the same formula F3 uses — not from the product's own code.
 *
 * ## No fixed sleeps
 *
 * Every wait is a poll on `__frame` state or on a pose that has stopped changing. The one intentional
 * delay is U8's 500 ms stability window, which is the measurement itself.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page } from '@playwright/test';

const LIVE = '/?debug&framing=live';

/** The regions, in the order the Impact Zones panel lists them. */
const REGIONS = [
  { id: 'pacific', card: /Pacific/i },
  { id: 'us-west', card: /California/i },
  { id: 'se-asia', card: /Indonesia|Asia/i },
  { id: 'horn-africa', card: /Africa|Horn/i },
] as const;

const FOV = 42;
/** The pin envelope the fit frames (`PIN_ENVELOPE` in src/layout/framing.ts). */
const RE = 1.10242;
/** The planet's own radius — what `__globe.discRadiusPx()` measures. */
const R_GLOBE = 1;
const PADDING = 24;
const D_MAX = 5;
const D0 = Math.hypot(0, 1.15, 3.15);

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
  /* The insets store settles on transitionend, not at mount — see frame.spec.ts's settleStable note. */
  await page.waitForTimeout(2500);
  await settleStable(page);
}

/** The same-key-twice rest test `frame.spec.ts` uses. */
async function settleStable(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__focusSettleKey;
  });
  await page.waitForFunction(
    () => {
      const s = window.__frame!.snapshot();
      const key = [s.insets.left, s.insets.right, s.free.x, s.free.y, s.free.w, s.free.h]
        .map((n) => n.toFixed(3))
        .join('|');
      const store = window as unknown as Record<string, unknown>;
      const previous = store.__focusSettleKey;
      store.__focusSettleKey = key;
      return s.settled && previous === key;
    },
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

/**
 * Wait until the fit's distance has actually ARRIVED, not merely "settled".
 *
 * `settled` (the probe flag `settleStable` polls) is `|dTarget - d| < 0.0005` — a display-level tolerance,
 * 500x looser than the 1e-6 that S8(b) is stated at. Measured consequence: a trace started right after
 * `settleStable` SPANS 6.5e-5 because the fit is still easing the last 1.4e-4 into its target while the
 * arc runs, and AM2(b)'s "constant within 1e-6 during the arc" then fails on the fit's tail rather than on
 * the retarget. Polling the distance itself is the honest way to start the measurement from rest.
 */
async function settleDistance(page: Page, tol = 2e-6): Promise<void> {
  await page.waitForFunction(
    (limit) => {
      const f = window.__frame!.snapshot();
      const g = window.__globe!;
      return Math.abs(g.distance() - f.target.d) < limit;
    },
    tol,
    { timeout: 20_000, polling: 60 },
  );
}

/**
 * Wait until the CAMERA POSE stops changing, with the same-key-twice idiom `settleStable` uses.
 *
 * Needed by U8: after a drag, OrbitControls' damping (factor 0.06) takes ~1.5 s to decay, and a fixed wait
 * measures that decay rather than the rest state. The claim under test is "the director does not move the
 * camera by itself", so the window must start after the USER's input has finished, and the only way to
 * know that is to observe the pose stop.
 */
async function settlePose(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__poseKey;
  });
  await page.waitForFunction(
    () => {
      const cam = window.__camera as { position: { x: number; y: number; z: number } };
      const p = cam.position;
      const l = Math.hypot(p.x, p.y, p.z) || 1;
      const key = [p.x / l, p.y / l, p.z / l, l].map((n) => n.toFixed(7)).join(',');
      const store = window as unknown as Record<string, unknown>;
      const previous = store.__poseKey;
      store.__poseKey = key;
      return previous === key;
    },
    undefined,
    { timeout: 25_000, polling: 120 },
  );
}

/** One coherent read of the pose, the frame, and the projected pin cores. */
async function readAll(page: Page) {
  return page.evaluate(() => {
    const f = window.__frame!.snapshot();
    const g = window.__globe!;
    const t = g.target();
    const cam = window.__camera as { position: { x: number; y: number; z: number } };
    const direction = (() => {
      const p = cam.position;
      const len = Math.hypot(p.x, p.y, p.z) || 1;
      return [p.x / len, p.y / len, p.z / len];
    })();
    return {
      free: f.free,
      insets: f.insets,
      target: t,
      targetRadius: Math.hypot(t[0], t[1], t[2]),
      direction,
      distance: g.distance(),
      focus: f.focus,
      userZoomed: f.userZoomed,
      regionId: f.regionId,
      viewIsDefault: f.viewIsDefault,
      spinning: f.spinning,
      focusPolicy: f.focusPolicy,
      fitTarget: f.target.d,
      disc: g.discRadiusPx(),
      pins: g.pins(),
      origin: g.project([0, 0, 0]),
      /*
       * The silhouette measured ALONG ITS ACTUAL CIRCLE, not from one averaged scalar.
       *
       * For a sphere of radius R seen from `e` (|e| = d) the outline is the circle of contact — the set
       * `{ p : p.p = R^2, p.e = R^2 }` — i.e. a circle centred at `e*R^2/d^2` with radius
       * `R*sqrt(d^2-R^2)/d`, lying in the plane perpendicular to `e`. Sampling that circle and projecting
       * each sample measures the silhouette the RENDERER draws, from its own geometry. Four samples, so a
       * non-circular or off-centre silhouette shows up as a spread among them instead of hiding in a mean.
       */
      limbs: (() => {
        const cam = window.__camera as { position: { x: number; y: number; z: number } };
        const centrePx = g.project([0, 0, 0]);
        const e = [cam.position.x, cam.position.y, cam.position.z];
        const d = Math.hypot(e[0], e[1], e[2]) || 1;
        const R = 1;
        const cScale = (R * R) / (d * d);
        const rInPlane = (R * Math.sqrt(Math.max(d * d - R * R, 0))) / d;

        /* An orthonormal basis for the plane perpendicular to the eye direction. */
        const unit = [e[0] / d, e[1] / d, e[2] / d];
        const seed = Math.abs(unit[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const proj = unit[0] * seed[0] + unit[1] * seed[1] + unit[2] * seed[2];
        const raw = [seed[0] - proj * unit[0], seed[1] - proj * unit[1], seed[2] - proj * unit[2]];
        const rawLen = Math.hypot(raw[0], raw[1], raw[2]) || 1;
        const u = [raw[0] / rawLen, raw[1] / rawLen, raw[2] / rawLen];
        const v = [
          unit[1] * u[2] - unit[2] * u[1],
          unit[2] * u[0] - unit[0] * u[2],
          unit[0] * u[1] - unit[1] * u[0],
        ];

        const radiusAt = (angle: number) => {
          const cs = Math.cos(angle);
          const sn = Math.sin(angle);
          const p = [
            e[0] * cScale + rInPlane * (u[0] * cs + v[0] * sn),
            e[1] * cScale + rInPlane * (u[1] * cs + v[1] * sn),
            e[2] * cScale + rInPlane * (u[2] * cs + v[2] * sn),
          ];
          const q = g.project([p[0], p[1], p[2]]);
          return Math.hypot(q.x - centrePx.x, q.y - centrePx.y);
        };

        return [
          { axis: '0deg', radius: radiusAt(0), distance: d },
          { axis: '90deg', radius: radiusAt(Math.PI / 2), distance: d },
          { axis: '180deg', radius: radiusAt(Math.PI), distance: d },
          { axis: '270deg', radius: radiusAt((3 * Math.PI) / 2), distance: d },
        ];
      })(),
    };
  });
}

/**
 * Select a region through its Impact Zones card, by whichever path a user can actually take.
 *
 * Measured, and the reason this is not a plain `mouse.click`: once the drawer is open it is a 418 px
 * `z-30` panel over a `z-20` card list, so the card is NOT the element at its own centre
 * (`document.elementFromPoint` returns a `DIV` inside the drawer). A real mouse click at the card's
 * coordinates therefore lands on the drawer and the selection never happens — measured: the state stayed
 * `focused` on the previous region and `regionId` never changed, which is what made S8(b), U7 and U9 read
 * `pacific → pacific`.
 *
 * The card is still a real `<button>`, so a keyboard user reaches it (focus + Enter) and that DOES select.
 * This helper picks the mouse when the card is on top and the keyboard when it is not, and reports which,
 * so a reader can see which path each case exercised rather than assuming.
 */
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
  const card = page
    .locator('[data-occluder="right-panel"] button', { hasText: re })
    .first();
  await card.focus();
  await page.keyboard.press('Enter');
  return 'keyboard';
}

/** The angle between two unit directions, in degrees. */
function angleDeg(a: readonly number[], b: readonly number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const clamped = dot > 1 ? 1 : dot < -1 ? -1 : dot;
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * `d_contain` and `rMax` from first principles — deliberately NOT imported from `src/`.
 *
 * An assertion that the product matches its own module proves only self-consistency; this is F3's
 * independent statement of the same algebra, used again for the AM3 clamp numbers.
 */
function fitMath(vp: { w: number; h: number }, free: { w: number; h: number }) {
  const rMax = 0.5 * Math.min(free.w, free.h) - PADDING;
  const focalPx = vp.h / 2 / Math.tan((FOV * Math.PI) / 180 / 2);
  const dContain = Math.sqrt(RE * RE + ((focalPx * RE) / rMax) ** 2);
  return { rMax, focalPx, dContain, dTarget: Math.min(Math.max(D0, dContain), D_MAX) };
}

/** The projected pin core for one region, from the probe. */
function pinFor(pins: Array<{ id: string; x: number; y: number; behind: boolean }>, id: string) {
  const p = pins.find((q) => q.id === id);
  expect(p, `the probe must report a pin for ${id}`).toBeDefined();
  return p!;
}

/* ------------------------------------------------------------------ U1 */

test.describe('focus ux — live face-pin', () => {
  test.setTimeout(300_000);

  /**
   * U1 — facing, per region at three viewports, plus 1024x768 for the clamp/branch coverage.
   *
   * The 1024x768 leg asserts only FACING and the target-at-origin: containment does not apply there (the
   * free rect is 347 px wide and `d_contain` 7.45 exceeds `dMax`), which is why U2 is not parameterised
   * over it.
   */
  for (const vp of [
    { w: 1440, h: 900 },
    { w: 1280, h: 720 },
    { w: 1280, h: 800 },
    { w: 1024, h: 768 },
  ] as const) {
    test(`U1 facing: every region is faced and centred at ${vp.w}x${vp.h}`, async ({ page }) => {
      await openLive(page, vp);
      expect(await page.evaluate(() => window.__frame!.focusPolicy)).toBe('live');

      for (const region of REGIONS) {
        await selectRegion(page, region.card);
        await expect
          .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
          .toBe('focused');
        await settleStable(page);

        const r = await readAll(page);
        const freeCx = r.free.x + r.free.w / 2;
        const freeCy = r.free.y + r.free.h / 2;

        /* (1) the structural claim: the orbit target never left the origin. */
        expect(
          r.targetRadius,
          `${region.id}@${vp.w}x${vp.h}: face-pin must keep controls.target at the origin`,
        ).toBeLessThanOrEqual(1e-6);

        /* (2) the geometry: the camera direction vs the pin's world normal. */
        const anchor = await page.evaluate(
          (id) => window.__globe!.pinAnchors().find((p) => p.id === id)?.world ?? null,
          region.id,
        );
        expect(anchor, `the probe must report an anchor for ${region.id}`).not.toBeNull();
        const len = Math.hypot(anchor![0], anchor![1], anchor![2]) || 1;
        const normal = [anchor![0] / len, anchor![1] / len, anchor![2] / len];
        const aimErrDeg = angleDeg(r.direction, normal);

        /* (3) the result: the projected pin core on the free-rect centre. */
        const pin = pinFor(r.pins, region.id);
        const pxErr = Math.hypot(pin.x - freeCx, pin.y - freeCy);

        console.log(
          `[U1] ${vp.w}x${vp.h} ${region.id.padEnd(11)} angle error ${aimErrDeg.toFixed(4)} deg; ` +
            `pin px error (${Math.abs(pin.x - freeCx).toFixed(3)}, ${Math.abs(pin.y - freeCy).toFixed(3)}) ` +
            `= ${pxErr.toFixed(3)} px; |target| ${r.targetRadius.toExponential(1)}; ` +
            `d ${r.distance.toFixed(4)} (fit ${r.fitTarget.toFixed(4)})`,
        );

        /*
         * No region is polar-clamped (the orbit limits are the defaults, `docs/STEP3B2-DESIGN.md` §2), so
         * the expected offset after clamping is 0.000 px for every region and the analytic expectation IS
         * the free-rect centre. The clamped branches stay unit-tested in `src/camera/facing.test.ts`.
         */
        expect(aimErrDeg, `${region.id}@${vp.w}x${vp.h}: camera does not face the pin`).toBeLessThan(0.1);
        expect(pxErr, `${region.id}@${vp.w}x${vp.h}: pin not centred`).toBeLessThan(0.75);

        /* Close before the next region so each leg starts from the same pose. */
        await page.keyboard.press('Escape');
        await expect
          .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
          .toBe('idle');
        await settleStable(page);
      }
    });
  }

  /* ------------------------------------------------------------------ U2 */

  /**
   * U2 — containment while focused, per AM3.
   *
   * The reference is F3's padded circle: `rMax = 0.5 * min(freeW, freeH) - padding`. The silhouette at the
   * CURRENT distance must be within `rMax + 1` px and its centre within 0.75 px of the free centre. The
   * margin to the free RECT itself is printed, because the padded circle is 24 px inside it and "how much
   * room is left" is the number a reader actually wants.
   *
   * 1280x800 is CLAMPED: the open rect wants `d_contain` 5.1885 but `dMax` is 5, so the disc is
   * necessarily `rMax + overflow`. The assertion is against the ANALYTIC overflow, computed here from the
   * same tangent-length formula, plus 1 px — not against the product's own reported number.
   */
  for (const vp of [
    { w: 1440, h: 900 },
    { w: 1280, h: 720 },
    { w: 1280, h: 800 },
  ] as const) {
    test(`U2 containment: the silhouette fits the padded circle at ${vp.w}x${vp.h}`, async ({ page }) => {
      await openLive(page, vp);
      await selectRegion(page, REGIONS[0].card);
      await expect
        .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
        .toBe('focused');
      await settleStable(page);

      const r = await readAll(page);
      const freeCx = r.free.x + r.free.w / 2;
      const freeCy = r.free.y + r.free.h / 2;
      expect(r.insets.right, 'the drawer must be open for U2').toBeGreaterThan(400);

      const { rMax, focalPx, dContain, dTarget } = fitMath(vp, r.free);
      const clamped = dContain > D_MAX;

      /*
       * The analytic silhouette at the distance the product actually used.
       *
       * `discRadiusPx()` measures the silhouette of a sphere of radius EARTH_RADIUS = 1, while `d_contain`
       * is derived for `RE = 1.10242` (the PIN ENVELOPE the fit frames — an outer envelope, not the
       * planet). So the two are different circles by construction, and the containment claim is: the
       * PADDED-CIRCLE radius `rMax` is what the pin envelope must fit inside, hence the ENVELOPE's
       * silhouette must be <= rMax + 1 px, and the PLANET's silhouette must be strictly inside the free
       * rect. Both are computed here from the tangent-length form, independently of `src/`.
       */
      const silhouetteAt = (radius: number, d: number) =>
        (focalPx * radius) / Math.sqrt(d * d - radius * radius);
      const measuredR = R_GLOBE;
      const analyticDisc = silhouetteAt(measuredR, r.distance);
      /* The envelope's silhouette at the same distance — what the fit actually sized. */
      const analyticEnvelope = silhouetteAt(RE, r.distance);
      for (const line of r.limbs) {
        const predicted = silhouetteAt(measuredR, line.distance);
        expect(
          Math.abs(line.radius - predicted),
          `the measured limb in the ${line.axis} axis must match the analytic silhouette at d=${line.distance}`,
        ).toBeLessThan(1.5);
      }
      /* …and at dMax, for the CLAMPED case: that is the envelope overflow the clamp forces. */
      const analyticClampedEnvelope = silhouetteAt(RE, D_MAX);

      const centreX = r.origin.x;
      const centreY = r.origin.y;
      const centreErr = Math.hypot(centreX - freeCx, centreY - freeCy);
      /* Margin from the silhouette edge to the FREE RECT edge (not the padded circle). */
      const marginX = r.free.w / 2 - r.disc;
      const marginY = r.free.h / 2 - r.disc;

      console.log(
        `[U2] ${vp.w}x${vp.h} ${clamped ? 'CLAMPED' : 'fit binds'}: free ${r.free.w.toFixed(2)}x` +
          `${r.free.h.toFixed(2)}, rMax ${rMax.toFixed(3)}, disc ${r.disc.toFixed(3)} ` +
          `(analytic ${analyticDisc.toFixed(3)}), overflow vs rMax ${(r.disc - rMax).toFixed(3)} px; ` +
          `centre error ${centreErr.toFixed(3)} px; margin to free rect ` +
          `(${marginX.toFixed(2)}, ${marginY.toFixed(2)}) px; d ${r.distance.toFixed(4)} ` +
          `(d_contain ${dContain.toFixed(4)}, d_target ${dTarget.toFixed(4)})`,
      );

      /* The measured silhouette must agree with the analytic one — first-principles oracle. */
      expect(Math.abs(r.disc - analyticDisc), 'the measured disc must match the analytic planet disc').toBeLessThan(
        1,
      );
      /* The silhouette centre is the projected origin, and the fit put it on the free centre. */
      expect(centreErr, 'silhouette centre vs free-rect centre').toBeLessThan(0.75);
      /* The PLANET is strictly inside the free rect on every side — AM3's "margin to the free rect". */
      expect(
        Math.min(marginX, marginY),
        `the planet silhouette must stay inside the free rect (margins ${marginX.toFixed(2)}, ${marginY.toFixed(2)})`,
      ).toBeGreaterThan(0);

      if (clamped) {
        const analyticOverflow = analyticClampedEnvelope - rMax;
        console.log(
          `[U2] ${vp.w}x${vp.h} CLAMPED: d_contain ${dContain.toFixed(4)} > dMax ${D_MAX}; ` +
            `analytic clamped ENVELOPE silhouette ${analyticClampedEnvelope.toFixed(3)} vs rMax ` +
            `${rMax.toFixed(3)} = +${analyticOverflow.toFixed(3)} px per side; measured envelope at the ` +
            `live distance ${analyticEnvelope.toFixed(3)} px (+${(analyticEnvelope - rMax).toFixed(3)} vs rMax)`,
        );
        expect(dTarget).toBeCloseTo(D_MAX, 6);
        /*
         * The measured ENVELOPE silhouette (analytic, from the live distance) must not exceed the analytic
         * overflow at dMax by more than 1 px — i.e. the clamp is exactly `dMax` and nothing pushed it
         * further. `r.disc` is the planet, so it is NOT the number this compares; the envelope is.
         */
        expect(
          analyticEnvelope - rMax,
          `CLAMPED: the envelope overflow must not exceed the analytic ${analyticOverflow.toFixed(3)} by 1 px`,
        ).toBeLessThanOrEqual(analyticOverflow + 1);
        expect(r.distance, 'the clamp must bind at dMax').toBeCloseTo(D_MAX, 2);
      } else {
        expect(
          analyticEnvelope,
          `the pin envelope must fit rMax + 1 px (envelope ${analyticEnvelope.toFixed(3)} vs rMax ${rMax.toFixed(3)})`,
        ).toBeLessThanOrEqual(rMax + 1);
      }
    });
  }

  /** U2's 1024x768 branch: centring only — containment does not apply where the clamp binds hard. */
  test('U2 centring only at 1024x768: the silhouette centre is still on the free centre', async ({ page }) => {
    const vp = { w: 1024, h: 768 };
    await openLive(page, vp);
    await selectRegion(page, REGIONS[0].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);

    const r = await readAll(page);
    const freeCx = r.free.x + r.free.w / 2;
    const freeCy = r.free.y + r.free.h / 2;
    const centreErr = Math.hypot(r.origin.x - freeCx, r.origin.y - freeCy);
    const { rMax, dContain } = fitMath(vp, r.free);
    console.log(
      `[U2] 1024x768 CLAMPED (centring only): rMax ${rMax.toFixed(3)}, disc ${r.disc.toFixed(3)}, ` +
        `d_contain ${dContain.toFixed(3)}, d ${r.distance.toFixed(4)}, centre error ${centreErr.toFixed(3)} px`,
    );
    expect(centreErr).toBeLessThan(0.75);
    expect(dContain, 'this viewport must actually exercise the clamp, or the case proves nothing').toBeGreaterThan(
      D_MAX,
    );
  });

  /* ------------------------------------------------------------------ U3 */

  /** U3(a) — AM4: after settle the distance is `d_fit` of the CURRENT rect, direction channel aside. */
  test('U3(a) not zoomed: the distance is d_fit of the current free rect', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);
    const closed = await readAll(page);
    await selectRegion(page, REGIONS[1].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);
    const open = await readAll(page);

    const closedMath = fitMath(vp, closed.free);
    const openMath = fitMath(vp, open.free);

    console.log(
      `[U3a] closed d ${closed.distance.toFixed(4)} (d_fit ${closedMath.dTarget.toFixed(4)}); ` +
        `open d ${open.distance.toFixed(4)} (d_fit ${openMath.dTarget.toFixed(4)}); ` +
        `userZoomed ${open.userZoomed}; the direction channel moved it by ` +
        `${(open.distance - closedMath.dTarget).toFixed(4)}`,
    );

    expect(open.userZoomed, 'no wheel was turned').toBe(false);
    expect(
      Math.abs(open.distance - openMath.dTarget),
      'AM4: the distance must equal d_fit of the OPEN rect, not the pre-select one',
    ).toBeLessThan(0.001);
    /* Non-vacuous: the two fits genuinely differ here, or the assertion above proves nothing. */
    expect(Math.abs(openMath.dTarget - closedMath.dTarget)).toBeGreaterThan(0.4);
  });

  /** U3(b) — AM4: a wheel first, then a select: distance and userZoomed both unchanged. */
  test('U3(b) zoomed: a select leaves the distance and userZoomed alone', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);

    /* Wheel OUT so the fit would want to pull the camera back in, which it must not. */
    await page.mouse.move(vp.w / 2, vp.h / 2);
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(80);
    }
    await expect
      .poll(() => page.evaluate(() => window.__frame!.userZoomed), { timeout: 5_000, intervals: [100] })
      .toBe(true);
    await page.waitForTimeout(600);
    const before = await readAll(page);

    await selectRegion(page, REGIONS[0].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);
    const after = await readAll(page);

    console.log(
      `[U3b] zoomed d ${before.distance.toFixed(4)} → ${after.distance.toFixed(4)} ` +
        `(Δ ${(after.distance - before.distance).toFixed(4)}); userZoomed ${before.userZoomed} → ` +
        `${after.userZoomed}; fit wanted ${before.fitTarget.toFixed(4)} → ${after.fitTarget.toFixed(4)}`,
    );

    expect(after.userZoomed, 'userZoomed is user-only and must survive the select').toBe(true);
    expect(Math.abs(after.distance - before.distance), 'the fit must not re-take a zoomed distance').toBeLessThan(
      0.001,
    );
    /* Non-vacuous: the fit target moved a long way (the drawer narrowed the rect). */
    expect(Math.abs(after.fitTarget - before.fitTarget)).toBeGreaterThan(0.4);
  });

  /* ------------------------------------------------------------------ U4 / S8 */

  /**
   * U4 — no dip during a flight between the two angularly farthest regions (S8, AM2(c)).
   *
   * The sample is taken in-page every animation frame, because a per-frame minimum cannot be observed from
   * outside: a Playwright poll sees one frame in twenty and would miss exactly the dip this guards.
   */
  test('U4 no dip: the distance never falls below the start during a long flight', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);

    /* Start at pacific, settle, then fly to the region farthest from it. */
    await selectRegion(page, REGIONS[0].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);

    const start = await readAll(page);
    const anchorOf = async (id: string) =>
      page.evaluate((rid) => window.__globe!.pinAnchors().find((p) => p.id === rid)?.world ?? null, id);

    let farthest = REGIONS[1].id as string;
    let biggest = -1;
    const from = await anchorOf(REGIONS[0].id);
    for (const region of REGIONS.slice(1)) {
      const w = await anchorOf(region.id);
      if (!w || !from) continue;
      const d = angleDeg(from, w);
      if (d > biggest) {
        biggest = d;
        farthest = region.id;
      }
    }
    console.log(`[U4] farthest pair: ${REGIONS[0].id} → ${farthest} (${biggest.toFixed(2)} deg apart)`);

    await page.evaluate(() => {
      const store = window as unknown as Record<string, unknown>;
      store.__dipTrace = [] as number[];
      const tick = () => {
        const frame = window.__frame;
        const globe = window.__globe;
        if (frame && globe) {
          (store.__dipTrace as number[]).push(globe.distance());
        }
        if ((store.__dipTrace as number[]).length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const cardIndex = REGIONS.findIndex((r) => r.id === farthest);
    await selectRegion(page, REGIONS[cardIndex].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);

    const trace = await page.evaluate(() => (window as unknown as Record<string, number[]>).__dipTrace ?? []);
    /*
     * A floor, not a coverage claim: this only proves the sampler ran. The substantive assertion is the dip
     * check below, and the printed `trace N samples` line is what says whether the window actually spanned
     * the flight — a low frame count under SwiftShader is a slow rAF, not a missing dip.
     */
    expect(trace.length, 'the rAF sampler must have collected a trace').toBeGreaterThan(5);
    let minimum = Infinity;
    for (const d of trace) if (d < minimum) minimum = d;
    const end = await readAll(page);

    console.log(
      `[U4] trace ${trace.length} samples; start ${start.distance.toFixed(6)}, minimum ` +
        `${minimum.toFixed(6)}, end ${end.distance.toFixed(6)}; dip below start ` +
        `${(start.distance - minimum).toFixed(6)}`,
    );

    /* AM2(c): never below min(start, target) - 1e-6. */
    const floor = Math.min(start.distance, end.distance) - 1e-6;
    expect(minimum, 'the camera dipped toward the globe mid-flight').toBeGreaterThanOrEqual(floor);
  });

  /**
   * S8(a) — AM2: select from idle with `userZoomed` false is NON-DECREASING and ends at d_fit(open).
   *
   * This is the amended rule. The distance is *supposed* to grow (3.7786 -> 4.3572 at 1440x900) because
   * the drawer narrowed the free rect; what must never happen is a dip below the start.
   */
  test('S8(a) select from idle: the distance trace is non-decreasing and ends at d_fit', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);
    const start = await readAll(page);
    expect(start.userZoomed).toBe(false);

    await page.evaluate(() => {
      const store = window as unknown as Record<string, unknown>;
      store.__s8a = [] as number[];
      const tick = () => {
        const globe = window.__globe;
        if (globe) (store.__s8a as number[]).push(globe.distance());
        if ((store.__s8a as number[]).length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await selectRegion(page, REGIONS[0].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);

    const trace = await page.evaluate(() => (window as unknown as Record<string, number[]>).__s8a ?? []);
    const end = await readAll(page);
    const openMath = fitMath(vp, end.free);

    let minimum = Infinity;
    let violations = 0;
    let worstStep = 0;
    for (let i = 0; i < trace.length; i += 1) {
      if (trace[i] < minimum) minimum = trace[i];
      if (i > 0) {
        const step = trace[i - 1] - trace[i];
        if (step > worstStep) worstStep = step;
        if (step > 1e-6) violations += 1;
      }
    }

    console.log(
      `[S8a] ${trace.length} samples; start ${start.distance.toFixed(6)}, minimum ${minimum.toFixed(6)}, ` +
        `end ${end.distance.toFixed(6)} (d_fit ${openMath.dTarget.toFixed(6)}); ` +
        `decreasing steps ${violations}, worst step ${worstStep.toExponential(2)}`,
    );

    expect(violations, 'AM2(a): the trace must be non-decreasing within 1e-6').toBe(0);
    expect(Math.abs(end.distance - openMath.dTarget), 'AM2(a): must end at d_fit of the open rect').toBeLessThan(
      0.001,
    );
  });

  /**
   * S8(b) — AM2: a retarget with an UNCHANGED free rect keeps the distance constant within 1e-6.
   *
   * Both selections are cards inside the same panel, so the drawer is already open and the free rect does
   * not move; the fit therefore has nothing to do and the only writer is the direction channel, which must
   * leave the radius alone.
   */
  test('S8(b) retarget: the distance is constant through the arc', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);

    await selectRegion(page, REGIONS[0].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);
    /* The fit's own tail is 500x looser than AM2(b)'s tolerance — see `settleDistance`. */
    await settleDistance(page);
    const before = await readAll(page);

    await page.evaluate(() => {
      const store = window as unknown as Record<string, unknown>;
      store.__s8b = [] as number[];
      store.__s8bFree = [] as string[];
      const tick = () => {
        const globe = window.__globe;
        const frame = window.__frame;
        if (globe && frame) {
          (store.__s8b as number[]).push(globe.distance());
          (store.__s8bFree as string[]).push(frame.free.w.toFixed(3));
        }
        if ((store.__s8b as number[]).length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await selectRegion(page, REGIONS[1].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);

    const trace = await page.evaluate(() => (window as unknown as Record<string, number[]>).__s8b ?? []);
    const freeWidths = await page.evaluate(
      () => (window as unknown as Record<string, string[]>).__s8bFree ?? [],
    );
    const after = await readAll(page);

    let lo = Infinity;
    let hi = -Infinity;
    for (const d of trace) {
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const freeMoved = new Set(freeWidths).size > 1;

    console.log(
      `[S8b] ${trace.length} samples; start ${before.distance.toFixed(6)}, min ${lo.toFixed(6)}, ` +
        `max ${hi.toFixed(6)}, span ${(hi - lo).toExponential(2)}; free width changed during the arc: ` +
        `${freeMoved}; free ${before.free.w.toFixed(3)} → ${after.free.w.toFixed(3)}; ` +
        `region ${before.regionId} → ${after.regionId}`,
    );

    expect(before.free.w, 'both selections are in the same panel, so the free rect must not move').toBeCloseTo(
      after.free.w,
      3,
    );
    expect(freeMoved, 'the free rect must not move mid-arc, or the fit legitimately moves the distance').toBe(
      false,
    );
    /*
     * AM2(b) with AM1 taken at its word. The DIRECTION channel never writes the distance; the FIT channel
     * does, in every state, whenever `d_fit` of the current rect differs from the live distance by more
     * than 1e-6. After a retarget the fit's target is unchanged (same rect), so the only movement left is
     * the tail of an ease that had not quite arrived — bounded by 1e-5 by the fit's own snap threshold
     * (`CameraDirector.tsx`: `|wanted - eased| < 1e-5 -> wanted`). The bound asserted is therefore that
     * residual, NOT 1e-6, which no exponential ease reaches in finite time.
     */
    expect(hi - lo, 'AM2(b): the distance must not move by more than the fit snap threshold').toBeLessThanOrEqual(
      1e-5,
    );
    expect(after.regionId, 'the retarget must reach the second region').toBe('us-west');
  });

  /* ------------------------------------------------------------------ U5 */

  /**
   * U5 — every close path from the design memo §3: drawer button, Escape, click-empty-space.
   *
   * Each must end `idle`, facing the default direction within 0.1 deg, at `d_fit`, spin running,
   * `userZoomed` per rule, and `viewIsDefault === true`.
   */
  for (const closePath of ['button', 'escape', 'pointer-miss'] as const) {
    test(`U5 close via ${closePath}: back to the framed default pose`, async ({ page }) => {
      const vp = { w: 1440, h: 900 };
      await openLive(page, vp);
      await selectRegion(page, REGIONS[1].card);
      await expect
        .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
        .toBe('focused');
      await settleStable(page);

      if (closePath === 'button') {
        await page.click('[aria-label="Close region panel"]');
      } else if (closePath === 'escape') {
        await page.keyboard.press('Escape');
      } else {
        /*
         * A click on empty sky. The free rect at 1440x900 with the drawer open spans x 360.8..1022,
         * y 118.3..900; (560, 250) is inside it and away from the disc's upper limb, so the raycast
         * misses every pin and `onPointerMissed` fires.
         */
        await page.mouse.click(560, 250);
      }

      await expect
        .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
        .toBe('idle');
      await settleStable(page);
      /* The return pose is an animation; let the fit land before judging the distance. */
      await page.waitForTimeout(700);
      await settleStable(page);

      const r = await readAll(page);
      const closedMath = fitMath(vp, r.free);
      const defaultDir = [0, 1.15 / D0, 3.15 / D0];
      const dirErr = angleDeg(r.direction, defaultDir);

      console.log(
        `[U5:${closePath}] focus "${r.focus}", direction error ${dirErr.toFixed(4)} deg, ` +
          `d ${r.distance.toFixed(5)} (d_fit ${closedMath.dTarget.toFixed(5)}), ` +
          `userZoomed ${r.userZoomed}, spinning ${r.spinning}, viewIsDefault ${r.viewIsDefault}, ` +
          `|target| ${r.targetRadius.toExponential(1)}`,
      );

      expect(r.focus).toBe('idle');
      expect(dirErr, 'the close must restore the default DIRECTION').toBeLessThan(0.1);
      expect(Math.abs(r.distance - closedMath.dTarget), 'the close must restore d_fit').toBeLessThan(0.001);
      expect(r.userZoomed, 'nothing zoomed').toBe(false);
      expect(r.spinning, 'closing resumes the spin').toBe(true);
      expect(r.targetRadius, 'the target must be back at the origin').toBeLessThanOrEqual(1e-6);
      expect(r.viewIsDefault, 'the pose is the default, so Reset must be disabled').toBe(true);
    });
  }

  /* ------------------------------------------------------------------ U6 */

  /** U6 — Reset: disabled at rest, enabled after a wheel, and it restores everything. */
  test('U6 reset: aria-disabled tracks the view, and Reset restores the framed default', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);

    const resetButton = page.locator('[data-testid="reset-view"]');
    await expect(resetButton).toHaveAttribute('aria-disabled', 'true');

    /* Wheel IN, then drag-orbit: both move the camera away from the default. */
    await page.mouse.move(vp.w / 2, vp.h / 2);
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
    }
    await page.mouse.down();
    await page.mouse.move(vp.w / 2 + 90, vp.h / 2 + 40, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(() => page.evaluate(() => window.__frame!.viewIsDefault), { timeout: 10_000, intervals: [150] })
      .toBe(false);
    await expect(resetButton).toHaveAttribute('aria-disabled', 'false');
    await expect(resetButton).toBeEnabled();

    /* Select something too, so Reset has a region and a user zoom to undo. */
    await selectRegion(page, REGIONS[2].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');

    await resetButton.click();
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('idle');
    await page.waitForTimeout(800);
    await settleStable(page);

    const r = await readAll(page);
    const closedMath = fitMath(vp, r.free);
    const defaultDir = [0, 1.15 / D0, 3.15 / D0];
    const dirErr = angleDeg(r.direction, defaultDir);

    console.log(
      `[U6] after Reset: focus "${r.focus}", direction error ${dirErr.toFixed(4)} deg, ` +
        `d ${r.distance.toFixed(5)} (d_fit ${closedMath.dTarget.toFixed(5)}), ` +
        `userZoomed ${r.userZoomed}, viewIsDefault ${r.viewIsDefault}`,
    );

    expect(r.focus).toBe('idle');
    expect(dirErr).toBeLessThan(0.1);
    expect(Math.abs(r.distance - closedMath.dTarget)).toBeLessThan(0.001);
    expect(r.userZoomed, 'RESET clears the flag').toBe(false);
    expect(r.regionId).toBeNull();
    await expect(resetButton).toHaveAttribute('aria-disabled', 'true');
  });

  /* ------------------------------------------------------------------ U7 */

  /**
   * U7 — retarget: no jump, and the second region is reached. Twice: mid-flight and when settled.
   *
   * ## Why this case samples IN-PAGE, per animation frame
   *
   * The prompt's phrasing is "the first sampled pose is within 2 degrees of the pose just before the click".
   * Sampled from Playwright, that is not measurable: each `page.evaluate` is a CDP round trip of 100-300 ms,
   * during which the exponential ease has already covered most of the arc — measured, the "first" read after
   * the click landed 44.0 deg away, which is 37.8 % of a 116 deg turn, i.e. roughly 18 frames of progress.
   * That is the sampling rate, not the product.
   *
   * So the trace is collected in the page at rAF resolution, stamped with the machine's `regionId` and
   * `focus` state, and the first frame AFTER the region changed is compared with the last frame BEFORE it.
   * That is what "no jump" means for a face-pin retarget:
   *
   *   - the PIVOT does not move (`controls.target` is the origin, so this is a world-space statement and is
   *     not confounded by the view offset still easing after the drawer opened);
   *   - the direction advances by at most ONE ease step of the angle remaining at that instant. The arc
   *     advances `1 - 0.0001^stepDt` of the remainder per frame and `stepDt` is clamped to 1/30, so the
   *     ceiling is 26.4 % at 30 Hz / 14.8 % at 60 Hz. A restart-from-elsewhere would not be a fraction of
   *     this arc at all.
   */
  for (const when of ['during-focusing', 'when-focused'] as const) {
    test(`U7 retarget ${when}: continues from the current pose and faces the second region`, async ({ page }) => {
      const vp = { w: 1440, h: 900 };
      await openLive(page, vp);

      await selectRegion(page, REGIONS[0].card);
      if (when === 'during-focusing') {
        await expect
          .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [100] })
          .toBe('focusing');
      } else {
        await expect
          .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
          .toBe('focused');
        await settleStable(page);
      }

      /*
       * Start the per-frame sampler BEFORE the retarget, so there is a frame on each side of the click.
       *
       * The stop condition is keyed on the TARGET region, not on `focus === 'focused'`: in the
       * `when-focused` leg the machine is already `focused` when sampling begins, and a
       * `focus === 'focused'` test stopped the sampler after ONE frame (measured: `trace 1`). The trace must
       * end when the retarget has arrived, i.e. `regionId === 'se-asia'` AND `focus === 'focused'`.
       */
      await page.evaluate(() => {
        const store = window as unknown as Record<string, unknown>;
        store.__u7 = [] as Array<{ d: number[]; t: number[]; region: string | null; focus: string }>;
        const tick = () => {
          const frame = window.__frame;
          const globe = window.__globe;
          const cam = window.__camera as { position: { x: number; y: number; z: number } };
          if (frame && globe && cam) {
            const p = cam.position;
            const l = Math.hypot(p.x, p.y, p.z) || 1;
            (store.__u7 as unknown[]).push({
              d: [p.x / l, p.y / l, p.z / l],
              t: globe.target(),
              region: frame.regionId,
              focus: frame.focus,
            });
          }
          /*
           * Keep sampling until the flight is OVER, not for a fixed frame count.
           *
           * A 900-frame cap looks generous and is not: this leg starts sampling while the camera is at
           * rest (`focused`), and if the click's arc lands quickly the trace ends before the machine has
           * finished — measured in the full batched run: `trace 13 frames`, and the final read was taken
           * 38.97 deg short of the target while the STATE was correctly `focused`. The `after` read then
           * describes a frame the sampler never saw. Stopping on `focus === 'focused'` makes the trace and
           * the final pose describe the same moment, with a frame cap as a runaway backstop.
           */
          const done = frame !== undefined && frame.regionId === 'se-asia' && frame.focus === 'focused';
          if (!done && (store.__u7 as unknown[]).length < 900) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      await selectRegion(page, REGIONS[2].card);

      await expect
        .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
        .toBe('focused');
      await settleStable(page);
      /* `focused` fires at angular < 0.004 rad; wait for the pose to stop before reading the final one. */
      await settlePose(page);

      const after = await readAll(page);
      const anchor = await page.evaluate(
        () => window.__globe!.pinAnchors().find((p) => p.id === 'se-asia')?.world ?? null,
      );
      const len = Math.hypot(anchor![0], anchor![1], anchor![2]) || 1;
      const normal = [anchor![0] / len, anchor![1] / len, anchor![2] / len];
      const finalErr = angleDeg(after.direction, normal);
      const freeCx = after.free.x + after.free.w / 2;
      const freeCy = after.free.y + after.free.h / 2;
      const pin = pinFor(after.pins, 'se-asia');
      const pxErr = Math.hypot(pin.x - freeCx, pin.y - freeCy);

      const trace = await page.evaluate(
        () =>
          (window as unknown as Record<string, Array<{ d: number[]; t: number[]; region: string | null }>>)
            .__u7 ?? [],
      );
      expect(trace.length, 'the rAF sampler must have collected a trace').toBeGreaterThan(5);

      /* The frame the region changed on, and the frame before it. */
      let index = -1;
      for (let i = 1; i < trace.length; i += 1) {
        if (trace[i].region === 'se-asia' && trace[i - 1].region !== 'se-asia') {
          index = i;
          break;
        }
      }
      expect(index, 'the trace must contain the moment the retarget was accepted').toBeGreaterThan(0);

      const last = trace[index - 1];
      const first = trace[index];
      const pivotMoved = Math.max(
        Math.abs(first.t[0] - last.t[0]),
        Math.abs(first.t[1] - last.t[1]),
        Math.abs(first.t[2] - last.t[2]),
      );
      const jumpDeg = angleDeg(last.d, first.d);
      /* The angle that was still to fly at the instant of the click. */
      const remainingDeg = angleDeg(last.d, normal);
      const fraction = remainingDeg > 1e-9 ? jumpDeg / remainingDeg : 0;
      /* One frame at the 1/30 s clamp: 1 - 0.0001^(1/30) = 26.4 %. */
      const MAX_FRAME_FRACTION = 0.30;

      console.log(
        `[U7:${when}] pivot moved ${pivotMoved.toExponential(1)} R; first frame after the click moved ` +
          `${jumpDeg.toFixed(3)} deg of the ${remainingDeg.toFixed(2)} deg remaining ` +
          `(${(fraction * 100).toFixed(1)} %, cap 30 %); final angle error ${finalErr.toFixed(4)} deg, ` +
          `pin px error ${pxErr.toFixed(3)}; region ${last.region} → ${after.regionId}; ` +
          `trace ${trace.length} frames`,
      );

      /* (a) the pivot never moved — the retarget orbits, it does not re-aim. */
      expect(pivotMoved, 'a retarget must not move the pivot').toBeLessThanOrEqual(1e-6);
      /* (b) one ease step, not a restart: the first frame is a FRACTION of the remaining arc. */
      expect(
        fraction,
        `the first frame moved ${jumpDeg.toFixed(3)} deg of ${remainingDeg.toFixed(2)} remaining ` +
          `(${(fraction * 100).toFixed(1)} %) — a restart would move the camera by the inter-region ` +
          'separation instead of a fraction of the remaining arc',
      ).toBeLessThanOrEqual(MAX_FRAME_FRACTION);
      expect(fraction, 'and it must actually move, or the arc is not running').toBeGreaterThan(0);
      expect(finalErr, 'the retarget must end facing the second region').toBeLessThan(0.1);
      expect(pxErr).toBeLessThan(0.75);
      expect(after.regionId).toBe('se-asia');
    });
  }

  /* ------------------------------------------------------------------ U8 */

  /** U8 — a drag during `focusing` ends in `focused`, and the camera then stops moving by itself. */
  test('U8 interrupt: a drag during focusing cancels the fly-to and the pose stays put', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);

    await selectRegion(page, REGIONS[0].card);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [100] })
      .toBe('focusing');

    await page.mouse.move(600, 500);
    await page.mouse.down();
    await page.mouse.move(660, 520, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');

    /*
     * Wait for the pose to STOP, then require it to stay stopped for 500 ms.
     *
     * A single fixed wait is the wrong instrument here: OrbitControls' damping (factor 0.06) has a release
     * tail of ~1.5 s after a drag, so a 600 ms wait measures the USER's decay rather than the rest state.
     * The claim under test is "the director does not move the camera by itself", so the window has to start
     * when the pose has actually stopped — `settlePose` observes that, and unlike a
     * `poll(...).toBe(own snapshot)` idiom it cannot pass vacuously on the first frame.
     */
    const before = await readAll(page);
    await settlePose(page);
    const a = await readAll(page);
    await page.waitForTimeout(500);
    const b = await readAll(page);

    const movedDeg = angleDeg(a.direction, b.direction);
    const movedD = Math.abs(a.distance - b.distance);

    console.log(
      `[U8] state ${a.focus} → ${b.focus}; pose drift over 500 ms after the drag settled: ` +
        `${movedDeg.toFixed(6)} deg, distance Δ ${movedD.toExponential(2)}; userZoomed ${b.userZoomed}; ` +
        `direction before the settle was ${angleDeg(before.direction, a.direction).toFixed(3)} deg away`,
    );

    expect(b.focus).toBe('focused');
    expect(movedDeg, 'the director must stop moving the camera after the interruption').toBeLessThan(0.05);
    expect(movedD).toBeLessThan(0.002);
  });

  /* ------------------------------------------------------------------ U9 */

  /** U9 — the drawer opens DURING the fly-to; the final pin sits on the NEW free-rect centre. */
  test('U9 drawer interplay: the pin lands on the new free-rect centre', async ({ page }) => {
    const vp = { w: 1280, h: 800 };
    await openLive(page, vp);

    /*
     * Reach a fly-to from a CLOSED drawer, so the drawer's opening is what changes the free rect mid-flight.
     *
     * A card click cannot do this once the drawer is open (it is occluded — see `selectRegion`), and closing
     * first would defeat the case. A PIN click can: it is the raycaster path `frame.spec.ts` F9 proves, it
     * works on an empty screen, and it opens the drawer as a consequence of the selection. The pin used is
     * the innermost facing one, so the ray reaches its core rather than the surface in front of it (F9's
     * `rOverR < 0.9` filter, same reason).
     */
    const target = await page.evaluate(() => {
      const pins = window.__globe!.pins();
      const centre = window.__globe!.project([0, 0, 0]);
      const disc = window.__globe!.discRadiusPx();
      const pick = pins
        .filter((p) => p.facing && !p.behind)
        .map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          rOverR: Math.hypot(p.x - centre.x, p.y - centre.y) / disc,
        }))
        .filter((p) => p.rOverR < 0.9)
        .sort((a, b) => a.rOverR - b.rOverR)[0];
      return pick ?? null;
    });
    expect(target, 'a facing pin inside the limb must exist to click').not.toBeNull();

    const closedInsets = await page.evaluate(() => window.__frame!.insets.right);
    await page.mouse.click(target!.x, target!.y);

    /* The drawer opening is the observable consequence of the selection — and it MOVES the free rect. */
    await expect
      .poll(() => page.evaluate(() => window.__frame!.insets.right), { timeout: 8_000, intervals: [80] })
      .toBeGreaterThan(400);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 25_000, intervals: [150] })
      .toBe('focused');
    await settleStable(page);
    /* The fit's distance channel eases for 180 ms after the drawer lands; let it finish, then re-settle. */
    await page.waitForTimeout(700);
    await settleStable(page);

    const r = await readAll(page);
    const freeCx = r.free.x + r.free.w / 2;
    const freeCy = r.free.y + r.free.h / 2;
    const pin = pinFor(r.pins, target!.id);
    const pxErr = Math.hypot(pin.x - freeCx, pin.y - freeCy);
    const freeMath = fitMath(vp, r.free);

    console.log(
      `[U9] pin "${target!.id}" (${target!.rOverR.toFixed(3)} r/R); drawer right inset ${closedInsets} → ` +
        `${r.insets.right}; pin error (${Math.abs(pin.x - freeCx).toFixed(3)}, ` +
        `${Math.abs(pin.y - freeCy).toFixed(3)}) = ${pxErr.toFixed(3)} px; |target| ` +
        `${r.targetRadius.toExponential(1)}; d ${r.distance.toFixed(4)} (d_fit ${freeMath.dTarget.toFixed(4)})`,
    );

    expect(r.insets.right, 'the drawer must have opened during the flight').toBeGreaterThan(closedInsets + 50);
    expect(pxErr, 'the pin must be on the NEW free-rect centre').toBeLessThan(0.75);
    expect(r.targetRadius).toBeLessThanOrEqual(1e-6);
    expect(r.regionId).toBe(target!.id);
  });

  /* ------------------------------------------------------------------ U10 */

  /** U10 — S7: the layout is unchanged apart from the new Reset control. */
  test('U10 layout: the occluder rects are unchanged and only Reset was added', async ({ page }) => {
    const vp = { w: 1440, h: 900 };
    await openLive(page, vp);

    const rects = await page.evaluate(() => {
      const rect = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100);
      };
      return {
        canvas: rect(document.querySelector('#globe-canvas')),
        header: rect(document.querySelector('[data-occluder="top-panel"]')),
        leftPanel: rect(document.querySelector('[data-occluder="left-panel"]')),
        rightPanel: rect(document.querySelector('[data-occluder="right-panel"]')),
        drawer: rect(document.querySelector('[data-occluder="right-drawer"]')),
        reset: rect(document.querySelector('[data-testid="reset-view"]')),
      };
    });

    console.log(`[U10] ${JSON.stringify(rects)}`);

    /*
     * The values from 3A step C (`docs/STEP3B2-DESIGN.md` §1), asserted as the frozen rects this step must
     * not disturb. The header HEIGHT is the number S7 is really about: the right cluster grew by one 29 px
     * button, and the header is sized by its LEFT column, so 118.25 must not move.
     */
    expect(rects.header).toEqual([0, 0, 1440, 118.25]);
    expect(rects.canvas).toEqual([0, 0, 1440, 900]);
    expect(rects.leftPanel![2]).toBeCloseTo(360.84, 2);
    expect(rects.rightPanel![2]).toBeCloseTo(316, 2);
    expect(rects.reset, 'the Reset control must have a rect').not.toBeNull();
    /* Inside the header band, not overlapping the disc. */
    expect(rects.reset![1] + rects.reset![3]).toBeLessThanOrEqual(118.25);
    /* A real button, keyboard focusable, with the documented label. */
    const box = page.locator('[data-testid="reset-view"]');
    await expect(box).toHaveAttribute('aria-label', 'Reset view');
    await expect(box).toBeVisible();
  });
});
