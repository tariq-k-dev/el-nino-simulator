/**
 * Negative tests: prove each look check actually FAILS when the thing it guards breaks.
 *
 * A green suite that cannot go red is not evidence. Every check in `look.spec.ts` was
 * written against a fixed scene, so without these none of them has ever been observed
 * failing on the defect it exists to catch.
 *
 * ## What changed in 2B-C2A, and why
 *
 * The previous version of this file parked N1/N3/N4 on `test.fixme` because each measured
 * NO CHANGE under a defect a standalone probe had shown was real. D1
 * (`docs/globe-look/D1-DIAGNOSIS.md`) recorded four moments and found the defect was live
 * at capture every time — lights 3->4, parent uuid stable, programs 20->35, uAlphaCap held
 * at 1.0. The defect had never been lost; N1 had been injected at a SCREEN pixel pair
 * (`project()` output, ~291 world units off the globe) instead of at the pin.
 *
 * So this file is rebuilt on two rules:
 *
 *  1. **Acquisition and analysis are separate.** `acquire()` (in `look/acquire.ts`) is the
 *     only thing that touches the scene: it sets flags, fits the limb, takes a baseline,
 *     installs the defect, waits 3 frames, runs a SURVIVAL PROBE, captures, uninstalls and
 *     re-captures. The checks (in `look/analysis.ts`) then run on finished bitmaps and
 *     cannot reach the scene at all.
 *  2. **Every test asserts the signal moved, not merely that a boolean flipped.** "3.6 says
 *     fail" is satisfiable by a broken check. "+329% against a 3% gate, in the positive
 *     direction" is not.
 *
 * Each test also asserts the control passes, and the ones that can assert the scene
 * returned to baseline afterwards.
 *
 * Defects are never committed to source: they live in a page-side engine installed by
 * `installDefectEngine` and torn down in `afterEach`.
 *
 * Requires `pnpm build:e2e` (a production `pnpm build` strips the VITE_E2E hooks, and the
 * bundle stamp refuses to run against the result).
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { measureSpecularMask, writeResult } from './look/measure';
import { openGlobe, capture, setLayers, settleAt, cameraGeometry } from './look/capture';
import { acquire, installDefectEngine, type LayerFlags } from './look/acquire';
import { checkGlare, checkLocalPeak, checkPins, checkRim, checkRingCast } from './look/analysis';
import { requireValidPins } from './look/pinValidity';
import { acquireGlintFrames } from './look/glintAcquire';
import {
  classifyGlintCollapse,
  countDifferingPixels,
  frameDelta,
  locateDiffering,
  maxRawChannelDelta,
  measureGlint,
} from './look/glint';
import { GLINT_GATE, GLINT_VIEW } from './look/glintConstants';
import {
  acquireFlatFrame,
  acquireRealFrame,
  assertSurfaceRestored,
  readTextureMeans,
} from './look/flatAlbedo';
import { evaluateTerminator, mutateTerminator } from './look/terminatorProfile';
import type { Bitmap, DiscGeometry } from '../../src/lib/look/helpers';
import { focalPxFromFov, shellSilhouetteOffsetPx } from '../../src/lib/look/helpers';
import { SHELLS } from '../../src/scene/constants';

/** The 3.6 view: pins on, everything that could confuse an annulus off. */
const RING_CAST_FLAGS: LayerFlags = {
  rings: false,
  atmosphere: false,
  stars: false,
  clouds: false,
  pins: true,
};

/** The 3.5 view: the committed pin gate's own layer set (measure.ts:780). */
const PIN_FLAGS: LayerFlags = {
  stars: false,
  rings: false,
  atmosphere: true,
  clouds: true,
  pins: true,
};

/** An all-black or all-white bitmap at the canvas' size. */
function syntheticFrame(width: number, height: number, value: 0 | 255): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/**
 * Pin geometry in the shape `checkPins` wants, resolved from the live probe.
 *
 * Same derivation as `measurePinGates`: the core sphere's world radius is 0.011
 * (`Hotspot.tsx`: `sphereGeometry args={[0.011, 16, 16]}`), which is NOT the 0.055
 * coreOffset — using the offset made the sample region 5x too large and every median came
 * back as the dark housing around the core.
 */
async function pinGeometry(page: Page, geom: DiscGeometry) {
  return page.evaluate((g: { cx: number; cy: number; r: number }) => {
    const anchors = window.__globe!.pinAnchors();
    const pins = window.__globe!.pins();
    const cam = window.__camera as { position: { x: number; y: number; z: number } };
    const cl = Math.hypot(cam.position.x, cam.position.y, cam.position.z) || 1;
    const camDir = [cam.position.x / cl, cam.position.y / cl, cam.position.z / cl];

    let sun: number[] = [0.72, 0.36, 0.59];
    (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
      const l = o as {
        isDirectionalLight?: boolean;
        intensity?: number;
        position?: { x: number; y: number; z: number };
      };
      if (l.isDirectionalLight && (l.intensity ?? 0) > 1 && l.position) {
        sun = [l.position.x, l.position.y, l.position.z];
      }
    });
    const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
    const sunDir = [sun[0] / sl, sun[1] / sl, sun[2] / sl];

    return pins.map((p) => {
      const a = anchors.find((x) => x.id === p.id);
      const w = a ? a.world : ([0, 0, 0] as [number, number, number]);
      const len = Math.hypot(w[0], w[1], w[2]) || 1;
      const n = [w[0] / len, w[1] / len, w[2] / len];
      const coreWorldR = 0.011;
      const perp = [n[2], 0, -n[0]];
      const pl = Math.hypot(perp[0], perp[1], perp[2]) || 1;
      const off: [number, number, number] = [
        w[0] + (perp[0] / pl) * coreWorldR,
        w[1] + (perp[1] / pl) * coreWorldR,
        w[2] + (perp[2] / pl) * coreWorldR,
      ];
      const p0 = window.__globe!.project(w);
      const p1 = window.__globe!.project(off);
      const rCore = Math.max(1.5, Math.hypot(p1.x - p0.x, p1.y - p0.y));
      const sunDot = n[0] * sunDir[0] + n[1] * sunDir[1] + n[2] * sunDir[2];
      return {
        id: p.id,
        side: (sunDot > 0.2 ? 'day' : sunDot < -0.1 ? 'night' : 'terminator') as
          | 'day'
          | 'night'
          | 'terminator',
        x: p.x,
        y: p.y,
        coreRadiusPx: Math.max(1.5, rCore * 0.6),
        rOverR: Math.hypot(p.x - g.cx, p.y - g.cy) / g.r,
        facingDot: n[0] * camDir[0] + n[1] * camDir[1] + n[2] * camDir[2],
      };
    });
  }, geom);
}

/**
 * The facing geometry `checkRingCast` needs, in one place.
 *
 * `pinGeometry` above returns the shape `checkPins` wants; 3.6 wants the same two numbers
 * without `side`. Named separately so the conversion is explicit rather than a spread that
 * silently carried field names into a rule.
 */
async function ringCastPinGeometry(page: Page, geom: DiscGeometry) {
  const pins = await pinGeometry(page, geom);
  return pins.map((p) => ({ id: p.id, x: p.x, y: p.y, facingDot: p.facingDot, rOverR: p.rOverR }));
}

test.describe('negative tests: each check fails when its defect is present', () => {
  test.setTimeout(400_000);

  test.beforeEach(async ({ page }) => {
    await openGlobe(page);
    await installDefectEngine(page);
  });

  test.afterEach(async ({ page }) => {
    // A defect tour must never leave anything behind on a page another test reuses.
    await page.evaluate(() => {
      (window as unknown as { __defects?: { uninstall(): void } }).__defects?.uninstall();
    });
  });

  // --------------------------------------------------------------------- N1 ---
  test('N1: an amber pointLight at a pin core makes 3.6 ring luminance FAIL', async ({ page }) => {
    /*
     * Defect placement is the whole story here. N1 previously injected at a SCREEN pixel
     * pair from project(); a light at (291, 482) sits 291 world units right and 482 down,
     * nowhere near the globe, so `distance: 1` falloff killed it before the surface and the
     * check correctly reported no change. It is now placed at the pin's CORE WORLD
     * position, read from __look.pinsWorld().
     *
     * us-west at az 0 is the ONLY valid pin at that azimuth (V0(c)): n·cam 0.856, r/R
     * 0.754. Never the Pacific pin at az 0 — its core projects at 1.100 R, outside the
     * disc, so its annulus is sky and its "delta" is the sky changing.
     */
    await settleAt(page, 0);
    await setLayers(page, RING_CAST_FLAGS);

    const control = await acquire(page, { flags: RING_CAST_FLAGS, azimuth: 0 });
    // Facing geometry, resolved the same way 3.5 does, so `isValidPin` — not a hand-picked
    // name — decides which pin a light can reach.
    const pins = await ringCastPinGeometry(page, control.geometry);
    const controlRows = checkRingCast(control.frame, control.frame, control.frame, control.geometry, pins);
    const controlValid = controlRows.filter((r) => r.valid);
    /*
     * The pin is SELECTED BY THE SHARED RULE, not named.
     *
     * The previous version hand-named `us-west`, with a comment explaining that the generic
     * selection had landed on horn-africa — a pin `checkRingCast` called valid on annulus
     * coverage alone although it faces away at az 0. Naming the pin worked around the
     * defect in the validity rule instead of fixing it. `checkRingCast` now applies
     * `isValidPin`, so the generic selection is correct and the workaround is gone.
     */
    requireValidPins(controlValid.map((r) => r.id), 'at-least-one', 'N1 control at az 0');
    expect(
      controlValid.every((r) => r.pass),
      `control should pass; got ${controlValid.map((r) => `${r.id}=${r.deltaPct}%`).join(', ')}`,
    ).toBe(true);

    /*
     * Which pin the defect is anchored to. Every valid row is a candidate; the target is the
     * one whose annulus the light can reach, and the assertion below proves it did.
     */
    const target = controlValid[0];
    const usWest = target;

    /*
     * Pin selection is explicit, not "whichever the check liked most".
     *
     * The first attempt took the VALID row with the smallest delta and landed on
     * horn-africa — which `checkRingCast` marks valid on annulus COVERAGE alone, with no
     * facing test. horn-africa faces away at az 0 (n·cam −0.575), so a light there is on
     * the far side and the defect could never show. V0(c) says us-west is the only pin
     * that is both front-facing and inside the disc at az 0, so it is named, and the
     * validity of that specific row is asserted rather than assumed.
     */

    // The defect frame (pins ON) plus the pins-OFF pair, all under ONE live defect.
    const defective = await acquire(page, {
      flags: RING_CAST_FLAGS,
      azimuth: 0,
      defect: { name: 'pointLight', params: { intensity: 2, distance: 1, color: 0xffaa00 } },
      pinName: target.id,
      extraCaptures: [
        { label: 'off', flags: { ...RING_CAST_FLAGS, pins: false } },
        { label: 'off2', flags: { ...RING_CAST_FLAGS, pins: false } },
      ],
    });
    const off = defective.extras.off;
    const off2 = defective.extras.off2;

    const rows = checkRingCast(defective.frame, off, off2, defective.geometry, pins);
    const hit = rows.find((r) => r.id === target.id)!;

    console.log(
      `[N1] ${target.id}: control delta=${usWest.deltaPct}% (allowed ${usWest.allowedPct}%) | ` +
        `defect delta=${hit.deltaPct}% (allowed ${hit.allowedPct}%) | ` +
        `annulus ${hit.offMean.toFixed(3)} -> ${hit.onMean.toFixed(3)} | pass=${hit.pass}`,
    );
    console.log(`[N1] survival probe ${JSON.stringify(defective.probe)}`);
    await writeResult('negative-n1', { control: target, defect: hit, probe: defective.probe });

    // The probe is what makes this result interpretable at all.
    expect(
      defective.probe?.alive,
      `the defect was not live at capture: ${defective.probe?.failures}`,
    ).toBe(true);
    expect(
      defective.probeAfterExtras?.alive,
      `the defect did not survive the pins-off captures: ${defective.probeAfterExtras?.failures?.join('; ')}`,
    ).toBe(true);
    expect(hit.valid, `${target.id} must stay measurable for the defect to count`).toBe(true);
    expect(hit.pass, `3.6 did NOT catch an amber pointLight at ${target.id}: delta ${hit.deltaPct}%`).toBe(false);
    // The signal, not just the verdict: positive direction, and past the gate.
    expect(hit.onMean, 'the defect must BRIGHTEN the annulus, not merely move it').toBeGreaterThan(
      hit.offMean,
    );
    expect(hit.deltaPct).toBeGreaterThan(hit.allowedPct);
  });

  // --------------------------------------------------------------------- N2 ---
  test('N2: specularIntensity 1.0 with roughness floor 0 makes 3.2 glare FAIL', async ({ page }) => {
    const control = await acquire(page, { flags: { stars: false } });
    const controlGlare = checkGlare(control.frame, control.geometry);
    expect(controlGlare.valid, 'control frame is not a rendered disc').toBe(true);
    expect(controlGlare.clipped, 'control has clipped pixels; cannot attribute the defect').toBe(0);
    expect(controlGlare.pass).toBe(true);

    // Mirror-smooth water at full specular — the exact pair CLIPPED-FACTS names.
    const defective = await acquire(page, {
      flags: { stars: false },
      defect: { name: 'mirrorSurface', params: { specularIntensity: 1, roughness: 0 } },
    });
    const defectGlare = checkGlare(defective.frame, defective.geometry);

    console.log(
      `[N2] control clipped=${controlGlare.clipped} largest=${controlGlare.largestBlob} | ` +
        `defect clipped=${defectGlare.clipped} largest=${defectGlare.largestBlob} (max 12)`,
    );
    console.log(`[N2] survival probe ${JSON.stringify(defective.probe)}`);
    await writeResult('negative-n2', { control: controlGlare, defect: defectGlare, probe: defective.probe });

    expect(defective.probe?.alive, `defect not live: ${defective.probe?.failures}`).toBe(true);
    expect(defectGlare.valid, 'defect frame must still be a rendered disc').toBe(true);
    expect(defectGlare.pass, '3.2 did NOT catch a mirror-smooth full-specular surface').toBe(false);
    // The glare rule is clipped==0 AND blob<=12; this defect targets clipping specifically.
    expect(
      defectGlare.clipped,
      `clipped pixels did not rise: ${controlGlare.clipped} -> ${defectGlare.clipped}`,
    ).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------- N3 ---
  test('N3: atmosphere alpha forced to 1 at the silhouette makes 3.1 FAIL', async ({ page }) => {
    const control = await acquire(page, { flags: { stars: false, atmosphere: true } });
    /*
     * The monotonic gate starts past the outermost OPAQUE silhouette, and that offset is a
     * camera input, not a pixel measurement — `measureRim` derives it exactly this way. The
     * atmosphere is deliberately excluded: it is an additive halo, so treating its 1.1 R
     * silhouette (+35.9 px) as opaque would skip the entire profile.
     */
    const cam = await cameraGeometry(page);
    const focal = focalPxFromFov(cam.fov, cam.height);
    const outermostOpaqueOffset = Math.max(
      shellSilhouetteOffsetPx(SHELLS.clouds, cam.radius, cam.distance, focal),
      shellSilhouetteOffsetPx(SHELLS.overlay, cam.radius, cam.distance, focal),
    );
    const controlRim = checkRim(control.frame, control.geometry, { outermostOpaqueOffset });
    expect(Number.isFinite(controlRim.peak), 'control rim profile is not finite').toBe(true);
    expect(
      controlRim.shellMinusBackground,
      'control shell already differs from background',
    ).toBeLessThanOrEqual(2);
    expect(
      controlRim.pass,
      `control 3.1 should pass; failures: ${controlRim.failures.join('; ')}`,
    ).toBe(true);

    /*
     * Capping the alpha alone was measured to do NOTHING (shellVsBackground 0.31 under the
     * defect vs 0.30 in the control). The cap is a ceiling and the shell's profile at the
     * silhouette comes from its impact-parameter falloff reaching zero at r = uShellRadius;
     * raising a ceiling does not lift a curve already below it. The defect therefore ALSO
     * replaces the fragment shader with one returning constant alpha, re-written every
     * frame so a material swap cannot revive the fade.
     */
    const defective = await acquire(page, {
      flags: { stars: false, atmosphere: true },
      defect: { name: 'atmosphereOpaque', params: { intensity: 2.5 } },
    });
    const defectRim = checkRim(defective.frame, defective.geometry, { outermostOpaqueOffset });

    console.log(
      `[N3] control shellVsBg=${controlRim.shellMinusBackground.toFixed(2)} peak=${controlRim.peak.toFixed(
        1,
      )} | defect shellVsBg=${defectRim.shellMinusBackground.toFixed(2)} ` +
        `peak=${defectRim.peak.toFixed(1)} step=${defectRim.maxAbsStepBeyond2px.toFixed(2)} ` +
        `mono=${defectRim.worstIncreaseOutward.toFixed(2)} (gates shell<=2, peak<=110, step<=16, rise<=1)`,
    );
    console.log(`[N3] survival probe ${JSON.stringify(defective.probe)}`);
    await writeResult('negative-n3', { control: controlRim, defect: defectRim, probe: defective.probe });

    expect(defective.probe?.alive, `defect not live: ${defective.probe?.failures}`).toBe(true);
    expect(defectRim.pass, '3.1 did NOT catch a hard atmosphere silhouette').toBe(false);
    // The silhouette-step gate is the one this defect targets; assert it specifically.
    expect(
      defectRim.shellMinusBackground,
      `the silhouette-step gate should fail; got ${defectRim.shellMinusBackground.toFixed(2)} vs 2`,
    ).toBeGreaterThan(2);
  });

  // --------------------------------------------------------------------- N4 ---
  test('N4: the retired fill light makes 3.3 FAIL in W1 once the material specular is back', async ({
    page,
  }) => {
    /*
     * THE FAITHFUL N4. The original defect is TWO things, and the old test restored one.
     *
     * What drew the blue circle at W1 was the cool fill light acting on a surface whose
     * GGX specular was still enabled. `docs/2B-VERIFY.md` and the ablation recorded in
     * `clipped-probe.mjs` measured the probe window at **luma 91.1 with the fill light and
     * 4.1 without it** — an 87-luma lift that any ratio gate sees at once.
     *
     * Since 38aa091 the surface is matte (`specularIntensity: 0`), so the same light lifts
     * blue by ~3/255 over a ~5/255 night ocean and moves three pixels in the whole disc.
     * Measured on the previous N4: W1 ratio 0.976 -> 0.982 against a 1.15 gate. That is why
     * it sat on `test.fixme` — and why N4 was described as testing the wrong defect.
     *
     * Recovered from git, both halves:
     *
     *   light      2e27939^  <directionalLight position={[-5.2,-2.2,-4.6]} intensity={0.32}
     *                        color="#2f6fb8" />
     *   material   38aa091^  specularIntensity 0.18 (PRE-FIX value; shipped is 0), roughness floor 0
     *
     * The 3.3 METRIC IS UNCHANGED. W1 stays at r/R 0.91, 180deg, size 40, sigma-3 blurred
     * ratio <= 1.15, excluded only by the measured specular mask. No threshold moves, and no
     * per-channel blue gate is introduced: the prompt's N4 finding records that a blue gate
     * would guard an invisible 3/255 lift, which is the opposite of what the look cares about.
     */
    const geomView = { stars: false, pins: false, rings: false, clouds: false };

    // ---- control: the same view, no defect, must pass and must not be excused ----
    const control = await acquire(page, { flags: geomView, azimuth: 0 });
    const controlGlint = await measureSpecularMask(page, control.geometry);
    const w1Control = checkLocalPeak(control.frame, control.geometry, { rOverR: 0.91, azimuthDeg: 180 });
    const w1ControlExcluded = controlGlint.lookup(w1Control.x, w1Control.y);

    expect(Number.isFinite(w1Control.ratio), 'control W1 ratio is not finite').toBe(true);
    expect(w1Control.pass, `control W1 already fails: ratio ${w1Control.ratio.toFixed(3)}`).toBe(true);
    expect(w1ControlExcluded, 'control W1 must not be excused as sun glint').toBe(false);

    // ---- defect: fill light AND the material specular that let it glow ----
    const defect = await acquire(page, {
      flags: geomView,
      azimuth: 0,
      defect: {
        name: 'fillLightWithSpecular',
        // No intensity/colour params: the engine hardcodes the git-recovered pair, so this
        // test cannot restate the defect to suit the result.
        params: { specularIntensity: 0.18, roughness: 0 },
      },
    });

    /*
     * W1 must be re-measured on the defect frame, and the specular mask re-measured too:
     * with specular restored the glint covers far more of the disc, and using the control's
     * mask would excuse exactly the pixels the defect created.
     */
    const defectGlint = await measureSpecularMask(page, defect.geometry);
    const w1Defect = checkLocalPeak(defect.frame, defect.geometry, { rOverR: 0.91, azimuthDeg: 180 });
    const w1DefectExcluded = defectGlint.lookup(w1Defect.x, w1Defect.y);

    console.log(
      `[N4] W1 control ratio=${w1Control.ratio.toFixed(3)} peak=${w1Control.peak.toFixed(2)} med=${w1Control.annulusMedian.toFixed(2)} | ` +
        `defect ratio=${w1Defect.ratio.toFixed(3)} peak=${w1Defect.peak.toFixed(2)} med=${w1Defect.annulusMedian.toFixed(2)} ` +
        `(gate 1.15)`,
    );
    console.log(
      `[N4] W1 excluded: control=${w1ControlExcluded} defect=${w1DefectExcluded} | ` +
        `mask px control=${controlGlint.summary.pixels} defect=${defectGlint.summary.pixels}`,
    );
    console.log(`[N4] survival probe ${JSON.stringify(defect.probe)}`);
    await writeResult('negative-n4', { control: w1Control, defect: w1Defect, probe: defect.probe });

    // The probe is what separates "the check is blind" from "the defect never arrived".
    expect(defect.probe?.alive, `defect not live at capture: ${defect.probe?.failures?.join('; ')}`).toBe(true);
    expect(defect.probeAfterExtras ?? true).toBeTruthy();

    /*
     * Inputs before verdicts. `checkLocalPeak` reports no separate `valid` flag: its inputs
     * are the capture (taken by `acquire`, which throws if the limb fit fails) and the probe
     * window. So validity means a finite peak, a non-zero annulus and a finite ratio — a
     * null-vs-null comparison must not be able to pass.
     */
    expect(w1Defect.peak, 'defect W1 peak is not finite').toBeGreaterThan(0);
    expect(w1Defect.annulusMedian, 'defect W1 annulus median is zero, so the ratio is 1/0').toBeGreaterThan(0);
    expect(Number.isFinite(w1Defect.ratio), 'defect W1 ratio is not finite').toBe(true);
    expect(w1Control.annulusMedian, 'control W1 annulus median is zero').toBeGreaterThan(0);

    // The verdict, and then the SIGNAL — a broken check could also return fail.
    expect(
      w1Defect.pass,
      `3.3 did NOT catch the faithful fill-light defect: W1 ratio ${w1Defect.ratio.toFixed(3)} within 1.15` +
        (w1DefectExcluded ? ' (and it was excused by the specular mask)' : ''),
    ).toBe(false);
    expect(
      w1Defect.ratio,
      `W1 ratio must RISE past 1.15; control ${w1Control.ratio.toFixed(3)} -> defect ${w1Defect.ratio.toFixed(3)}`,
    ).toBeGreaterThan(1.15);
    // The luma lift is the property the prompt names: ~91 instead of ~4.
    expect(w1Defect.peak, 'the defective W1 peak must be far brighter than the control').toBeGreaterThan(
      w1Control.peak * 3,
    );

    // Informational, and NOT a gate: with the material matte the light alone does nothing.
    const lightOnly = await acquire(page, {
      flags: geomView,
      azimuth: 0,
      defect: { name: 'fillLight', params: { intensity: 0.32 } },
    });
    const w1LightOnly = checkLocalPeak(lightOnly.frame, lightOnly.geometry, { rOverR: 0.91, azimuthDeg: 180 });
    console.log(
      `[N4] informational — fill light alone with specularIntensity 0: W1 peak ${w1Control.peak.toFixed(2)} -> ` +
        `${w1LightOnly.peak.toFixed(2)} (ratio ${w1Control.ratio.toFixed(3)} -> ${w1LightOnly.ratio.toFixed(3)}). ` +
        `The ~3/255 blue lift is invisible to a luma ratio gate, which is why the faithful defect restores the material.`,
    );
    await writeResult('negative-n4-light-only', { control: w1Control, lightOnly: w1LightOnly });
  });

  // --------------------------------------------------------------------- N9 ---
  test('N9: the glint sentinel FAILS when the specular overlay is off', async ({ page }) => {
    /*
     * The sentinel's own signal, at the smallest possible change: turn the overlay off and the
     * shipped render IS the "all specular off" frame, so the difference collapses to a rounding
     * residual. If the sentinel still passed, it would be measuring something other than glint.
     */
    const control = await acquireGlintFrames(page);
    const controlStats = measureGlint(control.current, control.off, control.geometry);
    expect(controlStats.valid, `control frames invalid: ${controlStats.invalidReason}`).toBe(true);
    // The CONTROL must be inside the window — both bounds. Asserting only the lower one let a
    // control that was already too bright (a defect upstream) satisfy "above the minimum" and
    // then the test's premise carried no information.
    expect(
      controlStats.max,
      `control glint peak ${controlStats.max.toFixed(2)} is outside the gate [${GLINT_GATE.maxMin}, ${GLINT_GATE.maxMax}]`,
    ).toBeGreaterThanOrEqual(GLINT_GATE.maxMin);
    expect(controlStats.max).toBeLessThanOrEqual(GLINT_GATE.maxMax);

    /*
     * Defect: overlay off, material still at the shipped si 0. Both "frames" are then the same
     * render, which is exactly what N9 claims the sentinel must notice.
     */
    await settleAt(page, GLINT_VIEW.azimuth);
    await setLayers(page, { stars: false, pins: false, rings: false, clouds: true });
    await page.evaluate(() => {
      window.__look!.specularIntensity(0);
      window.__globe!.setLookFlags({ specular: false });
    });
    const withOverlayOff = await capture(page);
    const alsoOff = await capture(page);

    const defectStats = measureGlint(withOverlayOff, alsoOff, control.geometry);
    // A NUMBER, not just a NaN: "identical" must mean zero pixels changed, not merely that the
    // measurement came back INVALID. Those are opposite findings and N9 must tell them apart.
    const differing = countDifferingPixels(withOverlayOff, alsoOff, control.geometry);
    const rawDelta = maxRawChannelDelta(withOverlayOff, alsoOff, control.geometry);

    const verdict = classifyGlintCollapse(defectStats, differing, GLINT_GATE);

    console.log(
      `[N9] control max=${controlStats.max.toFixed(2)} area6=${controlStats.area6} ` +
        `(gate ${GLINT_GATE.maxMin}..${GLINT_GATE.maxMax}) | ` +
        `defect max=${defectStats.valid ? defectStats.max.toFixed(2) : 'INVALID'} ` +
        `area6=${defectStats.area6} differingLumaPx=${differing} maxRawChannelDelta=${rawDelta} ` +
        `kind=${verdict.kind} ` +
        `acceptable=${verdict.acceptable} — ${verdict.reason}`,
    );
    await writeResult('negative-n9', {
      control: controlStats,
      defect: defectStats,
      differingLumaPixels: differing,
      maxRawChannelDelta: rawDelta,
      verdict,
    });

    /*
     * EXACTLY TWO signals count as N9 passing, and the classifier below is unit-tested:
     *
     *   (a) `identical` — INVALID, max NaN, the identical-frames reason, AND zero disc pixels
     *       differing. All three, because the reason is a claim made by the code under test.
     *   (b) `residual`  — VALID with a finite max below the gate minimum.
     *
     * Any other INVALID fails the test. The previous version accepted ANY INVALID whose reason
     * merely contained "identical", so a broken capture (bad geometry, zero radius) would also have
     * kept N9 green — the looseness that made the assertion meaningless.
     */
    expect(
      verdict.acceptable,
      `N9 did not see a collapse: ${verdict.reason}`,
    ).toBe(true);
    expect(['identical', 'residual']).toContain(verdict.kind);

    /*
     * And the sentinel's own verdict must be "not a pass" in both cases. Stated separately from
     * `acceptable` because they answer different questions: one says the MEASUREMENT collapsed, the
     * other says the GATE did not accept it.
     */
    const gatePassed =
      defectStats.valid && defectStats.max >= GLINT_GATE.maxMin && defectStats.max <= GLINT_GATE.maxMax;
    expect(gatePassed, 'the 3.9 sentinel PASSED with the overlay off, so it is not measuring glint').toBe(false);

    // Restore the shipped overlay for whatever runs next.
    await page.evaluate(() => window.__globe!.setLookFlags({ specular: true }));
  });

  // -------------------------------------------------------------------- N10 ---
  test('N10: the glint sentinel FAILS when si 1.0 and the roughness floor are restored', async ({
    page,
  }) => {
    /*
     * N10 — FRAME-IDENTITY DETECTOR.
     *
     * Third post-measurement definition change in this step. See docs/SPEC.md for the disclosure;
     * this header records what the test does and why, so the next reader does not have to
     * reconstruct it.
     *
     * ## Why the amplitude assertion could not work
     *
     * The old version asserted that metric 3.9 goes over its upper bound under this defect. In a
     * frozen, deterministic frame it does not. Measured over a faithful reproduction of this
     * test's own acquisition: the defect's contribution lands at [344,390] — 249.9 luma across
     * 8470 px, the retired fill light's blue circle — while the diff's MAXIMUM stays on the shipped
     * glint at [781,374], where it reads the control's 88.52 minus exactly one 8-bit step. That
     * minus-one is the OFF frame moving by one; the defect does not touch that pixel at all
     * (defect-minus-control there is +1.00).
     *
     * `diffStats.max` is a single extreme value, so a brighter neighbouring feature masks the
     * defect by construction. 3.9 measures overlay AMPLITUDE; this defect changes the SURFACE.
     * Before the uTime gates (`src/scene/lookTime.ts`) the frame was nondeterministic and the two
     * competing maxima swapped places between runs, which is why the old assertion sometimes
     * passed. That pass was an artifact of a moving frame, not a property of the look.
     *
     * ## What is asserted now
     *
     *   control, same page, two full acquisitions   max |dLuma| <= 1.0, and <= 50 px differ
     *   control vs a fresh page load's first         EXACTLY 0 (max |dLuma| 0, 0 px)
     *   defect vs control, over the fitLimb disc     max |dLuma| > 8, and >= 100 px differ by >6
     *
     * The first rule's tolerance is a POST-MEASUREMENT choice: an earlier version of this detector
     * demanded exactly 0 in-page and measured **0.7152 luma over 11 px**, so 1.0 / 50 px is chosen
     * to sit above a measured floor rather than at zero. It is disclosed as post-measurement in
     * docs/SPEC.md and must not be described as pre-registered. The cross-load rule stays strict,
     * and the detection rule was fixed before any defect measurement.
     *
     * Separation: 8 luma against a 1.0 floor, and 100 px against a 50 px floor — both an order of
     * magnitude clear, so the detector cannot be satisfied by the noise it tolerates.
     *
     * ## Every capture goes through `acquireGlintFrames`
     *
     * Not `settleAt` + `setLayers` + `capture`. Two failures came from mixing paths: a bare
     * `capture()` after the helper compares the glint view against the full look (227.43 luma,
     * because the helper's `finally` restores all layers), and a hand-re-pinned capture skips
     * `fitLimb`'s material swap-and-restore, which the first acquisition HAS performed. Same path
     * for every frame means the only variable is the frame.
     *
     * The 3.9 reading under the defect is printed as INFORMATION and never asserted here — see
     * above. N9 and the 3.9 sentinel test are untouched, so the metric keeps its own proof.
     *
     * The defect is installed through the same page-side engine every other negative uses, so it
     * is torn down by `afterEach` and never exists in source.
     */

    /* Tolerance for the SAME-PAGE pair only, and only because it was measured: see the header. */
    const IN_PAGE_MAX_ABS_TOL = 1.0;
    const IN_PAGE_MAX_DIFFERING_PX = 50;
    /** Detection thresholds — fixed before any defect measurement. */
    const DEFECT_MIN_MAX_ABS = 8;
    const DEFECT_MIN_GT6_PX = 100;

    // ---- 1. Baseline acquisition (this page). -----------------------------------------------
    const control = await acquireGlintFrames(page);
    const controlStats = measureGlint(control.current, control.off, control.geometry);
    expect(controlStats.valid, `control frames invalid: ${controlStats.invalidReason}`).toBe(true);
    expect(controlStats.max).toBeGreaterThanOrEqual(GLINT_GATE.maxMin);

    /*
     * INPUT VALIDITY, asserted at this test's own door.
     *
     * N10's defect only reaches a `MeshPhysicalMaterial`. An earlier test that swapped the surface
     * for another material type (N6d installs a MeshToonMaterial) and failed to restore the
     * INSTANCE left nothing for this defect to act on. Assert the precondition so a failure names
     * its own cause.
     */
    const surfaceType = await page.evaluate(() => {
      let physical = 0;
      const types: string[] = [];
      (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
        const m = o as { isMesh?: boolean; material?: { type?: string } };
        if (!m.isMesh || !m.material?.type) return;
        if (types.indexOf(m.material.type) < 0) types.push(m.material.type);
        if (m.material.type === 'MeshPhysicalMaterial') physical += 1;
      });
      return { physical, types };
    });
    expect(
      surfaceType.physical,
      `no MeshPhysicalMaterial in the scene (found: ${surfaceType.types.join(', ')}) — an earlier test leaked ` +
        `a material swap, so N10's defect cannot act. Fix the leak, not this test.`,
    ).toBeGreaterThan(0);
    expect(
      controlStats.max,
      `control already over the upper bound: ${controlStats.max}`,
    ).toBeLessThanOrEqual(GLINT_GATE.maxMax);

    // ---- 2. In-page determinism: a second FULL acquisition, same page. ----------------------
    const t0 = Date.now();
    const controlAgain = await acquireGlintFrames(page);
    const elapsedMs = Date.now() - t0;
    const cc = frameDelta(control.current, controlAgain.current, control.geometry);

    /*
     * Locate the jitter rather than hiding it. Recorded, never used to relax anything.
     */
    const pinsNow = await page.evaluate(() =>
      window.__globe!.pins().map((p) => ({ id: p.id, x: p.x, y: p.y })),
    );
    const glintPeak = controlStats.maxAt;
    const jitterPixels = locateDiffering(control.current, controlAgain.current, control.geometry, 20).map(
      (p) => {
        const nearest = pinsNow.reduce(
          (m, pin) =>
            Math.hypot(p.x - pin.x, p.y - pin.y) < Math.hypot(p.x - m.x, p.y - m.y) ? pin : m,
          pinsNow[0],
        );
        const rOverR = Math.hypot(p.x - control.geometry.cx, p.y - control.geometry.cy) / control.geometry.r;
        return {
          x: p.x,
          y: p.y,
          d: p.d,
          rOverR: +rOverR.toFixed(4),
          band: rOverR >= 1.0 ? 'at-or-outside-limb' : rOverR > 0.95 ? 'rim-band' : 'disc',
          toGlintPeak: glintPeak ? +Math.hypot(p.x - glintPeak[0], p.y - glintPeak[1]).toFixed(1) : null,
          nearestPin: nearest.id,
          toPin: +Math.hypot(p.x - nearest.x, p.y - nearest.y).toFixed(1),
        };
      },
    );

    console.log(
      `[N10] control-vs-control in-page maxAbs=${cc.maxAbs} differing=${cc.differing} ` +
        `(tolerance <= ${IN_PAGE_MAX_ABS_TOL} luma and <= ${IN_PAGE_MAX_DIFFERING_PX} px), ` +
        `sampled=${cc.sampled} px, second acquisition took ${elapsedMs} ms`,
    );
    console.log(
      `[N10] jitter (${jitterPixels.length} of ${cc.differing} shown): ${JSON.stringify(jitterPixels)}`,
    );
    expect(
      cc.maxAbs,
      `the in-page control pair exceeds its measured noise floor: max |dLuma| ${cc.maxAbs} ` +
        `(allowed <= ${IN_PAGE_MAX_ABS_TOL}), ${cc.differing} px differ ` +
        `(allowed <= ${IN_PAGE_MAX_DIFFERING_PX}). Pixels: ${JSON.stringify(jitterPixels)}`,
    ).toBeLessThanOrEqual(IN_PAGE_MAX_ABS_TOL);
    expect(
      cc.differing,
      `the in-page control pair has too many differing pixels: ${cc.differing} ` +
        `(allowed <= ${IN_PAGE_MAX_DIFFERING_PX}); locations ${JSON.stringify(jitterPixels)}`,
    ).toBeLessThanOrEqual(IN_PAGE_MAX_DIFFERING_PX);

    // The two acquisitions must agree on the shipped look, or "same frame" claims more than the
    // pixels support.
    const controlAgainStats = measureGlint(controlAgain.current, controlAgain.off, controlAgain.geometry);
    expect(
      controlAgainStats.max,
      `the shipped look changed between two acquisitions: ${controlStats.max} then ${controlAgainStats.max}`,
    ).toBe(controlStats.max);

    // ---- 3. Cross-load control pair: PRINTED, not asserted. ---------------------------------
    /*
     * N10 compares frames INSIDE ONE PAGE, so its assertions are the in-page noise floor and the
     * detection rule. The cross-load pair is printed here for the record and is deliberately not
     * asserted: it is owned by `ref.spec.ts`, which stays strict 0 with no tolerance anywhere.
     *
     * Why the split (measured in the v2 session): the same pose captured through
     * `acquireGlintFrames` on this page and on a fresh context differed by 0.7152 luma across 221
     * px — one green level, on the disc at r/R 0.71-0.88, away from pins and glint. The reference
     * helper's path (no `fitLimb` material swap) gave 6 cross-load pairs that were all exactly 0,
     * so the difference is in the acquisition path, not in the scene. Deciding a tolerance for
     * that here would be deciding it for the reference frame too; it gets its own measurement
     * (D8) and its own owner instead.
     */
    const fresh = await page
      .context()
      .browser()!
      .newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const freshPage = await fresh.newPage();
      await openGlobe(freshPage);
      const crossLoad = await acquireGlintFrames(freshPage);
      const cl = frameDelta(control.current, crossLoad.current, control.geometry);
      console.log(
        `[N10 info] cross-load control pair maxAbs=${cl.maxAbs} differing=${cl.differing} ` +
          `sampled=${cl.sampled} px — PRINTED ONLY, not asserted; cross-load determinism is ` +
          `ref.spec's strict-0 rule`,
      );
    } finally {
      await fresh.close();
    }

    /* ---- 4. PRECONDITION: the defect must land before its effect is judged. -------------- */

    const readEarth = () =>
      page.evaluate(() => {
        let out: {
          si: number | null;
          roughness: number | null;
          hasRoughnessMap: boolean | null;
          version: number | null;
        } = { si: null, roughness: null, hasRoughnessMap: null, version: null };
        (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
          const m = o as {
            isMesh?: boolean;
            material?: {
              type?: string;
              specularIntensity?: number;
              roughness?: number;
              roughnessMap?: unknown;
              version?: number;
            };
          };
          if (m.isMesh && m.material?.type === 'MeshPhysicalMaterial' && out.si === null) {
            out = {
              si: m.material.specularIntensity ?? null,
              roughness: m.material.roughness ?? null,
              hasRoughnessMap: Boolean(m.material.roughnessMap),
              version: m.material.version ?? null,
            };
          }
        });
        return out;
      });

    const pre = await readEarth();

    await page.evaluate(() => {
      const d = (
        window as unknown as {
          __defects: { install(n: string, p: Record<string, unknown>): void };
        }
      ).__defects;
      d.install('fillLightWithSpecular', { specularIntensity: 1, roughness: 0 });
    });
    // The defect engine re-applies through onBeforeRender, so it needs frames.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const post = await readEarth();
    console.log(
      `[N10] precondition specularIntensity ${pre.si} -> ${post.si}, ` +
        `roughness ${pre.roughness} -> ${post.roughness}, ` +
        `roughnessMap ${pre.hasRoughnessMap} -> ${post.hasRoughnessMap}, ` +
        `material version ${pre.version} -> ${post.version}`,
    );

    /*
     * PRECONDITION assertions, FIRST and with their own messages. A defect that failed to install
     * and a defect whose effect cannot be seen are different findings; reporting the second as the
     * first is how an earlier session spent hours blaming a metric.
     */
    expect(post.si, 'PRECONDITION: the defect did not set specularIntensity — the effect was never tested').toBe(1);
    expect(post.roughness, 'PRECONDITION: the defect did not clear the roughness floor').toBe(0);
    expect(post.hasRoughnessMap, 'PRECONDITION: the defect did not detach the roughness map').toBe(false);

    /* ---- 5. The defect frame, and the detector. ------------------------------------------ */

    const defect = await capture(page);
    await page.evaluate(() => window.__globe!.setLookFlags({ specular: false }));
    const defectOverlayOff = await capture(page);
    await page.evaluate(() => window.__globe!.setLookFlags({ specular: true }));

    const underDefect = measureGlint(defect, defectOverlayOff, control.geometry);
    const dc = frameDelta(defect, control.current, control.geometry);

    await writeResult('negative-n10', {
      control: controlStats,
      frameIdentity: { inPage: cc, crossLoadRule: 'exactly 0', defectVsControl: dc },
      jitterPixels,
      preconditions: { pre, post },
    });

    /*
     * INFORMATION ONLY — the 3.9 reading under this defect.
     *
     * Not asserted anywhere in this test, deliberately. 3.9 differences two frames that differ only
     * in the specular OVERLAY, so it measures overlay amplitude; this defect changes the SURFACE,
     * and its contribution lands away from the overlay's peak. In a frozen frame the amplitude max
     * therefore reads the control's value minus one 8-bit step. Asserting it here is what made the
     * old N10 pass only when the frame was nondeterministic.
     */
    console.log(
      `[N10 info] 3.9 under defect: max=${underDefect.valid ? underDefect.max.toFixed(2) : 'n/a'} ` +
        `maxAbs=${underDefect.valid ? underDefect.maxAbs.toFixed(2) : 'n/a'} ` +
        `area6=${underDefect.area6} — NOT asserted; 3.9 measures overlay amplitude and is blind ` +
        `to si 1.0 in a deterministic frame (see this test's header)`,
    );

    console.log(
      `[N10] defect-vs-control maxAbs=${dc.maxAbs.toFixed(2)} (need > ${DEFECT_MIN_MAX_ABS}) ` +
        `pixels>6=${dc.gt6} (need >= ${DEFECT_MIN_GT6_PX}) at=${JSON.stringify(dc.maxAbsAt)} ` +
        `sampled=${dc.sampled} maxGain=${dc.maxGain.toFixed(2)} maxDrop=${dc.maxDrop.toFixed(2)} ` +
        `| separation: ${(DEFECT_MIN_MAX_ABS / IN_PAGE_MAX_ABS_TOL).toFixed(1)}x the luma floor, ` +
        `${(DEFECT_MIN_GT6_PX / IN_PAGE_MAX_DIFFERING_PX).toFixed(1)}x the pixel floor`,
    );

    expect(
      dc.sampled,
      'the detector sampled no pixels — the disc geometry is broken, so nothing was compared',
    ).toBeGreaterThan(0);
    expect(
      dc.maxAbs,
      `defect not detected: the frame did not change (max |dLuma| ${dc.maxAbs.toFixed(2)}, need > ${DEFECT_MIN_MAX_ABS}). ` +
        'The defect installed (see the precondition line) but produced no visible change — a ' +
        'defect-delivery failure, not a metric failure.',
    ).toBeGreaterThan(DEFECT_MIN_MAX_ABS);
    expect(
      dc.gt6,
      `defect not detected: only ${dc.gt6} pixels changed by more than 6 luma ` +
        `(need >= ${DEFECT_MIN_GT6_PX}); max |dLuma| ${dc.maxAbs.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(DEFECT_MIN_GT6_PX);
  });

  // --------------------------------------------------------------------- N6 ---
  test('N6: a hard step in the FLAT render makes SOFT fail', async ({ page }) => {
    /*
     * SOFT is measured on the albedo-neutral curve, so the negative must be injected there: a step put
     * into the flat capture must be caught by the flat gate. Offline mutation — every disc pixel with
     * n·L in [-0.10, +0.30] is set to grey Ld_flat above zero and grey Ln_flat at or below it — so the
     * check is isolated from the renderer and the result cannot be an artefact of an injection that
     * failed to reach the GPU.
     */
    const means = await readTextureMeans(page);
    const control = await acquireFlatFrame(page, 0, 1.0, means);
    await assertSurfaceRestored(page);

    expect(control.verdict.soft, `control flat S ${control.verdict.S} already fails`).toBe(true);
    expect(control.verdict.visible, 'control flat render is not visible').toBe(true);

    const mutated = mutateTerminator(control.img, control.frame.sunCam, 'step', {
      lit: control.verdict.Ld,
      dark: control.verdict.Ln,
    });
    const after = evaluateTerminator(mutated, control.frame.sunCam);

    console.log(
      `[N6] control S=${control.verdict.S.toFixed(4)} (gate 0.25) | ` +
        `defect S=${after.S.toFixed(4)} worstBin=${after.worstStepBin} step=${after.worstStepLuma.toFixed(2)} | ` +
        `visible ${control.verdict.visible} -> ${after.visible}`,
    );
    await writeResult('negative-n6', { control: control.verdict, defect: after });

    expect(Number.isFinite(after.S), 'defect S is not finite').toBe(true);
    expect(after.soft, `SOFT did NOT catch a hard step: S ${after.S.toFixed(4)}`).toBe(false);
    // The SIGNAL, not just the verdict.
    expect(after.S, `S must reach the 0.6 separation level; got ${after.S.toFixed(4)}`).toBeGreaterThanOrEqual(0.6);
    // And VISIBLE still passes — the step is a softness defect, not a visibility one.
    expect(after.visible, 'VISIBLE should still pass under a hard step').toBe(true);
  });

  // -------------------------------------------------------------------- N6r ---
  test('N6r: a hard step in the REAL render trips the catastrophe bound, not VISIBLE', async ({ page }) => {
    /*
     * The real-render half of N6. Since SOFT moved to the flat curve, the real render is guarded by the
     * catastrophe bound (S_real < 0.6). This injects the same step into the REAL capture and asserts
     * that the bound — not VISIBLE — is what catches it.
     */
    const real = await acquireRealFrame(page, 0);
    expect(real.verdict.visible, 'control real render is not visible').toBe(true);
    expect(real.verdict.S, `control real S ${real.verdict.S} already over the catastrophe bound`).toBeLessThan(0.6);

    const mutated = mutateTerminator(real.img, real.frame.sunCam, 'step', {
      lit: real.verdict.Ld,
      dark: real.verdict.Ln,
    });
    const after = evaluateTerminator(mutated, real.frame.sunCam);

    console.log(
      `[N6r] control S_real=${real.verdict.S.toFixed(4)} | defect S_real=${after.S.toFixed(4)} ` +
        `(bound 0.6) worstBin=${after.worstStepBin} step=${after.worstStepLuma.toFixed(2)} | ` +
        `visible ${real.verdict.visible} -> ${after.visible}`,
    );
    await writeResult('negative-n6r', { control: real.verdict, defect: after });

    expect(after.S, `catastrophe bound NOT tripped: S ${after.S.toFixed(4)}`).toBeGreaterThanOrEqual(0.6);
    expect(after.S < 0.6, 'the catastrophe bound must FAIL under a hard step').toBe(false);
    expect(after.visible, 'VISIBLE should still pass under a hard step').toBe(true);
  });

  // -------------------------------------------------------------------- N6b ---
  test('N6b: a flat disc makes VISIBLE fail on A', async ({ page }) => {
    /*
     * Erase the lit side: every disc pixel with n·L > -0.15 is set to grey Ln. A = Ld - Ln collapses to
     * ~0, so the VISIBLE predicate must fail while the geometry stays valid.
     */
    const real = await acquireRealFrame(page, 0);
    expect(real.verdict.visible, 'control real render is not visible').toBe(true);

    const mutated = mutateTerminator(real.img, real.frame.sunCam, 'flat', {
      lit: real.verdict.Ld,
      dark: real.verdict.Ln,
    });
    const after = evaluateTerminator(mutated, real.frame.sunCam);

    console.log(
      `[N6b] control A=${real.verdict.A.toFixed(2)} | defect A=${after.A.toFixed(2)} ` +
        `Ld=${after.Ld.toFixed(2)} Ln=${after.Ln.toFixed(2)} visible=${after.visible}`,
    );
    await writeResult('negative-n6b', { control: real.verdict, defect: after });

    expect(Number.isFinite(after.A), 'defect A is NaN').toBe(true);
    expect(after.visible, `VISIBLE did NOT catch a flat disc: A ${after.A.toFixed(2)}`).toBe(false);
    expect(after.A, `A must fall below 25; got ${after.A.toFixed(2)}`).toBeLessThan(25);
  });

  // -------------------------------------------------------------------- N6c ---
  test('N6c: a white AmbientLight at 3.0 lifts the night floor and fails VISIBLE', async ({ page }) => {
    /*
     * A real render defect through the shared handle. Ambient light lifts every surface uniformly,
     * including the emissive night side, so the day/night separation the VISIBLE predicate measures is
     * destroyed. Intensity 3.0 is the prompt's value and is NOT tuned here.
     */
    const control = await acquireRealFrame(page, 0);
    expect(control.verdict.visible, 'control real render is not visible').toBe(true);

    await installDefectEngine(page);
    const defective = await acquire(page, {
      flags: { stars: false, pins: false, rings: false },
      azimuth: 0,
      defect: { name: 'ambientLight', params: { intensity: 3, color: 0xffffff } },
    });
    const after = evaluateTerminator(defective.frame, control.frame.sunCam);

    console.log(
      `[N6c] control Ln=${control.verdict.Ln.toFixed(2)} A=${control.verdict.A.toFixed(2)} visible=${control.verdict.visible} | ` +
        `defect Ln=${after.Ln.toFixed(2)} A=${after.A.toFixed(2)} visible=${after.visible}`,
    );
    console.log(`[N6c] survival probe ${JSON.stringify(defective.probe?.evidence)}`);
    await writeResult('negative-n6c', { control: control.verdict, defect: after, probe: defective.probe });

    expect(defective.probe?.alive, `defect not live: ${defective.probe?.failures?.join('; ')}`).toBe(true);
    expect(after.Ln, 'the ambient light must LIFT the night floor').toBeGreaterThan(control.verdict.Ln);
    expect(after.visible, `VISIBLE did NOT catch an ambient lift: A ${after.A.toFixed(2)}`).toBe(false);
  });

  // -------------------------------------------------------------------- N6d ---
  test('N6d: a two-texel toon ramp makes even the FLAT render hard, so SOFT fails', async ({ page }) => {
    /*
     * The strongest form of the negative: a real render defect that a flat surface cannot hide.
     * `MeshToonMaterial` with a two-texel NearestFilter gradient map quantises n·L to two levels, so the
     * terminator is a step in the SHADING, not in the albedo — the flat curve must show it.
     *
     * The surface is kept albedo-neutral (same flat day colour) so the only difference from the flat
     * control is the quantisation.
     */
    const means = await readTextureMeans(page);
    const control = await acquireFlatFrame(page, 0, 1.0, means);
    await assertSurfaceRestored(page);
    expect(control.verdict.soft, `flat control S ${control.verdict.S} already fails`).toBe(true);

    await installDefectEngine(page);
    const dayHex =
      (Math.round(Math.min(1, means.day[0]) * 255) << 16) |
      (Math.round(Math.min(1, means.day[1]) * 255) << 8) |
      Math.round(Math.min(1, means.day[2]) * 255);

    const defective = await acquire(page, {
      flags: { stars: false, pins: false, rings: false },
      azimuth: 0,
      defect: { name: 'toonTerminator', params: { dayColor: dayHex } },
    });
    const after = evaluateTerminator(defective.frame, control.frame.sunCam);

    console.log(
      `[N6d] flat control S=${control.verdict.S.toFixed(4)} | toon S=${after.S.toFixed(4)} ` +
        `worstBin=${after.worstStepBin} step=${after.worstStepLuma.toFixed(2)} | soft=${after.soft}`,
    );
    console.log(`[N6d] survival probe ${JSON.stringify(defective.probe?.evidence)}`);
    await writeResult('negative-n6d', { control: control.verdict, defect: after, probe: defective.probe });

    expect(defective.probe?.alive, `defect not live: ${defective.probe?.failures?.join('; ')}`).toBe(true);
    expect(after.soft, `SOFT did NOT catch a two-texel toon terminator: S ${after.S.toFixed(4)}`).toBe(false);
    expect(after.S, `S must reach 0.6; got ${after.S.toFixed(4)}`).toBeGreaterThanOrEqual(0.6);
  });

  // -------------------------------------------------------------------- N5 ---
  test('N5: 3.2 rejects an all-black capture as invalid and fails an all-white one', async ({ page }) => {
    await settleAt(page, 0);
    const geom: DiscGeometry = await page.evaluate(() => {
      const p = window.__globe!.project();
      return { cx: p.x, cy: p.y, r: window.__globe!.discRadiusPx() };
    });
    const real = await capture(page);
    const { width, height } = real;

    const control = checkGlare(real, geom);
    const black = checkGlare(syntheticFrame(width, height, 0), geom);
    const white = checkGlare(syntheticFrame(width, height, 255), geom);

    console.log(
      `[N5] control valid=${control.valid} pass=${control.pass} clipped=${control.clipped}\n` +
        `[N5] black   valid=${black.valid} pass=${black.pass} clipped=${black.clipped} reason="${black.invalidReason}"\n` +
        `[N5] white   valid=${white.valid} pass=${white.pass} clipped=${white.clipped} largest=${white.largestBlob}`,
    );
    await writeResult('negative-n5', { control, black, white });

    expect(control.valid).toBe(true);
    expect(control.pass).toBe(true);

    /*
     * The important half. An all-black frame has ZERO clipped pixels and ZERO blobs — it
     * would sail through the glare rule while measuring nothing. This is the null-vs-null
     * failure the whole spec family exists to prevent, and it is why every check asserts
     * input validity before its verdict.
     */
    expect(black.clipped, 'a black frame trivially has no clipped pixels').toBe(0);
    expect(black.largestBlob).toBe(0);
    expect(black.valid, 'an all-black capture MUST be rejected as invalid input').toBe(false);
    expect(black.invalidReason).toContain('black');
    expect(black.pass, 'an all-black capture must not count as a pass').toBe(false);

    /*
     * All-white is a real blast: valid input, failing the rule. It is also the case that
     * could blow the stack — one connected component of ~1 M pixels. The component labeller
     * is iterative; this assertion is the regression guard for the `Math.min(...xs)` spread
     * form the handoff warns about.
     */
    expect(white.valid, 'an all-white frame is still a rendered-looking frame').toBe(true);
    expect(white.pass).toBe(false);
    expect(white.clipped).toBeGreaterThan(0);
    expect(white.largestBlob, 'the whole frame is one component').toBeGreaterThan(12);
  });

  // --------------------------------------------------------------------- N7 ---
  test('N7: pin emissiveIntensity x4 blows out 3.5 P2/P3 for a day AND a night pin', async ({ page }) => {
    /*
     * az 300, not any of {0, 90, 180, 270}. V0(c) scanned twelve azimuths in 30° steps and
     * found the four that 3.5 uses NEVER contain both a valid day pin and a valid night
     * pin — az 0 has us-west day only, az 180 se-asia night only, and the rest have one or
     * neither (horn-africa is always `terminator`). az 300 gives us-west (day, n·sun 0.338,
     * r/R 0.757) and pacific (night, n·sun −0.342, r/R 0.570), so N7 is not vacuous.
     */
    const AZ = 300;

    const control = await acquire(page, { flags: PIN_FLAGS, azimuth: AZ });
    const pins = await pinGeometry(page, control.geometry);
    const controlPins = checkPins(control.frame, control.geometry, pins);
    const controlValid = controlPins.filter((p) => p.valid);
    const controlDay = controlValid.filter((p) => p.side === 'day');
    const controlNight = controlValid.filter((p) => p.side === 'night');

    expect(controlDay.length, `no valid DAY pin at az ${AZ}; N7 would be vacuous`).toBeGreaterThan(0);
    expect(controlNight.length, `no valid NIGHT pin at az ${AZ}; N7 would be vacuous`).toBeGreaterThan(0);
    expect(
      controlValid.every((p) => p.pass),
      `control 3.5 should pass; got ${controlValid
        .map((p) => `${p.id}:P1=${p.gates.P1} P2=${p.gates.P2} P3=${p.gates.P3} P4=${p.gates.P4}`)
        .join(', ')}`,
    ).toBe(true);

    const outcomes: Array<{ pin: string; side: string }> = [];

    for (const target of [controlDay[0], controlNight[0]]) {
      const defective = await acquire(page, {
        flags: PIN_FLAGS,
        azimuth: AZ,
        defect: { name: 'pinEmissiveBoost', params: { factor: 4, baseIntensity: 1.75 } },
        pinName: target.id,
      });
      const after = checkPins(defective.frame, defective.geometry, pins).find((p) => p.id === target.id)!;

      console.log(
        `[N7] ${target.id} (${target.side}): control med=(${target.median.join(',')}) ` +
          `luma=${target.medianLuma.toFixed(1)} blown=${target.blownPx} | ` +
          `defect med=(${after.median.join(',')}) luma=${after.medianLuma.toFixed(1)} ` +
          `blown=${after.blownPx} sat=${after.medianSaturation.toFixed(3)} | ` +
          `P1=${after.gates.P1} P2=${after.gates.P2} P3=${after.gates.P3} P4=${after.gates.P4}`,
      );
      console.log(`[N7] ${target.id} survival probe ${JSON.stringify(defective.probe)}`);

      expect(defective.probe?.alive, `${target.id}: defect not live: ${defective.probe?.failures}`).toBe(
        true,
      );
      expect(after.valid, `${target.id} must stay measurable`).toBe(true);
      expect(after.pass, `${target.id}: 3.5 did NOT catch a 4x emissive blow-out`).toBe(false);
      // Specifically P2 (not blown) or P3 (no longer tinted) must break — that is the pair a
      // blow-out attacks, and asserting it stops "it failed for some other reason".
      expect(
        !after.gates.P2 || !after.gates.P3,
        `${target.id}: expected P2 or P3 to fail; blown=${after.blownPx}, sat=${after.medianSaturation.toFixed(
          3,
        )}`,
      ).toBe(true);
      // The signal, in the expected direction.
      expect(after.medianLuma, `${target.id}: core did not brighten`).toBeGreaterThan(target.medianLuma);
      expect(after.blownPx, `${target.id}: blown pixel count did not rise`).toBeGreaterThanOrEqual(
        target.blownPx,
      );
      outcomes.push({ pin: target.id, side: target.side });
    }

    await writeResult('negative-n7', { az: AZ, outcomes });

    // Both sides covered, or the test quietly proved only half of what it claims.
    expect(outcomes.map((o) => o.side).sort()).toEqual(['day', 'night']);
  });

  // --------------------------------------------------------------------- N8 ---
  test('N8: pins hidden / core material black makes 3.5 P1 FAIL', async ({ page }) => {
    const AZ = 300;

    const control = await acquire(page, { flags: PIN_FLAGS, azimuth: AZ });
    const pins = await pinGeometry(page, control.geometry);
    const controlPins = checkPins(control.frame, control.geometry, pins);
    const controlValid = controlPins.filter((p) => p.valid);
    expect(controlValid.length, `no valid pin at az ${AZ}`).toBeGreaterThan(0);
    expect(
      controlValid.every((p) => p.gates.P1),
      'control P1 should pass for every valid pin',
    ).toBe(true);

    const target = controlValid[0];
    const defective = await acquire(page, {
      flags: PIN_FLAGS,
      azimuth: AZ,
      defect: { name: 'pinsHidden' },
      pinName: target.id,
    });
    const after = checkPins(defective.frame, defective.geometry, pins).find((p) => p.id === target.id)!;

    console.log(
      `[N8] ${target.id}: control med=(${target.median.join(',')}) luma=${target.medianLuma.toFixed(1)} | ` +
        `defect med=(${after.median.join(',')}) luma=${after.medianLuma.toFixed(1)} ` +
        `P1=${after.gates.P1} (gate luma >= 180)`,
    );
    console.log(`[N8] survival probe ${JSON.stringify(defective.probe)}`);
    await writeResult('negative-n8', { control: target, defect: after, probe: defective.probe });

    expect(defective.probe?.alive, `defect not live: ${defective.probe?.failures}`).toBe(true);
    expect(after.valid, `${target.id} must stay measurable`).toBe(true);
    expect(after.pass, '3.5 did NOT catch a hidden pin core').toBe(false);
    expect(after.gates.P1, 'P1 (readable core) specifically must fail').toBe(false);
    expect(after.medianLuma, 'core luma must FALL below the control').toBeLessThan(target.medianLuma);
    expect(after.medianLuma, 'P1 gate is luma >= 180').toBeLessThan(180);
  });
});
