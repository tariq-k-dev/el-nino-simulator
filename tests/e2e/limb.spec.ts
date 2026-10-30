/**
 * A2 — limb registration.
 *
 * `__globe.discRadiusPx()` is the origin of every disc-relative rule (the rim
 * profile, the probe windows, the terminator axis), so it is worth a spec of its
 * own. It was accused of under-reporting the limb by ~3 px; the measured answer is
 * that it agrees with a 360-ray sub-pixel circle fit to **0.11 px**, and the old
 * reading came from the atmosphere halo.
 *
 * Requires `pnpm build:e2e`.
 */
import { test, expect } from './fixtures';
import { cameraGeometry, fitLimb, openGlobe, setLayers } from './look/capture';
import { discRadiusNaivePx, discRadiusTangentPx, focalPxFromFov } from '../../src/lib/look/helpers';
import { writeResult } from './look/measure';

const CASES = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
] as const;

test.describe('limb registration', () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    await openGlobe(page);
  });

  for (const viewport of CASES) {
    test(`R_fit agrees with __globe.discRadiusPx within 0.5 px at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setLayers(page, { atmosphere: false, pins: false, clouds: false, stars: false, rings: false });
      await page.evaluate(() => window.__look!.setAzimuth(0));
      await page.waitForTimeout(400);

      const first = await fitLimb(page);
      const second = await fitLimb(page);

      // Inputs must be real before anything is compared.
      expect(first.rays, 'fitLimb produced no usable rays').toBeGreaterThan(340);
      expect(first.misses, 'fitLimb missed more than 20 of 360 rays').toBeLessThan(20);
      expect(Number.isFinite(first.r)).toBe(true);

      // The fit must be a circle, not a cloud of edge pixels.
      expect(first.rms, `limb fit RMS ${first.rms} px exceeds 0.4`).toBeLessThanOrEqual(0.4);
      expect(
        Math.abs(second.r - first.r),
        `R_fit is unstable across two captures: ${first.r} then ${second.r}`,
      ).toBeLessThanOrEqual(0.2);

      // The claim under test.
      const hook = await page.evaluate(() => window.__globe!.discRadiusPx());
      const delta = Math.abs(hook - first.r);

      // The other two numbers the brief asks to be reported.
      const geo = await cameraGeometry(page);
      const focal = focalPxFromFov(geo.fov, geo.height);
      const tangent = discRadiusTangentPx(geo.radius, geo.distance, focal);
      const naive = discRadiusNaivePx(geo.radius, geo.distance, focal);
      const centre = await page.evaluate(() => window.__globe!.project());
      const centreOffset = Math.hypot(first.cx - centre.x, first.cy - centre.y);

      const row = {
        viewport: `${viewport.width}x${viewport.height}`,
        rFit: +first.r.toFixed(3),
        rFitRms: +first.rms.toFixed(3),
        rFitRays: first.rays,
        rFitMisses: first.misses,
        hook: +hook.toFixed(3),
        tangent: +tangent.toFixed(3),
        naive: +naive.toFixed(3),
        focal: +focal.toFixed(2),
        distance: +geo.distance.toFixed(4),
        fov: geo.fov,
        canvasHeight: geo.height,
        hookMinusFit: +(hook - first.r).toFixed(3),
        tangentMinusFit: +(tangent - first.r).toFixed(3),
        naiveMinusFit: +(naive - first.r).toFixed(3),
        centreOffsetFromProject: +centreOffset.toFixed(3),
        fitCentreMinusProject: {
          dx: +(first.cx - centre.x).toFixed(3),
          dy: +(first.cy - centre.y).toFixed(3),
        },
      };
      console.log(`[limb] ${JSON.stringify(row)}`);

      await writeResult(`limb-${viewport.width}x${viewport.height}`, row);

      expect(
        delta,
        `R_fit ${first.r.toFixed(3)} disagrees with __globe.discRadiusPx() ${hook.toFixed(3)} by ${delta.toFixed(3)} px (max 0.5)`,
      ).toBeLessThanOrEqual(0.5);

      // Tangent form must also agree, since it is the analytic ground truth the hook
      // claims to implement. A large gap here would mean the hook's formula is right
      // by accident at this one distance.
      expect(
        Math.abs(tangent - first.r),
        `tangent radius ${tangent.toFixed(3)} disagrees with R_fit ${first.r.toFixed(3)}`,
      ).toBeLessThanOrEqual(0.5);

      // The naive form must be visibly WRONG, or the test cannot tell the two apart.
      expect(
        Math.abs(naive - first.r),
        'the naive f*R/d form agrees with R_fit, so this test cannot distinguish the formulas',
      ).toBeGreaterThan(1);

      // The fitted CENTRE must sit on the projected centre to within the half-pixel
      // sample-centre convention (a fitted edge lands on pixel boundaries, which are
      // half a pixel outside pixel centres).
      expect(
        centreOffset,
        `fitted limb centre is ${centreOffset.toFixed(3)} px from __globe.project() (max 1.0)`,
      ).toBeLessThanOrEqual(1);
    });
  }
});
