/**
 * GEOMETRY TESTS for the analytic `n·L` — the foundation the whole 3.4 redefinition rests on.
 *
 * These exist because the first F4 audit produced two numbers that contradicted the brief
 * (θ = 132.8° where the brief says 47.2°, and a "day" band DARKER than its "night" band at
 * az 150). Either the geometry is wrong or the brief's convention differs; a threshold cannot be
 * written until that is settled. So the tests below pin the function to cases with a known answer:
 *
 *   - camera and sun on the same axis  → `n·L = +1` at the disc centre (full day)
 *   - sun directly behind the camera   → `n·L = -1` at the disc centre (full night)
 *   - sun exactly side-on              → `n·L = 0` at the disc centre
 *   - far camera (orthographic limit)  → the `n·L = 0` crossing sits at `r/R = |cos θ|`
 *   - a hit beyond the limb            → `hit: false`, never a silent NaN that reads as "night"
 */
import { describe, expect, it } from 'vitest';
import {
  findAxisNDotL,
  nDotLAt,
  sunViewAngleDeg,
  type SunCameraGeometry,
} from '../../../src/lib/look/helpers';

/**
 * A camera on +Z looking at the origin, with the disc radius DERIVED from the camera.
 *
 * Deriving `r` rather than hardcoding it matters: the first version of this fixture put the
 * camera 200 units away and set `r = 325.96`, which is geometrically impossible — at that
 * distance a unit sphere spans about 5 px, so every off-centre ray missed and the test looked
 * like a maths failure when it was a fixture failure. `r = focal / sqrt(d² - R²)` is the tangent
 * radius and the value `fitLimb` would measure.
 */
function geom(over: Partial<SunCameraGeometry> = {}): SunCameraGeometry {
  const base = {
    cam: [0, 0, 3] as [number, number, number],
    sun: [0, 0, 1] as [number, number, number],
    fov: 42,
    heightPx: 800,
    cx: 640,
    cy: 400,
    r: 0,
    radius: 1,
  };
  const g = { ...base, ...over };
  if (!g.r) {
    const focal = g.heightPx / (2 * Math.tan((g.fov * Math.PI) / 360));
    const d = Math.hypot(g.cam[0], g.cam[1], g.cam[2]);
    g.r = focal / Math.sqrt(d * d - g.radius * g.radius);
  }
  return g;
}

/** Where the limb projects to, for the far-camera cases. */
function bandAt(g: SunCameraGeometry, px: number, py: number) {
  return nDotLAt(g, px, py);
}

describe('nDotLAt — sign conventions', () => {
  it('sun on the camera side gives n·L = +1 at the disc centre', () => {
    expect(bandAt(geom(), 640, 400).nDotL).toBeCloseTo(1, 6);
  });

  it('sun directly behind the globe gives n·L = -1 at the disc centre', () => {
    const g = geom({ sun: [0, 0, -1] });
    expect(bandAt(g, 640, 400).nDotL).toBeCloseTo(-1, 6);
  });

  it('sun side-on gives n·L = 0 at the disc centre', () => {
    const g = geom({ sun: [1, 0, 0] });
    expect(Math.abs(bandAt(g, 640, 400).nDotL)).toBeLessThan(1e-6);
  });

  it('reports hit:false outside the limb rather than a NaN that reads as night', () => {
    const s = bandAt(geom(), 640 + 400, 400);
    expect(s.hit).toBe(false);
    expect(Number.isNaN(s.nDotL)).toBe(true);
  });

  it('a point on the near surface is hit and its r/R is the screen offset over R_fit', () => {
    // Offset derived from the fixture's own radius, never a hardcoded pixel count.
    const g = geom();
    const s = bandAt(g, g.cx + g.r * 0.5, g.cy);
    expect(s.hit).toBe(true);
    expect(s.rOverR).toBeCloseTo(0.5, 3);
  });
});

describe('sunViewAngleDeg', () => {
  it('is 0 when the sun is behind the camera, looking straight at a fully lit face', () => {
    // The camera sits at +Z and looks toward the origin, i.e. down -Z. A sun at +Z is behind it.
    expect(sunViewAngleDeg({ cam: [0, 0, 3], sun: [0, 0, 1] })).toBeCloseTo(0, 4);
  });

  it('is 180 when the sun is on the far side', () => {
    expect(sunViewAngleDeg({ cam: [0, 0, 3], sun: [0, 0, -1] })).toBeCloseTo(180, 4);
  });

  it('is 90 for a side-on sun', () => {
    expect(sunViewAngleDeg({ cam: [0, 0, 3], sun: [1, 0, 0] })).toBeCloseTo(90, 4);
  });
});

describe('the orthographic limit', () => {
  /**
   * With the camera far away, perspective flattens and the `n·L = 0` crossing must land at
   * `r/R = |cos θ|`, which is the brief's own sanity relation. This is the test that would have
   * caught an inverted or transposed basis immediately.
   */
  it('puts the n·L = 0 crossing at |cos θ| for a distant camera', () => {
    for (const deg of [20, 35, 47.2, 60, 75]) {
      const th = (deg * Math.PI) / 180;
      const dir = Math.hypot(1, 0);
      void dir;
      // Sun tilted `deg` from the view axis, in the XZ plane.
      const g = geom({ cam: [0, 0, 200], sun: [Math.sin(th), 0, Math.cos(th)] });
      const axis = { ax: 1, ay: 0 };
      const zero = findAxisNDotL(g, axis, 0);
      expect(zero, `no crossing at θ=${deg}`).not.toBeNull();
      expect(zero!.rOverR).toBeCloseTo(Math.abs(Math.cos(th)), 2);
    }
  });

  it('puts ±0.25 at |sin(θ ∓ 14.48 deg)| — the brief\'s relation, within perspective', () => {
    const th = (47.2 * Math.PI) / 180;
    const g = geom({ cam: [0, 0, 200], sun: [Math.sin(th), 0, Math.cos(th)] });
    const axis = { ax: 1, ay: 0 };
    const plus = findAxisNDotL(g, axis, 0.25);
    const minus = findAxisNDotL(g, axis, -0.25);
    // n·L = cos(phi - theta) with x = R sin(phi): phi = theta - 90 -/+ 14.48 deg.
    const phiPlus = th - Math.PI / 2 + (14.48 * Math.PI) / 180;
    const phiMinus = th - Math.PI / 2 - (14.48 * Math.PI) / 180;
    expect(plus!.rOverR).toBeCloseTo(Math.abs(Math.sin(phiPlus)), 2);
    expect(minus!.rOverR).toBeCloseTo(Math.abs(Math.sin(phiMinus)), 2);
  });
});

describe('findAxisNDotL', () => {
  it('returns null when the axis never reaches the target', () => {
    // Sun straight at the camera: n·L is ~1 everywhere visible, so there is no crossing.
    expect(findAxisNDotL(geom({ sun: [0, 0, 1] }), { ax: 1, ay: 0 }, 0)).toBeNull();
  });

  it('interpolates between whole pixels rather than snapping to one', () => {
    const th = (47.2 * Math.PI) / 180;
    const g = geom({ cam: [0, 0, 200], sun: [Math.sin(th), 0, Math.cos(th)] });
    const zero = findAxisNDotL(g, { ax: 1, ay: 0 }, 0)!;
    expect(Number.isInteger(zero.t)).toBe(false);
  });
});
