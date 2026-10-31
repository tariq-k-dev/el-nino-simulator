/**
 * The easing constants the fly-to has always used, in ONE place.
 *
 * ## Why this file exists
 *
 * Step 3B2 moves the legacy aim-at-pin fly-to into a locked-only branch and adds a new face-pin
 * fly-to beside it. Both have to ease with the SAME time constants, and "the same" has to be a fact
 * about shared values rather than two literals that agree today. So the two bases and the
 * convergence epsilon live here, and every consumer imports them:
 *
 *   - `CameraDirector`'s locked branch reads them after the move (the arithmetic it performs is
 *     numerically identical to the pre-move code, which is what makes the locked golden fixture a
 *     real check rather than a restatement);
 *   - `camera/facing.ts` reads them for the spherical-arc ease and the arrival test.
 *
 * ## What each number means
 *
 * `1 - Math.pow(base, dt)` is an exponential damp with a time constant of `-1 / ln(base)` seconds:
 *
 *   - `FLY_TARGET_EASE_BASE = 0.0001` → τ = 0.1086 s. The base the orbit-target damp has always
 *     used (`CameraRig.tsx:85-133`, absorbed verbatim into `CameraDirector`).
 *   - `FLY_DISTANCE_EASE_BASE = 0.0006` → τ ≈ 0.1698 s. The distance ease, deliberately slower than
 *     the direction so a fly-to does not read as a dolly-plus-pan arriving at once.
 *   - `ARRIVE_EPSILON_R = 0.004` — the legacy convergence test: `controls.target` within 0.004 of
 *     its destination AND the distance within 0.004 of its target. At unit length 0.004 scene units
 *     is 0.004 rad, i.e. 0.229°, which is the angular tolerance the spherical ease reuses. Reusing
 *     the NUMBER rather than converting it keeps a reader from having to trust a conversion.
 */

/** Base of the orbit-target exponential damp. τ = 0.1086 s. */
export const FLY_TARGET_EASE_BASE = 0.0001;

/** Base of the distance exponential damp. τ = 0.1698 s. */
export const FLY_DISTANCE_EASE_BASE = 0.0006;

/** Convergence epsilon for the fly-to, in scene units (radians at unit length). */
export const ARRIVE_EPSILON_R = 0.004;

/** `1 - base^dt` — the frame-rate-independent damp factor the fly-to uses. */
export function easeFactor(base: number, dtS: number): number {
  return 1 - Math.pow(base, dtS);
}
