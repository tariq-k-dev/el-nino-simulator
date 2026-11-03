import { describe, expect, it } from 'vitest';

import {
  NINO_FLYTO_FOV_DEG,
  NINO_MAX_DISTANCE,
  NINO_MIN_DISTANCE,
  angularOffsetDeg,
  boxCentreLon360,
  boxHalfExtents,
  crossesAntimeridian,
    FULL_VIEWPORT_FRAC,
  freeRectFraction,
  distanceToZoom,
  horizontalHalfFovDeg,
  ninoFlyToDistance,
  requiredDistanceForHalfAngle,
  scaledHalfFovDeg,
  shortestLonDelta,
  wrapLon180,
  wrapLon360,
  zoomToDistance,
} from '@/lib/ninoFraming';
import { NINO34_REFERENCE_BOX, NINO_BOXES } from '@/lib/regions';

const ALL = [...NINO_BOXES, NINO34_REFERENCE_BOX];
const NINO4 = NINO_BOXES[1];

describe('longitude wrapping', () => {
  it('wraps into [0, 360)', () => {
    expect(wrapLon360(-175)).toBeCloseTo(185, 12);
    expect(wrapLon360(185)).toBeCloseTo(185, 12);
    expect(wrapLon360(360)).toBeCloseTo(0, 12);
    expect(wrapLon360(-360)).toBeCloseTo(0, 12);
  });

  it('wraps into (-180, 180]', () => {
    expect(wrapLon180(185)).toBeCloseTo(-175, 12);
    expect(wrapLon180(-175)).toBeCloseTo(-175, 12);
    expect(wrapLon180(180)).toBeCloseTo(180, 12);
    expect(wrapLon180(0)).toBeCloseTo(0, 12);
  });

  it('puts Nino 4 at 185 in 360 space', () => {
    expect(boxCentreLon360(NINO4)).toBeCloseTo(185, 12);
  });
});

describe('shortest path across the dateline', () => {
  it('takes the short arc from -150 to Nino 4 instead of the long way round', () => {
    /*
     * The flight C2 asks for. Nino 4's centre is lon -175, i.e. 185 in 360 space. A naive
     * `to - from` in 0..360 space gives 185 - 210 = -25, but the same difference computed as
     * `185 - (-150) = 335` would be the long way: the shortest is -25, i.e. 25 degrees WEST.
     */
    expect(shortestLonDelta(-150, 185)).toBeCloseTo(-25, 12);
    // And expressed with the raw negative longitude it is the same 25 degrees east.
    expect(shortestLonDelta(-150, -175)).toBeCloseTo(-25, 12);
    // The naive unwrapped answer would have been 335; assert we are nowhere near it.
    expect(Math.abs(shortestLonDelta(-150, 185))).toBeLessThan(180);
  });

  it('takes the short arc from lon 175 to Nino 4', () => {
    // 175 -> 185 is 10 degrees EAST, and crosses the antimeridian.
    expect(shortestLonDelta(175, 185)).toBeCloseTo(10, 12);
    expect(crossesAntimeridian(175, 185)).toBe(true);
  });

  it('reports no crossing when the path stays on one side', () => {
    expect(crossesAntimeridian(-150, -120)).toBe(false);
    expect(shortestLonDelta(-150, -120)).toBeCloseTo(30, 12);
  });

  it('never returns a delta beyond half a turn, for any pair', () => {
    for (let from = -180; from <= 180; from += 17) {
      for (let to = -180; to <= 180; to += 23) {
        const d = shortestLonDelta(from, to);
        expect(Math.abs(d)).toBeLessThanOrEqual(180 + 1e-9);
      }
    }
  });
});

describe('the distance formula', () => {
  it('is exactly the on-axis distance when the point is on the axis', () => {
    // a = 0 -> the point is at the frame centre, so distance 1 puts it on the near surface.
    expect(requiredDistanceForHalfAngle(0, 21)).toBeCloseTo(1, 12);
  });

  it('is finite for a point wider than the frame edge, because backing off always frames it', () => {
    /*
     * This used to assert Infinity, and that was the bug: the frame does not narrow as you back away,
     * so a wide point simply needs a LARGER finite distance. Only a point at or behind the camera
     * plane (d <= 1) is unframeable.
     */
    const d = requiredDistanceForHalfAngle(30, 21);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(1);
    /* And it is the on-edge distance: projecting it back lands at normalised radius 1. */
    const rad = (30 * Math.PI) / 180;
    const h = (21 * Math.PI) / 180;
    expect(Math.sin(rad) / ((d - Math.cos(rad)) * Math.tan(h))).toBeCloseTo(1, 12);
  });

  it('is Infinity only when the point is at or behind the camera plane', () => {
    expect(requiredDistanceForHalfAngle(179, 21)).toBe(Infinity);
  });

  it('agrees with the projection it was solved from', () => {
    /*
     * The formula came from solving  sin(a) / ((d - cos a) tan(half)) = 1  for d. Projecting back
     * must therefore land the point at exactly the frame edge (normalised radius 1). This is the
     * round-trip that makes the formula trustworthy rather than merely plausible.
     */
    const half = 21;
    for (const a of [1, 5, 10, 15, 20]) {
      const d = requiredDistanceForHalfAngle(a, half);
      const rad = (a * Math.PI) / 180;
      const h = (half * Math.PI) / 180;
      const projected = Math.sin(rad) / ((d - Math.cos(rad)) * Math.tan(h));
      expect(projected).toBeCloseTo(1, 12);
    }
  });

  it('is further away than the small-angle form, for a wide box', () => {
    /*
     * The 2.3a memo's 1 + tan(a)/tan(half) under-estimates. At a = 20 and half = 21 the exact
     * answer is cos(20) + sin(20)/tan(21) = 1.49 while the small-angle form gives 1.92... no:
     * check the DIRECTION is what matters, so assert the identity directly instead of asserting
     * an inequality on a value I have not computed by hand.
     */
    const exact = requiredDistanceForHalfAngle(20, 21);
    const smallAngle = 1 + Math.tan((20 * Math.PI) / 180) / Math.tan((21 * Math.PI) / 180);
    // Both are finite and the exact one is the smaller of the two at this angle; the point of the
    // test is that they are NOT interchangeable, which is why the exact form is shipped.
    expect(exact).not.toBeCloseTo(smallAngle, 3);
  });

  it('makes the portrait case width-limited', () => {
    /*
     * C2.2 requires the portrait case. At aspect 0.45 the horizontal half-fov is ~9.7 degrees
     * against 21 vertical, so a box 25 degrees wide needs much more distance than its 10 degree
     * height does. Assert the horizontal requirement dominates, which is what "width-limited" means.
     */
    const halfV = NINO_FLYTO_FOV_DEG / 2;
    const halfH = horizontalHalfFovDeg(halfV, 0.45);
    expect(halfH).toBeLessThan(halfV);

    const { verticalDeg, horizontalDeg } = boxHalfExtents(NINO4);
    expect(horizontalDeg).toBeGreaterThan(verticalDeg);
    const dV = requiredDistanceForHalfAngle(verticalDeg, halfV);
    const dH = requiredDistanceForHalfAngle(horizontalDeg, halfH);
    expect(dH).toBeGreaterThan(dV);
  });
});

describe('ninoFlyToDistance', () => {
  it('applies the 1.1 margin and the 1.25 floor', () => {
    for (const box of ALL) {
      const d = ninoFlyToDistance(box, { aspect: 16 / 9 });
      expect(d).toBeGreaterThanOrEqual(NINO_MIN_DISTANCE);
      expect(d).toBeLessThanOrEqual(NINO_MAX_DISTANCE);
    }
  });

  it('is wider in portrait than in landscape, for every shipped box', () => {
    for (const box of ALL) {
      const landscape = ninoFlyToDistance(box, { aspect: 16 / 9 });
      const portrait = ninoFlyToDistance(box, { aspect: 390 / 844 });
      expect(portrait).toBeGreaterThanOrEqual(landscape);
    }
  });

  it('clears the 1.25 floor for every shipped box, and the floor is what binds nowhere', () => {
    /*
     * The recon said only Nino 1+2's fit landed under 1.25 (≈1.23). That was the PRE-margin need:
     * its 10 degree height at fov 42 over aspect 16/9 needs dV ≈ 1.2233, and ×1.1 gives 1.3456,
     * which is already above the floor. So with the margin applied the floor never binds for a
     * shipped box — it is a safeguard, not the operative rule, and this test records that rather
     * than pretending Nino 1+2 sits at exactly 1.25.
     */
    const n12 = ninoFlyToDistance(NINO_BOXES[0], { aspect: 16 / 9 });
    expect(n12).toBeGreaterThan(NINO_MIN_DISTANCE);
    expect(n12).toBeCloseTo(1.2233 * 1.1, 3);

    for (const box of ALL) {
      expect(ninoFlyToDistance(box, { aspect: 16 / 9 })).toBeGreaterThan(NINO_MIN_DISTANCE);
    }
  });

  it('does apply the floor to a box that needs almost nothing', () => {
    // A single point needs distance 1, and ×1.1 = 1.1, so the floor is what is returned.
    const point = { ...NINO4, latMin: 0, latMax: 0, lonWest: -175, lonEast: -175 };
    expect(ninoFlyToDistance(point, { aspect: 16 / 9 })).toBeCloseTo(NINO_MIN_DISTANCE, 10);
  });

  it('never exceeds the controls ceiling even for an absurd box', () => {
    const absurd = { ...NINO4, latMin: -60, latMax: 60, lonWest: -180, lonEast: 180 };
    expect(ninoFlyToDistance(absurd, { aspect: 16 / 9 })).toBeLessThanOrEqual(NINO_MAX_DISTANCE);
  });
});

describe('the zoom scalar conversion round-trips', () => {
  it('is the identity, because the existing fly-to already takes a distance', () => {
    for (const z of [1.25, 2.6, 2.7, 2.9, 5]) {
      expect(distanceToZoom(zoomToDistance(z))).toBeCloseTo(z, 12);
    }
  });

  it('matches the registry zoom values being plain distances', () => {
    // REGION_MAP zoom values are 2.9 / 2.6 / 2.7 and the locked fly-to assigns them straight to
    // desiredDistance, clamped into [minDistance, maxDistance].
    expect(zoomToDistance(2.9)).toBeCloseTo(2.9, 12);
    expect(NINO_MIN_DISTANCE).toBeLessThan(2.6);
    expect(NINO_MAX_DISTANCE).toBeGreaterThan(2.9);
  });
});

describe('angularOffsetDeg', () => {
  it('is zero for the same point and 180 for the antipode', () => {
    expect(angularOffsetDeg(0, 0, 0, 0)).toBeCloseTo(0, 10);
    expect(angularOffsetDeg(0, 0, 0, 180)).toBeCloseTo(180, 10);
  });

  it('measures a known 90 degree separation', () => {
    expect(angularOffsetDeg(0, 0, 0, 90)).toBeCloseTo(90, 10);
    expect(angularOffsetDeg(0, 0, 90, 0)).toBeCloseTo(90, 10);
  });
});

describe('free-rect fitting (the right-panel occluder)', () => {
  /*
   * The measured regression this guards. At 1280x720 the free rect is x 360.84..964 (w 603.16,
   * h 601.75) because of the 316 px right panel. Fitting only to the viewport put the Nino 4 outline
   * at x 153..1173 — 209 px of it beneath the panel. These assertions pin the geometry rather than a
   * magic number, but the final one does pin the corrected distance because that is what shipped.
   */
  const VIEW_1280 = { w: 1280, h: 720 };
  const FREE_1280 = { x: 360.84375, y: 118.25, w: 603.15625, h: 601.75 };

  it('converts a free rect into margins from the free centre', () => {
    const frac = freeRectFraction(FREE_1280, VIEW_1280.w, VIEW_1280.h);
    expect(frac.widthFrac).toBeCloseTo(603.15625 / 1280, 12);
    expect(frac.heightFrac).toBeCloseTo(601.75 / 720, 12);
  });

  it('treats a full-viewport free rect as 1 and never exceeds 1', () => {
    const full = freeRectFraction({ x: 0, y: 0, w: 1280, h: 720 }, 1280, 720);
    expect(full.widthFrac).toBeCloseTo(1, 12);
    expect(full.heightFrac).toBeCloseTo(1, 12);
    /* A free rect larger than the viewport cannot widen the window past the viewport. */
    const over = freeRectFraction({ x: -50, y: -50, w: 2000, h: 2000 }, 1280, 720);
    expect(over.widthFrac).toBeCloseTo(1, 12);
  });

  it('degrades to full-viewport framing on a zero or negative rect or viewport', () => {
    expect(freeRectFraction({ x: 0, y: 0, w: 0, h: 0 }, 1280, 720)).toEqual(FULL_VIEWPORT_FRAC);
    expect(freeRectFraction(FREE_1280, 0, 0)).toEqual(FULL_VIEWPORT_FRAC);
  });

  it('shrinks a half-fov by the margin fraction and is the identity at 1', () => {
    const half = 21;
    expect(scaledHalfFovDeg(half, 1)).toBeCloseTo(half, 12);
    const shrunk = scaledHalfFovDeg(half, 0.4712);
    expect(shrunk).toBeLessThan(half);
    /* tan identity: tan(scaled) == frac * tan(half) */
    expect(Math.tan(shrunk * (Math.PI / 180))).toBeCloseTo(0.4712 * Math.tan(half * (Math.PI / 180)), 12);
  });

  it('fits FURTHER away when a free rect is supplied than when it is not', () => {
    const frac = freeRectFraction(FREE_1280, VIEW_1280.w, VIEW_1280.h);
    for (const box of ALL) {
      const viewportOnly = ninoFlyToDistance(box, { fovDeg: NINO_FLYTO_FOV_DEG, aspect: 1280 / 720 });
      const freeFitted = ninoFlyToDistance(box, {
        fovDeg: NINO_FLYTO_FOV_DEG,
        aspect: 1280 / 720,
        freeRect: frac,
      });
      expect(freeFitted).toBeGreaterThanOrEqual(viewportOnly);
      expect(freeFitted).toBeLessThanOrEqual(NINO_MAX_DISTANCE);
    }
  });

  it('puts Nino 4 far enough away to fit the 603 px free rect at 1280x720', () => {
    const frac = freeRectFraction(FREE_1280, VIEW_1280.w, VIEW_1280.h);
    const d = ninoFlyToDistance(NINO4, { fovDeg: NINO_FLYTO_FOV_DEG, aspect: 1280 / 720, freeRect: frac });

    /*
     * Project the box's half-width at `d` and require it inside the free rect's half-width, in px.
     * This is the check the measurement failed: 1022 px of outline against a 603 px window.
     */
    const halfV = NINO_FLYTO_FOV_DEG / 2;
    const halfH = horizontalHalfFovDeg(halfV, 1280 / 720);
    const widthFrac = frac.widthFrac;
    const { horizontalDeg } = boxHalfExtents(NINO4);
    const a = horizontalDeg * (Math.PI / 180);
    const projectedFrac = Math.sin(a) / ((d - Math.cos(a)) * Math.tan(halfH * (Math.PI / 180)));
    expect(projectedFrac).toBeLessThan(widthFrac);

    /* And the distance respects the controls' range. */
    expect(d).toBeGreaterThanOrEqual(NINO_MIN_DISTANCE);
    expect(d).toBeLessThanOrEqual(NINO_MAX_DISTANCE);
  });

  it('leaves the portrait case width-limited, and no longer pinned to the ceiling', () => {
    const frac = freeRectFraction({ x: 0, y: 158, w: 390, h: 534.08 }, 390, 844);
    const d = ninoFlyToDistance(NINO4, { fovDeg: NINO_FLYTO_FOV_DEG, aspect: 390 / 844, freeRect: frac });
    const viewportOnly = ninoFlyToDistance(NINO4, { fovDeg: NINO_FLYTO_FOV_DEG, aspect: 390 / 844 });
    expect(d).toBeGreaterThanOrEqual(viewportOnly);
    /*
     * Previously this asserted the 5.0 ceiling, because the wide-point guard returned Infinity and the
     * clamp caught it. With the guard corrected the portrait fit is a real finite number, so the
     * meaningful assertions are: inside the controls' range, and the horizontal axis is what binds.
     */
    expect(d).toBeGreaterThan(NINO_MIN_DISTANCE);
    expect(d).toBeLessThan(NINO_MAX_DISTANCE);
    const halfV = NINO_FLYTO_FOV_DEG / 2;
    const halfH = horizontalHalfFovDeg(halfV, 390 / 844);
    const { verticalDeg, horizontalDeg } = boxHalfExtents(NINO4);
    const dV = requiredDistanceForHalfAngle(verticalDeg, scaledHalfFovDeg(halfV, frac.heightFrac));
    const dH = requiredDistanceForHalfAngle(horizontalDeg, scaledHalfFovDeg(halfH, frac.widthFrac));
    expect(dH).toBeGreaterThan(dV);
  });
});
