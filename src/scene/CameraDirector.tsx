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
import { REGION_MAP, latLonToVector3 } from '@/lib/regions';
import {
  ARRIVE_EPSILON_R,
  FLY_DISTANCE_EASE_BASE,
  FLY_TARGET_EASE_BASE,
  easeFactor,
} from '@/camera/easing';
import { arcStep, facingPose, isArrived, type Vec3 } from '@/camera/facing';
import {
  getResetRequest,
  getViewState,
  publishViewState,
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
  const hasApplied = useRef(false);
  const rigOwnsDistance = useRef(true);
  const recentDistances = useRef<number[]>([]);

  /**
   * The distance `userZoomed` was last evaluated against, so a `change` event can tell whether the
   * USER moved it. `null` until the first frame has run (there is no distance to compare yet).
   */
  const lastSeenDistance = useRef<number | null>(null);
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
      withOwnWrite,
      dispatch,
    };

    if (isTravelling(state)) {
      if (IS_LOCKED) {
        runLockedFlyTo(ctx);
      } else {
        runLiveFlyTo(ctx);
      }
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
    } else {
      const w = size.width;
      const h = size.height;
      const insets = getInsets();

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
        publishViewState({ viewIsDefault, spinning: !spin.current.paused });
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
            focusPolicy: 'live',
          },
        };
      }
    }
  });

  return null;
}
