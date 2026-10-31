/**
 * `facingPose` and `arcStep` — the PURE geometry of the live focus policy.
 *
 * ## What changes from the legacy fly-to
 *
 * Step 3B flew the camera AT the pin: it damped `controls.target` onto the pin's world position and
 * damped the distance to the pin's own `zoom`. Measured in the 3B audit, that overflows the free
 * rectangle by up to **+462 px right and +306 px bottom**, because the orbit target ends up on the
 * pin and the globe is no longer centred on anything.
 *
 * The live policy instead **orbits the camera to face the pin**: `controls.target` stays at the
 * origin, the distance is not touched, and the camera is placed on the pin's own normal side. The pin
 * then projects onto the free-rect centre by construction, and the globe stays centred and contained.
 *
 * ## Why the interpolation is on the sphere
 *
 * Interpolating the camera POSITION along a chord would shorten the radius mid-flight (the chord
 * between two points on a sphere of radius `d` passes inside it, by `d(1 - cos(Δ/2))` — at
 * `d = 3.78` and a 152° flight that is **2.05 R**, a visible dive toward the globe). So the
 * direction is interpolated along the great circle and the radius is applied afterwards, which makes
 * the distance constant to float exactness (asserted to 1e-9) and makes S8 unbreakable by
 * construction rather than by a clamp.
 *
 * ## Why this file has no three.js dependency
 *
 * Vectors are `Vec3 = [number, number, number]`. The geometry is what needs testing — clamps,
 * antipodes, retargets — and a browser-free unit test is the cheapest way to test all of it. The
 * director converts at the boundary.
 */

import { ARRIVE_EPSILON_R, FLY_TARGET_EASE_BASE, easeFactor } from './easing';

export type Vec3 = [number, number, number];

/** World up. Camera polar angle is measured from this axis, matching `OrbitControls`. */
export const WORLD_UP: Vec3 = [0, 1, 0];

/**
 * The deterministic fallback axis for the degenerate antipodal case.
 *
 * Used when `cross(up, direction)` vanishes (the direction is parallel to up, i.e. at a pole) AND
 * when `cross(from, to)` vanishes (a 180° flight). Chosen from a fixed world axis rather than from
 * the operand order, so the same pair of inputs always produces the same path on every call and every
 * machine — a tie-break that depended on which argument came first would make a retarget mid-flight
 * jump.
 */
const TIE_BREAK_AXES: readonly Vec3[] = [
  [0, 0, 1],
  [0, 1, 0],
  [1, 0, 0],
];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/** Unit vector. Returns the zero vector unchanged rather than NaN. */
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  if (l < 1e-12) return [0, 0, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Clamp into `[-1, 1]` before `acos`, so float noise cannot produce NaN at 0° or 180°. */
function safeAcos(x: number): number {
  if (x > 1) return 0;
  if (x < -1) return Math.PI;
  return Math.acos(x);
}

/** Unsigned angle between two directions, radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return safeAcos(dot(normalize(a), normalize(b)));
}

/**
 * A rotation axis perpendicular to `v`, chosen deterministically.
 *
 * `preferred` (usually `up`) is used when the cross product with it is non-degenerate; otherwise the
 * first tie-break axis that is not parallel to `v`. Total, so a caller never has to test for NaN.
 */
function perpAxis(v: Vec3, preferred: Vec3): Vec3 {
  const c = cross(preferred, v);
  if (length(c) > 1e-6) return normalize(c);
  for (const axis of TIE_BREAK_AXES) {
    const c2 = cross(axis, v);
    if (length(c2) > 1e-6) return normalize(c2);
  }
  /* Unreachable: no vector is parallel to all three world axes. */
  return [1, 0, 0];
}

/** Rodrigues rotation of `v` about a unit `axis` by `angle` radians. */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [
    v[0] * c + k[0] * s + axis[0] * d,
    v[1] * c + k[1] * s + axis[1] * d,
    v[2] * c + k[2] * s + axis[2] * d,
  ];
}

/** Polar angle of a direction from `up`, in RADIANS, in `[0, π]`. */
export function polarAngle(dir: Vec3, up: Vec3 = WORLD_UP): number {
  return safeAcos(dot(normalize(dir), normalize(up)));
}

/** Move a unit direction to a specific polar angle, keeping its azimuth. */
function atPolar(dir: Vec3, up: Vec3, polar: number): Vec3 {
  const u = normalize(up);
  const v = normalize(dir);
  const cosP = Math.cos(polar);
  const sinP = Math.sin(polar);
  /* The azimuthal part: v with its `up` component removed. */
  const perp: Vec3 = [v[0] - dot(v, u) * u[0], v[1] - dot(v, u) * u[1], v[2] - dot(v, u) * u[2]];
  const pl = length(perp);
  let p: Vec3;
  if (pl > 1e-9) {
    p = [perp[0] / pl, perp[1] / pl, perp[2] / pl];
  } else {
    /*
     * The direction is ON the pole, so it has no azimuth to preserve. Pick the deterministic
     * perpendicular instead of returning NaN — a pin exactly at a pole is a legal input, and its
     * clamped result must still be a unit vector.
     */
    p = perpAxis(u, [1, 0, 0]);
  }
  return normalize([
    cosP * u[0] + sinP * p[0],
    cosP * u[1] + sinP * p[1],
    cosP * u[2] + sinP * p[2],
  ]);
}

export interface FacingInput {
  /** The pin's unit direction in world space (already rotated by the earth's spin). */
  pinDir: Vec3;
  /** The camera's distance from the origin. Carried through untouched; the module never changes it. */
  distance: number;
  /** World up. Defaults to the Y axis. */
  up?: Vec3;
  /** `OrbitControls.minPolarAngle`, radians. Defaults to the control's own 0. */
  polarMin?: number;
  /** `OrbitControls.maxPolarAngle`, radians. Defaults to the control's own π. */
  polarMax?: number;
}

export interface FacingPose {
  /** Where the camera must sit, as a unit direction from the orbit target. */
  direction: Vec3;
  /** True when the polar limits moved the camera off the pin's exact normal. */
  clamped: boolean;
  /** Angle between the requested and the achieved direction, degrees. 0 when not clamped. */
  residualDeg: number;
}

/**
 * The pose that FACES a pin: the camera on the pin's normal side of the origin, at `distance`.
 *
 * `controls.target` is the origin, so this function needs no target at all — that is the whole point
 * of the change from aim-at-pin.
 *
 * `clamped`/`residualDeg` exist because the polar limits are a real constraint on any pin near a
 * pole: `OrbitControls.update()` would silently move the camera anyway, and a spec that asserted
 * "the pin is at the free-rect centre" would then be measuring the clamp as a 30 px defect. Reporting
 * the residual lets a caller assert against the analytic expectation instead.
 */
export function facingPose(input: FacingInput): FacingPose {
  const up = input.up ?? WORLD_UP;
  const polarMin = input.polarMin ?? 0;
  const polarMax = input.polarMax ?? Math.PI;

  const wanted = normalize(input.pinDir);
  const polar = polarAngle(wanted, up);

  if (polar >= polarMin - 1e-12 && polar <= polarMax + 1e-12) {
    return { direction: wanted, clamped: false, residualDeg: 0 };
  }

  const target = polar < polarMin ? polarMin : polarMax;
  const direction = atPolar(wanted, up, target);
  const residual = Math.abs(polar - target);
  return {
    direction,
    clamped: residual > 1e-12,
    residualDeg: (residual * 180) / Math.PI,
  };
}

export interface ArcStepInput {
  /** The camera's direction THIS frame — so a retarget continues from where the camera is. */
  from: Vec3;
  /** The direction to fly to. */
  to: Vec3;
  /** Frame delta in seconds. */
  dtS: number;
  /** The ease base. Defaults to the fly-to's own target base; NOT retyped anywhere else. */
  easeBase?: number;
}

/**
 * One frame of a great-circle ease from `from` toward `to`.
 *
 * The angular step is `remaining * (1 - base^dt)` — the same exponential damp the fly-to has always
 * used for its target, so the flight feels identical and the convergence test can be the same
 * epsilon. The result is a UNIT vector: the caller multiplies by its own constant distance, which is
 * what makes "the distance never changes" structural rather than a property to re-check each frame.
 */
export function arcStep(input: ArcStepInput): Vec3 {
  const from = normalize(input.from);
  const to = normalize(input.to);
  const total = safeAcos(dot(from, to));
  if (total < 1e-9) return to;

  const k = easeFactor(input.easeBase ?? FLY_TARGET_EASE_BASE, input.dtS);
  const step = total * k;

  /*
   * The rotation axis is `from x to`, normalised. For a 180° flight that cross product vanishes and
   * the deterministic tie-break axis is used instead, so the path is pinned rather than NaN. The axis
   * is perpendicular to `from` in both cases, so the rotation keeps the vector on its own great
   * circle and the radius is untouched.
   */
  const c = cross(from, to);
  const axis = length(c) > 1e-6 ? normalize(c) : perpAxis(from, WORLD_UP);
  return normalize(rotateAbout(from, axis, step));
}

/**
 * Remaining angular error toward a target, radians.
 *
 * This is the live CONVERGENCE TEST's left-hand side: `isArrived` is `remaining < ARRIVE_EPSILON_R`,
 * the legacy fly-to's own epsilon (0.004 at unit length). Sharing the constant is what lets the
 * prompt's "same convergence test as today" be checked rather than assumed.
 */
export function remainingRad(from: Vec3, to: Vec3): number {
  return angleBetween(from, to);
}

/** True when a direction is within the legacy fly-to's angular epsilon of its target. */
export function isArrived(from: Vec3, to: Vec3): boolean {
  return remainingRad(from, to) < ARRIVE_EPSILON_R;
}

/** Angular tolerance in degrees, for reporting. */
export const ARRIVE_EPSILON_DEG = (ARRIVE_EPSILON_R * 180) / Math.PI;
