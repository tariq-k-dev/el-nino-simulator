/**
 * PIN VISIBILITY BANDS — the one place a pin's facing threshold is written down.
 *
 * Why this module exists (step 3B2-FIX2-CONT A1/A2): the pin-click spec classifies every pose into
 * front / grazing / back and asserts "front selects 100 %, back selects 0 %". The hit proxy's raycast
 * gate has to refuse exactly the band the spec calls back, so the two must read the SAME numbers. They
 * used to be two literals (`FRONT = 0.15` in the spec, `> 0` in the product), and the 3B2-FIX2 audit
 * measured the cost of that drift: the product gate admitted 20 of 23 front rows (87.0 %) against the
 * spec's required 100 %.
 *
 * ## The algebra the gate is keyed on
 *
 * The original design gated on `n · (rayOrigin − pinBaseWorld) > 0`. With the camera at distance `D`
 * along the unit vector `u`, and the pin base at radius `rb` along the unit normal `n`, that expression
 * is `D (n·u) − rb`. So the "hemisphere" test is really a hard threshold at `n·u > rb / D`: it moves
 * with the camera distance, while the bands below are constants on `n·u`. At `d_fit` the threshold is
 * 0.27720 and at `dMax` 0.20948 — both above 0.15, and `rb / D <= 0.15` would need `D >= 6.98 R` while
 * `OrbitControls.maxDistance` is 5. No camera pose in the product could satisfy both, which is why the
 * gate was rewritten as a constant on `n·u`.
 *
 * ## What replaced it, and what it costs
 *
 * `PIN_HIT_GATE` is the midpoint of the two band edges, so it is a constant in the same quantity the
 * spec bands; front rows are admitted with margin and back rows are refused with margin. The price is
 * stated in the audit and accepted: a pin between the gate and the limb is clickable even where the
 * planet's own silhouette is in front of it (nothing in this scene depth-tests the proxy against the
 * globe), and a pin in `[PIN_HIT_GATE, FRONT_EDGE)` — the grazing band, which the spec reports and
 * never asserts — becomes clickable.
 *
 * Dependency-free on purpose: `tests/e2e/pin-click.spec.ts` imports it directly, so it must not pull in
 * three, React or anything browser-only.
 */

/**
 * `n · u` at or above this is "clearly on the near hemisphere": the pin must select, at every angle.
 * Named `FRONT` in the spec before it moved here.
 */
export const FRONT_EDGE = 0.15;

/**
 * `n · u` below this is "behind the globe": the pin must never select. The spec's back band is
 * `facing < 0`, so the edge is exactly zero — kept as a named constant so the midpoint below is a
 * formula rather than a magic number.
 */
export const BACK_EDGE = 0;

/**
 * The proxy's raycast gate, in `n · u`: a hit is returned only strictly above this.
 *
 * `(FRONT_EDGE + BACK_EDGE) / 2 = 0.075`. With these bands the gate is NOT zero — the bands are
 * asymmetric (front edge 0.15, back edge 0), unlike the symmetric case the prompt anticipated. The
 * unit test pins `FRONT_EDGE > PIN_HIT_GATE > BACK_EDGE` so the margin can never be eroded silently.
 */
export const PIN_HIT_GATE = (FRONT_EDGE + BACK_EDGE) / 2;

/** Projected radius of a pin's hit proxy, in CSS px, on a fine pointer. */
export const HIT_PX = 14;

/** Same, on `pointer: coarse` — a thumb is wider than a cursor tip. */
export const HIT_PX_COARSE = 22;

/**
 * Nearest pin pair, spin-invariant, measured over all six pairs (audit, `probe-geometry.mjs`):
 * pacific <-> us-west at 0.89532 R, next se-asia <-> horn-africa at 1.27524 R.
 */
export const NEAREST_PIN_PAIR_R = 0.89532;

/**
 * Ceiling on the proxy's world radius: half the nearest pin pair, so two proxies can never overlap and
 * one pin can never swallow its neighbour's click. At `d_fit` a 14 px proxy is 0.04513 R — 9.9x under
 * this — so the clamp only ever binds at absurd camera distances.
 */
export const PIN_HIT_CLAMP_R = NEAREST_PIN_PAIR_R / 2;

/** Anything with x/y/z, so three's `Vector3` and a plain object both satisfy it. */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Does a pin whose base normal is `nWorld` face the camera enough to be hit?
 *
 * Pure, and deliberately ignorant of `rb`, `D`, pin height and `maxDistance`: those are what made the
 * old gate distance-dependent. It reads exactly three world quantities plus the gate.
 *
 * @param nWorld           outward pin-base normal, transformed by the spin group's world rotation and
 *                         recomputed at raycast time, so it stays right while the planet spins.
 * @param cameraWorld      `raycaster.ray.origin` — the near plane of the picking ray, not the camera
 *                         object's position (they differ, and the ray is what actually picks).
 * @param globeCenterWorld the spin group's world position, NOT the world origin.
 * @param gate             defaults to `PIN_HIT_GATE`.
 * @returns true iff `dot(normalize(nWorld), normalize(cameraWorld - globeCenterWorld)) > gate`.
 *          A degenerate camera at the globe centre returns false and does not throw.
 */
export function pinFacesCamera(
  nWorld: Vec3Like,
  cameraWorld: Vec3Like,
  globeCenterWorld: Vec3Like,
  gate: number = PIN_HIT_GATE,
): boolean {
  const nx = nWorld.x;
  const ny = nWorld.y;
  const nz = nWorld.z;
  const dx = cameraWorld.x - globeCenterWorld.x;
  const dy = cameraWorld.y - globeCenterWorld.y;
  const dz = cameraWorld.z - globeCenterWorld.z;

  const nLen = Math.hypot(nx, ny, nz);
  const dLen = Math.hypot(dx, dy, dz);
  /* A zero-length camera vector is the degenerate "camera at the globe centre" case: no direction to
   * face, so nothing faces it. A zero-length normal is a malformed pin; refusing it is safer than
   * letting NaN decide, and neither throws. */
  if (!(nLen > 0) || !(dLen > 0)) return false;

  const facing = (nx * dx + ny * dy + nz * dz) / (nLen * dLen);
  return facing > gate;
}
