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
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { RegionId } from '@/types/enso';
import { REGION_MAP, latLonToVector3 } from '@/lib/regions';
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
         * A pose set by the hook changes the distance without the user touching the wheel, and
         * `lastFit` was invalidated by that too — see the header. Set the flag so the fit stays out
         * of the way, exactly as it did before.
         */
        if (lastFit.current !== null && Math.abs(ownDistance.current - lastFit.current) > LAST_FIT_EPSILON) {
          dispatch({ type: 'USER_ZOOM' });
        }
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

  /* ------------------------------------------------------------------------ the frame */

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const stepDt = Math.min(delta, 1 / 30);

    /* ============================================================== 1. the fly-to ====
     *
     * Verbatim from `CameraRig.tsx:85-133`. The `travelling` flag is owned by the machine's states:
     * `focusing` animates toward the selected region, `returning` toward the default pose, and
     * `idle`/`focused` let OrbitControls own the camera entirely.
     */
    const state = machine.current.state;

    if (isTravelling(state)) {
      const region = targetRegion.current;
      if (region) {
        const want = REGION_MAP[region];
        desiredTarget.current.copy(regionDirection(region, spin.current.y));
        desiredDistance.current = want.zoom;
      } else {
        desiredTarget.current.copy(DEFAULT_TARGET);
        desiredDistance.current = DEFAULT_POSITION.length();
      }

      const targetEase = 1 - Math.pow(0.0001, stepDt);
      const distanceEase = 1 - Math.pow(0.0006, stepDt);
      const wanted = desiredDistance.current;

      withOwnWrite(() => {
        /* Damp the orbit target. */
        controls.target.lerp(desiredTarget.current, targetEase);

        /*
         * Ease distance-from-target while preserving the viewing direction, clamped into the
         * controls' own limits so a fly-to can never park the camera outside the range the user may
         * then zoom within.
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
      if (lastFit.current !== null) {
        const d = camera.position.distanceTo(controls.target);
        if (Math.abs(d - lastFit.current) > LAST_FIT_EPSILON) dispatch({ type: 'USER_ZOOM' });
      }

      const targetSettled = controls.target.distanceTo(desiredTarget.current) < 0.004;
      const distanceSettled = Math.abs(camera.position.distanceTo(controls.target) - wanted) < 0.004;
      if (targetSettled && distanceSettled) {
        dispatch(state === 'returning' ? { type: 'RETURNED' } : { type: 'ARRIVED' });
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
          },
        };
      }
    }
  });

  return null;
}
