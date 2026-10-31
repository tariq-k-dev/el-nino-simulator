/**
 * Framing MODE and the shared constants the rig needs — the small module between the pure
 * arithmetic (`frame.ts`) and the component that drives the camera (`scene/FrameRig.tsx`).
 *
 * ## Two modes, and why the locked one exists
 *
 * The legacy specs (`look`, `negative`, `ref`, the five `globe` zoom cases) do not describe a
 * framing, they describe a look. They compare pixels at strict 0 and assert named distances from a
 * committed baseline, so the moment a step starts moving the camera or the frustum they would all
 * be measuring a different picture — and editing them to suit would destroy the only evidence that
 * the look is unchanged. So the framing is **opt-in** in the E2E build:
 *
 * | build | URL | mode | camera |
 * |---|---|---|---|
 * | production | anything | **live** | offset + fit |
 * | `VITE_E2E=1` | no `framing` | **locked** | untouched — byte-identical to pre-3A2 |
 * | `VITE_E2E=1` | `?framing=live` | **live** | offset + fit |
 *
 * ## Why the guard is a single `import.meta.env` expression
 *
 * Production must never carry the locked branch: there is no mode to choose at runtime when the
 * only branch that ships is `live`. Both the mode resolution and the branch itself are therefore
 * gated on `import.meta.env.VITE_E2E === '1'` and nothing else — Vite substitutes the literal
 * `undefined`, the comparison folds to `false`, and Rollup/esbuild drop the rest as dead code.
 * `scripts/check-assets.mjs` proves it from the other side by grepping the production bundle for
 * `LOCKED_BRANCH_MARKER`, which is the one string that exists only in the locked branch.
 */

import * as THREE from 'three';
import { EARTH_RADIUS } from '@/scene/constants';
import { GLOBE_LOOK } from '@/scene/globeLook';
import { getInsets } from './useInsets';
import { computeFrame, type Frame } from './frame';

/** `'live'` frames the globe in the free rectangle; `'locked'` writes nothing at all. */
export type FramingMode = 'live' | 'locked';

/**
 * A string that exists ONLY in the locked branch.
 *
 * Not a log line and not a comment: minification strips comments and would make the bundle check
 * vacuous. It is returned by `resolveFramingMode`'s locked path (as `LOCKED_BRANCH_MARKER`'s only
 * use) so that `grep` on `dist/assets/*.js` is evidence about emitted code.
 */
export const LOCKED_BRANCH_MARKER = 'frame-locked-branch-7f3a';

/** The camera's vertical field of view, degrees (`GlobeScene.tsx:220`). */
export const FOV_DEG = 42;

/**
 * The shipped camera distance — **read** from the canonical position, never retyped.
 *
 * `DEFAULT_POSITION` lives at `src/scene/CameraRig.tsx:17` (not exported from there), so this
 * reconstructs the vector from the same three numbers and takes its length, which is the
 * operation that produced 3.3533565 in `docs/STEP3-FRAME.md` §1. A hardcoded 3.3534 would be a
 * fifth decimal away from the real value and would make the "distance equals d0 exactly" assertion
 * in F1 a lie about a number nobody set.
 */
export const CAMERA_START = { x: 0, y: 1.15, z: 3.15 } as const;
export const D0 = new THREE.Vector3(CAMERA_START.x, CAMERA_START.y, CAMERA_START.z).length();

/** `<OrbitControls maxDistance>`: the same expression the JSX uses (`GlobeScene.tsx:678`). */
export const MAX_DISTANCE = EARTH_RADIUS * 5;

/**
 * The radius of the sphere the fit frames: the pin core envelope.
 *
 * `anchorRadius (1.012) * idleLift (1.035) + coreOffset (0.055) = 1.10242 R` — composed from
 * `GLOBE_LOOK` exactly as `GlobeScene.tsx:297-299` composes it, so a pin moved in the tuning table
 * moves the framing with it instead of leaving the disc sized for a pin that no longer exists.
 */
export const PIN_ENVELOPE =
  GLOBE_LOOK.pins.anchorRadius * GLOBE_LOOK.pins.idleLift + GLOBE_LOOK.pins.coreOffset;

/** Time constant of the framing ease, seconds (frame-rate independent exponential). */
export const FRAME_TIME_CONSTANT_S = 0.18;

/**
 * Resolve the framing mode. Pure, so the table above is a unit test rather than a comment.
 *
 * `isE2E` is passed in rather than read here so the decision can be tested in both directions; the
 * module-level `FRAMING_MODE` below is the only production caller and passes the folded literal.
 */
export function resolveFramingMode(search: string, isE2E: boolean): FramingMode {
  if (!isE2E) return 'live';
  return new URLSearchParams(search).get('framing') === 'live' ? 'live' : 'locked';
}

/**
 * The mode this page runs in, decided once at module load.
 *
 * Read `framing=live` from a query string; anything else (including a typo) is locked in an E2E
 * build. Failing closed is deliberate: a spec that forgets the parameter measures the shipped look
 * and says so, rather than silently measuring the new framing and blaming the look.
 */
export const FRAMING_MODE: FramingMode =
  import.meta.env.VITE_E2E === '1'
    ? resolveFramingMode(typeof location === 'undefined' ? '' : location.search, true)
    : ('live' as const);

/** Is this page allowed to move the camera? */
export const IS_LIVE = FRAMING_MODE === 'live';

/**
 * Is the framing switched off?
 *
 * `import.meta.env.VITE_E2E` is tested FIRST and at the top level, so a production build folds the
 * whole expression to `false` and the locked branch (its marker string included) is dropped with
 * it. `FRAMING_MODE` is 'live' in production anyway, so this is belt and braces for the one thing
 * that must never ship: a code path that exists only for tests.
 */
export const IS_LOCKED = import.meta.env.VITE_E2E === '1' && FRAMING_MODE !== 'live';

/** Offsets smaller than this are not worth touching the projection matrix for, in CSS px. */
export const OFFSET_EPSILON_PX = 0.01;

/**
 * How close the live distance must be to the last distance the rig wrote for the fit to consider
 * the camera "not moved by the user". 0.002 scene units is ~0.06 % of d0 — far below one wheel
 * notch (which moves it by ~0.01 at this distance) and far above float noise from
 * `OrbitControls.update()` re-deriving the position each frame.
 */
export const LAST_FIT_EPSILON = 0.002;

/** What `window.__frame` reports. Every field is something a spec can assert on. */
export interface FrameProbeState {
  mode: FramingMode;
  insets: { top: number; right: number; bottom: number; left: number };
  free: { x: number; y: number; w: number; h: number };
  /** Where the rig wants the camera: offset in px, distance in scene units. */
  target: { dx: number; dy: number; d: number };
  /** What the camera has NOW — the eased values, not the target. */
  current: { dx: number; dy: number; d: number };
  /** True when `current` is within 0.05 px and 0.0005 of `target`. */
  settled: boolean;
  degenerate: boolean;
  /** True when `camera.view` is null, i.e. no view offset is installed. */
  cameraViewIsNull: boolean;
}

/** The mutable slot `FrameRig` writes into, so `__frame` can read the last rendered frame. */
export interface FrameProbeSink {
  state: FrameProbeState;
}

/**
 * Compute the frame for one viewport, reading the live insets store.
 *
 * The single place the three measured constants (`D0`, `MAX_DISTANCE`, `PIN_ENVELOPE`) are supplied,
 * so the rig and any probe that wants to print the target cannot disagree about the inputs.
 */
export function frameNow(viewport: { w: number; h: number }, fovDeg: number = FOV_DEG): Frame {
  return computeFrame({
    viewport,
    insets: getInsets(),
    fovDeg,
    d0: D0,
    dMax: MAX_DISTANCE,
    re: PIN_ENVELOPE,
  });
}
