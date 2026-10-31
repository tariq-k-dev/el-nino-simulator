import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FRAME_PADDING_PX,
  computeFrame,
  type Frame,
  type FrameInput,
} from './frame';

/*
 * These tests are the arithmetic, not a snapshot of it.
 *
 * The last one is the important one: it builds a real `PerspectiveCamera`, installs the view
 * offset `computeFrame` returns, and checks where the globe's centre and its silhouette actually
 * PROJECT — the only way to know the sign convention is right rather than plausible. A sign error
 * fails it by twice the offset (44 px at 1280x800), not by a rounding error.
 */

/** The shipped distance, as measured from `CameraRig.tsx:17` — not retyped from the prompt. */
const D0 = Math.hypot(0, 1.15, 3.15);

/** The pin core envelope: `anchorRadius * idleLift + coreOffset` (`docs/STEP3-AUDIT.md` §5). */
const RE = 1.012 * 1.035 + 0.055;

/** `<OrbitControls maxDistance>` (`src/scene/GlobeScene.tsx:678`). */
const D_MAX = 5;

/** `<Canvas camera={{ fov: 42 }}>` (`src/scene/GlobeScene.tsx:220`). */
const FOV = 42;

/** Insets measured live at the four spec viewports (all of them the same in this layout). */
const LIVE_INSETS = { left: 360.844, right: 316, top: 118.3, bottom: 0 };

const NO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };

function frameFor(
  w: number,
  h: number,
  insets: { left: number; right: number; top: number; bottom: number },
  overrides: Partial<FrameInput> = {},
): Frame {
  return computeFrame({
    viewport: { w, h },
    insets,
    fovDeg: FOV,
    d0: D0,
    dMax: D_MAX,
    re: RE,
    ...overrides,
  });
}

describe('computeFrame — offset', () => {
  it('a centred free rectangle gives exactly zero offset', () => {
    const f = frameFor(1280, 800, NO_INSETS);
    expect(f.dx).toBe(0);
    expect(f.dy).toBe(0);
    // free = the viewport minus padding on all four sides, so its centre IS the viewport centre.
    expect(f.free.x).toBe(FRAME_PADDING_PX);
    expect(f.free.y).toBe(FRAME_PADDING_PX);
    expect(f.free.x + f.free.w / 2).toBeCloseTo(640, 9);
    expect(f.free.y + f.free.h / 2).toBeCloseTo(400, 9);
  });

  it('reproduces the Step 3A free centre at 1440x900 by hand arithmetic', () => {
    /*
     * Hand arithmetic, from the measured insets:
     *
     *   freeW = 1440 - 360.844 - 316 - 48 = 715.156 ... no: padding is applied once per side
     *   freeW = 1440 - 360.844 - 316 - 2*24 = 715.156
     *   freeH =  900 - 118.25  -   0 - 2*24 = 733.750
     *   cx    = 360.844 + 715.156/2 + 24   = 742.422
     *   cy    = 118.25  + 733.750/2 + 24   = 509.125
     *
     * which is the figure step C of 3A shipped (`docs/STEP3-STATUS.md`), so the two halves of the
     * work agree on where the free rectangle is rather than merely both being self-consistent.
     */
    const f = frameFor(1440, 900, { left: 360.844, right: 316, top: 118.25, bottom: 0 });
    expect(f.free.w).toBeCloseTo(715.156, 6);
    expect(f.free.h).toBeCloseTo(733.75, 6);
    expect(f.free.x + f.free.w / 2).toBeCloseTo(742.422, 6);
    expect(f.free.y + f.free.h / 2).toBeCloseTo(509.125, 6);
    // dx/dy are measured from the VIEWPORT centre, which is the whole point of the sign.
    expect(f.dx).toBeCloseTo(742.422 - 720, 6);
    expect(f.dy).toBeCloseTo(509.125 - 450, 6);
  });

  it('a left-only inset moves the centre right by exactly half of it', () => {
    // One-sided insets are the cleanest check that this is a centre calculation and not a shift.
    const f = frameFor(1000, 800, { left: 200, right: 0, top: 0, bottom: 0 });
    // freeW = 1000 - 200 - 48 = 752; centre = 200 + 376 + 24 = 600 = viewport centre + 100.
    expect(f.dx).toBeCloseTo(100, 9);
    expect(f.dy).toBeCloseTo(0, 9);
  });

  it('insets on opposite sides cancel', () => {
    const f = frameFor(1000, 800, { left: 150, right: 150, top: 80, bottom: 80 });
    expect(f.dx).toBeCloseTo(0, 9);
    expect(f.dy).toBeCloseTo(0, 9);
  });
});

describe('computeFrame — fit distance', () => {
  it('never goes below the shipped distance, and equals it when there is room', () => {
    const f = frameFor(1440, 900, NO_INSETS);
    expect(f.dTarget).toBe(D0);
    expect(f.dContain).toBeLessThan(D0);
    expect(f.dTarget).toBeGreaterThanOrEqual(D0);
  });

  it('zooms out for a small free rectangle, by the tangent-length formula', () => {
    const f = frameFor(1024, 768, LIVE_INSETS);
    const focal = 768 / 2 / Math.tan((FOV * Math.PI) / 180 / 2);
    const rMax = 0.5 * Math.min(1024 - 360.844 - 316 - 48, 768 - 118.3 - 0 - 48);
    expect(f.rMax).toBeCloseTo(rMax, 9);
    expect(f.dContain).toBeCloseTo(Math.sqrt(RE * RE + ((focal * RE) / rMax) ** 2), 9);
    expect(f.dTarget).toBeGreaterThan(D0);
  });

  it('clamps to dMax, and says so by leaving dTarget below dContain', () => {
    /*
     * The clamp is not hypothetical: at 1024x768 the layout wants 7.455 and the controls cap at 5.
     * The honest result is dTarget = 5 with dContain = 7.455, i.e. a disc 76.55 px LARGER than
     * rMax. Anything that hid this (e.g. reporting dContain as the target) would put the camera
     * outside the range the user is then allowed to zoom in from.
     */
    const f = frameFor(1024, 768, LIVE_INSETS);
    expect(f.dContain).toBeGreaterThan(D_MAX);
    expect(f.dTarget).toBe(D_MAX);
  });

  it('is monotonic: shrinking the free rectangle never reduces the required distance', () => {
    /*
     * `left` ASCENDING is the free rectangle SHRINKING (freeW = 1600 - left - 48), so `dContain`
     * must be non-decreasing down the list. Written the other way round this test passes for the
     * wrong reason — the first version of it did exactly that and failed on the descending list,
     * which is why the direction is spelled out here.
     */
    const lefts = [200, 400, 700, 900, 1100, 1300, 1400];
    let previous = 0;
    for (const left of lefts) {
      const f = frameFor(1600, 900, { left, right: 0, top: 0, bottom: 0 });
      expect(f.dContain, `left=${left} rMax=${f.rMax}`).toBeGreaterThanOrEqual(previous);
      previous = f.dContain;
    }
    // …and it does actually change over that range, so the loop is not vacuous.
    expect(previous).toBeGreaterThan(D0);
  });
});

describe('computeFrame — degenerate', () => {
  it('flags an empty free rectangle and returns a no-op', () => {
    const f = frameFor(400, 300, { left: 300, right: 300, top: 0, bottom: 0 });
    expect(f.free.w).toBe(0);
    expect(f.degenerate).toBe(true);
    // The centre collapses to the inset boundary, which is 100 px right of the viewport centre.
    expect(f.dx).toBeCloseTo(300 - 200, 9);
    expect(f.dTarget).toBe(D0);
    expect(f.rMax).toBe(0);
  });

  it('flags a free rectangle smaller than the padding', () => {
    // 800 wide with 380+380 of insets leaves 40 px, less than the 48 px of padding.
    const f = frameFor(800, 800, { left: 380, right: 380, top: 0, bottom: 0 });
    expect(f.degenerate).toBe(true);
    expect(f.dTarget).toBe(D0);
  });

  it('does not flag a merely tight rectangle', () => {
    const f = frameFor(1024, 768, LIVE_INSETS);
    expect(f.degenerate).toBe(false);
  });
});

/**
 * Project a world point to CSS pixels.
 *
 * The same arithmetic `__globe.project()` does (`src/lib/globeProbe.ts:141-153`), written out
 * here so the oracle does not depend on the module under test for its own verdict.
 */
function projectToPx(camera: THREE.PerspectiveCamera, p: THREE.Vector3, w: number, h: number) {
  const v = p.clone().project(camera);
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
}

/**
 * NUMERIC ORACLE — does the computed frame actually put the globe where it says?
 *
 * Builds the camera the app builds (same fov, same aspect), applies the view offset the frame
 * asks for, parks it at `dTarget` looking at the origin, and then projects:
 *
 *  - the globe centre, which must land on the free-rect centre, and
 *  - the two silhouette tangent points of a sphere of radius `RE`, which must sit exactly `rMax`
 *    from that centre.
 *
 * The tangent points are derived, not fudged. With the sphere centred at the origin and the eye at
 * `(0, 0, d)`, a tangent point `P` satisfies `|P| = RE` and `P · (P - C) = 0` (the radius is
 * perpendicular to the tangent). The second gives `P_z = RE^2 / d`; substituting back,
 * `P_x = P_y = RE * sqrt(1 - (RE/d)^2)`. The two points projected here are the extremes of that
 * circle in the x and y directions — i.e. exactly the left/right and top/bottom of the silhouette.
 *
 * Also the sign test: `setViewOffset(W, H, -dx, -dy, W, H)`. If that were `+dx` the centre would
 * land 2dx away and every case below would fail by tens of pixels.
 */
describe('computeFrame — numeric oracle (real camera, real projection)', () => {
  const cases: Array<{ w: number; h: number; insets: typeof LIVE_INSETS }> = [
    { w: 1280, h: 800, insets: LIVE_INSETS },
    { w: 1024, h: 768, insets: LIVE_INSETS },
    { w: 1440, h: 900, insets: { ...LIVE_INSETS, top: 118.25 } },
    { w: 1280, h: 720, insets: LIVE_INSETS },
    // No insets at all: the offset is zero and this reduces to the plain projection.
    { w: 1280, h: 800, insets: NO_INSETS },
    // One-sided, to exercise a non-zero offset that is not symmetric.
    { w: 1200, h: 700, insets: { left: 260, right: 0, top: 60, bottom: 0 } },
  ];

  for (const { w, h, insets } of cases) {
    it(`${w}x${h}: centre lands on the free centre and the silhouette radius is rMax`, () => {
      const frame = frameFor(w, h, insets);

      const camera = new THREE.PerspectiveCamera(FOV, w / h, 0.1, 400);
      camera.position.set(0, 0, frame.dTarget);
      camera.lookAt(0, 0, 0);
      // THE SIGN CONVENTION UNDER TEST.
      camera.setViewOffset(w, h, -frame.dx, -frame.dy, w, h);
      camera.updateMatrixWorld(true);

      const centrePx = projectToPx(camera, new THREE.Vector3(0, 0, 0), w, h);
      /*
       * THE PROJECTED CENTRE MUST LAND ON THE FREE CENTRE. No insets are involved in this
       * assertion: the free rect is centred inside the insets, so "the free centre" and "the inset
       * rectangle's centre" are the same pixel, and that is what the offset targets.
       */
      const freeCx = frame.free.x + frame.free.w / 2;
      const freeCy = frame.free.y + frame.free.h / 2;

      expect(centrePx.x).toBeCloseTo(freeCx, 2); // 0.01 px
      expect(centrePx.y).toBeCloseTo(freeCy, 2);

      // Tangent points: the rim of the silhouette, derived above.
      const d = frame.dTarget;
      const tz = (RE * RE) / d;
      const txy = RE * Math.sqrt(1 - (RE / d) ** 2);
      const right = projectToPx(camera, new THREE.Vector3(txy, 0, tz), w, h);
      const up = projectToPx(camera, new THREE.Vector3(0, txy, tz), w, h);

      const radiusX = Math.hypot(right.x - centrePx.x, right.y - centrePx.y);
      const radiusY = Math.hypot(up.x - centrePx.x, up.y - centrePx.y);

      /*
       * The projected silhouette must equal what the fit's OWN formula predicts at `dTarget`:
       *
       *     r = f * re / sqrt(d^2 - re^2)
       *
       * This is the assertion that ties the arithmetic to the pipeline. It fails by tens of pixels
       * if the offset is applied with the wrong sign (the centre moves), if the focal length is
       * derived from the free height instead of the viewport height, or if `setViewOffset` is
       * given a `width`/`height` other than the full viewport.
       *
       * 0.05 px: the tangent points come from the sphere's exact geometry while the formula is a
       * trig identity, so they agree to thousandths of a pixel. Measured across these cases the
       * worst disagreement is ~0.02 px.
       */
      const focalOracle = h / 2 / Math.tan((FOV * Math.PI) / 180 / 2);
      const expectedRadius =
        (focalOracle * RE) / Math.sqrt(frame.dTarget ** 2 - RE ** 2);
      expect(radiusX).toBeCloseTo(expectedRadius, 1);
      expect(radiusY).toBeCloseTo(expectedRadius, 1);
      expect(Math.abs(radiusX - radiusY)).toBeLessThan(0.05);

      /*
       * …and then HOW that radius compares to rMax, which is the part that is easy to get wrong by
       * assuming. Three regimes, and every one of them occurs at the spec viewports:
       *
       *   dTarget == dMax, dContain > dMax   -> the CLAIM is violated, the disc is too big
       *   dTarget  > d0, i.e. the fit binds -> the silhouette is rMax to within rounding
       *   dTarget == d0, the zoom-out floor -> the disc is SMALLER than rMax; this step may only
       *                                        zoom out, so a roomy viewport keeps the shipped
       *                                        framing rather than growing the globe to fill it
       */
      const clampedByMax = frame.dContain > D_MAX && frame.dTarget === D_MAX;
      if (clampedByMax) {
        expect(radiusX).toBeGreaterThan(frame.rMax);
      } else if (frame.dTarget > D0 + 1e-9) {
        expect(radiusX).toBeCloseTo(frame.rMax, 1);
      } else {
        expect(radiusX).toBeLessThanOrEqual(frame.rMax + 0.05);
      }
    });
  }

  it('the offset is what moves the centre: without it the centre would be off by 2·dx', () => {
    /*
     * A demonstration rather than a second implementation: the same camera with no view offset
     * puts the globe at the viewport centre. This is what makes the first assertion above
     * meaningful — it shows the offset is doing the work, not a coincidence of a symmetric case.
     */
    const w = 1280;
    const h = 800;
    const frame = frameFor(w, h, LIVE_INSETS);
    expect(Math.abs(frame.dx)).toBeGreaterThan(20);

    const plain = new THREE.PerspectiveCamera(FOV, w / h, 0.1, 400);
    plain.position.set(0, 0, frame.dTarget);
    plain.lookAt(0, 0, 0);
    plain.updateMatrixWorld(true);
    const noOffset = projectToPx(plain, new THREE.Vector3(0, 0, 0), w, h);
    expect(noOffset.x).toBeCloseTo(w / 2, 2);
    expect(noOffset.y).toBeCloseTo(h / 2, 2);
  });

  it('the measured silhouette is larger than rMax where dMax clamps', () => {
    // 1024x768: documented in docs/STEP3-FRAME.md §4. Asserted, not assumed, so the report's
    // "F4 is unreachable at 1024x768" claim has a number behind it.
    const f = frameFor(1024, 768, LIVE_INSETS);
    const focal = 768 / 2 / Math.tan((FOV * Math.PI) / 180 / 2);
    const silhouette = (focal * RE) / Math.sqrt(f.dTarget ** 2 - RE ** 2);
    expect(silhouette).toBeGreaterThan(f.rMax);
    expect(silhouette - f.rMax).toBeGreaterThan(70);
  });
});
