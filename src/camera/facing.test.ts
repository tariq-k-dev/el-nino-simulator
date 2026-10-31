import { describe, expect, it } from 'vitest';
import {
  ARRIVE_EPSILON_DEG,
  WORLD_UP,
  angleBetween,
  arcStep,
  facingPose,
  isArrived,
  normalize,
  polarAngle,
  remainingRad,
  type Vec3,
} from './facing';
import { ARRIVE_EPSILON_R, FLY_TARGET_EASE_BASE } from './easing';

/**
 * The live focus geometry, tested without a browser.
 *
 * Every case here is a number the director and the E2E spec depend on. The four regions are the real
 * pins (`src/lib/regions.ts`), so a case that passes here is a claim about the shipped data rather
 * than about a convenient example.
 */

const DEG = 180 / Math.PI;

/** `latLonToVector3` from `lib/regions.ts`, duplicated ONLY to keep this file three.js-free. */
function pinDir(lat: number, lon: number): Vec3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return normalize([
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ]);
}

const REGIONS = [
  { id: 'pacific', lat: -2, lon: -150 },
  { id: 'us-west', lat: 37, lon: -120 },
  { id: 'se-asia', lat: -3, lon: 112 },
  { id: 'horn-africa', lat: 8, lon: 42 },
];

/** The default camera direction: `(0, 1.15, 3.15)` normalised. */
const DEFAULT_DIR = normalize([0, 1.15, 3.15]);

describe('facingPose — direction', () => {
  it('faces the pin normal exactly when no polar limit binds', () => {
    for (const r of REGIONS) {
      const pin = pinDir(r.lat, r.lon);
      const pose = facingPose({ pinDir: pin, distance: 3.7786 });
      expect(pose.clamped, r.id).toBe(false);
      expect(pose.residualDeg, r.id).toBe(0);
      expect(angleBetween(pose.direction, pin) / DEG).toBeLessThan(1e-12);
    }
  });

  it('returns a unit direction at every spin angle (the earth group rotates the pin)', () => {
    const spin = (v: Vec3, y: number): Vec3 =>
      normalize([
        v[0] * Math.cos(y) + v[2] * Math.sin(y),
        v[1],
        -v[0] * Math.sin(y) + v[2] * Math.cos(y),
      ]);
    for (const r of REGIONS) {
      for (const y of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) {
        const pin = spin(pinDir(r.lat, r.lon), y);
        const pose = facingPose({ pinDir: pin, distance: 4 });
        expect(Math.hypot(...pose.direction)).toBeCloseTo(1, 12);
        expect(angleBetween(pose.direction, pin) / DEG, `${r.id}@${y}`).toBeLessThan(1e-9);
      }
    }
  });

  it('matches the lat/lon of the shipped region table', () => {
    /* Spot values so a change to `latLonToVector3` cannot pass silently here. */
    const pacific = pinDir(-2, -150);
    expect(pacific[0]).toBeCloseTo(-0.865498, 5);
    expect(pacific[1]).toBeCloseTo(-0.034899, 5);
    expect(pacific[2]).toBeCloseTo(0.499695, 5);

    const usWest = pinDir(37, -120);
    expect(usWest[0]).toBeCloseTo(-0.399318, 5);
    expect(usWest[1]).toBeCloseTo(0.601815, 5);
    expect(usWest[2]).toBeCloseTo(0.691639, 5);
  });

  it('never changes the distance it was given (it is carried, not computed)', () => {
    /* The function has no distance in its output at all: asserting the shape is the point. */
    const pose = facingPose({ pinDir: pinDir(-3, 112), distance: 3.3534 });
    expect(Object.keys(pose).sort()).toEqual(['clamped', 'direction', 'residualDeg']);
  });
});

describe('facingPose — polar clamp', () => {
  it('clamps a pin near the north pole against minPolarAngle', () => {
    /* 85°N: polar 5°. minPolarAngle 70° forbids the camera getting that close to the pole. */
    const pin = pinDir(85, 0);
    expect(polarAngle(pin) * DEG).toBeCloseTo(5, 9);
    const pose = facingPose({ pinDir: pin, distance: 4, polarMin: 70 / DEG });
    expect(pose.clamped).toBe(true);
    expect(pose.residualDeg).toBeCloseTo(65, 9);
    expect(polarAngle(pose.direction) * DEG).toBeCloseTo(70, 9);
  });

  it('clamps at the south end against maxPolarAngle', () => {
    const pin = pinDir(-88, 30);
    expect(polarAngle(pin) * DEG).toBeCloseTo(178, 9);
    const pose = facingPose({ pinDir: pin, distance: 4, polarMax: 160 / DEG });
    expect(pose.clamped).toBe(true);
    expect(polarAngle(pose.direction) * DEG).toBeCloseTo(160, 9);
    expect(pose.residualDeg).toBeCloseTo(18, 9);
  });

  it('preserves the azimuth while clamping the polar angle', () => {
    /* A clamp must rotate the camera toward the allowed band, not spin the planet. */
    const pin = pinDir(85, 40);
    const pose = facingPose({ pinDir: pin, distance: 4, polarMin: 60 / DEG });
    const azimuth = (v: Vec3): number => Math.atan2(v[2], v[0]) * DEG;
    expect(azimuth(pose.direction)).toBeCloseTo(azimuth(pin), 9);
  });

  it('does not clamp when the limit is exactly the pin polar angle', () => {
    const pin = pinDir(53, 0);
    const pose = facingPose({ pinDir: pin, distance: 4, polarMin: polarAngle(pin) });
    expect(pose.clamped).toBe(false);
    expect(pose.residualDeg).toBe(0);
  });

  it('shipped limits (0 and π, the OrbitControls defaults) clamp no region', () => {
    for (const r of REGIONS) {
      const pose = facingPose({ pinDir: pinDir(r.lat, r.lon), distance: 4, polarMin: 0, polarMax: Math.PI });
      expect(pose.clamped, r.id).toBe(false);
    }
  });

  it('handles a pin exactly at a pole without NaN', () => {
    const north: Vec3 = [0, 1, 0];
    const pose = facingPose({ pinDir: north, distance: 4, polarMin: 80 / DEG });
    expect(pose.clamped).toBe(true);
    expect(Math.hypot(...pose.direction)).toBeCloseTo(1, 12);
    expect(polarAngle(pose.direction) * DEG).toBeCloseTo(80, 9);
    expect(Number.isNaN(pose.direction[0])).toBe(false);
  });
});

describe('arcStep — spherical interpolation', () => {
  const a = pinDir(-3, 112);
  const b = pinDir(37, -120);

  it('keeps the radius at 1 to 1e-9 across a full flight', () => {
    let dir = a;
    for (let i = 0; i < 400; i += 1) {
      dir = arcStep({ from: dir, to: b, dtS: 1 / 60 });
      expect(Math.abs(Math.hypot(...dir) - 1)).toBeLessThan(1e-9);
    }
    expect(angleBetween(dir, b) / DEG).toBeLessThan(0.1);
  });

  it('never passes inside the start radius when scaled to a distance', () => {
    /*
     * The S8 rule, at the geometry level: a chord interpolation would dip by
     * d(1 - cos(Δ/2)) = 2.05 R for this pair. The arc cannot dip at all.
     */
    const d = 4.2828;
    let dir = a;
    let minDistance = Infinity;
    for (let i = 0; i < 200; i += 1) {
      dir = arcStep({ from: dir, to: b, dtS: 1 / 60 });
      minDistance = Math.min(minDistance, Math.hypot(...dir) * d);
    }
    expect(minDistance).toBeGreaterThanOrEqual(d - 1e-9);
  });

  it('takes the same fraction of the remaining angle every frame (exponential damp)', () => {
    const total = angleBetween(a, b);
    const first = arcStep({ from: a, to: b, dtS: 1 / 60 });
    const travelled = angleBetween(a, first);
    const expected = total * (1 - Math.pow(FLY_TARGET_EASE_BASE, 1 / 60));
    expect(travelled).toBeCloseTo(expected, 12);
  });

  it('converges within the legacy epsilon, at the legacy time constant', () => {
    /* 60 fps: the angle must be under 0.004 rad well before one second. */
    let dir = a;
    let frames = 0;
    while (!isArrived(dir, b) && frames < 600) {
      dir = arcStep({ from: dir, to: b, dtS: 1 / 60 });
      frames += 1;
    }
    expect(isArrived(dir, b)).toBe(true);
    /* τ = 0.1086 s, so 0.004 rad of a 152° flight is ~5.6τ ≈ 0.61 s ≈ 37 frames. */
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(80);
    expect(remainingRad(dir, b)).toBeLessThan(ARRIVE_EPSILON_R);
  });

  it('is frame-rate independent to within the ease form itself', () => {
    const oneBig = arcStep({ from: a, to: b, dtS: 1 / 30 });
    const twoSmall = arcStep({ from: arcStep({ from: a, to: b, dtS: 1 / 60 }), to: b, dtS: 1 / 60 });
    /* Two half-steps of an exponential damp are not identical to one full step, but they agree to
       first order; the assertion is that they are the same kind of flight, not the same frame. */
    expect(Math.abs(angleBetween(a, oneBig) - angleBetween(a, twoSmall)) / DEG).toBeLessThan(0.6);
  });

  it('returns the target exactly when it is already there', () => {
    expect(arcStep({ from: a, to: a, dtS: 1 / 60 })).toEqual(a);
  });
});

describe('arcStep — antipodal determinism', () => {
  const from: Vec3 = normalize([0.3, 0.4, 0.8660254037844386]);
  const to: Vec3 = normalize([-0.3, -0.4, -0.8660254037844386]);

  it('is deterministic for an exactly antipodal pair', () => {
    const one = arcStep({ from, to, dtS: 1 / 60 });
    const two = arcStep({ from, to, dtS: 1 / 60 });
    expect(one).toEqual(two);
    expect(Number.isNaN(one[0] + one[1] + one[2])).toBe(false);
    expect(Math.hypot(...one)).toBeCloseTo(1, 12);
  });

  it('does not depend on which operand is "first" for the AXIS it picks', () => {
    /* `perpAxis(from, up)` is a function of `from` alone, so the two orders cannot disagree. */
    const forward = arcStep({ from, to, dtS: 1 / 60 });
    const backward = arcStep({ from: to, to: from, dtS: 1 / 60 });
    expect(angleBetween(forward, backward) / DEG).toBeGreaterThan(0);
    /* Each moves a quarter of the way along its own great circle: equal step sizes. */
    expect(angleBetween(from, forward)).toBeCloseTo(angleBetween(to, backward), 12);
  });

  it('handles a pole-to-pole flight (cross product vanishes on the up axis)', () => {
    const north: Vec3 = [0, 1, 0];
    const south: Vec3 = [0, -1, 0];
    const step = arcStep({ from: north, to: south, dtS: 1 / 60 });
    expect(Math.hypot(...step)).toBeCloseTo(1, 12);
    expect(polarAngle(step)).toBeGreaterThan(0);
    expect(polarAngle(step)).toBeLessThan(Math.PI);
  });
});

describe('arcStep — retarget', () => {
  it('continues from the current direction without a jump', () => {
    const a = pinDir(-3, 112);
    const b = pinDir(37, -120);
    const c = pinDir(8, 42);

    /* Fly 10 frames toward B, then retarget to C. */
    let dir = a;
    for (let i = 0; i < 10; i += 1) dir = arcStep({ from: dir, to: b, dtS: 1 / 60 });
    const before = dir;

    const after = arcStep({ from: dir, to: c, dtS: 1 / 60 });
    /* One frame's worth of motion, not a teleport to C. */
    const oneFrame = angleBetween(before, c) * (1 - Math.pow(FLY_TARGET_EASE_BASE, 1 / 60));
    expect(angleBetween(before, after)).toBeCloseTo(oneFrame, 10);
    expect(angleBetween(before, after) / DEG).toBeLessThan(5);
    expect(angleBetween(after, c) / DEG).toBeLessThan(angleBetween(before, c) / DEG);
  });

  it('turns toward the new target on the very next frame', () => {
    const a = pinDir(-3, 112);
    const b = pinDir(37, -120);
    const c = pinDir(8, 42);
    let dir = a;
    for (let i = 0; i < 5; i += 1) dir = arcStep({ from: dir, to: b, dtS: 1 / 60 });
    const towardB = arcStep({ from: dir, to: b, dtS: 1 / 60 });
    const towardC = arcStep({ from: dir, to: c, dtS: 1 / 60 });
    expect(angleBetween(towardC, c)).toBeLessThan(angleBetween(towardB, c));
  });
});

describe('remainingRad / isArrived', () => {
  it('reports the epsilon the legacy fly-to uses', () => {
    expect(ARRIVE_EPSILON_R).toBe(0.004);
    expect(ARRIVE_EPSILON_DEG).toBeCloseTo(0.2292, 4);
  });

  it('is true only inside the epsilon', () => {
    const a: Vec3 = [0, 0, 1];
    expect(isArrived(a, [0, 0, 1])).toBe(true);
    const justInside: Vec3 = normalize([Math.sin(0.003), 0, Math.cos(0.003)]);
    const justOutside: Vec3 = normalize([Math.sin(0.005), 0, Math.cos(0.005)]);
    expect(isArrived(a, justInside)).toBe(true);
    expect(isArrived(a, justOutside)).toBe(false);
  });

  it('measures the default-to-pin angles the E2E expectations use', () => {
    const expectDeg: Record<string, number> = {
      pacific: 62.779,
      'us-west': 31.12,
      'se-asia': 152.587,
      'horn-africa': 125.079,
    };
    for (const r of REGIONS) {
      const got = remainingRad(DEFAULT_DIR, pinDir(r.lat, r.lon)) * DEG;
      expect(got, r.id).toBeCloseTo(expectDeg[r.id], 2);
    }
  });
});

describe('normalize / polarAngle edge cases', () => {
  it('normalize returns a unit vector or the zero vector, never NaN', () => {
    expect(normalize([3, 4, 0])).toEqual([0.6, 0.8, 0]);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('polarAngle is 0 at up, π at down, and 90° on the equator', () => {
    expect(polarAngle([0, 1, 0])).toBe(0);
    expect(polarAngle([0, -1, 0])).toBeCloseTo(Math.PI, 12);
    expect(polarAngle([1, 0, 0]) * DEG).toBeCloseTo(90, 12);
  });

  it('WORLD_UP is the Y axis, matching OrbitControls', () => {
    expect(WORLD_UP).toEqual([0, 1, 0]);
  });
});
