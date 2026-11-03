/**
 * `CameraDirector` — the ONLY module that writes the camera after mount.
 *
 * ## What this replaces, and what it must not change
 *
 * Before 3B there were six camera writers (`docs/STEP3B-DESIGN.md` §2). Two of them were React
 * components with their own `useFrame` (`CameraRig`, `FrameRig`), and the rest were configuration
 * (the Canvas prop, the OrbitControls bounds) or the E2E hook (`__globe.setCamera` /
 * `__look.setAzimuth`). This file absorbs the two components and the hook, and keeps the other two as
 * the allowlist's declared exceptions.
 *
 * The step is BEHAVIOR-PRESERVING, so the merge is deliberately not a rewrite. The old code ran two
 * `useFrame` callbacks in mount order on every frame:
 *
 *     1. `CameraRig`  — damp `controls.target`, ease the distance-from-target, `controls.update()`
 *     2. `FrameRig`   — install the view offset, then (if the fit owns the distance) ease that and
 *                       `controls.update()` again
 *
 * This file runs exactly those two bodies, in exactly that order, inside ONE `useFrame`. The ordering
 * is load-bearing: the fit must read the camera AFTER the fly-to has moved it, and a frame that ran
 * them the other way would compute `currentDistance` from a stale pose.
 *
 * ## Why one `useFrame` and one priority
 *
 * Two writers on the same frame cannot be reasoned about: whichever ran second won, and which one that
 * was depended on React's mount order. One callback makes the sequence a fact in the source rather
 * than a consequence of the tree, and it is what lets `userZoomed` be a single piece of state instead
 * of two flags that could disagree.
 *
 * ## `userZoomed`, and why a fly-to sets it too
 *
 * The prompt defines the flag from OrbitControls events: a `start`, or a `change` raised outside this
 * module's own writes, with a distance change above 0.002. That is the USER half, and it is
 * implemented verbatim below.
 *
 * But `userZoomed` is the replacement for `FrameRig`'s `lastFit` rule, and `lastFit` was invalidated
 * by ANY distance writer, not only the user:
 *
 *     const userHasMoved = Math.abs(currentDistance - lastFit.current) >= LAST_FIT_EPSILON;
 *
 * A fly-to moved the distance, so `lastFit` went stale and the fit never re-took the distance again —
 * which is exactly what `docs/STEP3B-DESIGN.md` §3 measured after a close (d ≈ 3.35, not the fit's
 * 3.7784). If this file set `userZoomed` only from user input, then after a region was closed the fit
 * WOULD re-take the distance and ease 3.3534 → 3.7784, which is a visible zoom-out that does not
 * happen today. So the flag also latches when a non-fit writer (the fly-to, `setPose`) changes the
 * distance by more than the epsilon.
 *
 * Read strictly, `userZoomed` therefore means **"the fit must not write the distance"**. That is
 * precisely what `lastFit` meant, generalised to one boolean, and it is stated here and in the
 * `STEP3B-DESIGN.md` "as built" section rather than left for a reader to infer.
 *
 * It gates the DISTANCE ONLY. The view offset is layout (`FrameRig.tsx:19-22`) and always follows the
 * insets — a wheel event must never un-centre the globe.
 *
 * ## Step 3B2 reverses that latch in LIVE mode (deviation 2 of 3B is reversed)
 *
 * The paragraph above describes step 3B, when the live fly-to damped the DISTANCE to the pin's own
 * `zoom`. The live fly-to no longer writes the distance at all: it orbits the camera to face the pin
 * and leaves the orbit radius alone. So nothing but the user can invalidate the fit in live mode, and
 * `userZoomed` is set ONLY by OrbitControls input (`start`/`change`, a distance change > 0.002 outside
 * this module's own writes). No `USER_ZOOM` is dispatched from `setPose` and none from the fly-to.
 *
 * The latch is KEPT, verbatim, inside the LOCKED branch below, because the legacy aim-at-pin fly-to
 * still moves the distance and `globe.spec.ts`'s "zoom still works after a region fly-to" depends on
 * the same `lastFit` behaviour. That is why the two policies are separate bodies rather than one body
 * with a mode flag: the locked one has to keep arithmetic and side effects this step must not touch.
 *
 * ## The two policies
 *
 * | mode | fly-to writes | on arrival |
 * |---|---|---|
 * | `locked` (E2E build, no `framing=live`) | `controls.target` → the pin, distance → the pin's `zoom` | pose within 0.004 R in both |
 * | `live` (production, and `?framing=live`) | the DIRECTION only: camera orbits to the pin's normal side, `controls.target` stays the origin, the radius is untouched | angular error < 0.004 rad, then the exact direction is written |
 *
 * The live arrival SNAPS the last 0.004 rad onto the target direction instead of leaving it there.
 * Without the snap the machine would stop animating with the camera up to 0.229 deg (about 4.7 px at
 * 1440x900) short of the pin, and the acceptance oracle — "the projected pin core is within 0.75 px of
 * the free-rect centre" — would measure that residual as a defect. The snap is the same device the fit
 * already uses for the distance (`|wanted - eased| < 1e-5` -> `wanted`).
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { RegionId } from '@/types/enso';
import { NINO_BOXES, REGION_MAP, latLonToVector3 } from '@/lib/regions';
import { boxCentreLon360, freeRectFraction, ninoFlyToDistance } from '@/lib/ninoFraming';
import { GLOBE_LOOK } from '@/scene/globeLook';
import {
  ARRIVE_EPSILON_R,
  FLY_DISTANCE_EASE_BASE,
  FLY_TARGET_EASE_BASE,
  easeFactor,
} from '@/camera/easing';
import { arcStep, facingPose, isArrived, type Vec3 } from '@/camera/facing';
import {
  getLayoutSignal,
  getResetRequest,
  getViewState,
  publishViewState,
  startLayoutObserver,
  subscribeResetRequest,
} from '@/scene/viewStore';
import type { SpinState } from '@/scene/EarthSystem';
import {
  D0,
  FRAME_TIME_CONSTANT_S,
  FOV_DEG,
  IS_LOCKED,
  LAST_FIT_EPSILON,
  LOCKED_BRANCH_MARKER,
  MAX_DISTANCE,
  OFFSET_EPSILON_PX,
  PIN_ENVELOPE,
  type FrameProbeSink,
} from '@/layout/framing';
import { computeFrame } from '@/layout/frame';
import { getInsets } from '@/layout/useInsets';
import {
  initialFocus,
  isTravelling,
  step as stepFocus,
  type FocusEvent,
  type FocusSnapshot,
  type FocusState,
} from '@/scene/focusMachine';
import { registerCameraIntents, type CameraPose } from '@/scene/cameraIntents';
import { asMobileFrame, computeMobileFit, type MobileFrame } from '@/mobile/mobileFrame';
import type { LayoutMode2 } from '@/mobile/layoutMath';

/** The shipped start position; the same constants the `<Canvas camera>` prop uses. */
const DEFAULT_POSITION = new THREE.Vector3(0, 1.15, 3.15);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);

/** World-space direction of a lat/lon after the earth group's Y rotation. */
function regionDirection(id: RegionId, spinY: number): THREE.Vector3 {
  const region = REGION_MAP[id];
  const [x, y, z] = latLonToVector3(region.lat, region.lon, 1);
  return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), spinY);
}

/**
 * The locked branch. Unchanged in purpose from `FrameRig.tsx:73-76`: a function with an OBSERVABLE side
 * effect, so that its survival in a bundle is a fact about emitted code rather than about a comment.
 */
function noteLocked(): void {
  (window as unknown as Record<string, unknown>).__frameLocked = LOCKED_BRANCH_MARKER;
}

/**
 * The locked FLY-TO's own marker — a string that exists only in the aim-at-pin branch.
 *
 * Distinct from `LOCKED_BRANCH_MARKER` (`'frame-locked-branch-7f3a'`) because they certify different
 * things: that one says the whole locked FRAMING survives, this one says the legacy aim-at-pin
 * arithmetic does. Both are called from inside `if (IS_LOCKED)` blocks, which `import.meta.env` folds to
 * `false` in production, so `scripts/check-assets.mjs` can prove from the bundle that neither ships.
 *
 * Placement note: this is called from the travelling half of the locked policy, so a locked page that
 * never starts a fly-to does not set it at runtime. The proof is about EMITTED CODE (`grep` on
 * `dist-e2e/assets/*.js`), which does not depend on it ever running.
 */
const FOCUS_POLICY_LOCKED_MARKER = 'focus-policy-locked-3b2-a41';

function noteLockedPolicy(): void {
  (window as unknown as Record<string, unknown>).__frameLockedPolicy = FOCUS_POLICY_LOCKED_MARKER;
}

/** The default camera DIRECTION (unit), derived from the shipped position rather than retyped. */
const DEFAULT_DIRECTION: THREE.Vector3 = DEFAULT_POSITION.clone().normalize();

/*
 * Scratch vectors: `useFrame` runs 60 times a second and this module already allocates a `Vector3` per
 * frame for the offset. The policy code below must not add another per frame, so it works in place.
 */
const SCRATCH_OFFSET = new THREE.Vector3();
const SCRATCH_DIR = new THREE.Vector3();

/** `viewIsDefault` tolerances: direction within 0.5 deg of the default, distance within 0.002. */
const VIEW_DEFAULT_ANGLE_DEG = 0.5;
const VIEW_DEFAULT_DISTANCE = 0.002;

/** The refs and helpers either policy needs. Passed explicitly so both policies stay module-level. */
interface PolicyContext {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControlsImpl;
  stepDt: number;
  state: FocusState;
  spin: MutableRefObject<SpinState>;
  targetRegion: MutableRefObject<RegionId | null>;
  desiredTarget: MutableRefObject<THREE.Vector3>;
  desiredDistance: MutableRefObject<number>;
  lastFit: MutableRefObject<number | null>;
  /**
   * The Niño box flight target (step 2.3c-1, C2). `null` when no box flight is in progress.
   *
   * Kept separate from `targetRegion` because a box is not a `RegionId`: it has no drawer, no
   * metrics row and no accent, and reusing the region channel would make the region drawer think a
   * box was selected. The aim point and distance are resolved once, when the flight starts, so a
   * mid-flight aspect change cannot retarget an in-progress tween.
   */
  ninoFlight: MutableRefObject<{ direction: THREE.Vector3; distance: number } | null>;
  withOwnWrite: (fn: () => void) => void;
  dispatch: (event: FocusEvent) => void;
}

/**
 * The LOCKED focus policy — the legacy aim-at-pin fly-to, moved here from the frame body.
 *
 * The arithmetic is unchanged: same two eases (now read from `camera/easing.ts`, same values), same
 * `withOwnWrite` guard, same `lastFit` latch that dispatches `USER_ZOOM` when a non-fit writer moved the
 * distance, same 0.004 convergence in target distance AND distance error. This is what makes S3 a real
 * check rather than a restatement: the locked golden entries were captured against this code.
 *
 * Only reachable when `IS_LOCKED`, which folds to `false` in a production build, so the whole function
 * — and `FOCUS_POLICY_LOCKED_MARKER` with it — is removed from the shipped bundle.
 */
function runLockedFlyTo(ctx: PolicyContext): void {
  noteLockedPolicy();

  const { camera, controls, stepDt, state, spin, targetRegion, withOwnWrite, dispatch } = ctx;

  const region = targetRegion.current;
  if (region) {
    const want = REGION_MAP[region];
    ctx.desiredTarget.current.copy(regionDirection(region, spin.current.y));
    ctx.desiredDistance.current = want.zoom;
  } else {
    ctx.desiredTarget.current.copy(DEFAULT_TARGET);
    ctx.desiredDistance.current = DEFAULT_POSITION.length();
  }

  const targetEase = easeFactor(FLY_TARGET_EASE_BASE, stepDt);
  const distanceEase = easeFactor(FLY_DISTANCE_EASE_BASE, stepDt);
  const wanted = ctx.desiredDistance.current;

  withOwnWrite(() => {
    /* Damp the orbit target. */
    controls.target.lerp(ctx.desiredTarget.current, targetEase);

    /*
     * Ease distance-from-target while preserving the viewing direction, clamped into the controls' own
     * limits so a fly-to can never park the camera outside the range the user may then zoom within.
     */
    const offset = camera.position.clone().sub(controls.target);
    const currentDistance = offset.length();
    if (currentDistance > 1e-6) {
      const clamped = THREE.MathUtils.clamp(wanted, controls.minDistance, controls.maxDistance);
      const nextDistance = THREE.MathUtils.lerp(currentDistance, clamped, distanceEase);
      camera.position.copy(controls.target).add(offset.setLength(nextDistance));
    }

    /* update() derives the quaternion from target+offset and clamps the polar angle. */
    controls.update();
  });

  /* A fly-to IS a distance writer that is not the fit — see the header. */
  if (ctx.lastFit.current !== null) {
    const d = camera.position.distanceTo(controls.target);
    if (Math.abs(d - ctx.lastFit.current) > LAST_FIT_EPSILON) dispatch({ type: 'USER_ZOOM' });
  }

  const targetSettled = controls.target.distanceTo(ctx.desiredTarget.current) < ARRIVE_EPSILON_R;
  const distanceSettled =
    Math.abs(camera.position.distanceTo(controls.target) - wanted) < ARRIVE_EPSILON_R;
  if (targetSettled && distanceSettled) {
    dispatch(state === 'returning' ? { type: 'RETURNED' } : { type: 'ARRIVED' });
  }
}

/**
 * The NIÑO BOX fly-to (step 2.3c-1, C2.3) — the existing tween, aimed at a box instead of a region.
 *
 * Reuses exactly the live policy's machinery: `arcStep` for the great-circle tween and `isArrived`
 * for the same convergence epsilon. What is different is where the destination comes from —
 * `ninoFlight`, resolved once at button-press time from `ninoFraming` — and that the distance is
 * eased toward the box's fitted distance rather than held constant.
 *
 * ## The dateline, and why nothing here interpolates longitude
 *
 * A flight cannot take the wrong way round the globe, structurally: `arcStep` interpolates between
 * two UNIT VECTORS on the shortest great circle, with the step size proportional to `acos(from·to)`,
 * which is by definition ≤ 180°. The 3D direction for lon 185 (Niño 4's centre) and for lon -150
 * (the pacific pin) are 25° apart, so the tween covers 25° — there is no scalar longitude anywhere
 * for a `+335°` long-way bug to live in. `ninoFraming.shortestLonDelta` exists to make that claim
 * TESTABLE at the longitude level (and is used by the tests for the two flights the step names);
 * the flight itself is correct by construction rather than by getting the sign right.
 *
 * ## Distance
 *
 * Eased with the same `FLY_DISTANCE_EASE_BASE` the locked policy uses and clamped into the controls'
 * own range, so a fly-to can never park the camera outside `[minDistance, maxDistance]` and the
 * pinch/wheel that follows stays in range by construction. minDistance is NOT touched here.
 */
function runNinoFlyTo(ctx: PolicyContext): void {
  const { camera, controls, stepDt, ninoFlight, withOwnWrite, dispatch } = ctx;

  const flight = ninoFlight.current;
  if (!flight) {
    /* No target: hand the camera back rather than tweening toward nothing. */
    withOwnWrite(() => controls.update());
    return;
  }

  const wanted = facingPose({
    pinDir: [flight.direction.x, flight.direction.y, flight.direction.z],
    distance: flight.distance,
    polarMin: controls.minPolarAngle,
    polarMax: controls.maxPolarAngle,
  }).direction;

  const from = orbitDirection(camera, controls);
  const arrived = isArrived(from, wanted);
  const next = arrived ? wanted : arcStep({ from, to: wanted, dtS: stepDt });

  /* Ease the radius toward the fitted distance while the direction tweens, clamped by the controls. */
  const currentDistance = orbitDistance(camera, controls);
  const distanceEase = easeFactor(FLY_DISTANCE_EASE_BASE, stepDt);
  const clampedWanted = THREE.MathUtils.clamp(
    flight.distance,
    controls.minDistance,
    controls.maxDistance,
  );
  const nextDistance = THREE.MathUtils.lerp(currentDistance, clampedWanted, distanceEase);

  withOwnWrite(() => {
    camera.position
      .copy(controls.target)
      .add(SCRATCH_DIR.set(next[0], next[1], next[2]).multiplyScalar(nextDistance));
    controls.update();
  });

  /*
   * A box flight IS a distance writer that is not the fit, exactly like the locked fly-to above.
   *
   * Without this latch the frame rig's distance channel still owns the radius and eases it back to the
   * fit on the very next frame, so the flight's radius is overwritten mid-tween and the camera lands at
   * `frame.dTarget` instead of the box's fitted distance. The measured symptom is a "settled" distance
   * that is neither the requested value nor inside `[minDistance, maxDistance]` in a way the controls
   * would allow — 5.813 against a ceiling of 5 at 390x844 portrait.
   *
   * `withOwnWrite` suppresses the controls' own `change` listener while this module writes, so the
   * latch has to be dispatched here rather than relying on the listener to notice.
   */
  if (ctx.lastFit.current !== null) {
    const d = camera.position.distanceTo(controls.target);
    if (Math.abs(d - ctx.lastFit.current) > LAST_FIT_EPSILON) dispatch({ type: 'USER_ZOOM' });
  }

  /*
   * Clear the flight on arrival. The selection itself (`activeBoxId`) lives in React state and the
   * outline highlight is driven from there, so this only stops the tween; the camera then falls back
   * to the "not travelling" branch where the controls own it.
   */
  if (arrived && Math.abs(nextDistance - clampedWanted) < ARRIVE_EPSILON_R) {
    ninoFlight.current = null;
    ctx.dispatch({ type: 'ARRIVED' });
  }
}

/** The camera's unit direction from the orbit target. Zero-safe: never returns a zero vector. */
function orbitDirection(camera: THREE.PerspectiveCamera, controls: OrbitControlsImpl): Vec3 {
  const v = SCRATCH_OFFSET.copy(camera.position).sub(controls.target);
  if (v.lengthSq() < 1e-18) return [DEFAULT_DIRECTION.x, DEFAULT_DIRECTION.y, DEFAULT_DIRECTION.z];
  v.normalize();
  return [v.x, v.y, v.z];
}

/** The distance from the orbit target. */
function orbitDistance(camera: THREE.PerspectiveCamera, controls: OrbitControlsImpl): number {
  return camera.position.distanceTo(controls.target);
}

/**
 * The LIVE focus policy — orbit the camera to FACE the pin, at a distance it does not touch.
 *
 * Three properties, all structural rather than asserted:
 *
 *   - `controls.target` is never written, so it stays at the origin and the globe stays centred on the
 *     free rect (the whole point of replacing aim-at-pin, which overflowed it by up to +462 px).
 *   - the radius is read once and re-applied, so the distance is constant through the arc and cannot
 *     dip toward the globe (AM2/S8). Any change to it comes from the fit's own channel, not from here.
 *   - the aim is a great-circle arc from the camera's CURRENT direction, so a retarget continues from
 *     where the camera is instead of jumping back to the flight's start.
 */
function runLiveFlyTo(ctx: PolicyContext): void {
  const { camera, controls, stepDt, state, spin, targetRegion, withOwnWrite, dispatch } = ctx;

  /*
   * Where the camera must point. `facingPose` owns the polar clamp, so the director never compares
   * angles itself; the limits are read off the controls rather than restated (they are the OrbitControls
   * defaults today, but a pin near a pole must not silently mis-frame if that ever changes).
   */
  let wanted: Vec3;
  if (state === 'returning') {
    wanted = [DEFAULT_DIRECTION.x, DEFAULT_DIRECTION.y, DEFAULT_DIRECTION.z];
  } else {
    const region = targetRegion.current;
    if (region === null) {
      /* `focusing` with no region is unreachable (the machine names one); fall back to the default. */
      wanted = [DEFAULT_DIRECTION.x, DEFAULT_DIRECTION.y, DEFAULT_DIRECTION.z];
    } else {
      const pin = regionDirection(region, spin.current.y);
      wanted = facingPose({
        pinDir: [pin.x, pin.y, pin.z],
        distance: orbitDistance(camera, controls),
        polarMin: controls.minPolarAngle,
        polarMax: controls.maxPolarAngle,
      }).direction;
    }
  }

  const from = orbitDirection(camera, controls);
  const arrived = isArrived(from, wanted);
  const next = arrived ? wanted : arcStep({ from, to: wanted, dtS: stepDt });

  /*
   * The RADIUS is captured before the write and re-applied after it. `controls.update()` is allowed to
   * clamp the polar angle, which changes the direction but must not change the distance.
   */
  const radius = orbitDistance(camera, controls);

  withOwnWrite(() => {
    camera.position
      .copy(controls.target)
      .add(SCRATCH_DIR.set(next[0], next[1], next[2]).multiplyScalar(radius));
    controls.update();
  });

  if (arrived) dispatch(state === 'returning' ? { type: 'RETURNED' } : { type: 'ARRIVED' });
}

/** Angular error between two directions, degrees — for `viewIsDefault`. */
function angleDegBetween(a: Vec3, b: THREE.Vector3): number {
  const d = a[0] * b.x + a[1] * b.y + a[2] * b.z;
  const clamped = d > 1 ? 1 : d < -1 ? -1 : d;
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * The MOBILE view-offset applier — idempotent, keyed on `(mode, W, H)`.
 *
 * ## The sign, as measured
 *
 * `.cache/mob/probe-offset.mjs` builds a real `PerspectiveCamera(42, 390/844, 0.1, 400)` at the shipped
 * position, sets the offset, and projects the world origin:
 *
 *     no offset                  y = 422.000   (error 189.900 from the wanted 232.100)
 *     setViewOffset(…, -189.90)  y = 611.900   (error 379.800 — wrong direction, and by 2x)
 *     setViewOffset(…, +189.90)  y = 232.100   (error 0.000)   <- this one
 *     clearViewOffset            y = 422.000
 *
 * So a POSITIVE `offsetY` moves the projected content UP. `mobileFrame.ts` returns `viewOffsetY`; this
 * function applies it with that sign, and the assertion in `mobileFrame.test.ts` re-derives it from a real
 * camera on every gate run rather than trusting this comment.
 *
 * ## Why the sub-window is the FULL size
 *
 * `setViewOffset(W, H, 0, dy, W, H)`: the sub-window keeps the full width and height, so three's
 * `updateProjectionMatrix` shifts the principal point without rescaling the frustum. A smaller sub-window
 * would also change the zoom, which would make the fit's `d_fit` wrong by the ratio of the two heights.
 *
 * ## Why it is re-applied on every resize
 *
 * R3F rewrites `camera.aspect` from the canvas size and calls `updateProjectionMatrix()` itself on a resize,
 * which PRESERVES `camera.view` but recomputes the matrix from the OLD view parameters — so the offset is
 * still there and the matrix is still right for the new size only after a second `updateProjectionMatrix()`.
 * Re-applying on a size change covers both, and it is cheap because `setViewOffset` is a handful of float
 * writes.
 *
 * ## When it is cleared
 *
 * On leaving mobile mode, and only then. `clearViewOffset()` restores `camera.view = null`, which is the
 * desktop state every existing spec asserts (`cameraViewIsNull`), so a resize across the breakpoint in either
 * direction returns the camera to a state the 3A/3B proofs describe.
 */
interface MobileOffsetState {
  /** The mode and size the offset was last applied for, and the rect size it was fitted to. */
  mode: LayoutMode2 | null;
  w: number;
  h: number;
  /** The header bottom and the dock width the fit was computed from, so a re-fit happens when either moves. */
  headerBottom: number;
}

/**
 * Publish the mode's ceiling to `controls.maxDistance`, once per change.
 *
 * ## Why the director is the one writer
 *
 * `singleWriter.test.ts` bans `.maxDistance =` outside this file, and `GlobeScene.tsx`'s JSX prop sets the initial
 * value at mount. This function is the runtime half of that rule: it is called from the frame, compares against
 * what it last wrote, and writes only on a change — so an ordinary desktop frame is one float comparison and
 * nothing else, which is what keeps the desktop proofs untouched.
 *
 * ## Desktop writes 5, always
 *
 * Not "writes nothing": a page that was a phone and is now a desktop must have its ceiling RESTORED, or the user
 * could zoom out to a mobile `dMax` on a desktop viewport. Writing the same constant the JSX prop already holds is
 * a no-op in effect and is the state the desktop specs describe.
 */
function applyMaxDistance(
  controls: OrbitControlsImpl,
  written: { current: number | null },
  wanted: number,
): void {
  if (written.current !== null && Math.abs(written.current - wanted) < 1e-9) return;
  controls.maxDistance = wanted;
  written.current = wanted;
}

function applyMobileOffset(
  camera: THREE.PerspectiveCamera,
  state: MobileOffsetState,
  mode: LayoutMode2,
  w: number,
  h: number,
  headerBottom: number,
  compute: () => MobileFrame,
): MobileFrame | null {
  if (state.mode === mode && state.w === w && state.h === h && state.headerBottom === headerBottom) return null;
  state.mode = mode;
  state.w = w;
  state.h = h;
  state.headerBottom = headerBottom;

  if (mode === 'desktop') {
    /*
     * Leaving mobile: put the camera back to the null-view state the desktop proofs describe.
     *
     * `clearViewOffset()` also calls `updateProjectionMatrix()` itself, but the call is written out rather
     * than relied on: `clearViewOffset` doing it is an implementation detail of three r169, and a version
     * that stopped would leave the desktop matrix still shifted with `camera.view === null` — i.e. every
     * desktop spec's `cameraViewIsNull` check would pass while the picture stayed wrong.
     */
    if (camera.view !== null) {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    return null;
  }

  const frame = compute();
  /*
   * The GENERALISED offset: both axes, from the free rect's centre.
   *
   * `setViewOffset(W, H, ox, oy, W, H)` with `ox = W/2 - cx` and `oy = H/2 - cy`. The sub-window keeps the full
   * W x H, so the zoom is unchanged and the disc stays a circle — a lens shift, not a rescale. Both signs were
   * proven by projecting a real camera in `mobileFrame.test.ts`, which is what the prompt's "flip a sign if
   * needed" asks for; the answer was that neither needed flipping.
   */
  camera.setViewOffset(w, h, frame.viewOffsetX, frame.viewOffsetY, w, h);
  /*
   * Explicit, per the step: `setViewOffset` only STORES the parameters and flags the matrix, and the commit
   * is this call. Writing it out also makes the projection write visible to `projectionWriter.test.ts`, which
   * asserts the director contains all three of `setViewOffset`, `clearViewOffset` and this.
   */
  camera.updateProjectionMatrix();
  return frame;
}

/** `prefers-reduced-motion`, resolved once instead of once per frame. */
let reducedMotionQuery: MediaQueryList | null | undefined;
function prefersReducedMotion(): boolean {
  if (reducedMotionQuery === undefined) {
    reducedMotionQuery =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  return reducedMotionQuery?.matches ?? false;
}

interface CameraDirectorProps {
  activeRegion: RegionId | null;
  spin: MutableRefObject<SpinState>;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  /** Bumped to force a re-focus on the same region (e.g. re-click). */
  focusNonce: number;
  /** Receives the per-frame probe state. */
  probe?: MutableRefObject<FrameProbeSink | null>;
}

export function CameraDirector({
  activeRegion,
  spin,
  controlsRef,
  focusNonce,
  probe,
}: CameraDirectorProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);

  /*
   * THE ONE layout-mode listener (step 3-MOBILE1 B).
   *
   * Started here rather than in `App` or `GlobeScene` for one reason: this component is inside `<Canvas>`,
   * so it is guaranteed to be mounted exactly once and exactly as long as the scene exists, and the value it
   * publishes is only ever read by this file's frame loop and by the DOM shell that decides which overlay to
   * render. A second listener anywhere else would be a second source of truth for the same boolean.
   *
   * `startLayoutObserver` is ref-counted and idempotent, so React 18's development double-mount cannot install
   * two, and joining the one `App` already started is one `refs += 1`.
   */
  useEffect(() => startLayoutObserver(), []);

  /* ---------------------------------------------------------------- focus machine */

  const machine = useRef<FocusSnapshot>(initialFocus());
  /** The region the machine is targeting; kept apart from React's prop so a retarget is one event. */
  const targetRegion = useRef<RegionId | null>(null);
  /** True while the fly-to is animating. The machine's `focusing`/`returning` states gate this. */
  const travelling = useRef(false);
  const desiredTarget = useRef(new THREE.Vector3().copy(DEFAULT_TARGET));
  const desiredDistance = useRef(DEFAULT_POSITION.length());

  /* ------------------------------------------------------------------ frame rig state */

  const appliedOffset = useRef({ dx: 0, dy: 0 });
  const easedOffset = useRef({ dx: 0, dy: 0 });
  const appliedSize = useRef({ w: 0, h: 0 });
  const lastFit = useRef<number | null>(null);
  /**
   * The Niño box flight target (C2). Resolved once when the flight starts so a mid-flight aspect
   * change cannot retarget an in-progress tween.
   */
  const ninoFlight = useRef<{ direction: THREE.Vector3; distance: number } | null>(null);
  const hasApplied = useRef(false);
  const rigOwnsDistance = useRef(true);
  const recentDistances = useRef<number[]>([]);

  /**
   * The distance `userZoomed` was last evaluated against, so a `change` event can tell whether the
   * USER moved it. `null` until the first frame has run (there is no distance to compare yet).
   */
  const lastSeenDistance = useRef<number | null>(null);
  /**
   * The mobile offset's idempotency key, and the last frame it produced.
   *
   * Both are refs rather than state: `useFrame` runs 60 times a second and reads/writes them in place, and
   * moving either into React state would re-render the scene subtree on every resize storm. The cache exists
   * so a frame that does NOT cross a mode or size boundary can reuse the previous `MobileFrame` instead of
   * recomputing the fit — the offset only changes when the window does.
   */
  const mobileOffset = useRef<MobileOffsetState>({ mode: null, w: 0, h: 0, headerBottom: 0 });
  /** The `controls.maxDistance` this module last wrote, so it writes only on a change. */
  const maxDistanceWritten = useRef<number | null>(null);
  const mobileCache = useRef<MobileFrame | null>(null);
  /** True while THIS module is writing, so its own `change` events are ignored. */
  const writing = useRef(false);
  /** Last distance this module itself wrote — the "outside the director's own writes" test. */
  const ownDistance = useRef<number | null>(null);

  /** Apply a camera write with the "our own change events are not user input" guard held. */
  const withOwnWrite = (fn: () => void): void => {
    writing.current = true;
    try {
      fn();
    } finally {
      writing.current = false;
    }
  };

  /** Dispatch one machine event and record the resulting context. */
  const dispatch = (event: FocusEvent): void => {
    machine.current = stepFocus(machine.current, event);
  };

  /* ------------------------------------------------------------------- intents */

  /**
   * Register the synchronous pose setter the E2E hook submits through.
   *
   * Synchronous on purpose. `__globe.setCamera` used to write the camera immediately and resolve on
   * the second `requestAnimationFrame`; deferring the write to the next `useFrame` would have moved
   * that second rAF one frame later and put `ref.spec.ts`'s strict-0 comparison at risk. The write
   * still lives in this module — `globeProbe.ts` now only submits.
   */
  useEffect(() => {
    registerCameraIntents({
      setPose: (pose: CameraPose) => {
        withOwnWrite(() => {
          camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
          camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
          camera.updateMatrixWorld(true);
        });
        ownDistance.current = camera.position.distanceTo(
          controlsRef.current?.target ?? new THREE.Vector3(),
        );
        /*
         * NO `USER_ZOOM` HERE — step 3B2 reverses the 3B latch.
         *
         * In 3B a hook-driven pose had to invalidate `lastFit` because the LIVE fly-to wrote the
         * distance and the fit would otherwise re-take it. The live fly-to writes no distance now, so
         * `userZoomed` means exactly "the USER moved the distance" and nothing else. The LOCKED branch
         * keeps its own latch internally (see `runLockedFlyTo`), which is where the behaviour
         * `globe.spec.ts` depends on actually lives.
         */
      },
      /**
       * Resolve a Niño box into a camera target. `null` cancels the flight.
       *
       * Everything that depends on the LIVE viewport is computed here, at press time: the aspect
       * comes from the camera the director already holds, so a portrait phone gets the width-limited
       * distance without the card having to know anything about the renderer. The whole framing
       * decision is `ninoFlyToDistance` — pure, unit-tested, no three.js.
       */
      focusNinoBox: (boxId: string | null) => {
        if (boxId === null) {
          ninoFlight.current = null;
          return;
        }
        const box = NINO_BOXES.find((b) => b.id === boxId);
        if (!box) {
          ninoFlight.current = null;
          return;
        }
        /*
         * `camera.aspect` is maintained by R3F on resize, so this is the same aspect the projection
         * uses. Guarding against 0 keeps a degenerate pre-layout size from producing Infinity.
         */
        const aspect = camera.aspect > 0 ? camera.aspect : 16 / 9;
        /*
         * Fit to the FREE RECT, not the raw viewport. The frame rig parks the aimed point at the free
         * rect's centre, so the free rect is the window the outline has to fit inside — fitting to the
         * viewport let a wide box slide under the 316 px right panel (measured: the Nino 4 outline ran
         * 209 px beneath it at 1280x720). `getInsets()` is the same registry the frame rig reads, and
         * an unmeasured/zero rect degrades to full-viewport framing rather than NaN.
         */
        const insetsNow = getInsets();
        const freeRect = freeRectFraction(
          insetsNow.free,
          window.innerWidth || 0,
          window.innerHeight || 0,
        );
        const distance = ninoFlyToDistance(box, { fovDeg: camera.fov, aspect, freeRect });
        /*
         * Aim at the box centre in 360 space, then convert to a direction. `latLonToVector3` takes a
         * longitude in degrees and is periodic in 360, so lon 185 and lon -175 give the SAME vector:
         * there is no wrap step because the wrap is already implicit in sin/cos.
         */
        const [x, y, z] = latLonToVector3(
          box.anchorLat,
          boxCentreLon360(box),
          GLOBE_LOOK.pins.anchorRadius,
        );
        ninoFlight.current = { direction: new THREE.Vector3(x, y, z), distance };
      },
    });
    return () => registerCameraIntents(null);
  }, [camera, controlsRef]);

  /* -------------------------------------------------- OrbitControls as an input device */

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return undefined;

    const onStart = (): void => {
      /* A drag the user started during a fly-to cancels it; the machine knows the rule. */
      dispatch({ type: 'USER_ORBIT_START' });
    };

    const onChange = (): void => {
      /*
       * Ignore the `change` events THIS module raises by calling `controls.update()` — the controls
       * dispatch one on every internal damping step, and treating those as user input would latch
       * `userZoomed` on the very first frame and switch the fit's distance channel off forever.
       */
      if (writing.current) return;
      const controls2 = controlsRef.current;
      if (!controls2) return;
      const d = camera.position.distanceTo(controls2.target);
      const previous = lastSeenDistance.current;
      lastSeenDistance.current = d;
      if (previous === null) return;
      /*
       * `> LAST_FIT_EPSILON` (0.002), the prompt's threshold. A rotation changes the distance by ~0,
       * a one-notch wheel changes it by ~0.01 at this distance, so the test separates them.
       */
      if (Math.abs(d - previous) > LAST_FIT_EPSILON) dispatch({ type: 'USER_ZOOM' });
    };

    controls.addEventListener('start', onStart);
    controls.addEventListener('change', onChange);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('change', onChange);
    };
  }, [camera, controlsRef]);

  /* ------------------------------------------- selection -> machine (replaces CameraRig's effect) */

  useEffect(() => {
    if (activeRegion) {
      dispatch({ type: 'SELECT', regionId: activeRegion });
      spin.current.paused = true;
      targetRegion.current = activeRegion;
    } else if (machine.current.state !== 'idle') {
      /* Deselecting is the CLOSE rule; `SELECT(null)` is routed there by the machine itself. */
      dispatch({ type: 'SELECT', regionId: null });
      spin.current.paused = false;
      targetRegion.current = null;
    } else {
      /* Never selected: nothing to close, and the spin keeps running. */
      spin.current.paused = false;
    }
    travelling.current = true;
  }, [activeRegion, focusNonce, spin]);

  /* --------------------------------------------------- the Reset View button's channel */

  /**
   * Subscribe to the RESET requests the header's button raises.
   *
   * A counter rather than an event bus: two clicks must be two events, and a subscriber that missed one
   * while unmounted must not replay it. The dispatch is synchronous, so the machine has already moved to
   * `returning` by the time the click handler returns.
   */
  useEffect(() => {
    let seen = getResetRequest();
    return subscribeResetRequest(() => {
      const now = getResetRequest();
      if (now === seen) return;
      seen = now;
      dispatch({ type: 'RESET' });
      /* RESET is the "back to the default view" intent, which is a running-planet intent. */
      spin.current.paused = false;
    });
  }, [spin]);

  /* ------------------------------------------------------------------------ the frame */

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const stepDt = Math.min(delta, 1 / 30);
    const state = machine.current.state;

    /* ============================================================ 1. the focus policy ====
     *
     * Two bodies, chosen by MODE — not by a flag inside one body. The locked one is the legacy
     * aim-at-pin fly-to with its own `lastFit` latch; the live one orbits the camera and writes no
     * distance. Keeping them apart is what lets the locked arithmetic stay byte-identical (S3) while
     * the live policy reverses the 3B distance latch.
     */
    const ctx: PolicyContext = {
      camera,
      controls,
      stepDt,
      state,
      spin,
      targetRegion,
      desiredTarget,
      desiredDistance,
      lastFit,
      ninoFlight,
      withOwnWrite,
      dispatch,
    };

    if (isTravelling(state)) {
      if (IS_LOCKED) {
        runLockedFlyTo(ctx);
      } else {
        runLiveFlyTo(ctx);
      }
    } else if (ninoFlight.current) {
      /*
       * A box flight is active. Checked OUTSIDE `isTravelling` because a box is not a region and does
       * not drive the focus machine: the machine stays `idle` and the controls own the camera during
       * the tween, so the flight has to be its own gate rather than a machine state.
       */
      runNinoFlyTo(ctx);
    } else {
      /*
       * Not travelling: the controls own the camera. `update()` still has to run every frame because
       * that is what applies OrbitControls' own damping to the user's wheel/pinch/rotate input.
       */
      withOwnWrite(() => controls.update());
    }

    /* ============================================================== 2. the frame ====
     *
     * `FrameRig`'s body. In LOCKED mode none of this runs — the component renders no offset, no fit
     * and leaves `camera.view` null, which is what keeps `ref.spec.ts` at strict 0.
     */
    if (IS_LOCKED) {
      noteLocked();
    } else if (getLayoutSignal().mode !== 'desktop') {
      /*
       * ===================================================== 2a. THE MOBILE BRANCH ====
       *
       * A separate branch rather than a conditional inside the desktop body, for the same reason the two focus
       * policies are separate bodies: the desktop arithmetic has to stay byte-identical (S1 residual 0), and the
       * only way to be sure a shared branch did not perturb it is to not share one.
       *
       * Step MOBILE2 replaced MOBILE1's fixed 55 % band with the layout's own free rectangle, and the distance with
       * the unclamped fit:
       *
       *   - the free rect comes from `computeFreeRect` (header bottom, peek clamp, dock width);
       *   - the offset is the GENERALISED two-axis lens shift `W/2 - cx`, `H/2 - cy`;
       *   - `dFit = dContain` (no ceiling clamp) and `controls.maxDistance = max(5, 1.25·dContain)`.
       *
       * Everything else — the fit's distance channel, `userZoomed`, the probe — is the desktop code, moved
       * wholesale rather than reimplemented.
       */
      const w = size.width;
      const h = size.height;
      const signal = getLayoutSignal();
      const mode = signal.mode;

      /* One fit per layout change, reused for both the offset and the distance. */
      const fit = computeMobileFit(mode, w, h, signal.headerBottom);
      const mobile = applyMobileOffset(camera, mobileOffset.current, mode, w, h, signal.headerBottom, () =>
        asMobileFrame(fit, w, h),
      );
      const frame = mobile ?? asMobileFrame(fit, w, h);
      mobileCache.current = frame;

      /*
       * THE CEILING. Written every mobile frame, and cleared back to 5 on the desktop branch below — so a rotation
       * to desktop cannot leave a mobile `maxDistance` behind.
       */
      applyMaxDistance(controls, maxDistanceWritten, fit.dMaxMode);

      const offset = camera.position.clone().sub(controls.target);
      const currentDistance = offset.length();

      if (lastFit.current === null) lastFit.current = currentDistance;
      lastSeenDistance.current = currentDistance;

      const userZoomedMobile = machine.current.context.userZoomed;
      rigOwnsDistance.current = !userZoomedMobile;
      /*
       * A MODE CHANGE re-fits with no animation, and resets the "the user owns the distance" latch.
       *
       * The prompt's rule: on a rotation or resize the director re-fits, keeps the camera DIRECTION and the
       * selected region, and sets the distance to the new dFit if the view was default. `mobile` is non-null
       * exactly when the mode or the size or the header changed, which is the definition of a mode change — and
       * on that frame the fit takes the distance even if the user had zoomed, because a distance chosen for a
       * 390x844 portrait band is meaningless at 844x390.
       */
      const reFit = mobile !== null;
      const frameWantsDistance = !userZoomedMobile || reFit;
      if (frameWantsDistance && Math.abs(frame.dTarget - currentDistance) > 1e-6) {
        const k = reFit || prefersReducedMotion() ? 1 : 1 - Math.exp(-stepDt / FRAME_TIME_CONSTANT_S);
        const wanted = THREE.MathUtils.clamp(frame.dTarget, controls.minDistance, controls.maxDistance);
        const eased = THREE.MathUtils.lerp(currentDistance, wanted, k);
        const nextDistance = Math.abs(wanted - eased) < 1e-5 ? wanted : eased;
        withOwnWrite(() => {
          camera.position.copy(controls.target).add(offset.setLength(nextDistance));
          controls.update();
        });
        lastFit.current = nextDistance;
        lastSeenDistance.current = nextDistance;
      }
      if (reFit) dispatch({ type: 'USER_ZOOM_RESET' });

      {
        const dir = orbitDirection(camera, controls);
        const d = orbitDistance(camera, controls);
        const viewIsDefault =
          state === 'idle' &&
          !userZoomedMobile &&
          angleDegBetween(dir, DEFAULT_DIRECTION) <= VIEW_DEFAULT_ANGLE_DEG &&
          Math.abs(d - frame.dTarget) <= VIEW_DEFAULT_DISTANCE;
        publishViewState({
          viewIsDefault,
          spinning: !spin.current.paused,
          hasRegion: machine.current.context.regionId !== null,
        });
      }

      if (probe) {
        const camDistance = camera.position.distanceTo(controls.target);
        const recent = recentDistances.current;
        recent.push(camDistance);
        if (recent.length > 4) recent.shift();
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of recent) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const spread = recent.length < 4 ? Infinity : hi - lo;
        const distanceQuiet = spread < 2e-4;
        const distanceArrived = Math.abs(frame.dTarget - camDistance) < 0.0005;
        const distanceSettled = rigOwnsDistance.current
          ? distanceArrived && distanceQuiet
          : distanceQuiet;

        probe.current = {
          state: {
            mode: 'live',
            insets: {
              left: frame.free.x,
              right: w - (frame.free.x + frame.free.w),
              top: frame.free.y,
              bottom: h - (frame.free.y + frame.free.h),
            },
            free: { ...frame.free },
            target: { dx: frame.dx, dy: frame.dy, d: frame.dTarget },
            current: { dx: frame.dx, dy: frame.dy, d: camDistance },
            settled: distanceSettled,
            degenerate: frame.degenerate,
            cameraViewIsNull: camera.view === null || camera.view.enabled === false,
            focus: machine.current.state,
            userZoomed: userZoomedMobile,
            regionId: machine.current.context.regionId,
            viewIsDefault: getViewState().viewIsDefault,
            spinning: getViewState().spinning,
            hasRegion: getViewState().hasRegion,
            focusPolicy: 'live',
            layoutMode: mode,
            viewOffsetY: frame.viewOffsetY,
            viewOffsetX: frame.viewOffsetX,
            clampedByMax: frame.clampedByMax,
            dMax: controls.maxDistance,
            dFit: fit.dFit,
            radiusBudget: fit.rect.radiusBudget,
            headerBottom: signal.headerBottom,
          },
        };
      }
    } else {
      const w = size.width;
      const h = size.height;
      const insets = getInsets();

      /*
       * Any frame at desktop size CLEARS a mobile offset this module installed earlier. Idempotent: the
       * applier returns immediately when the mode and size are already desktop's, and it only calls
       * `clearViewOffset` when `camera.view` is actually non-null — so on an ordinary desktop frame this is
       * one comparison and nothing else, which is what keeps `cameraViewIsNull` true and S1 at 0.
       */
      applyMobileOffset(camera, mobileOffset.current, 'desktop', w, h, 0, () => mobileCache.current as MobileFrame);
      mobileCache.current = null;
      /*
       * THE CEILING, restored. A page that was a phone keeps `max(5, 1.25·dContain)` in `controls.maxDistance`
       * until this runs, and leaving it would let a desktop user zoom out past the design ceiling — a desktop
       * behaviour change, which is exactly what this step must not cause. Same constant the JSX prop holds.
       */
      applyMaxDistance(controls, maxDistanceWritten, MAX_DISTANCE);

      const frame = computeFrame({
        viewport: { w, h },
        insets,
        fovDeg: FOV_DEG,
        d0: D0,
        dMax: MAX_DISTANCE,
        re: PIN_ENVELOPE,
      });

      /* ------------------------------------------------------------------ offset */

      const reduced = prefersReducedMotion();
      const first = !hasApplied.current;
      const snap = first || reduced || frame.degenerate;

      let nextDx = frame.dx;
      let nextDy = frame.dy;
      if (!snap) {
        const k = 1 - Math.exp(-stepDt / FRAME_TIME_CONSTANT_S);
        nextDx = easedOffset.current.dx + (frame.dx - easedOffset.current.dx) * k;
        nextDy = easedOffset.current.dy + (frame.dy - easedOffset.current.dy) * k;
        if (Math.abs(frame.dx - nextDx) < OFFSET_EPSILON_PX) nextDx = frame.dx;
        if (Math.abs(frame.dy - nextDy) < OFFSET_EPSILON_PX) nextDy = frame.dy;
      }
      easedOffset.current = { dx: nextDx, dy: nextDy };

      const moved =
        Math.abs(nextDx - appliedOffset.current.dx) > OFFSET_EPSILON_PX ||
        Math.abs(nextDy - appliedOffset.current.dy) > OFFSET_EPSILON_PX;
      const resized = appliedSize.current.w !== w || appliedSize.current.h !== h;

      if (moved || resized || first) {
        /* NEGATIVE offsets: a negative window offset moves the content right/down. */
        camera.setViewOffset(w, h, -nextDx, -nextDy, w, h);
        appliedOffset.current = { dx: nextDx, dy: nextDy };
        appliedSize.current = { w, h };
        hasApplied.current = true;
      }

      /* ---------------------------------------------------------------- distance */
      /*
       * THE FIT'S DISTANCE CHANNEL — AM1.
       *
       * It runs in EVERY state, not only `idle`/`returning`: while `userZoomed` is false it follows
       * `d_fit` of the CURRENT free rect, in both directions, floor `d0` ceiling `dMax`, 180 ms ease,
       * snap on first application. That is exactly what 3A2 shipped, and it is what lets the drawer
       * opening mid-flight zoom the camera OUT to the new containment distance while the arc runs
       * (1440x900: 3.7786 -> 4.3572). It cannot move the DIRECTION, so it cannot disturb the face-pin
       * aim, and the live fly-to never writes the distance, so the two channels never fight.
       *
       * When `userZoomed` is true the fit writes nothing here and containment is not asserted.
       */
      const offset = camera.position.clone().sub(controls.target);
      const currentDistance = offset.length();

      if (lastFit.current === null) lastFit.current = currentDistance;
      lastSeenDistance.current = currentDistance;

      const userZoomed = machine.current.context.userZoomed;
      rigOwnsDistance.current = !userZoomed;
      if (!userZoomed && Math.abs(frame.dTarget - currentDistance) > 1e-6) {
        const k = first || reduced ? 1 : 1 - Math.exp(-stepDt / FRAME_TIME_CONSTANT_S);
        const wanted = THREE.MathUtils.clamp(frame.dTarget, controls.minDistance, controls.maxDistance);
        const eased = THREE.MathUtils.lerp(currentDistance, wanted, k);
        const nextDistance = Math.abs(wanted - eased) < 1e-5 ? wanted : eased;
        withOwnWrite(() => {
          camera.position.copy(controls.target).add(offset.setLength(nextDistance));
          controls.update();
        });
        lastFit.current = nextDistance;
        lastSeenDistance.current = nextDistance;
      }

      /* ----------------------------------------------------- viewIsDefault and spin */
      /*
       * Published OUTSIDE the probe gate, so a production build (which installs no probe) still drives
       * the Reset button. Computed here rather than at the top of the frame because it needs the fit's
       * `frame.dTarget`, which only the live half computes.
       *
       * A store rather than React state: this runs at 60 Hz and `publishViewState` drops a no-change
       * write, so the header only re-renders when one of the two booleans actually moves.
       */
      {
        const dir = orbitDirection(camera, controls);
        const d = orbitDistance(camera, controls);
        const viewIsDefault =
          state === 'idle' &&
          !userZoomed &&
          angleDegBetween(dir, DEFAULT_DIRECTION) <= VIEW_DEFAULT_ANGLE_DEG &&
          Math.abs(d - frame.dTarget) <= VIEW_DEFAULT_DISTANCE;
        /*
         * `hasRegion` is carried from the machine so this frame's publish cannot CLEAR a selection flag
         * that `GlobeScene` set a moment earlier (step 3B2-FIX1 B). It reads the SAME fact the app's
         * `activeRegion` prop expresses — the machine's `regionId` — so the two writers cannot disagree
         * for longer than the frame in which a selection is being handed over.
         */
        publishViewState({
          viewIsDefault,
          spinning: !spin.current.paused,
          hasRegion: machine.current.context.regionId !== null,
        });
      }

      /* ------------------------------------------------------------------- probe */

      if (probe) {
        const camDistance = camera.position.distanceTo(controls.target);
        const dx = easedOffset.current.dx;
        const dy = easedOffset.current.dy;
        const pxError = Math.max(Math.abs(frame.dx - dx), Math.abs(frame.dy - dy));

        const recent = recentDistances.current;
        recent.push(camDistance);
        if (recent.length > 4) recent.shift();
        /* A fold, not `Math.max(...recent)`: the source guard forbids an unbounded spread. */
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of recent) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const spread = recent.length < 4 ? Infinity : hi - lo;
        const distanceQuiet = spread < 2e-4;
        const distanceArrived = Math.abs(frame.dTarget - camDistance) < 0.0005;
        const distanceSettled = rigOwnsDistance.current ? distanceArrived && distanceQuiet : distanceQuiet;

        probe.current = {
          state: {
            mode: 'live',
            insets: { ...insets },
            free: { ...frame.free },
            target: { dx: frame.dx, dy: frame.dy, d: frame.dTarget },
            current: { dx, dy, d: camDistance },
            settled: pxError < 0.05 && distanceSettled,
            degenerate: frame.degenerate,
            cameraViewIsNull: camera.view === null || camera.view.enabled === false,
            /* Step 3B additions — the machine's state, visible so a spec can poll it. */
            focus: machine.current.state,
            userZoomed,
            regionId: machine.current.context.regionId,
            /* Step 3B2 additions. */
            viewIsDefault: getViewState().viewIsDefault,
            spinning: getViewState().spinning,
            hasRegion: getViewState().hasRegion,
            focusPolicy: 'live',
            /** Desktop's ceiling, reported so LM8 can assert 5 without reading the controls. */
            dMax: controls.maxDistance,
          },
        };
      }
    }
  });

  return null;
}
