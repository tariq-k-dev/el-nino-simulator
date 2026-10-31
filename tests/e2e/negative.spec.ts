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
import { measureBlueCircle, writeResult } from './look/measure';
import { openGlobe, capture, setLayers, settleAt, cameraGeometry } from './look/capture';
import { acquire, installDefectEngine, type LayerFlags } from './look/acquire';
import { checkGlare, checkPins, checkRim, checkRingCast } from './look/analysis';
import { requireValidPins } from './look/pinValidity';
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
  /*
   * N4 IS `test.fixme` ON PURPOSE, AND THIS IS THE ONE THING IN C2A NOT MET.
   *
   * The defect is real, correctly placed and provably live: lights 4, intensity 0.32,
   * position exactly (-5.2, -2.2, -4.6), parented to the scene root, survival probe clean.
   * What it does NOT do is move W1. Measured on the stamped bundle:
   *
   *   disc pixels                                 333,185
   *   pixels moved by more than 2/255                     3
   *   mean signed luma delta inside the disc          +0.069
   *   max signed luma delta anywhere in the disc       +2.51   (at r/R 0.977, -168deg)
   *   W1 raw RGB, before -> after          (0,4,28) -> (0,4,31)
   *   W1 sigma-3 blurred peak, before -> after     4.95 -> 6.02
   *   W1 ratio, control -> defect             0.976 -> 0.982   (gate 1.15)
   *
   * So the fill light raises the blue channel by 3/255 over a nearly-black night ocean
   * (W1 luma ~5/255). Three pixels move in the whole disc. 3.3's ratio gate cannot see a
   * 3/255 lift at that signal level, and no amount of injection would change that: the
   * defect's reach is a property of `intensity: 0.32` against a sun of intensity 3.6.
   *
   * WHY THIS IS NOT FIXED HERE, AND WHAT THE OPTIONS ARE — this is a design decision for
   * Tariq, and every option edits either the gate or the brief:
   *
   *   (a) raise the defect intensity (e.g. 3.2, the old 10x). Rejected for this run: the
   *       prompt names 0.32 explicitly, and quietly changing the defect to make a test pass
   *       is the same class of error as tuning a threshold to a render.
   *   (b) move W1 to where the light actually lands (r/R 0.977, -168deg). That EDITS the
   *       3.3 gate to fit the defect — explicitly forbidden.
   *   (c) change 3.3's metric to a per-channel blue difference rather than a blurred-luma
   *       ratio, so a 3/255 blue lift at a dark window is detectable. This is the honest
   *       fix and it changes a committed threshold's definition, so it needs sign-off.
   *
   * Kept as `test.fixme` with the numbers above rather than deleted or weakened: it is the
   * evidence that 3.3's ratio gate is blind at low signal, and the next reader should not
   * have to rediscover it. Tracked in docs/globe-look/D1-DIAGNOSIS.md.
   */
  test.fixme( // allow-skip: 3.3's ratio gate cannot see a 3/255 blue lift at W1's luma -- measurements in the comment above, options need sign-off
    'N4: a blue DirectionalLight at (-5.2,-2.2,-4.6) makes 3.3 FAIL in W1',
    async ({ page }) => {
    /*
     * 3.3 needs the specular mask to decide W1 is not excused, and that mask is a second
     * capture taken with a different material state — so this one keeps the committed
     * `measureBlueCircle`, which owns that pair. The defect is installed by the same
     * page-side engine, and the survival probe is the engine's own.
     */
    const control = await measureBlueCircle(page);
    const w1Control = control.result.windows.find((w) => w.id === 'W1');
    expect(w1Control, 'W1 is missing from the control').toBeDefined();
    expect(w1Control!.valid, `W1 control invalid: ${w1Control!.validityReason}`).toBe(true);
    expect(w1Control!.excluded, 'W1 must not be excused in the control').toBe(false);
    expect(w1Control!.ratio, `control W1 ratio ${w1Control!.ratio} already fails`).toBeLessThanOrEqual(
      1.15,
    );

    // The exact fill light that drew the blue circle at (344,392).
    const probe = await page.evaluate(() => {
      const d = (
        window as unknown as {
          __defects: {
            install(n: string, p: Record<string, unknown>): void;
            probe(n: string, p: Record<string, unknown>): {
              evidence: Record<string, unknown>;
              failures: string[];
              frameBefore: number;
              frameAtCapture: number;
            };
          };
        }
      ).__defects;
      d.install('fillLight', { color: 0x2f6fb8, intensity: 0.32 });
      return d.probe('fillLight', { intensity: 0.32 });
    });

    const defective = await measureBlueCircle(page);
    const w1Defect = defective.result.windows.find((w) => w.id === 'W1')!;

    console.log(
      `[N4] W1: control ratio=${w1Control!.ratio} peak=${w1Control!.peak} med=${w1Control!.annulusMedian} | ` +
        `defect ratio=${w1Defect.ratio} peak=${w1Defect.peak} med=${w1Defect.annulusMedian} ` +
        `excluded=${w1Defect.excluded} (max 1.15)`,
    );
    console.log(`[N4] survival probe ${JSON.stringify(probe)}`);
    await writeResult('negative-n4', { control: w1Control, defect: w1Defect, probe });

    expect(probe.failures, `defect not live: ${probe.failures.join('; ')}`).toHaveLength(0);
    expect(w1Defect.valid, 'W1 must stay valid for the defect to count').toBe(true);
    expect(
      w1Defect.pass,
      `3.3 did NOT catch the fill light: W1 ratio ${w1Defect.ratio} within 1.15` +
        (w1Defect.excluded ? ' (and it was excused by the specular mask)' : ''),
    ).toBe(false);
    expect(
      w1Defect.ratio,
      `W1 ratio must RISE past 1.15 under the fill light; got ${w1Defect.ratio} vs control ${w1Control!.ratio}. ` +
        `At intensity 0.32 this defect moves 3 pixels in the whole disc and lifts W1's blue by 3/255 — see the fixme note.`,
    ).toBeGreaterThan(1.15);
    expect(w1Defect.ratio).toBeGreaterThan(w1Control!.ratio);
    },
  );
  // --------------------------------------------------------------------- N5 ---
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
