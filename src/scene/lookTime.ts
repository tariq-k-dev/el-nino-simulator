/**
 * The one rule for "what time is it" in a shader uniform.
 *
 * ## Why this exists
 *
 * Two scene components write `uTime` from R3F's clock:
 *
 *   Globe.tsx:224    atmosphere breathe   `u.uTime.value = t`            (unconditional)
 *   Hotspot.tsx:58   pin ring pulse       `uTime.value = elapsedTime`    (unconditional)
 *
 * `Starfield.tsx:109` already did the right thing — `look.animate ? elapsedTime : 0` — but the
 * other two did not, so with the scene clock frozen (`animate: false`, which is what
 * `__look.setAzimuth` sets for every pixel spec) two effects kept moving. Measured: two captures
 * of the same pinned pose differed by up to 3.0 luma in 13608 px, monotonically growing across a
 * sequence of captures, and removing the atmosphere and the pins dropped that to zero.
 *
 * ## The frozen value is a CONSTANT, not "the last clock value"
 *
 * Freezing at wherever the clock happened to be is the failure mode `Starfield.tsx:101-108`
 * documents: `elapsedTime` accumulates from frame deltas, so two page loads reach their first
 * screenshot at different times and render different frames. A baseline has to be independent of
 * the load, which means the frozen value is a constant. It is `0`, because that is the value the
 * frozen starfield already uses — one constant for the whole frozen scene, so nobody has to
 * remember which effect froze at what.
 *
 * ## What `animate: true` does
 *
 * Returns `elapsed` unchanged — the same number that was written before this helper existed. The
 * live product is therefore byte-identical: `look.animate` is `true` in every non-E2E build,
 * because the only writer that sets it false is `__look.setAzimuth`, which is itself behind a
 * compile-time `VITE_E2E` gate plus `?debug` (see GlobeScene.tsx:234 / :423).
 */

/** The frozen value every time-driven effect uses when `animate` is false. */
export const FROZEN_LOOK_TIME = 0;

/**
 * The time to hand a shader uniform.
 *
 * @param animate  `look.animate` — false only under the E2E hooks
 * @param elapsed  the renderer clock's `elapsedTime`, in seconds
 */
export function lookTime(animate: boolean, elapsed: number): number {
  return animate ? elapsed : FROZEN_LOOK_TIME;
}
